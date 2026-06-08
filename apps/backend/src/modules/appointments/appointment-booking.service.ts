import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { firstFreeSlot } from './appointments.util';

/**
 * Clamp a proposed slot into a context's office hours / working days. Injected
 * as a policy so the bot (server-local hours) and the web (explicit PKT) keep
 * their own rule while sharing the one conflict engine below.
 */
export type SlotClamp = (proposed: Date) => Date;

/**
 * What to do when the desired slot collides with an existing booking:
 *  - `advance`: silently roll forward to the next free slot (WhatsApp bot — it
 *    can't surface an error mid-conversation).
 *  - `reject` : throw `409` (carrying the next free slot as `suggestedAt`) so a
 *    human picks another time (web / mobile app).
 */
export type ConflictPolicy = 'reject' | 'advance';

// One window the conflict engine reads around the desired time:
//  - 12h BACK is the wider of the two original bounds; it catches a long
//    appointment that STARTED before the desired slot but overlaps it. (Slots
//    entirely in the past can't overlap a forward candidate, so this is safe for
//    `advance` and only adds harmless rows for `reject`.)
//  - 21d FORWARD gives `firstFreeSlot` room to roll across days. For `reject`
//    these later rows can't create a false clash (the overlap test ignores any
//    interval starting at/after the desired slot's end), they only feed the
//    suggestion.
const WINDOW_BACK_MS = 12 * 60 * 60_000;
const WINDOW_FWD_MS = 21 * 24 * 60 * 60_000;
const DEFAULT_DURATION_MIN = 30;

/**
 * THE single appointment double-booking authority for the whole platform.
 *
 * Before this existed, the WhatsApp bot and the web each had their own
 * "don't double-book a rep" implementation — two engines that could drift apart.
 * Both now route through `resolveSlot` here: one row-lock, one busy-interval
 * read, one overlap test, one next-free-slot search. The only thing that differs
 * between callers is the `conflict` policy (`advance` vs `reject`) and the office
 * `clamp` — both passed in.
 *
 * Lives in its own tiny module (depends on PrismaService only) so both
 * AppointmentsModule (web) and AiModule (bot) can import it with no cycle.
 */
@Injectable()
export class AppointmentBookingService {
  private readonly log = new Logger(AppointmentBookingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the slot to book for `employeeId` at/around `desiredAt`, with
   * concurrency-safe conflict control. MUST run inside the caller's
   * transaction (`tx`) so the agent row-lock and the subsequent create/update
   * are atomic — this is what actually prevents two concurrent bookings from
   * both passing the check (the race the old web guard had).
   *
   * Returns the slot to use + whether it was advanced. For `reject`, throws
   * `ConflictException({ message, suggestedAt })` when the desired slot is taken.
   */
  async resolveSlot(
    tx: Prisma.TransactionClient,
    opts: {
      employeeId: string;
      desiredAt: Date;
      durationMinutes: number;
      conflict: ConflictPolicy;
      clamp: SlotClamp;
      /** Exclude this appointment from the busy set (reschedule = don't clash with self). */
      excludeAppointmentId?: string;
    },
  ): Promise<{ bookedAt: Date; advanced: boolean }> {
    // employees.id is a TEXT column (String @id) — compare text-to-text, no ::uuid cast.
    // FOR UPDATE serialises concurrent bookings for this rep (like the
    // lead-assignment engine): the 2nd transaction waits here until the 1st commits,
    // so it sees the 1st booking when it reads the busy set below.
    await tx.$queryRaw`SELECT 1 FROM core.employees WHERE id = ${opts.employeeId} FOR UPDATE`;

    const durationMs = opts.durationMinutes * 60_000;
    const winStart = new Date(opts.desiredAt.getTime() - WINDOW_BACK_MS);
    const winEnd = new Date(opts.desiredAt.getTime() + WINDOW_FWD_MS);
    const rows = await tx.appointment.findMany({
      where: {
        assignedEmployeeId: opts.employeeId,
        status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
        scheduledAt: { gte: winStart, lte: winEnd },
        ...(opts.excludeAppointmentId ? { id: { not: opts.excludeAppointmentId } } : {}),
      },
      select: { scheduledAt: true, durationMinutes: true },
    });
    const busy = rows.map((r) => ({
      s: r.scheduledAt.getTime(),
      e: r.scheduledAt.getTime() + (r.durationMinutes ?? DEFAULT_DURATION_MIN) * 60_000,
    }));

    if (opts.conflict === 'advance') {
      // Always run the slot search (matches the bot's prior behaviour exactly:
      // it returns the desired time if free, else the next open slot).
      const bookedAt = firstFreeSlot(opts.desiredAt, durationMs, busy, opts.clamp);
      return { bookedAt, advanced: bookedAt.getTime() !== opts.desiredAt.getTime() };
    }

    // reject: only the desired slot matters for the decision.
    const ds = opts.desiredAt.getTime();
    const de = ds + durationMs;
    const clash = busy.some((iv) => ds < iv.e && iv.s < de);
    if (!clash) return { bookedAt: opts.desiredAt, advanced: false };

    const suggestedAt = firstFreeSlot(opts.desiredAt, durationMs, busy, opts.clamp);
    throw new ConflictException({
      message: 'That time is already booked for this agent. Pick another slot.',
      suggestedAt: suggestedAt.toISOString(),
    });
  }

  /**
   * Convenience wrapper around `resolveSlot`: opens a transaction, resolves the
   * slot (when an agent is assigned — unassigned appointments skip the conflict
   * check entirely), then runs the caller's `run` (the create or update) inside
   * the SAME transaction so the lock and the write commit together.
   *
   * Returns `{ result, bookedAt, advanced }` — `result` is whatever `run`
   * returns (the created/updated row with the caller's own select/include).
   */
  async withResolvedSlot<T>(opts: {
    employeeId: string | null;
    desiredAt: Date;
    durationMinutes: number;
    conflict: ConflictPolicy;
    clamp: SlotClamp;
    excludeAppointmentId?: string;
    run: (bookedAt: Date, tx: Prisma.TransactionClient) => Promise<T>;
  }): Promise<{ result: T; bookedAt: Date; advanced: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      if (!opts.employeeId) {
        // No agent → nothing to double-book against; book exactly as asked.
        const result = await opts.run(opts.desiredAt, tx);
        return { result, bookedAt: opts.desiredAt, advanced: false };
      }
      const { bookedAt, advanced } = await this.resolveSlot(tx, {
        employeeId: opts.employeeId,
        desiredAt: opts.desiredAt,
        durationMinutes: opts.durationMinutes,
        conflict: opts.conflict,
        clamp: opts.clamp,
        excludeAppointmentId: opts.excludeAppointmentId,
      });
      const result = await opts.run(bookedAt, tx);
      return { result, bookedAt, advanced };
    });
  }
}
