import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  JrArtifact,
  JrArtifactFolder,
  JrArtifactStatus,
  JrArtifactType,
  JrArtifactVersion,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { StorageService } from '../storage/storage.service';
import { JudicialReviewService } from './judicial-review.service';
import {
  CarryToRedeterminationDto,
  CounselReviewDto,
  CreateArtifactDto,
  FileArtifactDto,
  ServeArtifactDto,
} from './judicial-review.dto';

/**
 * The set of artifacts that are actually filed with the Federal Court and must
 * therefore carry a recorded counsel approval before they can leave the desk.
 * Received documents (GCMS notes, Rule 9 responses received, the refusal
 * letter) are NOT in this set — they skip the gate (§5.2).
 */
const COURT_FILED_TYPES = new Set<JrArtifactType>([
  'ALJR_FORM_IR1',
  'AR_AFFIDAVIT',
  'MEMORANDUM_OF_ARGUMENT',
  'APPLICANTS_RECORD',
  'APPLICANTS_RECORD_TOC',
  'APPLICANTS_RECORD_BACKPAGE',
  'ANONYMITY_REQUEST',
  'REPLY_MEMORANDUM',
  'NOTICE_OF_DISCONTINUANCE',
  'CERTIFICATE_OF_SERVICE',
]);

/**
 * The ALJR / Form IR-1 artifact. When it is SERVED, the matter's r.7(2) deadline
 * anchor (`proofOfServiceFiledAt`) is DERIVED from that service date — it is
 * never entered independently (§5.4).
 */
const ALJR_TYPES = new Set<JrArtifactType>(['ALJR_FORM_IR1', 'ALJR_STAMPED_FILED']);

/** Statuses that render under the finalised "Files" folder (§5.3). */
const FILES_STATUSES = new Set<JrArtifactStatus>(['COUNSEL_APPROVED', 'FILED', 'SERVED']);

/** Display order for the grouped artifact list. */
const FOLDER_ORDER: JrArtifactFolder[] = [
  'CLIENT_APPLICATION_DOCUMENTS',
  'ENGAGEMENT',
  'JUDICIAL_REVIEW_RAW',
  'JUDICIAL_REVIEW_FILES',
  'SETTLEMENT',
  'REDETERMINATION',
];

/** A positive MIME allowlist — no virus scanner exists, so only known-safe
 *  document/image types are accepted (§9 upload). */
const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]);

const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * The JR artifact store + lifecycle. JR documents live in their OWN store —
 * under the key prefix jr/matters/${matterId} — never the shared client
 * databank, so a processing officer on the same client can't read counsel
 * correspondence, draft memoranda or merits opinions. Versions are append-only;
 * artifacts are soft-deleted via deletedAt.
 *
 * PR 2 adds the lifecycle transitions and the counsel-approval gate
 * (`assertFilable`). Every mutation is access-checked against the owning matter
 * and writes a JrAuditLog row inside the same transaction.
 */
