import { Injectable, NotFoundException } from '@nestjs/common';
import { PresenceStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

// Presence is the agent's MANUAL availability (Online/Away/Offline). It drives
// the topbar pill + routing. Real-time *activity* (lastActivityAt, updated by
// the global interceptor) is a SEPARATE signal shown on /admin/employees — the
// two-systems split the team asked for.

/**
 * Agent presence (ONLINE / AWAY / OFFLINE).
 *
 * Three independent signals contribute:
 *   1. Explicit toggle in the dashboard topbar (`employees.presenceStatus`)
 *   2. Heartbeat freshness (`employees.lastActivityAt` — updated on every
 *      socket connect, every API call from the dashboard, and an explicit
 *      `POST /whatsapp/presence/heartbeat` every ~60s)
 *   3. Business hours (org-level; layered at the routing engine, not here)
 *
 * The **effective** presence returned by computeEffective() combines (1) + (2):
 *   - OFFLINE → OFFLINE
 *   - ONLINE + stale heartbeat (>5 min) → AWAY override
 *   - ONLINE + fresh heartbeat → ONLINE
 *   - AWAY → AWAY
 *
 * Business-hours override is applied at the routing layer (only ONLINE
 * employees within hours are eligible for round-robin), not in this service.
 */
@Injectable()
export class WhatsAppPresenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the calling user's Employee row. WhatsApp inbox membership lives
   * on Employee, not UserAccount.
   */
  private async employeeFor(userId: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { userId },
      select: {
        id: true,
        presenceStatus: true,
        lastActivityAt: true,
        presenceChangedAt: true,
        whatsappInboxMember: true,
        presenceLocked: true,
      },
    });
    if (!emp) throw new NotFoundException('No employee profile for this user');
    return emp;
  }

  /** Effective presence + raw toggle state for the calling user. */
  async getMine(userId: string) {
    const emp = await this.employeeFor(userId);
    return {
      employeeId: emp.id,
      whatsappInboxMember: emp.whatsappInboxMember,
      explicit: emp.presenceStatus,
      effective: WhatsAppPresenceService.computeEffective(emp),
      lastActivityAt: emp.lastActivityAt,
      presenceChangedAt: emp.presenceChangedAt,
      // When true the topbar toggle is locked OFFLINE (admin paused new leads).
      presenceLocked: emp.presenceLocked,
    };
  }

  /** Agent toggles their explicit presence. */
  async setExplicit(userId: string, status: PresenceStatus): Promise<void> {
    const emp = await this.employeeFor(userId);
    // A presence-locked (admin-paused) rep is pinned OFFLINE: ignore any attempt
    // — theirs or the app's — to flip back online, so "no new leads" sticks.
    const effective = emp.presenceLocked ? PresenceStatus.OFFLINE : status;
    const now = new Date();
    await this.prisma.employee.update({
      where: { id: emp.id },
      data: {
        presenceStatus: effective,
        presenceChangedAt: now,
      },
    });
  }

  /** Cheap activity ping — bumps lastActivityAt. Called every ~60s by the UI. */
  async heartbeat(userId: string): Promise<void> {
    const emp = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!emp) return;
    await this.prisma.employee.update({
      where: { id: emp.id },
      data: { lastActivityAt: new Date() },
    });
  }

  /**
   * Manager / admin live view: every active employee in the inbox pool with
   * presence + open thread load.
   */
  async listTeam() {
    const rows = await this.prisma.employee.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        // Deactivated/suspended users shouldn't show up in the admin's
        // reassign dropdown — picking one would route a chat to someone
        // who can't log in to answer it.
        user: { status: 'ACTIVE' },
      },
      orderBy: [{ whatsappInboxMember: 'desc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        whatsappInboxMember: true,
        presenceStatus: true,
        presenceLocked: true,
        lastActivityAt: true,
        skills: true,
        user: { select: { email: true } },
        _count: {
          select: {
            assignedLeads: {
              where: { status: { in: ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'FOLLOW_UP'] } },
            },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`.trim(),
      email: r.user.email,
      whatsappInboxMember: r.whatsappInboxMember,
      presenceLocked: r.presenceLocked,
      skills: r.skills,
      explicit: r.presenceStatus,
      effective: WhatsAppPresenceService.computeEffective({
        presenceStatus: r.presenceStatus,
        lastActivityAt: r.lastActivityAt,
      }),
      lastActivityAt: r.lastActivityAt,
      openLeads: r._count.assignedLeads,
    }));
  }

  /**
   * Admin daily presence-accountability report:
   *   - today: LIVE per-agent Away/Offline working-hours minutes + current
   *     SLA penalty (from the accumulators the sweeper maintains);
   *   - history: the last ~10 end-of-day snapshots (from presence_daily_reports).
   */
  async dailyReport() {
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { timezone: true },
    });
    const tz = org?.timezone ?? 'Asia/Karachi';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

    const emps = await this.prisma.employee.findMany({
      where: { isActive: true, whatsappInboxMember: true, deletedAt: null, user: { status: 'ACTIVE' } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true, firstName: true, lastName: true, presenceStatus: true,
        awayMinutesToday: true, offlineMinutesToday: true,
        slaPenaltyPoints: true, offlinePenalizedDate: true,
      },
    });
    const todayRows = emps.map((e) => ({
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      presence: e.presenceStatus,
      awayMinutes: e.awayMinutesToday,
      offlineMinutes: e.offlineMinutesToday,
      penaltyPoints: e.slaPenaltyPoints,
      penalizedToday: e.offlinePenalizedDate === today,
    }));

    const snaps = await this.prisma.presenceDailyReport.findMany({
      where: { reportDate: { not: today } },
      orderBy: [{ reportDate: 'desc' }, { offlineMinutes: 'desc' }],
      take: 300,
    });
    const byDate = new Map<string, Array<{ name: string; awayMinutes: number; offlineMinutes: number; penaltyApplied: number }>>();
    for (const s of snaps) {
      if (!byDate.has(s.reportDate)) byDate.set(s.reportDate, []);
      byDate.get(s.reportDate)!.push({
        name: s.employeeName,
        awayMinutes: s.awayMinutes,
        offlineMinutes: s.offlineMinutes,
        penaltyApplied: s.penaltyApplied,
      });
    }
    const history = [...byDate.entries()]
      .slice(0, 10)
      .map(([date, rows]) => ({ date, rows }));

    return { today: { date: today, rows: todayRows }, history };
  }

  static computeEffective(emp: {
    presenceStatus: PresenceStatus;
    lastActivityAt: Date | null;
  }): PresenceStatus {
    // The pill + team dashboard reflect the agent's MANUAL availability choice.
    // (Real activity is shown separately on /admin/employees via lastActivityAt.)
    return emp.presenceStatus;
  }
}
