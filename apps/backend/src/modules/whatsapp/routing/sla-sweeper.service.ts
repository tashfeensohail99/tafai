import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PresenceStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { WhatsAppRealtimePublisher } from '../realtime/publisher.service';
import { WhatsAppAssignmentService } from './assignment.service';
import { isWithinBusinessHours, type BusinessHours } from './business-hours';
import { WHATSAPP_WS_EVENTS } from '../queues/queue-contracts';

/**
 * Response-SLA sweeper.
 *
 * The rolling Response-SLA clock (thread.responseDeadlineAt) is event-driven
 * on both ends — set when a customer message arrives, cleared when the agent
 * replies. But the *miss* of a deadline is a non-event: if nobody replies,
 * nothing fires. This sweeper is what notices.
 *
 * Every 60s it scans threads that are awaiting an agent reply and:
 *   - fires an "approaching" warning once, when within slaWarnBeforeSeconds
 *     of the deadline (responseWarned guard);
 *   - fires a "breach" once, when the deadline has passed (responseBreached
 *     guard) AND atomically credits the assigned agent's breach tally.
 *
 * Race-safety: the breach flag flip is an updateMany gated on
 * responseBreached:false, so even if two sweeps overlapped only one would
 * win the flip and count the breach. We run a single backend instance, but
 * this keeps it correct regardless.
 *
 * We deliberately do NOT auto-reassign — per product decision, the warning
 * just tells the agent "leads are reassigned after N breaches". Flipping on
 * real reassignment later is a localized change here.
 */
