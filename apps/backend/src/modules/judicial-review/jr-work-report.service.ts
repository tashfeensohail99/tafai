import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { JrWorkReport, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { StorageService } from '../storage/storage.service';
import { OpenAiService } from '../ai/openai.service';
import { EmailService } from '../email/email.service';
import { JrWorkReportPdfService } from './jr-work-report-pdf.service';
import { toLegalDateUtc } from './jr-deadline-engine';
import {
  JrWorkReportCompileService,
  WorkReportBody,
} from './jr-work-report-compile.service';
import {
  CreateWorkReportDto,
  CreateWorkReportNoteDto,
  EmailWorkReportDto,
  ListWorkReportsQueryDto,
} from './judicial-review.dto';

const VIEW_ALL = 'jr.report.view_all';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Images / voice notes are small; 25 MB is ample for either (mirrors jr-notes). */
const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Ceiling on inline voice-note transcription. A normal recording transcribes in
 * a few seconds; this only trips on a pathologically slow Whisper call and just
 * saves the attachment with transcriptStatus=FAILED rather than holding the
 * request open (mirrors {@link JrNotesService}).
 */
const TRANSCRIBE_TIMEOUT_MS = 60_000;

/**
 * Audio containers a browser MediaRecorder / mobile recorder can realistically
 * emit. `video/webm` is deliberately included — some browsers label an audio-only
 * MediaRecorder blob that way (mirrors jr-notes.service.ts).
 */
const AUDIO_MIME_TYPES = new Set<string>([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/x-m4a',
  'audio/aac',
  'audio/3gpp',
  'video/webm',
]);

const IMAGE_MIME_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/tiff',
]);

/** The hydrated report shape returned by create/getById. */
export interface HydratedWorkReport {
  report: {
    id: string;
    subjectAssociateUserId: string;
    subjectName: string | null;
    periodFrom: Date;
    periodTo: Date;
    status: JrWorkReport['status'];
    canViewAllAtCompile: boolean;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
    // frozenPdf* stay NULL in 10A (finalize lands in 10C).
    frozenPdfKey: string | null;
    frozenPdfSha256: string | null;
  };
  body: WorkReportBody;
  notes: Array<{ id: string; authorUserId: string; content: string; createdAt: Date }>;
  // Attachments are METADATA ONLY in 10A — no signed URLs (those land in 10B).
  attachments: Array<{
    id: string;
    kind: string;
    mimeType: string | null;
    durationMs: number | null;
    transcript: string | null;
    transcriptStatus: string;
    createdAt: Date;
  }>;
}

/**
 * The JR associate work-report store (§11.7, PR 10A). Persists ONLY the
 * parameters + provenance + manual enrichments — the body is never stored, it is
 * recompiled live on every read via {@link JrWorkReportCompileService}.
 *
 * The subject is ALWAYS resolved server-side: a caller without jr.report.view_all
 * has any supplied subjectAssociateId actively OVERRIDDEN to their own id. Every
 * scoped query ANDs the scope in via AND:[] (never a bare {OR} sibling — #253).
 */
