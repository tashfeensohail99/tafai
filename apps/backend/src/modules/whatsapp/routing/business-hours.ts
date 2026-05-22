/**
 * Business-hours math for SLA + after-hours routing.
 *
 * Stored per-org as { timezone, hoursOpen ('HH:MM'), hoursClose ('HH:MM'),
 * workingDays (number[] where 0=Sunday..6=Saturday) } plus an OPTIONAL mid-day
 * break (breakStart / breakEnd, 'HH:MM').
 *
 * The SLA clock only advances during *working* time — it pauses overnight, on
 * non-working days, AND during the lunch break. `computeSlaDeadline` consumes
 * the SLA seconds across the working windows, rolling any remainder past a
 * break / close / weekend into the next open window.
 */

export interface BusinessHours {
  timezone: string;
  hoursOpen: string; // 'HH:MM' local
  hoursClose: string; // 'HH:MM' local
  workingDays: number[]; // 0-6
  // Optional mid-day break — both must be set for a break to apply.
  breakStart?: string | null; // 'HH:MM' local
  breakEnd?: string | null; // 'HH:MM' local
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0=Sun..6=Sat
  hour: number; // 0-23
  minute: number;
}

function partsInTimezone(date: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // some locales return '24' for midnight
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekdayMap[get('weekday')] ?? 0,
    hour,
    minute: Number(get('minute')),
  };
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * The working minute-of-day intervals for a day, with the break carved out.
 * No break → a single [open, close] interval. Break → two intervals:
 * [open, breakStart] and [breakEnd, close]. Returned half-open: [start, end).
 */
function workingIntervals(hours: BusinessHours): Array<[number, number]> {
  const open = hhmmToMinutes(hours.hoursOpen);
  const close = hhmmToMinutes(hours.hoursClose);
  const hasBreak =
    !!hours.breakStart &&
    !!hours.breakEnd &&
    hhmmToMinutes(hours.breakStart) > open &&
    hhmmToMinutes(hours.breakEnd) < close &&
    hhmmToMinutes(hours.breakStart) < hhmmToMinutes(hours.breakEnd);
  if (!hasBreak) return [[open, close]];
  const bs = hhmmToMinutes(hours.breakStart!);
  const be = hhmmToMinutes(hours.breakEnd!);
  return [
    [open, bs],
    [be, close],
  ];
}

/** True if `at` falls within a working interval on a working day. */
export function isWithinBusinessHours(hours: BusinessHours, at: Date = new Date()): boolean {
  const p = partsInTimezone(at, hours.timezone);
  if (!hours.workingDays.includes(p.weekday)) return false;
  const minuteOfDay = p.hour * 60 + p.minute;
  return workingIntervals(hours).some(([s, e]) => minuteOfDay >= s && minuteOfDay < e);
}

/**
 * Next instant the business is open. If `at` is already inside a working
 * interval, returns `at`. Otherwise walks forward — to the next interval start
 * (e.g. break end), or the next working day's opening — skipping non-working
 * days. Returned as a UTC Date.
 */
export function nextBusinessOpen(hours: BusinessHours, at: Date = new Date()): Date {
  if (isWithinBusinessHours(hours, at)) return at;

  const cursor = new Date(at);
  // Walk up to 14 days forward (covers weekends + holiday-length gaps).
  for (let i = 0; i < 14; i++) {
    const parts = partsInTimezone(cursor, hours.timezone);
    if (hours.workingDays.includes(parts.weekday)) {
      const minuteOfDay = parts.hour * 60 + parts.minute;
      for (const [s, e] of workingIntervals(hours)) {
        if (minuteOfDay < s) {
          // Before this interval (pre-open, or mid-break before the 2nd window):
          // jump to its start.
          return setLocalTime(hours.timezone, parts.year, parts.month, parts.day, s);
        }
        if (minuteOfDay >= s && minuteOfDay < e) {
          return cursor; // inside (guard above usually prevents reaching here)
        }
        // else past this interval → check the next one
      }
    }
    // Past all of today's intervals / non-working day → next day midnight local.
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }
  return cursor;
}

/**
 * Compute the SLA deadline by consuming `slaSeconds` of WORKING time starting
 * from the next open instant — rolling any remainder past a break, past
 * closing, and over weekends into the next working window. So a 5-minute SLA
 * on a message at 12:28 (2 min before the lunch break) lands at 14:03, and one
 * at 17:58 lands at 09:03 the next working day.
 */
export function computeSlaDeadline(
  hours: BusinessHours,
  inboundAt: Date,
  slaSeconds: number,
): Date {
  let cursor = nextBusinessOpen(hours, inboundAt);
  let remainingMs = Math.max(0, slaSeconds) * 1000;
  if (remainingMs === 0) return cursor;

  // Bounded walk across working intervals.
  for (let i = 0; i < 60; i++) {
    const parts = partsInTimezone(cursor, hours.timezone);
    const minuteOfDay = parts.hour * 60 + parts.minute;
    const interval = workingIntervals(hours).find(
      ([s, e]) => minuteOfDay >= s && minuteOfDay < e,
    );
    if (!interval) {
      // Not inside a working interval (landed on a boundary / closed time) —
      // advance to the next open and retry.
      cursor = nextBusinessOpen(hours, cursor);
      continue;
    }
    const intervalEnd = setLocalTime(
      hours.timezone,
      parts.year,
      parts.month,
      parts.day,
      interval[1],
    );
    const msToEnd = intervalEnd.getTime() - cursor.getTime();
    if (remainingMs <= msToEnd) {
      return new Date(cursor.getTime() + remainingMs);
    }
    remainingMs -= msToEnd;
    // Hop just past this interval's end so nextBusinessOpen returns the NEXT
    // working window (break end, or next day's open).
    cursor = nextBusinessOpen(hours, new Date(intervalEnd.getTime() + 1000));
  }
  return cursor;
}

function setLocalTime(
  timezone: string,
  year: number,
  month: number,
  day: number,
  totalMinutes: number,
): Date {
  const targetH = Math.floor(totalMinutes / 60);
  const targetM = totalMinutes % 60;
  let utc = new Date(Date.UTC(year, month - 1, day, targetH, targetM, 0, 0));
  for (let i = 0; i < 2; i++) {
    const p = partsInTimezone(utc, timezone);
    const observedMin = p.hour * 60 + p.minute;
    const dayDelta =
      (p.year - year) * 365 * 24 * 60 +
      (p.month - month) * 30 * 24 * 60 +
      (p.day - day) * 24 * 60;
    const drift = observedMin + dayDelta - totalMinutes;
    if (drift === 0) break;
    utc = new Date(utc.getTime() - drift * 60 * 1000);
  }
  return utc;
}
