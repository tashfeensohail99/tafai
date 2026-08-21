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
import { WhatsAppAssignmentService, createAssignmentCache } from './assignment.service';
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
  /** Max stuck threads actually ASSIGNED per recovery pass. */
  private static readonly RECOVERY_LIMIT = 10;
  /** Hard ceiling on the over-fetched page (LIMIT + threads currently in backoff). */
  private static readonly RECOVERY_MAX_PAGE = 50;

  // Per-thread recovery backoff (in-memory; reset on restart — that's fine, a
  // restart just re-tries everything once). Stops the recovery loop from
  // re-running the SAME doomed assignment transaction every 60s, which floods
  // the logs and competes for the scarce DB pool. Never abandons a lead: the
  // backoff caps the RETRY FREQUENCY, not the total number of attempts.
  private readonly recoveryBackoff = new Map<string, { fails: number; nextAt: number }>();
  private static readonly RECOVERY_MAX_BACKOFF_MS = 30 * 60_000; // cap at 30 min
  private static readonly RECOVERY_ALERT_AFTER = 5; // WARN a human after N straight fails

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
      // Exclude already-breached threads. A breach now CLEARS responseDeadlineAt
      // (see the breach block below), so breached threads are already dropped by
      // `not: null` — this `responseBreached: false` is a belt-and-braces guard.
      // It keeps the working set to threads that still need action, protecting
      // the `take: 500` page from inert rows starving genuinely-new threads.
      // (Because breach clears the clock, the "overdue" KPI — which keys off
      // responseDeadlineAt — no longer accumulates abandoned breached threads.)
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
          // Clearing the SLA clock in the SAME update retires this thread from
          // the "overdue" KPI: the breach is tallied below, and the customer-
          // waiting signal lives in `awaitingReply` (untouched), so an abandoned
          // thread no longer inflates the overdue count forever.
          const flipped = await this.prisma.whatsAppThread.updateMany({
            where: { id: t.id, responseBreached: false },
            data: {
              responseBreached: true,
              responseDeadlineAt: null,
              responseDueSince: null,
              responseWarned: false,
            },
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
    // GATE: an inbound message only auto-assigns to an ONLINE agent. If NOBODY
    // is online, running ensureAssigned is pointless — every call does the full
    // ~10-round-trip transaction just to find an empty pool and return
    // unassigned, hammering the scarce DB pool for nothing. When reps aren't
    // marking themselves online this fired 50 useless transactions EVERY 60s
    // (the pool-starvation incident). One cheap COUNT gates the whole sweep;
    // the moment an agent comes online the next tick drains the backlog.
    const onlineAgents = await this.prisma.employee.count({
      where: {
        isActive: true,
        whatsappInboxMember: true,
        deletedAt: null,
        presenceStatus: PresenceStatus.ONLINE,
        user: {
          status: 'ACTIVE',
          userRoles: { none: { role: { name: { in: ['finance', 'finance_manager'] } } } },
        },
      },
    });
    if (onlineAgents === 0) {
      this.recoveryBackoff.clear(); // reset per-thread counters; not their fault
      this.log.debug('assignment recovery skipped: no ONLINE agent to receive leads');
      return;
    }

    const now = Date.now();
    // Process at most 10 threads per tick (was 50). Each still costs a read + a
    // locked write + audit rows, so a 50-thread batch was a hundreds-of-round-trip
    // burst every 60s against the same scarce pool. 10/tick = 600/hr — ample for
    // a lane that only catches what the webhook missed, and it drains a backlog
    // over minutes instead of in one storm.
    //
    // Backed-off threads are the OLDEST rows and stay unassigned, so they keep
    // reappearing at the head of this `createdAt asc` page. With a small page
    // they could wedge the lane entirely: every tick returns the same N
    // backed-off rows, processes none, and newer stuck threads never get in.
    // Over-fetch past them so we always have room for LIMIT actionable threads.
    const inBackoff = [...this.recoveryBackoff.values()].filter(
      (b) => b.nextAt > now,
    ).length;
    const stuck = await this.prisma.whatsAppThread.findMany({
      where: {
        status: { not: 'ARCHIVED' },
        lead: { is: { assignedEmployeeId: null, deletedAt: null } },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: Math.min(
        WhatsAppSlaSweeperService.RECOVERY_LIMIT + inBackoff,
        WhatsAppSlaSweeperService.RECOVERY_MAX_PAGE,
      ),
    });
    if (stuck.length === 0) {
      this.recoveryBackoff.clear();
      return;
    }

    const liveIds = new Set(stuck.map((t) => t.id));
    // Drop backoff entries for threads that are no longer stuck (assigned or
    // archived) so the map can't grow without bound.
    for (const id of this.recoveryBackoff.keys()) {
      if (!liveIds.has(id)) this.recoveryBackoff.delete(id);
    }

    let recovered = 0;
    let skipped = 0;
    let processed = 0;
    // ONE org memo for the whole batch: ensureAssigned() re-read the org (a
    // branch→organization join) once PER THREAD even though every stuck thread
    // resolves to the same org — needless cross-region round-trips every 60s on
    // the pool that starved (P2028). The memo advances the round-robin cursor
    // in-memory as it assigns, so the batch still spreads across reps rather
    // than piling onto one. Eligibility is deliberately NOT memoised (see
    // createAssignmentCache) — it gates lead-ownership overwrites.
    const cache = createAssignmentCache();
    for (const t of stuck) {
      if (processed >= WhatsAppSlaSweeperService.RECOVERY_LIMIT) break;
      const bo = this.recoveryBackoff.get(t.id);
      if (bo && bo.nextAt > now) {
        skipped++; // still backing off — don't re-hammer this doomed thread yet
        continue;
      }
      processed++;
      try {
        const outcome = await this.assignment.ensureAssigned(t.id, { cache });
        if (outcome.assignedEmployeeId) {
          recovered++;
          this.recoveryBackoff.delete(t.id); // success — clear its backoff
        } else {
          // Agents ARE online yet this thread still can't be placed — a real
          // edge (missing org/branch, etc.). Back it off; NEVER give up.
          this.registerRecoveryFailure(t.id, `unassigned (online agents present)`);
        }
      } catch (err) {
        this.registerRecoveryFailure(t.id, (err as Error).message);
      }
    }
    if (recovered > 0) {
      this.log.warn(
        `assignment recovery: re-assigned ${recovered} thread(s) the webhook left unassigned` +
          (skipped ? ` (${skipped} in backoff)` : ''),
      );
    }
  }

  /**
   * Record a recovery failure for a thread and schedule its next attempt with
   * exponential backoff (capped). After a run of straight failures WHILE agents
   * are online, surface it LOUDLY so a human investigates a genuinely-wedged
   * thread — but keep retrying forever so a lead is never silently dropped.
   */
  private registerRecoveryFailure(threadId: string, reason: string): void {
    const prev = this.recoveryBackoff.get(threadId);
    const fails = (prev?.fails ?? 0) + 1;
    const delay = Math.min(
      WhatsAppSlaSweeperService.RECOVERY_MAX_BACKOFF_MS,
      60_000 * Math.pow(2, fails - 1), // 1m, 2m, 4m, 8m, 16m, 30m(cap)
    );
    this.recoveryBackoff.set(threadId, { fails, nextAt: Date.now() + delay });
    if (fails === WhatsAppSlaSweeperService.RECOVERY_ALERT_AFTER) {
      this.log.error(
        `assignment recovery: thread ${threadId} still unassigned after ${fails} attempts with agents online — needs manual assignment. Last: ${reason}`,
      );
    } else {
      this.log.debug(`assignment recovery deferred for thread ${threadId} (fail #${fails}): ${reason}`);
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
