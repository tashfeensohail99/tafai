import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, PresenceStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LeadAssignmentService } from '../lead-assignment/lead-assignment.service';
import {
  ONLINE_ROUND_ROBIN_SOURCE_CHANNELS,
  startOfPktDayUtc,
} from '../../common/routing/daily-lead-cap';

/** One rep row for the admin "Lead Caps" tab. */
export interface LeadCapRow {
  id: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  presenceStatus: PresenceStatus;
  presenceLocked: boolean;
  /** null = unlimited; 0 = block all new online leads; N = at most N/day. */
  dailyLeadCap: number | null;
  /** Online (round-robin) leads assigned to this rep since PKT-midnight. */
  usedToday: number;
  /** True when a cap is set and today's online count has reached it. */
  capReached: boolean;
}

/**
 * Admin management of the per-rep DAILY ONLINE-lead cap (Employee.dailyLeadCap).
 * The cap throttles ONLY the live round-robin (inbound WhatsApp/CTWA + Messenger)
 * — CSV imports, Meta forms, manual and reception assignments are never capped
 * (see common/routing/daily-lead-cap.ts). This service powers the admin tab that
 * replaces the enable-rep-with-cap.ts CLI script.
 */
@Injectable()
export class LeadCapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Every round-robin-eligible rep with their cap + today's online usage, plus
   *  an all-capped alert so admin can see when the live pool is exhausted. */
  async listReps(): Promise<{ reps: LeadCapRow[]; allOnlineCapped: boolean; waitingUnassigned: number }> {
    const since = startOfPktDayUtc();

    // The EXACT round-robin pool (reused so this list can never drift from who
    // actually receives leads). Capped/paused reps stay in the pool — they keep
    // existing chats — so they must appear here, badged.
    const reps = await this.prisma.employee.findMany({
      where: LeadAssignmentService.ELIGIBLE_WHERE,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        presenceStatus: true,
        presenceLocked: true,
        dailyLeadCap: true,
        branchId: true,
        branch: { select: { name: true } },
      },
    });

    // Online leads assigned today per rep — same count the cap enforces.
    const counts = reps.length
      ? await this.prisma.lead.groupBy({
          by: ['assignedEmployeeId'],
          where: {
            assignedEmployeeId: { in: reps.map((r) => r.id) },
            createdAt: { gte: since },
            deletedAt: null,
            sourceChannel: { in: [...ONLINE_ROUND_ROBIN_SOURCE_CHANNELS] },
          },
          _count: { _all: true },
        })
      : [];
    const usedBy = new Map<string, number>();
    for (const c of counts) if (c.assignedEmployeeId) usedBy.set(c.assignedEmployeeId, c._count._all);

    const rows: LeadCapRow[] = reps.map((r) => {
      const usedToday = usedBy.get(r.id) ?? 0;
      return {
        id: r.id,
        name: `${r.firstName} ${r.lastName}`.trim(),
        branchId: r.branchId,
        branchName: r.branch?.name ?? null,
        presenceStatus: r.presenceStatus,
        presenceLocked: r.presenceLocked,
        dailyLeadCap: r.dailyLeadCap,
        usedToday,
        capReached: r.dailyLeadCap != null && usedToday >= r.dailyLeadCap,
      };
    });

    // Alert: every currently-ONLINE, un-paused rep has hit their cap → the live
    // round-robin pool is empty and new online leads sit unassigned until a cap
    // is lifted or PKT-midnight resets the window.
    const onlineActive = rows.filter((r) => r.presenceStatus === 'ONLINE' && !r.presenceLocked);
    const allOnlineCapped = onlineActive.length > 0 && onlineActive.every((r) => r.capReached);

    // How many online leads are actually waiting right now (today), so the
    // banner can quantify the impact.
    const waitingUnassigned = await this.prisma.lead.count({
      where: {
        assignedEmployeeId: null,
        deletedAt: null,
        createdAt: { gte: since },
        sourceChannel: { in: [...ONLINE_ROUND_ROBIN_SOURCE_CHANNELS] },
      },
    });

    return { reps: rows, allOnlineCapped, waitingUnassigned };
  }

  /** Set (or clear, with null) a rep's daily online-lead cap. */
  async setCap(employeeId: string, cap: number | null, actorUserId: string) {
    if (cap != null && (!Number.isInteger(cap) || cap < 0)) {
      throw new BadRequestException('Cap must be a non-negative whole number, or null to clear it.');
    }
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true, dailyLeadCap: true },
    });
    if (!emp) throw new NotFoundException('Employee not found');

    const updated = await this.prisma.employee.update({
      where: { id: employeeId },
      data: { dailyLeadCap: cap },
      select: { id: true, dailyLeadCap: true },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.USER_UPDATED,
      entityType: 'Employee',
      entityId: employeeId,
      oldValues: { dailyLeadCap: emp.dailyLeadCap },
      newValues: { dailyLeadCap: cap },
    });

    return updated;
  }
}
