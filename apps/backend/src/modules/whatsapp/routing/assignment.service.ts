/**
 * WhatsApp conversation → sales-employee assignment engine.
 *
 * Algorithm (priority order):
 *   1. **Sticky.** If the lead's `preferredEmployeeId` is set AND that employee
 *      is still in the eligible pool (whatsappInboxMember + isActive),
 *      assign to them.
 *   2. **Strict round-robin.** Walk eligible employees in deterministic id
 *      order, starting after `Organization.rrCursorEmployeeId`. Update cursor.
 *
 * **24/7 assignment — no business-hours, no weekend, no presence gate.**
 * Tashfeen policy: "we will keep assigning chat to the sale team no stoppage;
 * they will come back next morning and start the system where they left off"
 * and "nothing pauses on weekends .. system works 24/7 .. on monday they will
 * come back and watch and then start working." Threads that arrive after 6
 * PM, on Saturday, or on Sunday are still distributed; agents pick them up
 * the next working morning. Presence (ONLINE / AWAY / OFFLINE) remains as a
 * UI signal but does not gate routing.
 *
 * Business hours ARE still used to pause the first-response SLA clock so it
 * doesn't tick to red at 11 PM — see `computeSlaDeadline()`.
 *
 * Eligibility for an Employee in the round-robin pool:
 *   - isActive = true
 *   - whatsappInboxMember = true
 *   - deletedAt = null
 *   - linked UserAccount.status = ACTIVE (a deactivated user must not receive
 *     new chats — they can't log in to respond, leads would rot)
 *
 * Idempotent: if the lead is already assigned, the engine returns without
 * changes. Manual reassignment via the API bypasses this engine entirely.
 *
 * Why we operate on Lead, not Thread: Tafsheen's existing sales pipeline owns
 * "who is responsible for this customer" on Lead.assignedEmployeeId. We keep
 * a single source of truth and just record the WhatsApp-specific reason on
 * the thread.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  LeadStatus,
  PresenceStatus,
  WhatsAppAssignmentReason,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { computeSlaDeadline, type BusinessHours } from './business-hours';

// ── Ad-specific routing (interim, hard-coded) ───────────────────────────────
// New Click-to-WhatsApp chats from these Meta ads route ONLY to the Lahore
// desk, never the whole round-robin pool. Keyed on the Meta ad id
// (referral.source_id, captured on the thread as adReferral). Employee ids are
// the production Lahore reps (verified 2026-07-30). This is a deliberate
// stop-gap pending a manager-editable routing screen — to add/remove an ad edit
// AD_ROUTING; to change the team edit LAHORE_DESK. Repeat customers already
// owned by an eligible rep are untouched (the keep-check runs first), so this
// only steers genuinely new / unassigned leads.
const LAHORE_DESK: readonly string[] = [
  '4d0802f0-30f5-469b-9279-e57536815c8e', // Tabida Bilal
  '88016096-7b41-4c59-b6e7-a6d8bca2908f', // Samiya Aslam
  '2faaef9e-8583-43bc-92d4-b739dd1d8ab5', // Rubab
  '1a0b7967-e27e-431a-9efd-f4dfe923c779', // Ifra Qaiser Mehmood
  '1beff9a3-8f13-4669-8faf-03325a3735e0', // Noman Gondal
  '6439a4ca-3626-4ba8-a274-610719acf2c4', // Aqsa Sadiq
];
const AD_ROUTING: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  // "Turn Your Visa Refusal into Approval by Judicial Review" (JR) — confirmed live.
  ['52533803620533', new Set(LAHORE_DESK)],
  // "C11" ad id exactly as provided (no chats delivered under it yet).
  ['52531891901333', new Set(LAHORE_DESK)],
  // "Business Permit to Canada PR" — the C11-theme ad actually delivering
  // (408 chats 2026-07-23→29); one digit-cluster off the id above, almost
  // certainly the same ad. Keyed too so routing works whichever id Meta sends.
  ['52531891900933', new Set(LAHORE_DESK)],
]);

/** The fixed sub-team a Click-to-WhatsApp referral must route to, or null when
 *  the ad has no override (→ normal whole-pool round-robin). */
function adTeamForReferral(adReferral: unknown): ReadonlySet<string> | null {
  if (!adReferral || typeof adReferral !== 'object' || Array.isArray(adReferral)) return null;
  const sid = (adReferral as Record<string, unknown>)['source_id'];
  if (typeof sid !== 'string') return null;
  return AD_ROUTING.get(sid) ?? null;
}

