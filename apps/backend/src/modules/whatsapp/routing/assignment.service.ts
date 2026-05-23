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
  type Lead,
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
   */
  async ensureAssigned(threadId: string): Promise<AssignmentOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const thread = await tx.whatsAppThread.findUnique({
        where: { id: threadId },
        include: {
          lead: { select: { id: true, assignedEmployeeId: true, preferredEmployeeId: true, branchId: true } },
        },
      });
      if (!thread?.lead) {
        this.log.warn({ threadId }, 'assignment: thread or lead missing');
        return {
          leadId: '',
          threadId,
          assignedEmployeeId: null,
          reason: null,
          retryAt: null,
        };
      }
      const lead = thread.lead;

      // Serialize concurrent assignment of the SAME lead. The webhook worker
      // runs at concurrency 8, so two inbound messages arriving together would
      // otherwise both read assignedEmployeeId=null and assign DIFFERENT agents
      // (and double-advance the round-robin cursor). A row-level lock makes the
      // second transaction wait for the first to commit; the re-read below then
      // sees the committed assignment and honors it. Read Committed (Prisma's
      // default) does not prevent this on its own — the explicit FOR UPDATE
      // does.
      //
      // CRITICAL #1: this is a SELECT, so it MUST use $queryRaw, not $executeRaw.
      // $executeRaw is for statements that return a row COUNT (INSERT/UPDATE/
      // DELETE); handing it a SELECT makes Prisma throw "Execute returned
      // results, which is not allowed in SQL", which aborts the whole
      // transaction and leaves EVERY lead unassigned.
      //
      // CRITICAL #2: do NOT cast the parameter to ::uuid. `crm.leads.id` is a
      // TEXT column (Prisma `String @id` with no `@db.Uuid`), so `id = $1::uuid`
      // asks Postgres for a `text = uuid` operator that doesn't exist → error
      // 42883, which also aborts the transaction and leaves every lead
      // unassigned. Compare text-to-text: `id = ${lead.id}` (lead.id is already
      // a string). Both of these bugs took assignment down for hours — the lock
      // throwing is silently swallowed by the webhook's catch.
      await tx.$queryRaw`SELECT 1 FROM crm.leads WHERE id = ${lead.id} FOR UPDATE`;
      const locked = await tx.lead.findUnique({
        where: { id: lead.id },
        select: { assignedEmployeeId: true, preferredEmployeeId: true },
      });
      // Use the post-lock values for the assignment decision.
      lead.assignedEmployeeId = locked?.assignedEmployeeId ?? null;
      lead.preferredEmployeeId = locked?.preferredEmployeeId ?? null;

      // Load org for business-hours + SLA + round-robin cursor.
      const org = await this.loadOrgFor(tx, lead.branchId);
      if (!org) {
        this.log.error({ threadId }, 'assignment: organization not found via branch');
        return { leadId: lead.id, threadId, assignedEmployeeId: null, reason: null, retryAt: null };
      }

      const hours: BusinessHours = {
        timezone: org.timezone,
        hoursOpen: org.hoursOpen,
        hoursClose: org.hoursClose,
        workingDays: org.workingDays,
      };
      const now = new Date();

      // Stamp SLA deadline if missing and we have a firstInboundAt.
      if (!thread.slaDeadlineAt && thread.firstInboundAt) {
        const deadline = computeSlaDeadline(
          hours,
          thread.firstInboundAt,
          org.slaFirstResponseSeconds,
        );
        await tx.whatsAppThread.update({
          where: { id: threadId },
          data: { slaDeadlineAt: deadline },
        });
      }

      // Per Tashfeen policy: assignment runs 24/7 including weekends.
      // Threads received after 6 PM, on Saturday, or on Sunday are still
      // distributed to the team; agents pick them up the next working morning
      // where they left off. Business hours + working-days are used ONLY for
      // SLA-clock math (already applied above) and for the after-hours
      // auto-ack template (separate worker, not gated here). NO business-
      // Business hours / weekend are NOT a routing gate (24/7 distribution).
      // Presence IS now a gate for NEW leads: only ONLINE agents receive new
      // round-robin/sticky assignments. Away/Offline agents are skipped for new
      // leads but KEEP their existing chats (handled by the base-pool check
      // below) so they can resume with their clients when they're back.

      // Base pool: everyone who CAN own a WhatsApp chat (active, in the inbox
      // pool, account active) — presence-agnostic. Used to decide whether an
      // EXISTING assignment is still valid.
      const eligible = await this.loadEligibleEmployees(tx, org.organizationId);

      // Already assigned — keep it as long as the assignee is still in the BASE
      // pool. Presence (Away/Offline) does NOT drop an existing chat: the agent
      // keeps their clients and picks them up when back online. We only re-route
      // if they were deactivated, removed from the inbox pool, or suspended.
      if (lead.assignedEmployeeId) {
        const stillEligible = eligible.some((e) => e.id === lead.assignedEmployeeId);
        if (stillEligible) {
          return {
            leadId: lead.id,
            threadId,
            assignedEmployeeId: lead.assignedEmployeeId,
            reason: null,
            retryAt: null,
          };
        }
        this.log.log(
          { leadId: lead.id, previousAssignee: lead.assignedEmployeeId },
          'assignment: previous assignee no longer eligible, re-routing',
        );
        // Fall through to re-route. preferredEmployeeId is left as-is; the
        // sticky check below also requires the agent to be online.
      }

      // NEW-lead pool: base pool restricted to ONLINE agents. Away/Offline
      // agents do not receive new leads.
      const onlinePool = eligible.filter((e) => e.presenceStatus === PresenceStatus.ONLINE);

      if (onlinePool.length === 0) {
        this.log.log(
          { leadId: lead.id, basePool: eligible.length },
          'assignment: no ONLINE agents — leaving unassigned until someone comes online (sweeper will pick up)',
        );
        return { leadId: lead.id, threadId, assignedEmployeeId: null, reason: null, retryAt: null };
      }

      // 1. Sticky — preferred employee, but only if they're online.
      const sticky = lead.preferredEmployeeId
        ? onlinePool.find((e) => e.id === lead.preferredEmployeeId)
        : undefined;
      if (sticky) {
        await this.applyAssignment(tx, threadId, lead, sticky.id, WhatsAppAssignmentReason.STICKY);
        return {
          leadId: lead.id,
          threadId,
          assignedEmployeeId: sticky.id,
          reason: WhatsAppAssignmentReason.STICKY,
          retryAt: null,
        };
      }

      // 2. Strict round-robin among ONLINE agents.
      const pick = pickRoundRobin(onlinePool, org.rrCursorEmployeeId);
      await this.applyAssignment(
        tx,
        threadId,
        lead,
        pick.id,
        WhatsAppAssignmentReason.ROUND_ROBIN,
      );
      await tx.organization.update({
        where: { id: org.organizationId },
        data: { rrCursorEmployeeId: pick.id },
      });
      return {
        leadId: lead.id,
        threadId,
        assignedEmployeeId: pick.id,
        reason: WhatsAppAssignmentReason.ROUND_ROBIN,
        retryAt: null,
      };
    });
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
        user: { status: 'ACTIVE' },
      },
      orderBy: { id: 'asc' },
      // presenceStatus drives the ONLINE-only gate for NEW leads (Away/Offline
      // agents are skipped for new assignments but keep their existing chats).
      select: { id: true, presenceStatus: true },
    });
    return rows;
  }

  private async applyAssignment(
    tx: Prisma.TransactionClient,
    threadId: string,
    lead: Pick<Lead, 'id' | 'preferredEmployeeId'>,
    assignedEmployeeId: string,
    reason: WhatsAppAssignmentReason,
  ): Promise<void> {
    const now = new Date();
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        assignedEmployeeId,
        // First time this lead is routed, set preferred = sticky.
        ...(lead.preferredEmployeeId ? {} : { preferredEmployeeId: assignedEmployeeId }),
        // NOTE: assignment does NOT touch lead.status. A lead being routed to
        // an agent is NOT the same as the agent having contacted them — it
        // stays NEW ("Pending") until the agent actually sends a message, at
        // which point the outbound worker flips NEW → CONTACTED. Previously
        // this set CONTACTED on assignment, which made every assigned lead
        // falsely read "Contacted" before anyone reached out.
      },
    });
    await tx.whatsAppThread.update({
      where: { id: threadId },
      data: { lastAssignmentReason: reason },
    });
    await tx.activityTimeline.create({
      data: {
        entityType: 'Lead',
        entityId: lead.id,
        leadId: lead.id,
        eventType: 'WHATSAPP_ASSIGNED',
        description: `WhatsApp lead auto-assigned (${reason.toLowerCase()})`,
        metadata: { reason, threadId, assignedEmployeeId },
      },
    });
  }
}

function pickRoundRobin<T extends { id: string }>(eligible: T[], cursor: string | null): T {
  if (!cursor) return eligible[0]!;
  const next = eligible.find((a) => a.id > cursor);
  return next ?? eligible[0]!;
}
