/**
 * Business-hours math for SLA + after-hours routing.
 *
 * Stored per-org as { timezone, hoursOpen ('HH:MM'), hoursClose ('HH:MM'),
 * workingDays (number[] where 0=Sunday..6=Saturday) }.
 */

export interface BusinessHours {
  timezone: string;
  hoursOpen: string; // 'HH:MM' local
  hoursClose: string; // 'HH:MM' local
  workingDays: number[]; // 0-6
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
  // Intl.DateTimeFormat with the timezone gives us the local clock reading.
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

/** True if `at` falls within the org's business hours. */
export function isWithinBusinessHours(hours: BusinessHours, at: Date = new Date()): boolean {
  const p = partsInTimezone(at, hours.timezone);
  if (!hours.workingDays.includes(p.weekday)) return false;
  const minuteOfDay = p.hour * 60 + p.minute;
  const open = hhmmToMinutes(hours.hoursOpen);
  const close = hhmmToMinutes(hours.hoursClose);
  return minuteOfDay >= open && minuteOfDay < close;
}

/**
 * Given a point in time and business hours, return the next instant where the
 * business is open. If `at` is already inside business hours, returns `at`.
 *
 * The math walks forward day-by-day in the target timezone, returning when we
 * hit a working day. The returned Date is converted back to UTC.
 */
export function nextBusinessOpen(hours: BusinessHours, at: Date = new Date()): Date {
  if (isWithinBusinessHours(hours, at)) return at;

  const cursor = new Date(at);
  // Walk up to 14 days forward (in case of holidays / 1-day weeks).
  for (let i = 0; i < 14; i++) {
    const parts = partsInTimezone(cursor, hours.timezone);
    const open = hhmmToMinutes(hours.hoursOpen);
    const close = hhmmToMinutes(hours.hoursClose);
    const minuteOfDay = parts.hour * 60 + parts.minute;
    const isWorkingDay = hours.workingDays.includes(parts.weekday);

    if (isWorkingDay && minuteOfDay < open) {
      // Same day, before opening: jump to open time.
      return setLocalTime(at, hours.timezone, parts.year, parts.month, parts.day, open);
    }
    if (isWorkingDay && minuteOfDay < close) {
      // Inside hours (shouldn't happen due to guard above), return now.
      return at;
    }
    // Move to next day midnight local time.
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }
  return cursor;
}

/**
 * Compute the SLA deadline for first agent reply, given:
 *  - the time the inbound arrived
 *  - the org's first-response SLA in seconds
 *  - the org's business hours
 *
 * Rule: SLA clock only advances during business hours. If the inbound arrived
 * outside hours, the clock starts at the next open.
 */
export function computeSlaDeadline(
  hours: BusinessHours,
  inboundAt: Date,
  slaSeconds: number,
): Date {
  const start = nextBusinessOpen(hours, inboundAt);
  // For a 60-second SLA inside hours, this is just +60s. We assume the SLA is
  // short enough not to wrap past closing; for longer SLAs we'd need to roll
  // the remaining seconds into the next business day, which we don't need for
  // a 1-minute target.
  return new Date(start.getTime() + slaSeconds * 1000);
}

function setLocalTime(
  _reference: Date,
  timezone: string,
  year: number,
  month: number,
  day: number,
  totalMinutes: number,
): Date {
  // Build a Date at the requested local clock in the target timezone, by
  // searching for the UTC instant whose tz-projection matches.
  const targetH = Math.floor(totalMinutes / 60);
  const targetM = totalMinutes % 60;
  // Start with a UTC guess: same Y/M/D at the requested HH:MM treated as UTC.
  let utc = new Date(Date.UTC(year, month - 1, day, targetH, targetM, 0, 0));
  // Up to two iterations: compute drift between UTC guess and what the tz
  // shows, and shift. This handles DST and offset.
  for (let i = 0; i < 2; i++) {
    const p = partsInTimezone(utc, timezone);
    const observedMin = p.hour * 60 + p.minute;
    const desiredMin = totalMinutes;
    const dayDelta =
      (p.year - year) * 365 * 24 * 60 +
      (p.month - month) * 30 * 24 * 60 +
      (p.day - day) * 24 * 60;
    const drift = observedMin + dayDelta - desiredMin;
    if (drift === 0) break;
    utc = new Date(utc.getTime() - drift * 60 * 1000);
  }
  return utc;
  // `reference` retained for API symmetry; not used.
}
