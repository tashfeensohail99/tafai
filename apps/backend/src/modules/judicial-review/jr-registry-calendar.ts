/**
 * Federal Court Registry calendar — Interpretation Act s.26 terminal-day
 * rollover ONLY. Pure module, no NestJS.
 *
 * SCOPE: this file exists for exactly one rule. A deadline LANDING on a day the
 * Federal Court Registry is closed moves to the next open day (Interpretation
 * Act s.26). This is the SOLE legitimate use of a holiday calendar in the
 * deadline engine — every IRPA / FCIRPR limitation period is counted in
 * CALENDAR DAYS (FCR 6(2) excludes holidays only for periods UNDER SEVEN DAYS,
 * and none of the periods this engine computes qualify). Do NOT add
 * addBusinessDays or any day-skipping helper to this file.
 *
 * BIAS (read before touching the holiday set): it is SAFE to under-roll — a
 * slightly earlier due date chases the client sooner — and DANGEROUS to
 * over-roll, i.e. to tell a client they have more time than they really do.
 * Therefore, when it is UNCERTAIN whether a given day is closed, treat it as
 * OPEN (do not add it to the closed set). Weekends are certain and are always
 * closed; only the discretionary holiday membership is governed by this bias.
 */

/** UTC-midnight Date for a Y/M/D (month is 0-based, matching Date.UTC). */
function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/** Add whole calendar days to a UTC-midnight date (returns a NEW Date). */
function addUtcDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

/**
 * Easter Sunday for a given year via the Anonymous Gregorian ("Butcher")
 * algorithm. Returns a UTC-midnight Date. Good Friday = Easter − 2, Easter
 * Monday = Easter + 1.
 */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month - 1, day);
}

/** The n-th (1-based) occurrence of `weekday` (0=Sun..6=Sat) in month/year. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = utc(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

/** Victoria Day — the Monday preceding May 25. */
function victoriaDay(year: number): Date {
  const may25 = utc(year, 4, 25);
  const dow = may25.getUTCDay();
  // Days back to the last Monday strictly before May 25 (7 when May 25 IS a Monday).
  const back = dow === 0 ? 6 : dow === 1 ? 7 : dow - 1;
  return addUtcDays(may25, -back);
}

/**
 * The observed date of a FIXED-date holiday. Standard weekend-observation shift:
 * a holiday on Saturday or Sunday is observed the following Monday. On a weekday
 * it is observed on the day itself.
 */
function observedFixed(base: Date): Date {
  const dow = base.getUTCDay();
  if (dow === 6) return addUtcDays(base, 2); // Sat → Mon
  if (dow === 0) return addUtcDays(base, 1); // Sun → Mon
  return base; // weekday → itself
}

// Per-year memo of the closed-day set (UTC-midnight timestamps).
const holidayCache = new Map<number, Set<number>>();

/**
 * Federal statutory holidays observed by the Federal Court Registry for a year,
 * as a set of UTC-midnight timestamps. Fixed-date holidays contribute both their
 * base date and their weekend-observed date; the Christmas/Boxing pair is handled
 * back-to-back so the two observed days never collide.
 */
function registryHolidayTimestamps(year: number): Set<number> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const s = new Set<number>();
  const addFixed = (month: number, day: number): void => {
    const base = utc(year, month, day);
    s.add(base.getTime());
    s.add(observedFixed(base).getTime());
  };

  // New Year's Day (Jan 1) — fixed.
  addFixed(0, 1);

  // Good Friday + Easter Monday (movable; always Fri / Mon, no observation shift).
  const easter = easterSunday(year);
  s.add(addUtcDays(easter, -2).getTime());
  s.add(addUtcDays(easter, 1).getTime());

  // Victoria Day (Monday preceding May 25).
  s.add(victoriaDay(year).getTime());

  // Canada Day (Jul 1) — fixed.
  addFixed(6, 1);

  // Labour Day (1st Monday of September).
  s.add(nthWeekdayOfMonth(year, 8, 1, 1).getTime());

  // National Day for Truth and Reconciliation (Sep 30) — fixed.
  addFixed(8, 30);

  // Thanksgiving (2nd Monday of October).
  s.add(nthWeekdayOfMonth(year, 9, 1, 2).getTime());

  // Remembrance Day (Nov 11) — fixed.
  addFixed(10, 11);

  // Christmas (Dec 25) + Boxing Day (Dec 26) — back-to-back. Observe each; if
  // Boxing's observed day collides with Christmas's (e.g. Dec 25 on a weekend, or
  // Dec 25 Sunday → Christmas observed Mon Dec 26), push Boxing to the next day.
  const xmas = utc(year, 11, 25);
  const boxing = utc(year, 11, 26);
  const obsXmas = observedFixed(xmas);
  let obsBoxing = observedFixed(boxing);
  if (obsBoxing.getTime() === obsXmas.getTime()) obsBoxing = addUtcDays(obsBoxing, 1);
  s.add(xmas.getTime());
  s.add(boxing.getTime());
  s.add(obsXmas.getTime());
  s.add(obsBoxing.getTime());

  holidayCache.set(year, s);
  return s;
}

/** True if the Federal Court Registry is closed on this UTC day (weekend or holiday). */
function isRegistryClosed(day: Date): boolean {
  const dow = day.getUTCDay();
  if (dow === 0 || dow === 6) return true; // Sunday / Saturday — always closed.
  return registryHolidayTimestamps(day.getUTCFullYear()).has(day.getTime());
}

/**
 * Interpretation Act s.26 ONLY: a deadline LANDING on a day the Federal Court
 * Registry is closed moves to the next open day. This is the SOLE legitimate use
 * of a holiday calendar here — every IRPA/FCIRPR period is CALENDAR DAYS (FCR 6(2)
 * excludes holidays only for periods under seven days). Do NOT add addBusinessDays
 * or any day-skipping helper to this file.
 *
 * Works entirely in UTC and returns a NEW UTC-midnight Date; the input is not
 * mutated. While the day is a Saturday, Sunday or a Registry-closed holiday, it
 * advances one calendar day and returns the first open day.
 */
export function rollForwardIfClosed(date: Date): Date {
  let out = utc(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  // A run of consecutive closed days is never long; the bound is a safety net.
  for (let guard = 0; guard < 30 && isRegistryClosed(out); guard++) {
    out = addUtcDays(out, 1);
  }
  return out;
}
