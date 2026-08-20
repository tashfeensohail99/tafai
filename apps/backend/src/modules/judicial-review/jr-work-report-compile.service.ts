import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Parameters for a single compile pass. The subject is ALREADY resolved
 * server-side by the caller (JrWorkReportService) — this service never trusts a
 * client-supplied subject.
 */
export interface CompileParams {
  subjectAssociateUserId: string;
  periodFrom: Date;
  periodTo: Date;
  /** When true, HEAD_ONLY case notes are included (the Head-only view). */
  canViewAll: boolean;
}

/** A single credited matter in the compiled caseload. */
export interface WorkReportMatter {
  matterId: string;
  matterNumber: string | null;
  styleOfCause: string | null;
  stage: string | null;
  clientId: string | null;
  clientName: string | null;
  clientReferenceCode: string | null;
  /** Classified per §11.7 (settled-redetermination / allowed / redetermination-approved). */
  isWin: boolean;
  /** Versions the subject uploaded on this matter, in-window. */
  draftVersions: number;
  /** The subject's audit actions on this matter, in-window (the spine slice). */
  actions: Array<{ action: string; entityId: string | null; createdAt: Date }>;
}

/** The structured, never-persisted report body. Recomputed on every read. */
export interface WorkReportBody {
  subjectAssociateUserId: string;
  period: { from: string; to: string };
  generatedAt: string;
  /** False for a clean "no work this period" window (never an error). */
  hasActivity: boolean;
  summary: {
    matterCount: number;
    draftVersions: number;
    submittedForReview: number;
    approvals: number;
    changesRequested: number;
    filings: number;
    caseNotes: number;
    wins: number;
  };
  matters: WorkReportMatter[];
  /** Case-workspace notes the subject authored in-window (HEAD_ONLY filtered by canViewAll). */
  caseNotes: Array<{
    id: string;
    matterId: string;
    noteType: string;
    content: string;
    createdAt: Date;
  }>;
  /**
   * On-time metric — MATTER-LEVEL, never attributed to the subject (JrDeadline
   * has no user column). Scoped to the compiled caseload matters.
   */
  deadlines: {
    scope: 'matter-level';
    onTime: number;
    missed: number;
    pending: number;
    total: number;
    items: Array<{
      matterId: string;
      milestoneKey: string;
      label: string | null;
      computedDueAt: Date;
      status: string;
      isFatal: boolean;
    }>;
  };
}

/**
 * Assign action string written by JudicialReviewService.assignMatter — the
 * reassignment-union keys off it. Confirmed against the merged schema/service
 * (jr_audit_logs.action = 'matter_assigned', with assignedAssociateUserId in
 * old/new values). If it ever changes, the union quietly under-credits — hence
 * the dedicated compile spec that decodes an assign delta.
 */
const ASSIGN_ACTION = 'matter_assigned';

/**
 * Compiles an associate's JR work report BODY from the JR audit log. The body is
 * NEVER stored — it is recomputed on every read, so it credits work even on a
 * matter later reassigned away and can never silently drift.
 *
 * STRICTLY SERIALIZED: every query is awaited before the next runs (never
 * Promise.all), so at most ONE of the 15 session-pool connections is in flight
 * at a time. Source is JrAuditLog ONLY — never the global AuditLog (pruned) nor
 * ActivityTimeline (rep-visible).
 */
@Injectable()
export class JrWorkReportCompileService {
  constructor(private readonly prisma: PrismaService) {}

