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
  PresenceStatus,
  WhatsAppAssignmentReason,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { computeSlaDeadline, type BusinessHours } from './business-hours';

export interface AssignmentOutcome {
  leadId: string;
  threadId: string;
  assignedEmployeeId: string | null;
  reason: WhatsAppAssignmentReason | null;
  retryAt: Date | null;
}

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
    opts?: { forLiveCall?: boolean },
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

    const org = await this.loadOrgFor(this.prisma, lead.branchId);
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

    // NEW-lead pool = eligible restricted to ONLINE (Away/Offline agents don't
    // receive new leads). A live inbound call can't wait for the sweeper, so if
    // nobody is ONLINE it falls back to the full eligible pool (still ONE rep).
    const onlinePool = eligible.filter((e) => e.presenceStatus === PresenceStatus.ONLINE);
    const pool = onlinePool.length > 0 ? onlinePool : opts?.forLiveCall ? eligible : [];
    if (pool.length === 0) {
      this.log.log(
        { leadId: lead.id, basePool: eligible.length, forLiveCall: !!opts?.forLiveCall },
        'assignment: no eligible agent to receive this lead — leaving unassigned (sweeper will pick up)',
      );
      return unassigned(lead.id);
    }

    // Candidate: sticky (preferred, if in the pool) else strict round-robin.
    const sticky = lead.preferredEmployeeId
      ? pool.find((e) => e.id === lead.preferredEmployeeId)
      : undefined;
    const candidateId = sticky ? sticky.id : pickRoundRobin(pool, org.rrCursorEmployeeId).id;
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
        if (reason === WhatsAppAssignmentReason.ROUND_ROBIN) {
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
}

function pickRoundRobin<T extends { id: string }>(eligible: T[], cursor: string | null): T {
  if (!cursor) return eligible[0]!;
  const next = eligible.find((a) => a.id > cursor);
  return next ?? eligible[0]!;
}
