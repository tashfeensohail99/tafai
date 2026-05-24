import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

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
 *   linked UserAccount.status = ACTIVE.
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
  async pickNextAgent(selectedAgentIds: string[] = []): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const eligible = await tx.employee.findMany({
        where: {
          isActive: true,
          whatsappInboxMember: true,
          deletedAt: null,
          user: { status: 'ACTIVE' },
          ...(selectedAgentIds.length > 0 ? { id: { in: selectedAgentIds } } : {}),
        },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
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
