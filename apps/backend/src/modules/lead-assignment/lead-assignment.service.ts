import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { cappedOutEmployeeIds } from '../../common/routing/daily-lead-cap';

/**
 * Shared round-robin lead → sales-employee assignment.
 *
 * Single source of truth for "pick the next agent" across every async lead
 * channel (CSV import, Meta Lead Forms, …). Uses the SAME cursor
 * (`Organization.rrCursorEmployeeId`) as the live WhatsApp engine so the
 * overall workload stays fair across all sources combined.
 *
 * Presence-agnostic on purpose: form/CSV leads arrive when the *customer*
 * acts, not when an agent happens to be online, so they're distributed to any
 * eligible agent 24/7 (the agent picks them up next shift). The live-WhatsApp
 * engine layers an ONLINE-only gate on top for real-time chats — that lives in
 * `WhatsAppAssignmentService` and is intentionally NOT duplicated here.
 *
 * Eligibility (identical to the WhatsApp pool):
 *   employee.isActive = true, whatsappInboxMember = true, deletedAt = null,
 *   linked UserAccount.status = ACTIVE, and NOT holding a finance role.
 *
 * The finance exclusion was missing here while `WhatsAppAssignmentService`
 * enforced it, so this docblock's claim of parity was false and Meta / CSV
 * leads could be round-robined onto a Finance officer. Working a new sales
 * lead is a sales job; finance staff sit in the same employee table and can
 * be WhatsApp inbox members for their own workflows, which is exactly why
 * `whatsappInboxMember` alone is not a sufficient filter.
 *
 * It lives in `ELIGIBLE_WHERE` rather than in `pickNextAgent`, so the reception
 * "referred by" picker and `isEligibleAgent` inherit it as well — those already
 * documented themselves as never returning finance staff, and now that holds.
 */
@Injectable()
export class LeadAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pick the next eligible agent in round-robin order and advance the shared
   * cursor — atomically, in one transaction, so concurrent callers don't
   * double-assign or skip. Returns null when no eligible agent exists (caller
   * stores the lead unassigned; a later assignment can pick it up).
   *
   * @param selectedAgentIds optional allow-list restricting the pool to a
   *   specific sub-team (used by targeted CSV imports). Empty = whole pool.
   */
  /** The eligibility predicate for "can be assigned a lead" — the ONE definition
   *  reused by the round-robin, the "list agents" picker, and the single-agent
   *  eligibility check, so a human-chosen agent can never fall outside the pool
   *  the round-robin would use. */
  private static readonly ELIGIBLE_WHERE = {
    isActive: true,
    whatsappInboxMember: true,
    deletedAt: null,
    user: {
      status: 'ACTIVE' as const,
      // Finance staff are not assignment targets for new sales leads. Mirrors
      // WhatsAppAssignmentService so every async channel — CSV, Meta, website
      // — lands on the same pool the live engine uses. It sits in the shared
      // predicate rather than in pickNextAgent alone so the reception
      // "referred by" picker is filtered by it too.
      userRoles: { none: { role: { name: { in: ['finance', 'finance_manager'] } } } },
    },
  };

  /**
   * The eligible sales-agent pool (identical criteria to pickNextAgent), for UIs
   * that let a human pick an agent — e.g. the reception "referred by" selector.
   * Ordered by name for display. Never returns finance/processing/suspended staff.
   */
  async listEligibleAgents(): Promise<Array<{ id: string; firstName: string; lastName: string }>> {
    return this.prisma.employee.findMany({
      where: LeadAssignmentService.ELIGIBLE_WHERE,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    });
  }

  /** Is this employee CURRENTLY an eligible sales agent (assignable a lead)?
   *  Used to validate a human-chosen referrer at assignment time so a stale /
   *  deactivated pick falls back to the round-robin instead of orphaning a lead. */
  async isEligibleAgent(employeeId: string): Promise<boolean> {
    const hit = await this.prisma.employee.findFirst({
      where: { id: employeeId, ...LeadAssignmentService.ELIGIBLE_WHERE },
      select: { id: true },
    });
    return !!hit;
  }

  /**
   * @param opts.ignoreDailyCap skip the per-rep daily new-lead cap. Set ONLY for
   *   a LIVE ringing customer (Telenor Smart Office inbound call) — a call must
   *   still reach a rep even if they've hit their proactive-lead quota. Every
   *   proactive channel (CSV, Meta, walk-in, API create) leaves this false.
   */
  async pickNextAgent(
    selectedAgentIds: string[] = [],
    opts?: { ignoreDailyCap?: boolean },
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const pool = await tx.employee.findMany({
        where: {
          ...LeadAssignmentService.ELIGIBLE_WHERE,
          // Skip reps the admin has paused from NEW leads. Only the auto
          // round-robin honors this — the manual pickers (listEligibleAgents /
          // isEligibleAgent) deliberately still include them, so a human can
          // hand-assign a lead to a paused rep on purpose.
          presenceLocked: false,
          ...(selectedAgentIds.length > 0 ? { id: { in: selectedAgentIds } } : {}),
        },
        orderBy: { id: 'asc' },
        select: { id: true, dailyLeadCap: true },
      });
      // Drop reps who've hit their per-rep DAILY cap today (same rule the live
      // engine applies) so this async channel can't overshoot it either. Manual
      // pickers above are intentionally NOT filtered — a human override wins —
      // and a live inbound call passes ignoreDailyCap so a ringing customer is
      // never stranded by the cap.
      const cappedOut = opts?.ignoreDailyCap ? new Set<string>() : await cappedOutEmployeeIds(tx, pool);
      const eligible = pool.filter((e) => !cappedOut.has(e.id));
      if (eligible.length === 0) return null;

      const org = await tx.organization.findFirst({ orderBy: { createdAt: 'asc' } });
      if (!org) return eligible[0]!.id;

      const cursor = org.rrCursorEmployeeId;
      const next = cursor ? eligible.find((e) => e.id > cursor) : eligible[0];
      const pick = next ?? eligible[0]!;

      await tx.organization.update({
        where: { id: org.id },
        data: { rrCursorEmployeeId: pick.id },
      });
      return pick.id;
    });
  }
}