export interface AssignmentOutcome {
  leadId: string;
  threadId: string;
  assignedEmployeeId: string | null;
  reason: WhatsAppAssignmentReason | null;
  retryAt: Date | null;
}

/** Org config `ensureAssigned` needs. `rrCursorEmployeeId` is the ONLY mutable
 *  field — it advances with each round-robin assignment. */
export interface OrgAssignmentConfig {
  organizationId: string;
  timezone: string;
  hoursOpen: string;
  hoursClose: string;
  workingDays: number[];
  slaFirstResponseSeconds: number;
  rrCursorEmployeeId: string | null;
}

/**
 * Per-sweep memo so a BATCH of ensureAssigned() calls doesn't re-read the same
 * invariants once per thread. The assignment-recovery sweeper used to call
 * ensureAssigned() in a loop over up to 50 stuck threads, and each call
 * re-issued `loadOrgFor` + `loadEligibleEmployees` — identical results every
 * time. At ~70ms of cross-region round-trip each, that was ~100 needless
 * pooled-connection holds per 60s tick, on the pool that starved (P2028).
 *
 * IMPORTANT: the cached org's `rrCursorEmployeeId` is advanced in-memory as we
 * assign (mirroring the DB write), so round-robin still spreads a batch across
 * reps. Caching it naively would hand every stuck thread to the SAME rep.
 *
 * Create one per sweep and throw it away — presence/eligibility is a snapshot,
 * which is fine for the seconds a sweep lasts. Pass NOTHING on the hot single
 * -thread webhook path so it always reads fresh.
 */
export interface AssignmentCache {
  /** branchId ('' for a null branch) → the org object. Several branches may map
   *  to the SAME organizationId; they all point at the SAME object below so the
   *  round-robin cursor advances exactly once per org, never once per branch. */
  orgByBranch: Map<string, OrgAssignmentConfig | null>;
  /** organizationId → the single shared, mutable org object (the cursor lives here). */
  orgById: Map<string, OrgAssignmentConfig>;
}

/**
 * NOTE — eligibility is deliberately NOT cached.
 *
 * Org config is static (only the cursor moves, and we own that). The eligible
 * agent pool is not: a rep can be deactivated, dropped from the inbox pool or
 * suspended at any moment, and `eligibleIds` is what Phase 2 uses to decide
 * whether to OVERWRITE a lead's current owner. Freezing that snapshot for a
 * whole sweep would (a) keep routing new leads to a rep who just became
 * ineligible, and (b) widen — from ~1 query to the entire sweep — the window in
 * which the sweeper could yank a lead away from a rep the webhook had just
 * validly assigned it to. Re-reading it per thread costs one indexed query;
 * lead ownership is worth far more than that.
 */
export const createAssignmentCache = (): AssignmentCache => ({
  orgByBranch: new Map(),
  orgById: new Map(),
});

