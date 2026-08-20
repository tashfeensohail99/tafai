import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JrWorkReport, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { toLegalDateUtc } from './jr-deadline-engine';
import {
  JrWorkReportCompileService,
  WorkReportBody,
} from './jr-work-report-compile.service';
import {
  CreateWorkReportDto,
  CreateWorkReportNoteDto,
  ListWorkReportsQueryDto,
} from './judicial-review.dto';

const VIEW_ALL = 'jr.report.view_all';
const DAY_MS = 24 * 60 * 60 * 1000;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly compiler: JrWorkReportCompileService,
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

  /** HTML-escape narrative note content (rendered into the PDF in 10C). */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