@Injectable()
export class JrArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jr: JudicialReviewService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read surface
  // ---------------------------------------------------------------------------

  /** List a matter's artifacts (excludes soft-deleted), in filing order. */
  async listForMatter(matterId: string): Promise<JrArtifact[]> {
    return this.prisma.jrArtifact.findMany({
      where: { matterId, deletedAt: null },
      orderBy: [{ folder: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  /**
   * List a matter's artifacts grouped by DISPLAY folder, ordered by sortOrder.
   * The Raw/Files split is computed from status without mutating the stored
   * `folder` (§5.3).
   */
  async listGroupedForMatter(matterId: string, user: RequestUser) {
    await this.jr.assertMatterAccess(matterId, user);
    const artifacts = await this.listForMatter(matterId);

    const byFolder = new Map<JrArtifactFolder, (JrArtifact & { displayFolder: JrArtifactFolder })[]>();
    for (const a of artifacts) {
      const displayFolder = this.displayFolder(a);
      const list = byFolder.get(displayFolder) ?? [];
      list.push({ ...a, displayFolder });
      byFolder.set(displayFolder, list);
    }

    const folders = FOLDER_ORDER.filter((f) => byFolder.has(f)).map((folder) => ({
      folder,
      artifacts: (byFolder.get(folder) ?? []).sort(
        (x, y) => x.sortOrder - y.sortOrder || x.title.localeCompare(y.title),
      ),
    }));

    return { folders };
  }

  /**
   * The counsel-review queue: every artifact currently in COUNSEL_REVIEW across
   * all matters, oldest first, joined to its matter's style-of-cause. The
   * `nearestFatalDeadline` is a TODO until the JrDeadline engine ships (PR 3).
   */
  async counselQueue() {
    const artifacts = await this.prisma.jrArtifact.findMany({
      where: { status: 'COUNSEL_REVIEW', deletedAt: null },
      // counselReviewedAt is null while in review, so submit time (updatedAt,
      // last touched by the submit transition) is the ordering key — oldest
      // waiting first.
      orderBy: [{ counselReviewedAt: 'asc' }, { updatedAt: 'asc' }],
      include: {
        matter: {
          select: { id: true, matterNumber: true, styleOfCause: true, stage: true },
        },
      },
    });

    return artifacts.map((a) => ({
      artifactId: a.id,
      matterId: a.matterId,
      matterNumber: a.matter.matterNumber,
      styleOfCause: a.matter.styleOfCause,
      artifactType: a.artifactType,
      title: a.title,
      submittedAt: a.updatedAt,
      nearestFatalDeadline: null as null, // TODO(PR3): join JrDeadline once populated
    }));
  }

  /** Mint a short-lived signed URL for a version, after matter access. */
  async getVersionUrlForUser(
    artifactId: string,
    versionId: string,
    user: RequestUser,
  ): Promise<{ url: string; fileName: string; mimeType: string }> {
    const artifact = await this.resolveArtifact(artifactId);
    await this.jr.assertMatterAccess(artifact.matterId, user);
    const version = await this.prisma.jrArtifactVersion.findFirst({
      where: { id: versionId, artifactId },
    });
    if (!version) throw new NotFoundException('Version not found');
    const url = await this.storage.getSignedUrl(version.storageKey);
    return { url, fileName: version.fileName, mimeType: version.mimeType };
  }

  // ---------------------------------------------------------------------------
  // Create + versions
  // ---------------------------------------------------------------------------

  /** Create a DRAFT artifact under a matter. */
  async createArtifact(matterId: string, dto: CreateArtifactDto, user: RequestUser): Promise<JrArtifact> {
    await this.jr.assertMatterAccess(matterId, user);

    return this.prisma.$transaction(async (tx) => {
      const artifact = await tx.jrArtifact.create({
        data: {
          matterId,
          artifactType: dto.artifactType,
          folder: dto.folder,
          title: dto.title,
          sortOrder: dto.sortOrder ?? 0,
          status: 'DRAFT',
          authorUserId: user.id,
        },
      });
      await this.writeAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'artifact_created',
        entityId: artifact.id,
        newValues: {
          artifactType: dto.artifactType,
          folder: dto.folder,
          title: dto.title,
        },
      });
      return artifact;
    });
  }

  /**
   * Upload a new, current version of an artifact. Never deletes prior versions;
   * the previous current row is simply flipped to isCurrent=false. If the
   * artifact was COUNSEL_CHANGES_REQUESTED, a new version resets status→DRAFT and
   * CLEARS the approval fields — the prior approval no longer attaches to any
   * current version.
   */
  async addVersion(
    artifactId: string,
    file: { buffer: Buffer; mimeType: string; originalName: string },
    uploadedByUserId: string,
    changeNote?: string,
  ): Promise<JrArtifactVersion> {
    const artifact = await this.prisma.jrArtifact.findFirst({
      where: { id: artifactId, deletedAt: null },
    });
    if (!artifact) throw new NotFoundException('Artifact not found');

    const uploaded = await this.storage.upload(
      file.buffer,
      file.mimeType,
      `jr/matters/${artifact.matterId}`,
      file.originalName,
    );

    return this.prisma.$transaction(async (tx) => {
      const last = await tx.jrArtifactVersion.findFirst({
        where: { artifactId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const versionNumber = (last?.versionNumber ?? 0) + 1;

      await tx.jrArtifactVersion.updateMany({
        where: { artifactId, isCurrent: true },
        data: { isCurrent: false },
      });

      return tx.jrArtifactVersion.create({
        data: {
          artifactId,
          versionNumber,
          storageKey: uploaded.key,
          fileName: file.originalName,
          mimeType: uploaded.mimeType,
          fileSizeBytes: uploaded.sizeBytes,
          changeNote: changeNote ?? null,
          uploadedByUserId,
          isCurrent: true,
        },
      });
    });
  }

  /**
   * Endpoint wrapper: upload a version via multipart, after matter access and a
   * positive MIME/size check. Reuses `addVersion`; then, in its own transaction,
   * resets a COUNSEL_CHANGES_REQUESTED artifact back to DRAFT (clearing the stale
   * approval) and writes the audit row.
   */
  async uploadVersion(
    artifactId: string,
    file: Express.Multer.File | undefined,
    user: RequestUser,
    changeNote?: string,
  ) {
    const artifact = await this.resolveArtifact(artifactId);
    await this.jr.assertMatterAccess(artifact.matterId, user);
    this.assertUploadable(file);

    const version = await this.addVersion(
      artifactId,
      { buffer: file!.buffer, mimeType: file!.mimetype, originalName: file!.originalname },
      user.id,
      changeNote,
    );

    // A new version INVALIDATES any counsel review already recorded OR in flight.
    // Once the content changes, an earlier approval — or an in-progress review
    // whose subject just changed under counsel — can no longer stand. Any of
    // COUNSEL_REVIEW / COUNSEL_APPROVED / COUNSEL_CHANGES_REQUESTED drops back to
    // a clean DRAFT with the approval cleared, so counsel can only ever approve
    // the version that stays current through review — the whole point of the
    // gate. (Resetting from COUNSEL_REVIEW is what stops a version swapped in
    // mid-review from being approved as though counsel had seen it.)
    const invalidatesReview =
      artifact.status === 'COUNSEL_REVIEW' ||
      artifact.status === 'COUNSEL_APPROVED' ||
      artifact.status === 'COUNSEL_CHANGES_REQUESTED';

    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.JrArtifactUpdateInput = invalidatesReview
        ? {
            status: 'DRAFT',
            counselApprovedVersionId: null,
            counselReviewedById: null,
            counselReviewedAt: null,
            changesRequestedAt: null,
            changesRequestedNote: null,
            counselComments: null,
          }
        : {};
      const next = invalidatesReview
        ? await tx.jrArtifact.update({ where: { id: artifactId }, data })
        : artifact;
      await this.writeAudit(tx, {
        matterId: artifact.matterId,
        actorUserId: user.id,
        action: 'artifact_version_uploaded',
        entityId: artifactId,
        oldValues: { status: artifact.status },
        newValues: {
          versionId: version.id,
          versionNumber: version.versionNumber,
          status: next.status,
          approvalCleared: invalidatesReview,
        },
      });
      return next;
    });

    return { artifact: updated, version };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle transitions
  // ---------------------------------------------------------------------------

  /** DRAFT → INTERNAL_QA. */
  async markInternalQa(artifactId: string, user: RequestUser): Promise<JrArtifact> {
    const artifact = await this.resolveArtifact(artifactId);
    await this.jr.assertMatterAccess(artifact.matterId, user);
    this.assertStatus(artifact, 'DRAFT', 'move to internal QA');

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrArtifact.update({
        where: { id: artifactId },
        data: {
          status: 'INTERNAL_QA',
          internalQaByUserId: user.id,
          internalQaAt: new Date(),
        },
      });
      await this.writeAudit(tx, {
        matterId: artifact.matterId,
        actorUserId: user.id,
        action: 'artifact_internal_qa',
        entityId: artifactId,
        oldValues: { status: artifact.status },
        newValues: { status: next.status },
      });
      return next;
    });
  }

  /** INTERNAL_QA → COUNSEL_REVIEW. Freezes the current version as the subject. */
  async submitToCounsel(artifactId: string, user: RequestUser): Promise<JrArtifact> {
    const artifact = await this.resolveArtifact(artifactId);
    await this.jr.assertMatterAccess(artifact.matterId, user);
    this.assertStatus(artifact, 'INTERNAL_QA', 'submit to counsel');

    const current = await this.currentVersion(artifactId);
    if (!current) {
      throw new UnprocessableEntityException(
        'Cannot submit for review: the artifact has no uploaded version.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrArtifact.update({
        where: { id: artifactId },
        data: { status: 'COUNSEL_REVIEW' },
      });
      await this.writeAudit(tx, {
        matterId: artifact.matterId,
        actorUserId: user.id,
        action: 'artifact_submitted_for_review',
        entityId: artifactId,
        oldValues: { status: artifact.status },
        // The review SUBJECT: exactly which version counsel is looking at.
        newValues: {
          status: next.status,
          reviewSubjectVersionId: current.id,
          reviewSubjectVersionNumber: current.versionNumber,
        },
      });
      return next;
    });
  }

  /** COUNSEL_REVIEW → COUNSEL_APPROVED | COUNSEL_CHANGES_REQUESTED. */
  async recordCounselReview(
    artifactId: string,
    dto: CounselReviewDto,
    user: RequestUser,
  ): Promise<JrArtifact> {
    const artifact = await this.resolveArtifact(artifactId);
    await this.jr.assertMatterAccess(artifact.matterId, user);
    this.assertStatus(artifact, 'COUNSEL_REVIEW', 'record a counsel review');

    const counsel = await this.prisma.jrCounsel.findFirst({
      where: { id: dto.counselId, isActive: true },
    });
    if (!counsel) {
      throw new BadRequestException('Counsel not found or not active');
    }

    const now = new Date();

    if (dto.decision === 'APPROVE') {
      const current = await this.currentVersion(artifactId);
      if (!current) {
        throw new UnprocessableEntityException(
          'Cannot approve: the artifact has no current version.',
        );
      }
      return this.prisma.$transaction(async (tx) => {
        const next = await tx.jrArtifact.update({
          where: { id: artifactId },
          data: {
            status: 'COUNSEL_APPROVED',
            counselReviewedById: dto.counselId,
            counselReviewedAt: now,
            counselApprovedVersionId: current.id,
            counselReviewRecordedByUserId: user.id,
            counselComments: dto.counselComments ?? null,
            changesRequestedAt: null,
            changesRequestedNote: null,
          },
        });
        await this.writeAudit(tx, {
          matterId: artifact.matterId,
          actorUserId: user.id,
          action: 'artifact_counsel_approved',
          entityId: artifactId,
          oldValues: { status: artifact.status },
          newValues: {
            status: next.status,
            counselId: dto.counselId,
            counselApprovedVersionId: current.id,
            counselReviewRecordedByUserId: user.id,
          },
        });
        return next;
      });
    }

    // REQUEST_CHANGES
    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrArtifact.update({
        where: { id: artifactId },
        data: {
          status: 'COUNSEL_CHANGES_REQUESTED',
          changesRequestedAt: now,
          changesRequestedNote: dto.changesRequestedNote ?? null,
          counselComments: dto.counselComments ?? null,
          counselReviewRecordedByUserId: user.id,
        },
      });
      await this.writeAudit(tx, {
        matterId: artifact.matterId,
        actorUserId: user.id,
        action: 'artifact_changes_requested',
        entityId: artifactId,
        oldValues: { status: artifact.status },
        newValues: {
          status: next.status,
          counselId: dto.counselId,
          changesRequestedNote: dto.changesRequestedNote ?? null,
        },
      });
      return next;
    });
  }

  /** COUNSEL_APPROVED → FILED. The counsel-approval gate runs FIRST. */
  async fileArtifact(artifactId: string, dto: FileArtifactDto, user: RequestUser): Promise<JrArtifact> {
    const pre = await this.resolveArtifact(artifactId);
    await this.jr.assertMatterAccess(pre.matterId, user);

    const filedAt = dto.filedAt ? new Date(dto.filedAt) : new Date();
    const registryStampedAt = dto.registryStampedAt ? new Date(dto.registryStampedAt) : filedAt;

    return this.prisma.$transaction(async (tx) => {
      // Re-read the artifact + its current version INSIDE the transaction and run
      // the gate here, so a version uploaded concurrently between an outside
      // check and this write can't slip a never-approved version to FILED.
      const artifact = await tx.jrArtifact.findFirst({ where: { id: artifactId, deletedAt: null } });
      if (!artifact) throw new NotFoundException('Artifact not found');
      const current = await tx.jrArtifactVersion.findFirst({ where: { artifactId, isCurrent: true } });
      // Nothing with no stored content may be filed — even received types (which
      // skip the counsel gate) must carry an uploaded version.
      if (!current) {
        throw new UnprocessableEntityException('Cannot file: the artifact has no uploaded version.');
      }
      this.assertFilable(artifact, current.id);

      const next = await tx.jrArtifact.update({
        where: { id: artifactId },
        data: {
          status: 'FILED',
          filedAt,
          registryStampedAt,
          courtDocumentNumber: dto.courtDocumentNumber,
        },
      });
      await this.writeAudit(tx, {
        matterId: artifact.matterId,
        actorUserId: user.id,
        action: 'artifact_filed',
        entityId: artifactId,
        oldValues: { status: artifact.status },
        newValues: {
          status: next.status,
          courtDocumentNumber: dto.courtDocumentNumber,
          filedAt: filedAt.toISOString(),
        },
      });
      return next;
    });
  }

  /**
   * FILED → SERVED. Proof of service is per artifact (§5.4). If the served
   * artifact is the ALJR, the matter's r.7(2) deadline anchor is derived from
   * this service date.
   */
  async serveArtifact(artifactId: string, dto: ServeArtifactDto, user: RequestUser): Promise<JrArtifact> {
    const artifact = await this.resolveArtifact(artifactId);
    await this.jr.assertMatterAccess(artifact.matterId, user);
    this.assertStatus(artifact, 'FILED', 'record service');

    const servedAt = dto.servedAt ? new Date(dto.servedAt) : new Date();
    const isAljr = ALJR_TYPES.has(artifact.artifactType);

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrArtifact.update({
        where: { id: artifactId },
        data: {
          status: 'SERVED',
          servedAt,
          servedOn: dto.servedOn,
          serviceMethod: dto.serviceMethod,
          proofOfServiceKey: dto.proofOfServiceKey ?? null,
          serviceScreenshotKey: dto.serviceScreenshotKey ?? null,
        },
      });

      // The r.7(2) anchor is DERIVED from the ALJR artifact's service date —
      // never entered independently (§5.4).
      if (isAljr) {
        await tx.jrMatter.update({
          where: { id: artifact.matterId },
          data: { proofOfServiceFiledAt: servedAt },
        });
      }

      await this.writeAudit(tx, {
        matterId: artifact.matterId,
        actorUserId: user.id,
        action: 'artifact_served',
        entityId: artifactId,
        oldValues: { status: artifact.status },
        newValues: {
          status: next.status,
          servedOn: dto.servedOn,
          serviceMethod: dto.serviceMethod,
          servedAt: servedAt.toISOString(),
          derivedMatterProofOfServiceFiledAt: isAljr ? servedAt.toISOString() : null,
        },
      });
      return next;
    });
  }

  /**
   * Mark a NEW artifact as carried into the post-settlement additional-submissions
   * package (§11.2), where fresh evidence IS admissible. Only once the matter is in
   * REDETERMINATION; stamps recordStatus=NEW and, optionally, the new-evidence
   * justification/explanation.
   */
  async carryToRedetermination(
    artifactId: string,
    dto: CarryToRedeterminationDto,
    user: RequestUser,
  ): Promise<JrArtifact> {
    const artifact = await this.resolveArtifact(artifactId);
    const matter = await this.jr.assertMatterAccess(artifact.matterId, user);
    if (matter.stage !== 'REDETERMINATION') {
      throw new UnprocessableEntityException(
        'New evidence can only be carried once the matter is in REDETERMINATION.',
      );
    }
    // Carrying marks a document as NEW evidence; an ON_RECORD document (part of the
    // original certified record) is not new and must not be relabelled.
    if (artifact.recordStatus === 'ON_RECORD') {
      throw new BadRequestException(
        'An on-record document (part of the original certified record) cannot be carried as new evidence.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrArtifact.update({
        where: { id: artifactId },
        data: {
          carriedToRedetermination: true,
          recordStatus: 'NEW',
          ...(dto.newEvidenceJustification !== undefined
            ? { newEvidenceJustification: dto.newEvidenceJustification }
            : {}),
          ...(dto.newEvidenceExplanation !== undefined
            ? { newEvidenceExplanation: dto.newEvidenceExplanation }
            : {}),
        },
      });
      await this.writeAudit(tx, {
        matterId: artifact.matterId,
        actorUserId: user.id,
        action: 'artifact_carried_to_redetermination',
        entityId: artifactId,
        oldValues: {
          carriedToRedetermination: artifact.carriedToRedetermination,
          recordStatus: artifact.recordStatus,
        },
        newValues: {
          carriedToRedetermination: true,
          recordStatus: 'NEW',
          newEvidenceJustification: dto.newEvidenceJustification ?? null,
        },
      });
      return next;
    });
  }

  /** Soft-delete an artifact. Versions are retained (never physically deleted). */
  async softDelete(artifactId: string, user: RequestUser): Promise<JrArtifact> {
    const artifact = await this.resolveArtifact(artifactId);
    await this.jr.assertMatterAccess(artifact.matterId, user);

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrArtifact.update({
        where: { id: artifactId },
        data: { deletedAt: new Date() },
      });
      await this.writeAudit(tx, {
        matterId: artifact.matterId,
        actorUserId: user.id,
        action: 'artifact_deleted',
        entityId: artifactId,
        oldValues: { status: artifact.status },
      });
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // The counsel-approval gate (§5.2) — VERBATIM
  // ---------------------------------------------------------------------------

  /**
   * The gate. A court-filed artifact must carry a recorded counsel approval,
   * and — the check that earns its keep — the approval must attach to the
   * version that is actually current (being filed), not merely a document with
   * the same name.
   */
  private assertFilable(a: JrArtifact, currentVersionId: string | null): void {
    if (!COURT_FILED_TYPES.has(a.artifactType)) return; // received docs skip the gate
    if (a.status !== 'COUNSEL_APPROVED')
      throw new UnprocessableEntityException(
        `${a.artifactType} cannot be filed from status ${a.status}. A court-filed artifact must carry a recorded counsel approval.`,
      );
    if (!a.counselReviewedById || !a.counselReviewedAt || !a.counselApprovedVersionId)
      throw new UnprocessableEntityException('Counsel approval record is incomplete.');
    if (a.counselApprovedVersionId !== currentVersionId)
      throw new UnprocessableEntityException(
        'The current version differs from the version counsel approved. Re-submit for review before filing.',
      );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** The Raw/Files display split from status, without mutating stored folder. */
  private displayFolder(a: JrArtifact): JrArtifactFolder {
    if (a.folder === 'JUDICIAL_REVIEW_RAW' || a.folder === 'JUDICIAL_REVIEW_FILES') {
      return FILES_STATUSES.has(a.status) ? 'JUDICIAL_REVIEW_FILES' : 'JUDICIAL_REVIEW_RAW';
    }
    return a.folder;
  }

  private async resolveArtifact(artifactId: string): Promise<JrArtifact> {
    const artifact = await this.prisma.jrArtifact.findFirst({
      where: { id: artifactId, deletedAt: null },
    });
    if (!artifact) throw new NotFoundException('Artifact not found');
    return artifact;
  }

  private async currentVersion(artifactId: string): Promise<JrArtifactVersion | null> {
    return this.prisma.jrArtifactVersion.findFirst({
      where: { artifactId, isCurrent: true },
    });
  }

  private assertStatus(a: JrArtifact, expected: JrArtifactStatus, action: string): void {
    if (a.status !== expected) {
      throw new UnprocessableEntityException(
        `Cannot ${action} from status ${a.status}; the artifact must be ${expected}.`,
      );
    }
  }

  private assertUploadable(file: Express.Multer.File | undefined): void {
    if (!file) {
      throw new BadRequestException(
        'No file provided. Use multipart/form-data with field name "file".',
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('File exceeds the 50 MB limit.');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Files of type ${file.mimetype} are not allowed. Allowed: PDF, JPEG, PNG, TIFF, DOC, DOCX.`,
      );
    }
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    input: {
      matterId: string;
      actorUserId: string;
      action: string;
      entityId: string;
      oldValues?: Prisma.InputJsonValue;
      newValues?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.jrAuditLog.create({
      data: {
        matterId: input.matterId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: 'JrArtifact',
        entityId: input.entityId,
        oldValues: input.oldValues,
        newValues: input.newValues,
      },
    });
  }
}
