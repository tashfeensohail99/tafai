/**
 * WhatsApp conversation → sales-employee assignment engine.
 *
 * Algorithm (priority order — see research notes):
 *   1. **Sticky.** If the lead's `preferredEmployeeId` is set AND that employee
 *      is currently eligible (whatsappInboxMember + ONLINE + heartbeat fresh
 *      + business is open), assign to them.
 *   2. **Strict round-robin.** Walk eligible employees in deterministic order
 *      (by id) starting after `Organization.rrCursorEmployeeId`. Update cursor.
 *   3. **After-hours / no agents.** Leave the lead unassigned. Caller may
 *      enqueue a retry for the next business open or send an auto-ack template.
 *
 * Eligibility for an Employee:
 *   - isActive = true
 *   - whatsappInboxMember = true
 *   - presenceStatus = ONLINE
 *   - lastActivityAt within HEARTBEAT_WINDOW_MS
 *   - the org's business hours are currently open
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
import {
  computeSlaDeadline,
  isWithinBusinessHours,
  nextBusinessOpen,
  type BusinessHours,
} from './business-hours';

const HEARTBEAT_WINDOW_MS = 5 * 60 * 1000;

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

      // Already assigned — nothing to do (manual reassign takes priority).
      if (lead.assignedEmployeeId) {
        return {
          leadId: lead.id,
          threadId,
          assignedEmployeeId: lead.assignedEmployeeId,
          reason: null,
          retryAt: null,
        };
      }

      const open = isWithinBusinessHours(hours, now);
      if (!open) {
        const retryAt = nextBusinessOpen(hours, now);
        this.log.log(
          { leadId: lead.id, retryAt: retryAt.toISOString() },
          'assignment: outside business hours; deferred to next open',
        );
        return { leadId: lead.id, threadId, assignedEmployeeId: null, reason: null, retryAt };
      }

      const eligible = await this.loadEligibleEmployees(tx, org.organizationId);
      if (eligible.length === 0) {
        this.log.log({ leadId: lead.id }, 'assignment: no eligible employees online');
        return { leadId: lead.id, threadId, assignedEmployeeId: null, reason: null, retryAt: null };
      }

      // 1. Sticky — does the lead's preferred employee qualify?
      const sticky = lead.preferredEmployeeId
        ? eligible.find((e) => e.id === lead.preferredEmployeeId)
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

      // 2. Strict round-robin: smallest id strictly greater than cursor.
      const pick = pickRoundRobin(eligible, org.rrCursorEmployeeId);
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

  private async loadEligibleEmployees(
    tx: Prisma.TransactionClient,
    _organizationId: string,
  ): Promise<{ id: string }[]> {
    const heartbeatFloor = new Date(Date.now() - HEARTBEAT_WINDOW_MS);
    const rows = await tx.employee.findMany({
      where: {
        isActive: true,
        whatsappInboxMember: true,
        presenceStatus: PresenceStatus.ONLINE,
        lastActivityAt: { gte: heartbeatFloor },
        deletedAt: null,
      },
      orderBy: { id: 'asc' },
      select: { id: true },
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
        // Move the pipeline from NEW → CONTACTED on first auto-assignment so
        // the lead surfaces in the agent's inbox under "engaged" filters.
        status: 'CONTACTED',
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