  async compileBody(params: CompileParams): Promise<WorkReportBody> {
    const { subjectAssociateUserId: subject, periodFrom, periodTo, canViewAll } = params;
    const window = { gte: periodFrom, lte: periodTo };

    // (1) SPINE — the subject's own matter-scoped JR audit rows in-window.
    const spine = await this.prisma.jrAuditLog.findMany({
      where: {
        actorUserId: subject,
        matterId: { not: null },
        createdAt: window,
      },
      orderBy: { createdAt: 'asc' },
      select: { matterId: true, action: true, entityId: true, createdAt: true },
    });

    // (2) POINT-IN-TIME CASELOAD — union the spine's distinct matterIds with the
    // matterIds of in-window assign-action rows that reference the subject (as the
    // new OR the prior assignee), so a mid-window reassignment still shows his work.
    const assignRows = await this.prisma.jrAuditLog.findMany({
      where: {
        action: ASSIGN_ACTION,
        matterId: { not: null },
        createdAt: window,
      },
      select: { matterId: true, oldValues: true, newValues: true },
    });

    const caseloadIds = new Set<string>();
    for (const r of spine) if (r.matterId) caseloadIds.add(r.matterId);
    for (const r of assignRows) {
      if (!r.matterId) continue;
      if (
        this.assignedIdOf(r.newValues) === subject ||
        this.assignedIdOf(r.oldValues) === subject
      ) {
        caseloadIds.add(r.matterId);
      }
    }
    const matterIds = [...caseloadIds];

    // (2b) One batched IN for matter labels — NEVER a per-matter lookup.
    const matterRows = matterIds.length
      ? await this.prisma.jrMatter.findMany({
          where: { id: { in: matterIds } },
          select: {
            id: true,
            matterNumber: true,
            styleOfCause: true,
            stage: true,
            clientId: true,
            applicationAllowed: true,
            redeterminationApproved: true,
            closeReason: true,
          },
        })
      : [];

    // (3) DRAFTING VOLUME — the subject's artifact versions in-window, grouped by
    // matter. JrArtifactVersion has no matterId column, so the owning matter is
    // read through the artifact relation in the SAME query, then tallied in JS.
    const versions = await this.prisma.jrArtifactVersion.findMany({
      where: { uploadedByUserId: subject, createdAt: window },
      select: { artifact: { select: { matterId: true } } },
    });
    const draftByMatter = new Map<string, number>();
    for (const v of versions) {
      const mid = v.artifact?.matterId;
      if (!mid) continue;
      draftByMatter.set(mid, (draftByMatter.get(mid) ?? 0) + 1);
    }

    // (4) ARTIFACT LIFECYCLE — submitted / changes-requested / filed derive from
    // the spine tally (the subject IS the actor). Approvals are credited via
    // counselReviewRecordedByUserId = subject (NEVER counselReviewedById — the
    // external counsel lawyer), so they get their own count query.
    let submittedForReview = 0;
    let changesRequested = 0;
    let filings = 0;
    for (const r of spine) {
      if (r.action === 'artifact_submitted_for_review') submittedForReview += 1;
      else if (r.action === 'artifact_changes_requested') changesRequested += 1;
      else if (r.action === 'artifact_filed') filings += 1;
    }
    const approvals = await this.prisma.jrArtifact.count({
      where: {
        counselReviewRecordedByUserId: subject,
        counselReviewedAt: window,
        deletedAt: null,
      },
    });

    // (5) NOTES — the subject's case-workspace notes in-window, excluding
    // HEAD_ONLY unless the caller may view all.
    const caseNoteRows = await this.prisma.jrNote.findMany({
      where: {
        authorUserId: subject,
        createdAt: window,
        deletedAt: null,
        ...(canViewAll ? {} : { noteType: { not: 'HEAD_ONLY' } }),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, matterId: true, noteType: true, content: true, createdAt: true },
    });

    // (6) ON-TIME METRIC — from JrDeadline for the caseload matters. Labelled
    // MATTER-LEVEL, never attributed to the subject (deadlines have no user column).
    const deadlineRows = matterIds.length
      ? await this.prisma.jrDeadline.findMany({
          where: { matterId: { in: matterIds } },
          orderBy: { computedDueAt: 'asc' },
          select: {
            matterId: true,
            milestoneKey: true,
            label: true,
            computedDueAt: true,
            status: true,
            isFatal: true,
          },
        })
      : [];

    // (7) CLIENT LABELS — one batched crm.Client IN (never per-matter). clientId is
    // a bare id on JrMatter (no relation).
    const clientIds = [...new Set(matterRows.map((m) => m.clientId).filter(Boolean))];
    const clients = clientIds.length
      ? await this.prisma.client.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, firstName: true, lastName: true, referenceCode: true },
        })
      : [];
    const clientById = new Map(clients.map((c) => [c.id, c]));

    // ---- assemble -----------------------------------------------------------
    const spineByMatter = new Map<
      string,
      Array<{ action: string; entityId: string | null; createdAt: Date }>
    >();
    for (const r of spine) {
      if (!r.matterId) continue;
      const list = spineByMatter.get(r.matterId) ?? [];
      list.push({ action: r.action, entityId: r.entityId, createdAt: r.createdAt });
      spineByMatter.set(r.matterId, list);
    }

    const matters: WorkReportMatter[] = matterRows
      .map((m) => {
        const c = m.clientId ? clientById.get(m.clientId) : undefined;
        return {
          matterId: m.id,
          matterNumber: m.matterNumber ?? null,
          styleOfCause: m.styleOfCause ?? null,
          stage: m.stage ?? null,
          clientId: m.clientId ?? null,
          clientName: c ? `${c.firstName} ${c.lastName}`.trim() : null,
          clientReferenceCode: c?.referenceCode ?? null,
          isWin: this.isWin(m),
          draftVersions: draftByMatter.get(m.id) ?? 0,
          actions: spineByMatter.get(m.id) ?? [],
        };
      })
      .sort((a, b) => (a.matterNumber ?? '').localeCompare(b.matterNumber ?? ''));

    let draftVersions = 0;
    for (const n of draftByMatter.values()) draftVersions += n;

    let onTime = 0;
    let missed = 0;
    let pending = 0;
    for (const d of deadlineRows) {
      if (d.status === 'MET') onTime += 1;
      else if (d.status === 'MISSED') missed += 1;
      else if (d.status === 'PENDING') pending += 1;
    }

    const wins = matters.filter((m) => m.isWin).length;

    const hasActivity =
      spine.length > 0 ||
      matters.length > 0 ||
      draftVersions > 0 ||
      approvals > 0 ||
      caseNoteRows.length > 0;

    return {
      subjectAssociateUserId: subject,
      period: { from: periodFrom.toISOString(), to: periodTo.toISOString() },
      generatedAt: new Date().toISOString(),
      hasActivity,
      summary: {
        matterCount: matters.length,
        draftVersions,
        submittedForReview,
        approvals,
        changesRequested,
        filings,
        caseNotes: caseNoteRows.length,
        wins,
      },
      matters,
      caseNotes: caseNoteRows.map((n) => ({
        id: n.id,
        matterId: n.matterId,
        noteType: n.noteType,
        content: n.content,
        createdAt: n.createdAt,
      })),
      deadlines: {
        scope: 'matter-level',
        onTime,
        missed,
        pending,
        total: deadlineRows.length,
        items: deadlineRows.map((d) => ({
          matterId: d.matterId,
          milestoneKey: d.milestoneKey,
          label: d.label ?? null,
          computedDueAt: d.computedDueAt,
          status: d.status,
          isFatal: d.isFatal,
        })),
      },
    };
  }

  /**
   * A matter is a WIN when it was allowed at hearing (applicationAllowed), the
   * redetermination was approved (redeterminationApproved), or it closed as a
   * settled-redetermination / allowed / redetermination-approved outcome.
   */
  private isWin(m: {
    applicationAllowed: boolean | null;
    redeterminationApproved: boolean | null;
    closeReason: string | null;
  }): boolean {
    if (m.applicationAllowed === true) return true;
    if (m.redeterminationApproved === true) return true;
    return (
      m.closeReason === 'SETTLED_REDETERMINATION' ||
      m.closeReason === 'ALLOWED_AT_HEARING' ||
      m.closeReason === 'REDETERMINATION_APPROVED'
    );
  }

  /** Read assignedAssociateUserId out of a JrAuditLog old/new JSON value. */
  private assignedIdOf(value: Prisma.JsonValue | null | undefined): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = (value as Record<string, unknown>).assignedAssociateUserId;
    return typeof v === 'string' ? v : null;
  }
}
