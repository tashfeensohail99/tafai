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
    };
  }

  /** Agent toggles their explicit presence. */
  async setExplicit(userId: string, status: PresenceStatus): Promise<void> {
    const emp = await this.employeeFor(userId);
    const now = new Date();
    await this.prisma.employee.update({
      where: { id: emp.id },
      data: {
        presenceStatus: status,
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

  static computeEffective(emp: {
    presenceStatus: PresenceStatus;
    lastActivityAt: Date | null;
  }): PresenceStatus {
    // The pill + team dashboard reflect the agent's MANUAL availability choice.
    // (Real activity is shown separately on /admin/employees via lastActivityAt.)
    return emp.presenceStatus;
  }
}