@Injectable()
export class WhatsAppAssignmentService {
  private readonly log = new Logger(WhatsAppAssignmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensure the lead behind a WhatsApp thread is assigned to an eligible
   * employee. Called from the webhook-ingest worker after every new inbound,
   * and exposed via API for manual "auto-assign now" actions.
   *
   * opts.forLiveCall — caller is a LIVE inbound call, which can't wait for the
   * sweeper. When set and no ONLINE agent is available, we fall back to the full
   * eligible pool (round-robin) so the call still rings the NEXT available rep
   * (one rep — never the whole team). Messages leave this unset and keep the
   * quiet ONLINE-only behavior.
   */
  async ensureAssigned(
    threadId: string,
    opts?: { forLiveCall?: boolean; cache?: AssignmentCache },
  ): Promise<AssignmentOutcome> {
    // ── Phase 1 — READ + DECIDE (no transaction). Assignment used to run the
    //    whole ~10-round-trip computation inside one interactive $transaction,
    //    pinning a scarce pooled connection BEGIN→COMMIT across every network
    //    round-trip to the (cross-region) DB — the pool-starvation incident.
    //    Now ONLY the "lock + write" critical section (Phase 2) is in a
    //    transaction; everything else is ordinary short queries.
    const unassigned = (leadId: string): AssignmentOutcome => ({
      leadId,
      threadId,
      assignedEmployeeId: null,
      reason: null,
      retryAt: null,
    });

    const thread = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        slaDeadlineAt: true,
        firstInboundAt: true,
        // Click-to-WhatsApp ad attribution — drives the ad-specific routing
        // override below (referral.source_id → fixed sub-team).
        adReferral: true,
        lead: {
          select: { id: true, assignedEmployeeId: true, preferredEmployeeId: true, branchId: true },
        },
      },
    });
    if (!thread?.lead) {
      this.log.warn({ threadId }, 'assignment: thread or lead missing');
      return unassigned('');
    }
    const lead = thread.lead;

    const org = await this.loadOrgForCached(lead.branchId, opts?.cache);
    if (!org) {
      this.log.error({ threadId }, 'assignment: organization not found via branch');
      return unassigned(lead.id);
    }

    // Stamp the first-response SLA deadline if missing — idempotent and
    // independent of the assignment decision, so it runs here (no tx).
    if (!thread.slaDeadlineAt && thread.firstInboundAt) {
      const hours: BusinessHours = {
        timezone: org.timezone,
        hoursOpen: org.hoursOpen,
        hoursClose: org.hoursClose,
        workingDays: org.workingDays,
      };
      const deadline = computeSlaDeadline(hours, thread.firstInboundAt, org.slaFirstResponseSeconds);
      await this.prisma.whatsAppThread
        .update({ where: { id: threadId }, data: { slaDeadlineAt: deadline } })
        .catch((err) =>
          this.log.warn(
            { threadId, err: (err as Error).message },
            'assignment: SLA-deadline stamp failed (non-fatal)',
          ),
        );
    }

    // ALWAYS fresh — never cached. See the note on createAssignmentCache: this
    // set decides whether Phase 2 may overwrite an existing owner.
    const eligible = await this.loadEligibleEmployees(this.prisma, org.organizationId);
    const eligibleIds = new Set(eligible.map((e) => e.id));

    // Already assigned to a still-eligible agent → keep it. Presence (Away/
    // Offline) does NOT drop an existing chat; we only re-route if the assignee
    // was deactivated / removed from the inbox pool / suspended.
    if (lead.assignedEmployeeId && eligibleIds.has(lead.assignedEmployeeId)) {
      return {
        leadId: lead.id,
        threadId,
        assignedEmployeeId: lead.assignedEmployeeId,
        reason: null,
        retryAt: null,
      };
    }
    if (lead.assignedEmployeeId) {
      this.log.log(
        { leadId: lead.id, previousAssignee: lead.assignedEmployeeId },
        'assignment: previous assignee no longer eligible, re-routing',
      );
    }

    // Ad-specific routing: chats from certain Click-to-WhatsApp ads must be
    // assigned ONLY within a fixed sub-team (the Lahore desk), never the whole
    // pool. Keyed on the Meta ad id (referral.source_id). NOT applied to live
    // calls — a call must still ring the next available rep anywhere.
    const adTeam = opts?.forLiveCall ? null : adTeamForReferral(thread.adReferral);
    const basePool = adTeam ? eligible.filter((e) => adTeam.has(e.id)) : eligible;

    // NEW-lead pool = basePool restricted to ONLINE (Away/Offline agents don't
    // receive new leads). A live inbound call can't wait for the sweeper, so if
    // nobody is ONLINE it falls back to the full base pool (still ONE rep). An
    // ad-restricted lead with none of the sub-team online stays unassigned and
    // the sweeper retries — still only ever within the sub-team.
    const onlinePool = basePool.filter((e) => e.presenceStatus === PresenceStatus.ONLINE);
    const pool = onlinePool.length > 0 ? onlinePool : opts?.forLiveCall ? basePool : [];
    if (pool.length === 0) {
      this.log.log(
        { leadId: lead.id, basePool: basePool.length, adRestricted: !!adTeam, forLiveCall: !!opts?.forLiveCall },
        'assignment: no eligible agent to receive this lead — leaving unassigned (sweeper will pick up)',
      );
      return unassigned(lead.id);
    }

    // Candidate:
    //   • sticky (preferred, if in the pool), else
    //   • ad-restricted → least-loaded of the sub-team. The shared global RR
    //     cursor is advanced constantly by whole-pool assignments, so reusing it
    //     here would lump most ad leads on one rep; balance by NEW backlog instead.
    //   • otherwise strict round-robin over the whole pool via the shared cursor.
    const sticky = lead.preferredEmployeeId
      ? pool.find((e) => e.id === lead.preferredEmployeeId)
      : undefined;
    // Only a real whole-pool round-robin pick advances the shared org cursor
    // (sticky and ad-restricted picks must not move it).
    const usedSharedCursor = !sticky && !adTeam;
    const candidateId = sticky
      ? sticky.id
      : adTeam
        ? await this.pickLeastLoaded(pool)
        : pickRoundRobin(pool, org.rrCursorEmployeeId).id;
    const reason = sticky ? WhatsAppAssignmentReason.STICKY : WhatsAppAssignmentReason.ROUND_ROBIN;

    // ── Phase 2 — COMMIT under a short lock (the ONLY critical section).
    //    Lock the lead row, re-read under the lock, write the assignment. The
    //    lock is what prevents double-assignment when two inbound messages for
    //    the SAME lead race (webhook worker concurrency 8): the loser blocks on
    //    the row lock, then re-reads the winner's assignment and honors it.
    //    ($queryRaw not $executeRaw — a SELECT via $executeRaw aborts the tx;
    //    and NO ::uuid cast — crm.leads.id is TEXT. Both once took routing down.)
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM crm.leads WHERE id = ${lead.id} FOR UPDATE`;
      const locked = await tx.lead.findUnique({
        where: { id: lead.id },
        select: { assignedEmployeeId: true, preferredEmployeeId: true },
      });
      const current = locked?.assignedEmployeeId ?? null;
      // Someone assigned it to a still-eligible agent while we were computing →
      // honor that, don't overwrite (idempotent, no double-assign).
      if (current && eligibleIds.has(current)) {
        return { assigned: current, committed: false };
      }
      // Unassigned, or assigned to a now-ineligible agent → write our candidate.
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          assignedEmployeeId: candidateId,
          // First time this lead is routed, set preferred = sticky.
          ...(locked?.preferredEmployeeId ? {} : { preferredEmployeeId: candidateId }),
          // NOTE: assignment does NOT touch lead.status (stays NEW until the
          // agent actually replies — the outbound worker flips NEW→CONTACTED).
        },
      });
      return { assigned: candidateId, committed: true };
    });

    // ── Phase 3 — BEST-EFFORT side writes (outside the tx). The assignment is
    //    already durably committed above; if these fail we lose only the audit
    //    trail / an un-advanced cursor (a rep picked once more), never the lead.
    if (result.committed) {
      // Advance the cursor on the (possibly CACHED) org object BEFORE the
      // best-effort writes below. When a sweep assigns a batch of threads it
      // reuses this org, so without this every thread would re-read the same
      // stale cursor and pickRoundRobin would hand them all to the SAME rep.
      // Done outside the try so a failed side-write still spreads this batch;
      // the DB cursor then simply resumes one behind on the next sweep, which
      // is the already-documented "a rep gets picked once more" tolerance.
      if (usedSharedCursor) {
        org.rrCursorEmployeeId = result.assigned;
      }
      try {
        await this.prisma.whatsAppThread.update({
          where: { id: threadId },
          data: { lastAssignmentReason: reason },
        });
        await this.prisma.activityTimeline.create({
          data: {
            entityType: 'Lead',
            entityId: lead.id,
            leadId: lead.id,
            eventType: 'WHATSAPP_ASSIGNED',
            description: `WhatsApp lead auto-assigned (${reason.toLowerCase()})`,
            metadata: { reason, threadId, assignedEmployeeId: result.assigned },
          },
        });
        // Advance the round-robin cursor (RR only). No longer inside the
        // assignment tx, so it no longer pins the shared Organization row for
        // the whole transaction — that shared-row convoy was a pool amplifier.
        if (usedSharedCursor) {
          await this.prisma.organization.update({
            where: { id: org.organizationId },
            data: { rrCursorEmployeeId: result.assigned },
          });
        }
      } catch (err) {
        this.log.warn(
          { leadId: lead.id, err: (err as Error).message },
          'assignment: post-commit side-writes failed (lead IS assigned)',
        );
      }
    }

    return {
      leadId: lead.id,
      threadId,
      assignedEmployeeId: result.assigned,
      reason: result.committed ? reason : null,
      retryAt: null,
    };
  }

  /** loadOrgFor, memoised per branch for the lifetime of one sweep's cache.
   *  No cache (the webhook hot path) → always a fresh read. */
  private async loadOrgForCached(
    branchId: string | null,
    cache?: AssignmentCache,
  ): Promise<OrgAssignmentConfig | null> {
    if (!cache) return this.loadOrgFor(this.prisma, branchId);
    const key = branchId ?? '';
    const hit = cache.orgByBranch.get(key);
    if (hit !== undefined) return hit; // `undefined` = miss; a cached `null` is a real "no org"

    const loaded = await this.loadOrgFor(this.prisma, branchId);
    // Collapse onto ONE object per organizationId. Two branches of the same org
    // would otherwise each hold their own copy of `rrCursorEmployeeId`, so
    // advancing one wouldn't advance the other and the SAME rep could be picked
    // twice within a single sweep.
    let shared: OrgAssignmentConfig | null = null;
    if (loaded) {
      shared = cache.orgById.get(loaded.organizationId) ?? loaded;
      cache.orgById.set(loaded.organizationId, shared);
    }
    cache.orgByBranch.set(key, shared);
    return shared;
  }

  /**
   * Resolve the Organization the lead belongs to. Tafsheen leads live under a
   * branch; the branch points to an org. For Tashfeen-single-tenant this is
   * essentially "the only org," but we look it up properly for correctness.
   */
  private async loadOrgFor(
    tx: Prisma.TransactionClient,
    branchId: string | null,
  ): Promise<
    | {
        organizationId: string;
        timezone: string;
        hoursOpen: string;
        hoursClose: string;
        workingDays: number[];
        slaFirstResponseSeconds: number;
        rrCursorEmployeeId: string | null;
      }
    | null
  > {
    if (branchId) {
      const branch = await tx.branch.findUnique({
        where: { id: branchId },
        include: { organization: true },
      });
      if (branch?.organization) {
        return {
          organizationId: branch.organization.id,
          timezone: branch.organization.timezone,
          hoursOpen: branch.organization.hoursOpen,
          hoursClose: branch.organization.hoursClose,
          workingDays: branch.organization.workingDays,
          slaFirstResponseSeconds: branch.organization.slaFirstResponseSeconds,
          rrCursorEmployeeId: branch.organization.rrCursorEmployeeId,
        };
      }
    }
    // Fallback: the (single) Organization row.
    const org = await tx.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) return null;
    return {
      organizationId: org.id,
      timezone: org.timezone,
      hoursOpen: org.hoursOpen,
      hoursClose: org.hoursClose,
      workingDays: org.workingDays,
      slaFirstResponseSeconds: org.slaFirstResponseSeconds,
      rrCursorEmployeeId: org.rrCursorEmployeeId,
    };
  }

  /**
   * Eligible-employee pool for round-robin.
   *
   * Tashfeen policy is "no stoppage": assignment runs 24/7. Presence is NOT a
   * routing gate — agents who marked themselves OFFLINE for the night still
   * receive threads into their queue so they can pick up where they left off
   * the next morning. Eligibility is just the inbox-member toggle + the
   * normal soft-delete + isActive flags.
   *
   * **Finance / Finance Manager users are excluded** from the routing pool:
   * they read WhatsApp through the customer profile as a closed-loop comms
   * channel, not as a primary inbox. Auto-assigning a new lead to a Finance
   * Officer would dead-end the conversation.
   *
   * If you ever want to skip vacationing agents, add a separate
   * `Employee.outOfOffice` field rather than overloading `presenceStatus`.
   */
  private async loadEligibleEmployees(
    tx: Prisma.TransactionClient,
    _organizationId: string,
  ): Promise<{ id: string; presenceStatus: PresenceStatus }[]> {
    const rows = await tx.employee.findMany({
      where: {
        isActive: true,
        whatsappInboxMember: true,
        deletedAt: null,
        // Deactivated/suspended users can't log in — if we route to them
        // the lead has nowhere to go. Always check user.status here too.
        user: {
          status: 'ACTIVE',
          // Finance/finance_manager are NOT round-robin targets (see jsdoc).
          userRoles: {
            none: { role: { name: { in: ['finance', 'finance_manager'] } } },
          },
        },
      },
      orderBy: { id: 'asc' },
      // presenceStatus drives the ONLINE-only gate for NEW leads (Away/Offline
      // agents are skipped for new assignments but keep their existing chats).
      select: { id: true, presenceStatus: true },
    });
    return rows;
  }

  /**
   * Pick the sub-team member with the smallest NEW-lead backlog (ties broken by
   * id for determinism). Used only for ad-restricted routing so a fixed team
   * shares the inflow by who is least busy, independent of the global
   * round-robin cursor. One indexed groupBy on the low-volume ad path.
   */
  private async pickLeastLoaded(pool: { id: string }[]): Promise<string> {
    const ids = pool.map((e) => e.id);
    const counts = await this.prisma.lead.groupBy({
      by: ['assignedEmployeeId'],
      where: { assignedEmployeeId: { in: ids }, status: LeadStatus.NEW, deletedAt: null },
      _count: { _all: true },
    });
    const backlog = new Map(counts.map((c) => [c.assignedEmployeeId as string, c._count._all]));
    return [...pool].sort(
      (a, b) => (backlog.get(a.id) ?? 0) - (backlog.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1),
    )[0]!.id;
  }
}

function pickRoundRobin<T extends { id: string }>(eligible: T[], cursor: string | null): T {
  if (!cursor) return eligible[0]!;
  const next = eligible.find((a) => a.id > cursor);
  return next ?? eligible[0]!;
}
