import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  apptDedupeKey,
  apptReminderContent,
  followupDueContent,
  followupDueDedupeKey,
  overdueDigestContent,
  overdueDigestKey,
  OVERDUE_DIGEST_HOUR_PKT,
  pktDateString,
  pktHour,
  reminderRunAt,
  startOfPktDayUtc,
} from './reminders.util';

/**
 * Durable reminder dispatcher.
 *
 * Every {@link INTERVAL_MS} it (1) reconciles the near-future source rows
 * (appointments + follow-ups) into the `reminder_jobs` ledger, then
 * (2) dispatches the jobs whose `runAt` has arrived, re-validating each against
 * the live source before firing.
 *
 * Why a ledger instead of the old in-memory window sweep: the previous
 * AppointmentReminderService only looked 10–20 minutes ahead each tick, so a
 * deploy or crash longer than that window silently dropped reminders. Here the
 * pending reminder is a durable row, so a restart loses nothing — the next tick
 * just picks up where it left off — and the same mechanism now covers
 * follow-ups (due + a daily overdue digest), not only appointments.
 *
 * Single dispatch point: {@link notify}. Push (FCM/APNs) plugs in there next
 * without touching any of the reconcile logic.
 */
@Injectable()
export class ReminderDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReminderDispatcherService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** Sweep cadence. 60s is ample — appointment reminders lead by 10 min. */
  private static readonly INTERVAL_MS = 60_000;
  /** How far ahead to materialise jobs (covers same-day bookings comfortably). */
  private static readonly HORIZON_HOURS = 24;
  /** Don't fire a follow-up "due" reminder for one that came due long ago. */
  private static readonly FOLLOWUP_DUE_GRACE_HOURS = 6;
  /** Per-tick caps so a backlog can't melt a sweep. */
  private static readonly RECONCILE_TAKE = 200;
  private static readonly DISPATCH_TAKE = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    // Defer the first run so it doesn't collide with startup work.
    setTimeout(() => {
      void this.tick().catch((err) =>
        this.log.error(`first reminder tick failed: ${(err as Error).message}`),
      );
    }, 10_000);

    this.timer = setInterval(() => {
      void this.tick().catch((err) =>
        this.log.error(`reminder tick failed: ${(err as Error).message}`),
      );
    }, ReminderDispatcherService.INTERVAL_MS);
    this.log.log(
      `Reminder dispatcher started (every ${ReminderDispatcherService.INTERVAL_MS / 1000}s)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One full reconcile + dispatch pass. Never overlaps a previous slow tick. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      await this.reconcileAppointments(now);
      await this.reconcileFollowupsDue(now);
      await this.reconcileOverdueDigests(now);
      await this.dispatchDue(now);
    } finally {
      this.running = false;
    }
  }

  // ───────────────────────────── Reconcile ─────────────────────────────

  /** Materialise APPOINTMENT_REMINDER jobs for upcoming, un-reminded appts. */
  private async reconcileAppointments(now: Date): Promise<void> {
    const horizon = new Date(now.getTime() + ReminderDispatcherService.HORIZON_HOURS * 3_600_000);
    const appts = await this.prisma.appointment.findMany({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        reminderSentAt: null,
        assignedEmployeeId: { not: null },
        scheduledAt: { gte: now, lte: horizon },
      },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        assignedEmployeeId: true,
        leadId: true,
        lead: { select: { firstName: true, phone: true } },
        client: { select: { firstName: true, phone: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: ReminderDispatcherService.RECONCILE_TAKE,
    });
    if (appts.length === 0) return;

    const userByEmp = await this.resolveUserIds(
      appts.map((a) => a.assignedEmployeeId).filter((x): x is string => Boolean(x)),
    );
    const keys = appts.map((a) => apptDedupeKey(a.id));
    const existing = await this.existingJobsByKey(keys);

    for (const a of appts) {
      const userId = a.assignedEmployeeId ? userByEmp.get(a.assignedEmployeeId) : null;
      if (!userId) continue;
      const runAt = reminderRunAt(a.scheduledAt);
      const who = this.partyName(a);
      const content = apptReminderContent({ title: a.title, who, scheduledAt: a.scheduledAt, now });
      const key = apptDedupeKey(a.id);
      const prior = existing.get(key);
      if (!prior) {
        await this.createJob({
          kind: 'APPOINTMENT_REMINDER',
          dedupeKey: key,
          runAt,
          userId,
          leadId: a.leadId,
          appointmentId: a.id,
          link: '/sales/appointments',
          ...content,
        });
      } else if (prior.status === 'PENDING' && prior.runAt.getTime() !== runAt.getTime()) {
        // Rescheduled before the reminder fired — move the pending job.
        await this.prisma.reminderJob.updateMany({
          where: { id: prior.id, status: 'PENDING' },
          data: { runAt, ...content },
        });
      }
    }
  }

  /** Materialise FOLLOWUP_DUE jobs for follow-ups coming due in the window. */
  private async reconcileFollowupsDue(now: Date): Promise<void> {
    const horizon = new Date(now.getTime() + ReminderDispatcherService.HORIZON_HOURS * 3_600_000);
    const floor = new Date(
      now.getTime() - ReminderDispatcherService.FOLLOWUP_DUE_GRACE_HOURS * 3_600_000,
    );
    const followUps = await this.prisma.followUp.findMany({
      where: {
        status: 'OPEN',
        assignedEmployeeId: { not: null },
        dueAt: { gte: floor, lte: horizon },
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        assignedEmployeeId: true,
        leadId: true,
        lead: { select: { firstName: true, phone: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: ReminderDispatcherService.RECONCILE_TAKE,
    });
    if (followUps.length === 0) return;

    const userByEmp = await this.resolveUserIds(
      followUps.map((f) => f.assignedEmployeeId).filter((x): x is string => Boolean(x)),
    );
    const existing = await this.existingJobsByKey(followUps.map((f) => followupDueDedupeKey(f.id)));

    for (const f of followUps) {
      const userId = f.assignedEmployeeId ? userByEmp.get(f.assignedEmployeeId) : null;
      if (!userId) continue;
      const key = followupDueDedupeKey(f.id);
      if (existing.has(key)) continue; // due time effectively immutable per id
      const who = f.lead?.firstName || f.lead?.phone || 'a lead';
      const content = followupDueContent({ title: f.title, who });
      await this.createJob({
        kind: 'FOLLOWUP_DUE',
        dedupeKey: key,
        runAt: f.dueAt,
        userId,
        leadId: f.leadId,
        followUpId: f.id,
        link: '/sales/follow-ups',
        ...content,
      });
    }
  }

  /**
   * One digest per user per PKT day, listing how many follow-ups are overdue.
   * Only fires from {@link OVERDUE_DIGEST_HOUR_PKT} onward so nobody gets a
   * buzz at midnight; the per-day dedupe key guarantees at most one.
   */
  private async reconcileOverdueDigests(now: Date): Promise<void> {
    if (pktHour(now) < OVERDUE_DIGEST_HOUR_PKT) return;
    const startOfToday = startOfPktDayUtc(now);

    // Tally per employee IN THE DATABASE. This previously did
    // `findMany({ select: { assignedEmployeeId }, take: 5000 })` and counted the
    // rows in JS — shipping up to 5,000 rows across the wire on EVERY 60s tick
    // from the digest hour until midnight (~360-480 times a day) purely to
    // produce a count.
    //
    // The `take: 5000` was also a silent CORRECTNESS bug: once the open-overdue
    // backlog passed 5,000, the cap truncated the set before the per-employee
    // tally, so digests under-counted and some reps were dropped entirely.
    // A grouped aggregate has no cap and transfers one row per employee.
    const grouped = await this.prisma.followUp.groupBy({
      by: ['assignedEmployeeId'],
      where: {
        status: 'OPEN',
        assignedEmployeeId: { not: null },
        dueAt: { lt: startOfToday },
      },
      _count: { _all: true },
    });
    if (grouped.length === 0) return;

    const countByEmp = new Map<string, number>();
    for (const g of grouped) {
      if (!g.assignedEmployeeId) continue;
      countByEmp.set(g.assignedEmployeeId, g._count._all);
    }
    const userByEmp = await this.resolveUserIds([...countByEmp.keys()]);
    const pktDate = pktDateString(now);
    const keys = [...countByEmp.keys()]
      .map((empId) => userByEmp.get(empId))
      .filter((u): u is string => Boolean(u))
      .map((userId) => overdueDigestKey(userId, pktDate));
    const existing = await this.existingJobsByKey(keys);

    for (const [empId, count] of countByEmp) {
      const userId = userByEmp.get(empId);
      if (!userId) continue;
      const key = overdueDigestKey(userId, pktDate);
      if (existing.has(key)) continue;
      const content = overdueDigestContent(count);
      await this.createJob({
        kind: 'FOLLOWUP_OVERDUE',
        dedupeKey: key,
        runAt: now,
        userId,
        link: '/sales/follow-ups',
        ...content,
      });
    }
  }

  // ───────────────────────────── Dispatch ─────────────────────────────

  /** Fire every PENDING job whose runAt has arrived, validating the source. */
  private async dispatchDue(now: Date): Promise<void> {
    const due = await this.prisma.reminderJob.findMany({
      where: { status: 'PENDING', runAt: { lte: now } },
      orderBy: { runAt: 'asc' },
      take: ReminderDispatcherService.DISPATCH_TAKE,
    });
    if (due.length === 0) return;

    for (const job of due) {
      const decision = await this.validate(job, now);
      // Atomically claim the job so a concurrent tick can't double-fire it.
      const claimed = await this.prisma.reminderJob.updateMany({
        where: { id: job.id, status: 'PENDING' },
        data: decision.send
          ? { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } }
          : { status: 'CANCELLED', attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) continue; // lost the race
      if (!decision.send) continue;

      await this.notify(job, decision.content ?? { title: job.title, body: job.body });
      if (job.kind === 'APPOINTMENT_REMINDER' && job.appointmentId) {
        // Keep the appointment's own flag in step so it's never re-materialised.
        await this.prisma.appointment
          .updateMany({ where: { id: job.appointmentId }, data: { reminderSentAt: new Date() } })
          .catch(() => undefined);
      }
    }
  }

  /** Re-check the live source; rebuild time-sensitive copy. */
  private async validate(
    job: { id: string; kind: string; appointmentId: string | null; followUpId: string | null; title: string; body: string | null },
    now: Date,
  ): Promise<{ send: boolean; content?: { title: string; body: string } }> {
    if (job.kind === 'APPOINTMENT_REMINDER') {
      if (!job.appointmentId) return { send: false };
      const a = await this.prisma.appointment.findUnique({
        where: { id: job.appointmentId },
        select: {
          status: true,
          title: true,
          scheduledAt: true,
          lead: { select: { firstName: true, phone: true } },
          client: { select: { firstName: true, phone: true } },
        },
      });
      // Skip if cancelled/completed/no-show, or already well past start time.
      if (!a || !['SCHEDULED', 'CONFIRMED'].includes(a.status)) return { send: false };
      if (a.scheduledAt.getTime() < now.getTime() - 60 * 60_000) return { send: false };
      return {
        send: true,
        content: apptReminderContent({
          title: a.title,
          who: this.partyName(a),
          scheduledAt: a.scheduledAt,
          now,
        }),
      };
    }

    if (job.kind === 'FOLLOWUP_DUE') {
      if (!job.followUpId) return { send: false };
      const f = await this.prisma.followUp.findUnique({
        where: { id: job.followUpId },
        select: { status: true, title: true, lead: { select: { firstName: true, phone: true } } },
      });
      if (!f || f.status !== 'OPEN') return { send: false };
      return {
        send: true,
        content: followupDueContent({ title: f.title, who: f.lead?.firstName || f.lead?.phone || 'a lead' }),
      };
    }

    // FOLLOWUP_OVERDUE digest — content was snapshotted at reconcile (same tick).
    return { send: true, content: { title: job.title, body: job.body ?? '' } };
  }

  /**
   * THE single delivery point for every reminder. In-app today; a push channel
   * (FCM/APNs) will fan out from here next, so all reminder kinds gain push at
   * once with no change to the reconcile/dispatch logic above.
   */
  private async notify(
    job: { userId: string; kind: string; link: string | null },
    content: { title: string; body: string | null },
  ): Promise<void> {
    await this.notifications.create({
      userId: job.userId,
      type: job.kind,
      title: content.title,
      body: content.body ?? null,
      link: job.link,
    });
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private async createJob(input: {
    kind: 'APPOINTMENT_REMINDER' | 'FOLLOWUP_DUE' | 'FOLLOWUP_OVERDUE';
    dedupeKey: string;
    runAt: Date;
    userId: string;
    leadId?: string | null;
    appointmentId?: string | null;
    followUpId?: string | null;
    title: string;
    body: string;
    link: string;
  }): Promise<void> {
    // create() races a unique-constraint on dedupeKey if two ticks overlap;
    // swallow that one error so reconcile stays idempotent.
    await this.prisma.reminderJob
      .create({
        data: {
          kind: input.kind,
          status: 'PENDING',
          runAt: input.runAt,
          dedupeKey: input.dedupeKey,
          userId: input.userId,
          leadId: input.leadId ?? null,
          appointmentId: input.appointmentId ?? null,
          followUpId: input.followUpId ?? null,
          title: input.title,
          body: input.body,
          link: input.link,
        },
      })
      .catch((err: { code?: string }) => {
        if (err?.code === 'P2002') return; // already materialised by a sibling tick
        throw err;
      });
  }

  private async existingJobsByKey(
    keys: string[],
  ): Promise<Map<string, { id: string; status: string; runAt: Date }>> {
    if (keys.length === 0) return new Map();
    const rows = await this.prisma.reminderJob.findMany({
      where: { dedupeKey: { in: keys } },
      select: { id: true, dedupeKey: true, status: true, runAt: true },
    });
    return new Map(rows.map((r) => [r.dedupeKey, { id: r.id, status: r.status, runAt: r.runAt }]));
  }

  /** Map assigned-employee ids → their login (UserAccount) id, in one query. */
  private async resolveUserIds(empIds: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(empIds)];
    if (unique.length === 0) return new Map();
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: unique } },
      select: { id: true, user: { select: { id: true } } },
    });
    return new Map(employees.map((e) => [e.id, e.user?.id ?? null]));
  }

  private partyName(a: {
    lead?: { firstName: string | null; phone: string | null } | null;
    client?: { firstName: string | null; phone: string | null } | null;
  }): string {
    return (
      a.lead?.firstName ||
      a.client?.firstName ||
      a.lead?.phone ||
      a.client?.phone ||
      'your next appointment'
    );
  }
}
