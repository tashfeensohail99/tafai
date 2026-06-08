/**
 * Pure helpers for appointment availability + double-booking. No Prisma/Nest so
 * the interval math stays unit-testable.
 *
 * Working hours are expressed in Pakistan Standard Time (Asia/Karachi), a fixed
 * UTC+5 offset (no DST since 2009).
 */

export interface Interval {
  start: Date;
  end: Date;
}

/** Office hours (PKT) used for the availability grid. */
export const WORK_START_HOUR_PKT = 9;
export const WORK_END_HOUR_PKT = 18;
/** Default availability slot granularity. */
export const DEFAULT_SLOT_MINUTES = 30;

/** Half-open overlap: [aStart,aEnd) intersects [bStart,bEnd). */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** The end of an appointment given its start + duration. */
export function appointmentEnd(start: Date, durationMinutes: number): Date {
  return new Date(start.getTime() + durationMinutes * 60_000);
}

/**
 * Office-hours window (PKT) for a `YYYY-MM-DD` date, as UTC instants. Uses an
 * explicit +05:00 offset so the conversion is exact regardless of server TZ.
 */
export function pktWorkingWindowUtc(dateStr: string): Interval {
  const pad = (h: number) => String(h).padStart(2, '0');
  return {
    start: new Date(`${dateStr}T${pad(WORK_START_HOUR_PKT)}:00:00+05:00`),
    end: new Date(`${dateStr}T${pad(WORK_END_HOUR_PKT)}:00:00+05:00`),
  };
}

/**
 * Free slots of `slotMinutes` within [windowStart, windowEnd) that don't overlap
 * any busy interval. A slot must fit entirely inside the window.
 */
export function computeFreeSlots(
  windowStart: Date,
  windowEnd: Date,
  busy: Interval[],
  slotMinutes: number = DEFAULT_SLOT_MINUTES,
): Interval[] {
  const slots: Interval[] = [];
  const stepMs = slotMinutes * 60_000;
  for (let t = windowStart.getTime(); t + stepMs <= windowEnd.getTime(); t += stepMs) {
    const slotStart = new Date(t);
    const slotEnd = new Date(t + stepMs);
    const blocked = busy.some((b) => intervalsOverlap(slotStart, slotEnd, b.start, b.end));
    if (!blocked) slots.push({ start: slotStart, end: slotEnd });
  }
  return slots;
}