@Injectable()
export class WhatsAppSlaSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhatsAppSlaSweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private static readonly INTERVAL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: WhatsAppRealtimePublisher,
    private readonly assignment: WhatsAppAssignmentService,
    private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    // Stagger the first run a few seconds after boot so it doesn't collide
    // with migration/startup work.
    this.timer = setInterval(() => {
      void this.sweep().catch((err) =>
        this.log.error(`SLA sweep failed: ${(err as Error).message}`),
      );
    }, WhatsAppSlaSweeperService.INTERVAL_MS);
    this.log.log('Response-SLA sweeper started (60s interval)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<void> {
    if (this.running) return; // never overlap a slow sweep with the next tick
    this.running = true;
    try {
      // Safety net: recover any open thread the webhook left unassigned. Runs
      // first and unconditionally so an assignment stall self-heals in <=60s.
      await this.recoverUnassignedThreads();

      const org = await this.prisma.organization.findFirst({
        orderBy: { createdAt: 'asc' },
      });
      if (!org) return;

      // Presence accountability + daily report run every tick, independent of
      // SLA threads (so they must be BEFORE the no-pending early return below).
      const hours: BusinessHours = {
        timezone: org.timezone,
        hoursOpen: org.hoursOpen,
        hoursClose: org.hoursClose,
        workingDays: org.workingDays,
        breakStart: org.breakStart,
        breakEnd: org.breakEnd,
      };
      await this.enforcePresenceAccountability(org.id, hours);
      await this.maybeSendDailyReport(hours);

      const now = new Date();
      const warnCutoff = new Date(now.getTime() + org.slaWarnBeforeSeconds * 1000);

      // Pull the (bounded) set of threads currently awaiting an agent reply
      // whose deadline is either already past or within the warn window.
      //
      // CRITICAL: exclude already-breached threads. A breach sets
      // responseBreached=true but does NOT clear responseDeadlineAt (only an
      // agent reply clears it), so a breached-but-unanswered thread would
      // otherwise stay in this window forever, doing nothing — the breach path
      // needs !responseBreached and the warn path needs !isPast, and a breached
      // thread satisfies neither. With `take: 500` and no ORDER BY, those inert
      // rows accumulate and can starve genuinely-new threads out of the page,
      // so warnings/breaches silently stop firing. Filtering them here keeps the
      // working set to threads that still need action. (Does not affect the
      // "overdue" KPI, which keys off responseDeadlineAt, not this query.)
      const pending = await this.prisma.whatsAppThread.findMany({
        where: {
          responseDeadlineAt: { not: null, lte: warnCutoff },
          responseBreached: false,
        },
        select: {
          id: true,
          responseDeadlineAt: true,
          responseWarned: true,
          responseBreached: true,
          leadId: true,
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              assignedEmployeeId: true,
            },
          },
        },
        take: 500,
      });
      if (pending.length === 0) return;

      let breaches = 0;
      let warnings = 0;

      for (const t of pending) {
        if (!t.responseDeadlineAt) continue;
        const isPast = now >= t.responseDeadlineAt;

        if (isPast && !t.responseBreached) {
          // Atomically claim the breach so concurrent sweeps can't double-count.
          const flipped = await this.prisma.whatsAppThread.updateMany({
            where: { id: t.id, responseBreached: false },
            data: { responseBreached: true },
          });
          if (flipped.count === 1) {
            breaches++;
            if (t.lead?.assignedEmployeeId) {
              await this.prisma.employee.update({
                where: { id: t.lead.assignedEmployeeId },
                data: { slaResponsesBreached: { increment: 1 } },
              });
            }
            await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.SLA_BREACH, {
              threadId: t.id,
              leadId: t.leadId,
              assignedEmployeeId: t.lead?.assignedEmployeeId ?? null,
              leadName: t.lead ? `${t.lead.firstName} ${t.lead.lastName}`.trim() : null,
              reassignThreshold: org.slaReassignThreshold,
            });
          }
        } else if (!isPast && !t.responseWarned) {
          // Approaching — fire the pre-breach nudge once.
          const flipped = await this.prisma.whatsAppThread.updateMany({
            where: { id: t.id, responseWarned: false },
            data: { responseWarned: true },
          });
          if (flipped.count === 1) {
            warnings++;
            await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.SLA_WARNING, {
              threadId: t.id,
              leadId: t.leadId,
              assignedEmployeeId: t.lead?.assignedEmployeeId ?? null,
              leadName: t.lead ? `${t.lead.firstName} ${t.lead.lastName}`.trim() : null,
              deadlineAt: t.responseDeadlineAt,
              reassignThreshold: org.slaReassignThreshold,
            });
          }
        }
      }

      if (breaches > 0 || warnings > 0) {
        this.log.log(`SLA sweep: ${warnings} warning(s), ${breaches} breach(es)`);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Self-healing assignment recovery.
   *
   * Every inbound is assigned inline by the webhook worker, but that call is
   * wrapped in a non-fatal try/catch (a failure there must never drop the
   * message we already saved). The downside: a transient DB blip, a race, or a
   * bug in the engine leaves the lead unassigned and SILENT — which is exactly
   * how a stall once ran for hours before anyone noticed.
   *
   * This gives every still-unassigned open thread a second chance on every
   * 60s tick. ensureAssigned is idempotent (no-ops on an already-assigned
   * lead), so once the webhook path is healthy this is just one cheap COUNT-ish
   * query returning nothing. Bounded to 50/tick so a large backlog drains over
   * a few minutes instead of hammering the DB in one burst.
   */
  private async recoverUnassignedThreads(): Promise<void> {
    const stuck = await this.prisma.whatsAppThread.findMany({
      where: {
        status: { not: 'ARCHIVED' },
        lead: { is: { assignedEmployeeId: null, deletedAt: null } },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    if (stuck.length === 0) return;

    let recovered = 0;
    for (const t of stuck) {
      try {
        const outcome = await this.assignment.ensureAssigned(t.id);
        if (outcome.assignedEmployeeId) recovered++;
      } catch (err) {
        // Surface loudly — if recovery itself fails the engine is broken and
        // we WANT it in the logs, not swallowed like the webhook path.
        this.log.error(
          `assignment recovery failed for thread ${t.id}: ${(err as Error).message}`,
        );
      }
    }
    if (recovered > 0) {
      this.log.warn(
        `assignment recovery: re-assigned ${recovered} thread(s) the webhook left unassigned`,
      );
    }
  }

  /**
   * Presence accountability (consequences for manual Away/Offline) — working
   * hours only. Runs every 60s tick:
   *   - accrues per-day Away/Offline minutes, reset at the Karachi day rollover;
   *   - Away > 10 min continuous → one warning popup per episode;
   *   - Offline > 2h cumulative → −2 SLA points (once/day) + email + popup;
   *   - recovers the SLA penalty by +1 each day.
   * The minute counters also feed the daily report (Slice 3).
   */
  private async enforcePresenceAccountability(
    orgId: string,
    hours: BusinessHours,
  ): Promise<void> {
    const now = new Date();
    const withinHours = isWithinBusinessHours(hours, now);
    // Karachi calendar day, 'YYYY-MM-DD' (en-CA yields ISO date order).
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: hours.timezone }).format(now);
    const tickMin = WhatsAppSlaSweeperService.INTERVAL_MS / 60_000;

    const emps = await this.prisma.employee.findMany({
      where: { isActive: true, whatsappInboxMember: true, deletedAt: null, user: { status: 'ACTIVE' } },
      select: {
        id: true, firstName: true, lastName: true,
        presenceStatus: true, presenceChangedAt: true,
        awayMinutesToday: true, offlineMinutesToday: true, presenceCountersDate: true,
        awayWarnedAt: true, offlinePenalizedDate: true, penaltyDecayDate: true, slaPenaltyPoints: true,
        user: { select: { email: true } },
      },
    });

    for (const e of emps) {
      const data: Prisma.EmployeeUpdateInput = {};
      let awayMin = e.awayMinutesToday;
      let offMin = e.offlineMinutesToday;
      let penalty = e.slaPenaltyPoints;
      let touchedCounters = false;

      // Day rollover — reset per-day accruals (offlinePenalizedDate is itself
      // date-stamped so it self-resets via the != today check below).
      if (e.presenceCountersDate !== today) {
        awayMin = 0;
        offMin = 0;
        data.presenceCountersDate = today;
        touchedCounters = true;
      }

      // Recover the SLA penalty by +1, once per day.
      if (e.penaltyDecayDate !== today) {
        if (penalty > 0) {
          penalty -= 1;
          data.slaPenaltyPoints = penalty;
        }
        data.penaltyDecayDate = today;
      }

      // Accrue minutes — working hours only.
      if (withinHours && e.presenceStatus === PresenceStatus.AWAY) {
        awayMin += tickMin;
        touchedCounters = true;
      } else if (withinHours && e.presenceStatus === PresenceStatus.OFFLINE) {
        offMin += tickMin;
        touchedCounters = true;
      }
      if (touchedCounters) {
        data.awayMinutesToday = awayMin;
        data.offlineMinutesToday = offMin;
      }

      // Away > 10 min continuous → one nudge popup per episode (working hours).
      if (
        withinHours &&
        e.presenceStatus === PresenceStatus.AWAY &&
        !e.awayWarnedAt &&
        e.presenceChangedAt
      ) {
        const continuousMin = (now.getTime() - e.presenceChangedAt.getTime()) / 60_000;
        if (continuousMin >= 10) {
          data.awayWarnedAt = now;
          await this.publisher.publishToOrg(orgId, WHATSAPP_WS_EVENTS.PRESENCE_AWAY_WARNING, {
            employeeId: e.id,
            minutes: Math.round(continuousMin),
          });
        }
      }

      // Offline > 2h cumulative working hours → −2 SLA points (once/day) + email + popup.
      if (
        e.presenceStatus === PresenceStatus.OFFLINE &&
        offMin >= 120 &&
        e.offlinePenalizedDate !== today
      ) {
        penalty += 2;
        data.slaPenaltyPoints = penalty;
        data.offlinePenalizedDate = today;
        if (e.user?.email) {
          this.email
            .sendPresenceOfflineWarning({
              to: e.user.email,
              firstName: e.firstName,
              offlineMinutes: offMin,
              penaltyPoints: 2,
            })
            .catch((err) =>
              this.log.warn(`offline-warning email failed for ${e.id}: ${(err as Error).message}`),
            );
        }
        await this.publisher.publishToOrg(orgId, WHATSAPP_WS_EVENTS.PRESENCE_OFFLINE_PENALTY, {
          employeeId: e.id,
          offlineMinutes: Math.round(offMin),
          penalty: 2,
        });
        this.log.warn(
          `presence penalty: ${e.firstName} ${e.lastName} −2 SLA (offline ${Math.round(offMin)}m today)`,
        );
      }

      if (Object.keys(data).length > 0) {
        await this.prisma.employee.update({ where: { id: e.id }, data });
      }
    }
  }

  /**
   * End-of-day presence report (6 PM, working days only): snapshot each agent's
   * Away/Offline working-hours minutes + any SLA penalty applied today, store it
   * for history, and email the summary to the admin. Idempotent — only the first
   * sweep after 18:00 with no snapshot for today does the work.
   */
  private async maybeSendDailyReport(hours: BusinessHours): Promise<void> {
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: hours.timezone }).format(now);
    const hour = parseInt(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: hours.timezone,
        hour: '2-digit',
        hour12: false,
      }).format(now),
      10,
    );
    if (hour < 18) return; // before 6 PM

    // Working days only (skip weekends/holidays-off).
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: hours.timezone, weekday: 'short' }).format(now);
    const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    if (!hours.workingDays.includes(wdMap[wd] ?? -1)) return;

    // Already compiled today? (the snapshot rows are the marker)
    const existing = await this.prisma.presenceDailyReport.count({ where: { reportDate: today } });
    if (existing > 0) return;

    const emps = await this.prisma.employee.findMany({
      where: { isActive: true, whatsappInboxMember: true, deletedAt: null, user: { status: 'ACTIVE' } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        awayMinutesToday: true,
        offlineMinutesToday: true,
        offlinePenalizedDate: true,
      },
    });
    if (emps.length === 0) return;

    const rows = emps.map((e) => ({
      employeeId: e.id,
      reportDate: today,
      employeeName: `${e.firstName} ${e.lastName}`.trim(),
      awayMinutes: e.awayMinutesToday,
      offlineMinutes: e.offlineMinutesToday,
      penaltyApplied: e.offlinePenalizedDate === today ? 2 : 0,
    }));
    await this.prisma.presenceDailyReport.createMany({ data: rows, skipDuplicates: true });

    const to = process.env.PRESENCE_REPORT_EMAIL ?? 'admin@tashfeengroup.com';
    this.email
      .sendDailyPresenceReport({
        to,
        date: today,
        rows: rows.map((r) => ({
          name: r.employeeName,
          awayMinutes: r.awayMinutes,
          offlineMinutes: r.offlineMinutes,
          penaltyApplied: r.penaltyApplied,
        })),
      })
      .catch((err) =>
        this.log.warn(`daily presence report email failed: ${(err as Error).message}`),
      );
    this.log.log(`presence daily report compiled + emailed for ${today} (${rows.length} agents)`);
  }
}