@Injectable()
export class JrWorkReportService {
  private readonly logger = new Logger(JrWorkReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly compiler: JrWorkReportCompileService,
    private readonly storage: StorageService,
    private readonly openai: OpenAiService,
    private readonly pdf: JrWorkReportPdfService,
    private readonly email: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Create (compile) + read
  // ---------------------------------------------------------------------------

  /**
   * Create (or return the existing DRAFT for) a work report. The subject is
   * resolved server-side; the @@unique(subject, from, to, status) gives DB-level
   * double-click idempotency — a repeat returns the existing DRAFT rather than a
   * duplicate.
   */
  async create(dto: CreateWorkReportDto, user: RequestUser): Promise<HydratedWorkReport> {
    const canViewAll = user.permissions.includes(VIEW_ALL);
    // Resolve subject SERVER-SIDE: a non-view_all caller is forced to themselves.
    const subjectAssociateUserId = canViewAll
      ? dto.subjectAssociateId ?? user.id
      : user.id;

    const periodFrom = toLegalDateUtc(dto.periodFrom);
    const periodTo = toLegalDateUtc(dto.periodTo);
    if (periodFrom.getTime() > periodTo.getTime()) {
      throw new BadRequestException('periodFrom must be on or before periodTo.');
    }

    // Idempotency: reuse an existing DRAFT for the same (subject, period).
    const existing = await this.prisma.jrWorkReport.findFirst({
      where: { subjectAssociateUserId, periodFrom, periodTo, status: 'DRAFT' },
    });
    if (existing) return this.hydrate(existing, canViewAll);

    let report: JrWorkReport;
    try {
      report = await this.prisma.jrWorkReport.create({
        data: {
          subjectAssociateUserId,
          periodFrom,
          periodTo,
          canViewAllAtCompile: canViewAll,
          status: 'DRAFT',
          createdByUserId: user.id,
        },
      });
    } catch (err) {
      // A concurrent double-click can lose the findFirst race — the @@unique then
      // rejects the loser; return the row the winner created.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const winner = await this.prisma.jrWorkReport.findFirst({
          where: { subjectAssociateUserId, periodFrom, periodTo, status: 'DRAFT' },
        });
        if (winner) return this.hydrate(winner, canViewAll);
      }
      throw err;
    }

    return this.hydrate(report, canViewAll);
  }

  /**
   * Load one report + its LIVE compiled body + non-deleted notes + attachment
   * metadata. A non-view_all caller may only read a report about themselves.
   */
  async getById(id: string, user: RequestUser): Promise<HydratedWorkReport> {
    const report = await this.prisma.jrWorkReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Work report not found');
    this.assertReadable(report, user);
    return this.hydrate(report, user.permissions.includes(VIEW_ALL));
  }

  /**
   * List reports visible to the caller. view_all sees all; everyone else sees only
   * reports about themselves. The scope is ALWAYS ANDed in (never a bare sibling).
   */
  async list(
    query: ListWorkReportsQueryDto,
    user: RequestUser,
  ): Promise<
    Array<{
      id: string;
      subjectAssociateUserId: string;
      periodFrom: Date;
      periodTo: Date;
      status: JrWorkReport['status'];
      createdByUserId: string;
      createdAt: Date;
    }>
  > {
    const scope: Prisma.JrWorkReportWhereInput = user.permissions.includes(VIEW_ALL)
      ? {}
      : { subjectAssociateUserId: user.id };

    const filters: Prisma.JrWorkReportWhereInput[] = [];
    if (query.status) filters.push({ status: query.status });

    const rows = await this.prisma.jrWorkReport.findMany({
      where: { AND: [scope, ...filters] },
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 50,
      select: {
        id: true,
        subjectAssociateUserId: true,
        periodFrom: true,
        periodTo: true,
        status: true,
        createdByUserId: true,
        createdAt: true,
      },
    });
    return rows;
  }

  /**
   * The pickable-subject list. A view_all caller gets every active JR associate /
   * head; everyone else gets only themselves.
   */
  async subjects(
    user: RequestUser,
  ): Promise<Array<{ id: string; email: string; name: string }>> {
    if (user.permissions.includes(VIEW_ALL)) {
      const users = await this.prisma.userAccount.findMany({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          userRoles: { some: { role: { name: { in: ['jr_associate', 'jr_head'] } } } },
        },
        select: {
          id: true,
          email: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      return users
        .map((u) => ({
          id: u.id,
          email: u.email,
          name: this.displayName(u.employee, u.email),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    const self = await this.prisma.userAccount.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    if (!self) return [];
    return [{ id: self.id, email: self.email, name: this.displayName(self.employee, self.email) }];
  }

  // ---------------------------------------------------------------------------
  // Report-level notes (DRAFT-only, author-attributed, soft-delete)
  // ---------------------------------------------------------------------------

  async addNote(
    id: string,
    dto: CreateWorkReportNoteDto,
    user: RequestUser,
  ): Promise<HydratedWorkReport> {
    const report = await this.prisma.jrWorkReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Work report not found');
    this.assertReadable(report, user);
    this.assertDraft(report);

    await this.prisma.jrWorkReportNote.create({
      data: {
        reportId: id,
        authorUserId: user.id,
        content: this.escapeHtml(dto.content),
      },
    });
    return this.hydrate(report, user.permissions.includes(VIEW_ALL));
  }

  async deleteNote(
    id: string,
    noteId: string,
    user: RequestUser,
  ): Promise<HydratedWorkReport> {
    const report = await this.prisma.jrWorkReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Work report not found');
    this.assertReadable(report, user);
    this.assertDraft(report);

    const note = await this.prisma.jrWorkReportNote.findFirst({
      where: { id: noteId, reportId: id, deletedAt: null },
    });
    if (!note) throw new NotFoundException('Report note not found');

    await this.prisma.jrWorkReportNote.update({
      where: { id: noteId },
      data: { deletedAt: new Date() },
    });
    return this.hydrate(report, user.permissions.includes(VIEW_ALL));
  }

  // ---------------------------------------------------------------------------
  // Media enrichments (§11.7, PR 10B) — image + voice notes, DRAFT-only
  // ---------------------------------------------------------------------------

  /**
   * Attach an image (screenshot / photo) to a DRAFT report. The object is
   * uploaded first, then the row is written; if the DB write fails the now-
   * orphaned object is deleted best-effort so a failed create never leaks bytes.
   * Only a durable storageKey is stored — reads mint a fresh signed URL on demand.
   */
  async addImage(
    reportId: string,
    file: Express.Multer.File | undefined,
    user: RequestUser,
  ): Promise<HydratedWorkReport> {
    const report = await this.prisma.jrWorkReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Work report not found');
    this.assertReadable(report, user);
    this.assertDraft(report);
    this.assertUploadable(file, IMAGE_MIME_TYPES);

    const uploaded = await this.storage.upload(
      file!.buffer,
      file!.mimetype,
      `jr/work-reports/${reportId}`,
      file!.originalname,
    );

    try {
      await this.prisma.jrWorkReportAttachment.create({
        data: {
          reportId,
          kind: 'IMAGE',
          storageKey: uploaded.key,
          mimeType: uploaded.mimeType,
          createdByUserId: user.id,
        },
      });
    } catch (err) {
      await this.storage.delete(uploaded.key).catch(() => undefined);
      throw err;
    }

    return this.hydrate(report, user.permissions.includes(VIEW_ALL));
  }

  /**
   * Attach a voice note to a DRAFT report. The clip is uploaded, then transcribed
   * best-effort inline (Whisper + Roman-Urdu; bounded by a timeout race, never
   * throws): a non-null transcript → transcriptStatus DONE, null/timeout → FAILED.
   * DB-write failure deletes the orphaned object (mirrors {@link addImage}).
   */
  async addVoice(
    reportId: string,
    file: Express.Multer.File | undefined,
    user: RequestUser,
  ): Promise<HydratedWorkReport> {
    const report = await this.prisma.jrWorkReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Work report not found');
    this.assertReadable(report, user);
    this.assertDraft(report);
    this.assertUploadable(file, AUDIO_MIME_TYPES);

    const uploaded = await this.storage.upload(
      file!.buffer,
      file!.mimetype,
      `jr/work-reports/${reportId}`,
      file!.originalname,
    );

    const tr = await this.transcribeBounded(
      file!.buffer,
      file!.originalname || 'voice-note.webm',
      TRANSCRIBE_TIMEOUT_MS,
    );

    try {
      await this.prisma.jrWorkReportAttachment.create({
        data: {
          reportId,
          kind: 'VOICE_NOTE',
          storageKey: uploaded.key,
          mimeType: uploaded.mimeType,
          durationMs: null,
          audioCodecExt: this.fileExt(file!.originalname),
          transcript: tr?.text ?? null,
          transcriptStatus: tr ? 'DONE' : 'FAILED',
          createdByUserId: user.id,
        },
      });
    } catch (err) {
      await this.storage.delete(uploaded.key).catch(() => undefined);
      throw err;
    }

    return this.hydrate(report, user.permissions.includes(VIEW_ALL));
  }

  /**
   * Soft-delete an attachment on a DRAFT report. The reportId match is the IDOR
   * guard — a stranger's attachmentId under this report 404s. The storage object
   * is intentionally KEPT (soft-delete only, no bytes are removed).
   */
  async deleteAttachment(
    reportId: string,
    attachmentId: string,
    user: RequestUser,
  ): Promise<HydratedWorkReport> {
    const report = await this.prisma.jrWorkReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Work report not found');
    this.assertReadable(report, user);
    this.assertDraft(report);

    const attachment = await this.prisma.jrWorkReportAttachment.findFirst({
      where: { id: attachmentId, reportId, deletedAt: null },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    await this.prisma.jrWorkReportAttachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() },
    });
    return this.hydrate(report, user.permissions.includes(VIEW_ALL));
  }

  /**
   * Mint a short-lived signed URL for an attachment. Reads are allowed on a
   * FINALIZED report too (NO assertDraft), so this only checks own-or-view_all.
   * The reportId match is the IDOR guard (§11.7 correction). The raw storageKey
   * is never returned.
   */
  async attachmentSignedUrl(
    reportId: string,
    attachmentId: string,
    user: RequestUser,
  ): Promise<{ url: string }> {
    const report = await this.prisma.jrWorkReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Work report not found');
    this.assertReadable(report, user);

    const attachment = await this.prisma.jrWorkReportAttachment.findFirst({
      where: { id: attachmentId, reportId, deletedAt: null },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    return { url: await this.storage.getSignedUrl(attachment.storageKey) };
  }

  // ---------------------------------------------------------------------------
  // Render / finalize / email (§11.7, PR 10C)
  // ---------------------------------------------------------------------------

  /**
   * Render the report as a branded PDF (own-or-view_all, enforced by getById).
   * A FINALIZED report streams the FROZEN object so the served bytes are the
   * immutable snapshot filed at finalize; a DRAFT renders the live body.
   */
  async renderPdf(id: string, user: RequestUser): Promise<{ buffer: Buffer; fileName: string }> {
    const report = await this.prisma.jrWorkReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Work report not found');
    this.assertReadable(report, user);

    // A PDF is a downloadable/emailable/shareable artifact — and a FINALIZED
    // report's PDF is downloadable by the (non-view_all) subject. So HEAD_ONLY
    // case-notes are NEVER rendered into a PDF; they stay a live, on-screen,
    // view_all-only surface (mirrors finalize).
    const hydrated = await this.hydrate(report, false);
    const fileName = this.pdfFileName(hydrated);

    if (report.status === 'FINALIZED' && report.frozenPdfKey) {
      const { bytes } = await this.storage.download(report.frozenPdfKey);
      return { buffer: bytes, fileName };
    }
    const buffer = await this.pdf.render(hydrated);
    return { buffer, fileName };
  }

  /**
   * Finalize a DRAFT report into an immutable, tamper-evident PDF snapshot.
   *
   * CORRECTION #1 (canonical): the PDF is rendered AND proven durable BEFORE the
   * status is mutated. Render throws when Chromium is absent; the post-upload
   * read-back throws in StorageService LOCAL mode (download is unsupported there)
   * — so neither a zero-byte phantom nor an un-persisted stub can ever lock the
   * enrichments. Only once real bytes have round-tripped do we flip to FINALIZED.
   */
  async finalize(id: string, user: RequestUser): Promise<HydratedWorkReport> {
    const report = await this.prisma.jrWorkReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Work report not found');
    this.assertReadable(report, user);
    this.assertDraft(report);

    // Hydrate with HEAD_ONLY EXCLUDED: the frozen PDF is downloadable by the
    // (non-view_all) subject and emailable to anyone, so it must never carry
    // HEAD_ONLY case-notes — those stay a live, view_all-only, on-screen surface.
    const hydrated = await this.hydrate(report, false);

    // (a) Render first — throws without Chromium; a zero-byte render is refused.
    const buffer = await this.pdf.render(hydrated);
    if (!buffer || buffer.length === 0) {
      throw new ServiceUnavailableException(
        'Cannot finalize: the PDF engine produced no output. Finalize aborted (nothing was locked).',
      );
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const frozenKey = `jr/work-reports/${id}/report-${Date.now()}-${sha256.slice(0, 8)}.pdf`;

    // (b) Persist to a durable, caller-chosen key, then PROVE it round-trips.
    // StorageService LOCAL mode makes download() throw here → status untouched.
    await this.storage.uploadAt(frozenKey, buffer, 'application/pdf');
    let readback: { bytes: Buffer };
    try {
      readback = await this.storage.download(frozenKey);
    } catch (err) {
      throw new ServiceUnavailableException(
        'Cannot finalize: durable PDF storage is unavailable (local mode). Finalize aborted (nothing was locked). ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
    const readbackSha = createHash('sha256').update(readback.bytes).digest('hex');
    if (readbackSha !== sha256) {
      // Best-effort cleanup of the mismatched object; leave status DRAFT.
      await this.storage.delete(frozenKey).catch(() => undefined);
      throw new ServiceUnavailableException(
        'Cannot finalize: the stored PDF did not match what was rendered. Finalize aborted (nothing was locked).',
      );
    }

    // (c) Only now — with proven bytes — flip the status in one update.
    const snapshotMeta: Prisma.InputJsonValue = {
      subjectName: hydrated.report.subjectName ?? null,
      period: {
        from: hydrated.report.periodFrom.toISOString(),
        to: hydrated.report.periodTo.toISOString(),
      },
      hasActivity: hydrated.body.hasActivity,
      summary: hydrated.body.summary,
      finalizedAt: new Date().toISOString(),
    };
    const matterIdsSnapshot: Prisma.InputJsonValue = hydrated.body.matters.map(
      (m) => m.matterId,
    );

    let updated: JrWorkReport;
    try {
      updated = await this.prisma.jrWorkReport.update({
        where: { id },
        data: {
          status: 'FINALIZED',
          frozenPdfKey: frozenKey,
          frozenPdfSha256: sha256,
          snapshotMeta,
          matterIdsSnapshot,
        },
      });
    } catch (err) {
      // The @@unique(subject, period, status) can collide if a FINALIZED report
      // for the same (subject, period) already exists — surface it as a conflict.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'A finalized report already exists for this associate and period.',
        );
      }
      throw err;
    }

    this.logger.log(`Finalized work report ${id} → ${frozenKey} (${buffer.length} bytes)`);
    return this.hydrate(updated, user.permissions.includes(VIEW_ALL));
  }

  /**
   * Email the report PDF to explicit recipients (or the caller as the default).
   * Gated at the controller by jr.report.share. getById enforces own-or-view_all.
   */
  async emailReport(
    id: string,
    dto: EmailWorkReportDto,
    user: RequestUser,
  ): Promise<{ sent: boolean; recipients: string[] }> {
    const recipients = (dto.emails && dto.emails.length ? dto.emails : [user.email])
      .map((e) => e.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      throw new BadRequestException('No recipients — provide at least one email address.');
    }

    const hydrated = await this.getById(id, user);
    const { buffer, fileName } = await this.renderPdf(id, user);

    const sent = await this.email.sendJrWorkReport({
      to: recipients,
      subjectName: hydrated.report.subjectName ?? 'JR associate',
      periodLabel: this.periodLabel(hydrated),
      status: hydrated.report.status,
      note: dto.note ?? null,
      pdf: buffer,
      fileName,
    });
    return { sent, recipients };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** A non-view_all caller may only touch a report whose subject is themselves. */
  private assertReadable(report: JrWorkReport, user: RequestUser): void {
    if (user.permissions.includes(VIEW_ALL)) return;
    if (report.subjectAssociateUserId !== user.id) {
      throw new ForbiddenException('You can only access your own work reports.');
    }
  }

  private assertDraft(report: JrWorkReport): void {
    if (report.status !== 'DRAFT') {
      throw new UnprocessableEntityException(
        'This report is FINALIZED — its enrichments are locked.',
      );
    }
  }

  /**
   * Recompute the body + reload enrichments for a report. `canViewAll` is the
   * LIVE reader's permission (NOT report.canViewAllAtCompile) — it gates whether
   * HEAD_ONLY case notes appear, so a non-view_all subject reading a report a Head
   * compiled about them never sees HEAD_ONLY material (which is hidden from them
   * everywhere else). canViewAllAtCompile is retained only to reproduce the frozen
   * 10C snapshot, never for live-read gating.
   */
  private async hydrate(report: JrWorkReport, canViewAll: boolean): Promise<HydratedWorkReport> {
    // Inclusive window: [periodFrom 00:00:00 UTC, periodTo 23:59:59.999 UTC].
    const from = new Date(report.periodFrom);
    const to = new Date(report.periodTo.getTime() + DAY_MS - 1);

    const body = await this.compiler.compileBody({
      subjectAssociateUserId: report.subjectAssociateUserId,
      periodFrom: from,
      periodTo: to,
      canViewAll,
    });

    const notes = await this.prisma.jrWorkReportNote.findMany({
      where: { reportId: report.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, authorUserId: true, content: true, createdAt: true },
    });

    const attachments = await this.prisma.jrWorkReportAttachment.findMany({
      where: { reportId: report.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        mimeType: true,
        durationMs: true,
        transcript: true,
        transcriptStatus: true,
        createdAt: true,
      },
    });

    const subject = await this.prisma.userAccount.findUnique({
      where: { id: report.subjectAssociateUserId },
      select: { email: true, employee: { select: { firstName: true, lastName: true } } },
    });

    return {
      report: {
        id: report.id,
        subjectAssociateUserId: report.subjectAssociateUserId,
        subjectName: subject
          ? this.displayName(subject.employee, subject.email)
          : null,
        periodFrom: report.periodFrom,
        periodTo: report.periodTo,
        status: report.status,
        canViewAllAtCompile: report.canViewAllAtCompile,
        createdByUserId: report.createdByUserId,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
        frozenPdfKey: report.frozenPdfKey,
        frozenPdfSha256: report.frozenPdfSha256,
      },
      body,
      notes,
      attachments,
    };
  }

  private displayName(
    employee: { firstName: string; lastName: string } | null,
    email: string,
  ): string {
    const name = employee ? `${employee.firstName} ${employee.lastName}`.trim() : '';
    return name || email;
  }

  /** A short YYYY-MM-DD → YYYY-MM-DD period label for the PDF / email subject. */
  private periodLabel(hydrated: HydratedWorkReport): string {
    const from = hydrated.report.periodFrom.toISOString().slice(0, 10);
    const to = hydrated.report.periodTo.toISOString().slice(0, 10);
    return `${from} to ${to}`;
  }

  /** Deterministic download filename for the report PDF. */
  private pdfFileName(hydrated: HydratedWorkReport): string {
    const from = hydrated.report.periodFrom.toISOString().slice(0, 10);
    const to = hydrated.report.periodTo.toISOString().slice(0, 10);
    return `jr-work-report-${from}_${to}-${hydrated.report.id.slice(0, 8)}.pdf`;
  }

  /** HTML-escape narrative note content (rendered into the PDF in 10C). */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Size + MIME allowlist guard for an uploaded attachment (mirrors jr-notes). */
  private assertUploadable(
    file: Express.Multer.File | undefined,
    allowed: Set<string>,
  ): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException(
        'No file provided. Use multipart/form-data with field name "file".',
      );
    }
    if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
      throw new BadRequestException('File exceeds the 25 MB limit.');
    }
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException(
        `Files of type ${file.mimetype} are not allowed. Allowed: ${[...allowed].join(', ')}.`,
      );
    }
  }

  /** Best-effort transcription with a hard timeout (see TRANSCRIBE_TIMEOUT_MS). */
  private async transcribeBounded(
    buffer: Buffer,
    filename: string,
    ms: number,
  ): Promise<{ text: string; latencyMs: number } | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });
    try {
      return await Promise.race([this.openai.transcribe(buffer, filename), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Lower-cased file extension (capped to the column width), or null. */
  private fileExt(filename?: string): string | null {
    if (!filename) return null;
    const dot = filename.lastIndexOf('.');
    if (dot < 0 || dot === filename.length - 1) return null;
    return filename.slice(dot + 1).toLowerCase().slice(0, 20);
  }
}
