import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Upcoming-appointment reminder sweeper.
 *
 * Every {@link AppointmentReminderService.INTERVAL_MS} we look for SCHEDULED
 * appointments whose `scheduledAt` falls inside the next reminder window
 * (10 to 20 minutes ahead) and that haven't had `reminderSentAt` stamped
 * yet, then:
 *   1. Create a bell notification for the assigned agent ("In ~10 minutes:
 *      consultation with Asad").
 *   2. Stamp `reminderSentAt` so we never double-fire.
 *
 * The 10-minute lead-time is the de-facto Outlook/Google default — long
 * enough to find your headset and a quiet room, short enough that you
 * don't ignore it. The 20-minute upper bound exists so a sweep that ran
 * late (e.g. just after a restart) still catches an appointment it would
 * otherwise have missed entirely.
 *
 * The flip to `reminderSentAt = now()` is gated on `reminderSentAt: null`
 * inside an updateMany, which makes it idempotent under concurrent ticks.
 */
@Injectable()
export class AppointmentReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AppointmentReminderService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** Sweep cadence. 60s is fine — we look 10 min ahead so timing slack is wide. */
  private static readonly INTERVAL_MS = 60_000;
  /** How far ahead we consider for a reminder. */
  private static readonly LEAD_MINUTES = 10;
  /** Upper bound on the window so a late sweep still picks up "just-missed" appts. */
  private static readonly TRAILING_MINUTES = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    // Defer the first run a few seconds so it doesn't collide with
    // startup work (Prisma generate, queue connect, etc.)
    setTimeout(() => {
      void this.sweep().catch((err) =>
        this.log.error(`first appointment-reminder sweep failed: ${(err as Error).message}`),
      );
    }, 8_000);

    this.timer = setInterval(() => {
      void this.sweep().catch((err) =>
        this.log.error(`appointment-reminder sweep failed: ${(err as Error).message}`),
      );
    }, AppointmentReminderService.INTERVAL_MS);
    this.log.log(`Appointment-reminder sweeper started (every ${AppointmentReminderService.INTERVAL_MS / 1000}s)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<void> {
    if (this.running) return; // never overlap a slow sweep with the next tick
    this.running = true;
    try {
      const now = new Date();
      const leadAt = new Date(now.getTime() + AppointmentReminderService.LEAD_MINUTES * 60_000);
      const trailingAt = new Date(now.getTime() + AppointmentReminderService.TRAILING_MINUTES * 60_000);

      // Candidate set: SCHEDULED, in the next 10-20 minutes, assigned to
      // someone, no reminder fired yet. Bounded by `take` so a backlog
      // from a deploy outage can't melt the loop.
      //
      // `Appointment` has no `assignedEmployee` relation defined, so we
      // pull the employee in a second query below.
      const candidates = await this.prisma.appointment.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { gte: leadAt, lte: trailingAt },
          reminderSentAt: null,
          assignedEmployeeId: { not: null },
        },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          appointmentType: true,
          assignedEmployeeId: true,
          lead: { select: { firstName: true, phone: true } },
          client: { select: { firstName: true, phone: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 50,
      });

      if (candidates.length === 0) return;

      // Resolve user IDs for all assignees in one go to avoid N+1 hits.
      const empIds = candidates
        .map((c) => c.assignedEmployeeId)
        .filter((id): id is string => Boolean(id));
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: empIds } },
        select: { id: true, user: { select: { id: true } } },
      });
      const userIdByEmpId = new Map(
        employees.map((e) => [e.id, e.user?.id ?? null] as const),
      );

      for (const appt of candidates) {
        const userId = appt.assignedEmployeeId
          ? userIdByEmpId.get(appt.assignedEmployeeId) ?? null
          : null;
        if (!userId) continue;

        // Atomic flip: only one tick wins the update — protects against
        // a slow sweep overlapping the next one.
        const flipped = await this.prisma.appointment.updateMany({
          where: { id: appt.id, reminderSentAt: null },
          data: { reminderSentAt: new Date() },
        });
        if (flipped.count === 0) continue; // another tick won the race

        const who =
          appt.lead?.firstName ||
          appt.client?.firstName ||
          appt.lead?.phone ||
          appt.client?.phone ||
          'your next appointment';

        const minutesAway = Math.max(
          1,
          Math.round((appt.scheduledAt.getTime() - now.getTime()) / 60_000),
        );

        await this.notifications.create({
          userId,
          type: 'APPOINTMENT_REMINDER',
          title: `Starting in ${minutesAway} min: ${appt.title}`,
          body: `With ${who} · ${formatWhen(appt.scheduledAt)}`,
          link: '/sales/appointments',
        });
      }
      this.log.debug(`fired ${candidates.length} appointment reminder(s)`);
    } finally {
      this.running = false;
    }
  }
}

function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d) + ' PKT';
}
