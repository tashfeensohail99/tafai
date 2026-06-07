/**
 * Pure helpers for the durable reminder dispatcher. Kept free of Prisma/Nest so
 * the timing + payload logic is unit-testable without a DB.
 *
 * All "day" math is done in Pakistan Standard Time (Asia/Karachi). Pakistan has
 * observed no daylight-saving since 2009, so PKT is a fixed UTC+5 offset — we
 * rely on that for the cheap day-boundary arithmetic below and use Intl only
 * for human-facing formatting.
 */

/** Minutes before an appointment that its reminder fires (Outlook/Google default). */
export const APPT_LEAD_MINUTES = 10;

/** Fixed PKT offset in minutes (UTC+5, no DST). */
const PKT_OFFSET_MIN = 5 * 60;

/** Hour-of-day (0–23, PKT) at/after which the daily overdue digest may fire. */
export const OVERDUE_DIGEST_HOUR_PKT = 8;

/** The instant an appointment reminder should fire: scheduledAt − leadMinutes. */
export function reminderRunAt(scheduledAt: Date, leadMinutes = APPT_LEAD_MINUTES): Date {
  return new Date(scheduledAt.getTime() - leadMinutes * 60_000);
}

// ── Stable dedupe keys (the ledger's unique identity per source+reminder) ──
export const apptDedupeKey = (appointmentId: string): string => `appt:${appointmentId}`;
export const followupDueDedupeKey = (followUpId: string): string => `followup-due:${followUpId}`;
export const overdueDigestKey = (userId: string, pktDate: string): string =>
  `followup-overdue:${userId}:${pktDate}`;

/** YYYY-MM-DD for the PKT calendar day that `d` falls in. */
export function pktDateString(d: Date): string {
  const shifted = new Date(d.getTime() + PKT_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Hour-of-day (0–23) in PKT for instant `d`. */
export function pktHour(d: Date): number {
  const shifted = new Date(d.getTime() + PKT_OFFSET_MIN * 60_000);
  return shifted.getUTCHours();
}

/** The UTC instant of 00:00 PKT on the PKT day that `d` falls in. */
export function startOfPktDayUtc(d: Date): Date {
  const shifted = new Date(d.getTime() + PKT_OFFSET_MIN * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - PKT_OFFSET_MIN * 60_000);
}

/** Human-friendly clock time in PKT, e.g. "3:30 PM PKT". */
export function formatWhenPkt(d: Date): string {
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d) + ' PKT'
  );
}

/** Minutes from `now` until `when`, floored at 1 (never "in 0 min"). */
export function minutesAway(when: Date, now: Date): number {
  return Math.max(1, Math.round((when.getTime() - now.getTime()) / 60_000));
}

/** Notification copy for an appointment reminder. */
export function apptReminderContent(input: {
  title: string;
  who: string;
  scheduledAt: Date;
  now: Date;
}): { title: string; body: string } {
  const mins = minutesAway(input.scheduledAt, input.now);
  return {
    title: `Starting in ${mins} min: ${input.title}`,
    body: `With ${input.who} · ${formatWhenPkt(input.scheduledAt)}`,
  };
}

/** Notification copy for a follow-up that's now due. */
export function followupDueContent(input: { title: string; who: string }): {
  title: string;
  body: string;
} {
  return {
    title: `Follow-up due: ${input.title}`,
    body: `With ${input.who}`,
  };
}

/** Notification copy for the daily overdue-follow-ups digest. */
export function overdueDigestContent(count: number): { title: string; body: string } {
  const n = `${count} follow-up${count === 1 ? '' : 's'}`;
  return {
    title: `${n} overdue`,
    body:
      count === 1
        ? 'A follow-up is past its due date — please action or reschedule it.'
        : `${count} follow-ups are past their due date — please action or reschedule them.`,
  };
}
