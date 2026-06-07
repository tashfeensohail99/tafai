/**
 * Pure attendance rules engine — NO database, NO side effects. Given a policy,
 * one day's raw inputs (camera computed minutes), and the day's context
 * (weekday, holiday, approved official-duty / extra-break minutes), it returns
 * the computed minutes, the day classification, the payable-status, and the
 * list of typed exceptions an admin should review.
 *
 * Deliberately conservative: it SURFACES exceptions (late, extra break, short
 * hours, overtime…) but does NOT itself decide pay. Deductions/additions are
 * applied later by payroll, and only from APPROVED data.
 */
import {
  AttendanceDayType,
  AttendanceExceptionType,
  AttendanceStatus,
  SaturdayPolicy,
} from '@prisma/client';

export interface RulesPolicy {
  workStart: string; // 'HH:MM'
  workEnd: string;
  graceMin: number;
  allowedBreakMin: number;
  fullDayMinMin: number;
  halfDayMinMin: number;
  workingDays: number[]; // 0=Sun..6=Sat
  saturdayPolicy: SaturdayPolicy;
  overtimeStartAfter: string;
  overtimeMinBlockMin: number;
  roundingMin: number;
}

/** Raw per-day inputs (camera /daily computed fields, or stored record). */
export interface RawDay {
  firstIn: string | null; // 'HH:MM'
  lastOut: string | null;
  grossPresenceMin: number;
  breakMin: number; // lunch minutes
  personalMin: number;
  personalOverMin: number; // break/personal over the allowance (camera)
  unscheduledExits: number;
  lateMin: number; // camera-reported late, if any
  overtimeMin: number; // camera-reported OT, if any
  cameraStatus?: string | null; // e.g. 'present' | 'absent' | 'weekend'
}

/** Approved overlay credited back into the day. */
export interface DayContext {
  weekday: number; // 0=Sun..6=Sat
  isHoliday: boolean;
  isOnApprovedLeave: boolean;
  officialDutyMin: number; // approved
  approvedExtraBreakMin: number; // admin-approved extra break (not deducted)
}

export interface ComputedException {
  type: AttendanceExceptionType;
  minutes: number;
  description: string;
}

export interface ComputedDay {
  dayType: AttendanceDayType;
  lateMin: number;
  earlyLeaveMin: number;
  overtimeMin: number;
  personalOverMin: number;
  netPayableMin: number;
  status: AttendanceStatus;
  exceptions: ComputedException[];
}

export function hhmmToMin(t: string | null | undefined): number | null {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return null;
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

function roundTo(mins: number, step: number): number {
  if (!step || step <= 0) return mins;
  return Math.round(mins / step) * step;
}

/** Classify the calendar day. */
export function classifyDay(ctx: DayContext, policy: RulesPolicy): AttendanceDayType {
  if (ctx.isHoliday) return AttendanceDayType.HOLIDAY;
  if (policy.workingDays.includes(ctx.weekday)) return AttendanceDayType.WORKING;
  if (ctx.weekday === 6 && policy.saturdayPolicy === SaturdayPolicy.OPTIONAL_WFH) {
    return AttendanceDayType.SATURDAY;
  }
  if (ctx.weekday === 6 && policy.saturdayPolicy === SaturdayPolicy.WORKING) {
    return AttendanceDayType.WORKING;
  }
  return AttendanceDayType.WEEKLY_OFF;
}

export function computeDay(raw: RawDay, ctx: DayContext, policy: RulesPolicy): ComputedDay {
  const dayType = classifyDay(ctx, policy);
  const exceptions: ComputedException[] = [];

  const came = (raw.grossPresenceMin ?? 0) > 0 || !!raw.firstIn;

  // ── Non-working days: never absent, never auto-deduct, no OT/bonus ──
  if (dayType !== AttendanceDayType.WORKING) {
    let status: AttendanceStatus;
    if (dayType === AttendanceDayType.HOLIDAY) status = AttendanceStatus.HOLIDAY;
    else if (dayType === AttendanceDayType.SATURDAY) status = came ? AttendanceStatus.PRESENT : AttendanceStatus.WEEKLY_OFF;
    else status = AttendanceStatus.WEEKLY_OFF;
    return {
      dayType,
      lateMin: 0,
      earlyLeaveMin: 0,
      overtimeMin: 0,
      personalOverMin: 0,
      netPayableMin: raw.grossPresenceMin ?? 0,
      status,
      exceptions: [],
    };
  }

  // ── Approved leave covers the working day ──
  if (ctx.isOnApprovedLeave) {
    return {
      dayType,
      lateMin: 0,
      earlyLeaveMin: 0,
      overtimeMin: 0,
      personalOverMin: 0,
      netPayableMin: policy.fullDayMinMin,
      status: AttendanceStatus.ON_LEAVE,
      exceptions: [],
    };
  }

  const workStart = hhmmToMin(policy.workStart) ?? 540;
  const workEnd = hhmmToMin(policy.workEnd) ?? 1080;
  const otStart = hhmmToMin(policy.overtimeStartAfter) ?? workEnd;
  const firstIn = hhmmToMin(raw.firstIn);
  const lastOut = hhmmToMin(raw.lastOut);

  // Late: prefer camera's value; else derive from first-in vs (start + grace).
  let lateMin = raw.lateMin ?? 0;
  if (!lateMin && firstIn != null) {
    const overGrace = firstIn - (workStart + policy.graceMin);
    lateMin = overGrace > 0 ? overGrace : 0;
  }
  lateMin = roundTo(Math.max(0, lateMin), policy.roundingMin);

  // Early leave: left before work-end.
  let earlyLeaveMin = 0;
  if (lastOut != null && lastOut < workEnd) earlyLeaveMin = roundTo(workEnd - lastOut, policy.roundingMin);

  // Extra break / personal over the allowance (camera already nets the allowance).
  const personalOverMin = Math.max(0, raw.personalOverMin ?? 0);

  // Overtime: prefer camera; else derive from last-out beyond OT start.
  let overtimeMin = raw.overtimeMin ?? 0;
  if (!overtimeMin && lastOut != null && lastOut > otStart) overtimeMin = lastOut - otStart;
  overtimeMin = overtimeMin >= policy.overtimeMinBlockMin ? roundTo(overtimeMin, policy.roundingMin) : 0;

  // Net payable working minutes = presence + approved duty + approved extra break.
  // (Unapproved extra break stays as an exception and isn't credited.)
  const netPayableMin =
    (raw.grossPresenceMin ?? 0) + (ctx.officialDutyMin ?? 0) + (ctx.approvedExtraBreakMin ?? 0);

  // ── Status from net payable ──
  let status: AttendanceStatus;
  if (netPayableMin >= policy.fullDayMinMin) status = lateMin > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
  else if (netPayableMin >= policy.halfDayMinMin) status = AttendanceStatus.HALF_DAY;
  else status = AttendanceStatus.ABSENT;
  if (ctx.officialDutyMin > 0 && netPayableMin >= policy.fullDayMinMin) status = AttendanceStatus.OFFICIAL_DUTY;

  // ── Exceptions (each PENDING for admin review) ──
  if (!firstIn && !lastOut && netPayableMin < policy.halfDayMinMin) {
    exceptions.push({ type: AttendanceExceptionType.ABSENT, minutes: 0, description: 'No check-in/out recorded' });
  } else {
    if (!firstIn || !lastOut) {
      exceptions.push({ type: AttendanceExceptionType.MISSING_PUNCH, minutes: 0, description: !firstIn ? 'Missing check-in' : 'Missing check-out' });
    }
    if (lateMin > 0) exceptions.push({ type: AttendanceExceptionType.LATE, minutes: lateMin, description: `Late by ${lateMin} min (after ${policy.workStart} + ${policy.graceMin}m grace)` });
    if (earlyLeaveMin > 0) exceptions.push({ type: AttendanceExceptionType.EARLY_LEAVE, minutes: earlyLeaveMin, description: `Left ${earlyLeaveMin} min before ${policy.workEnd}` });
    if (personalOverMin > 0) exceptions.push({ type: AttendanceExceptionType.EXTRA_BREAK, minutes: personalOverMin, description: `Break/personal ${personalOverMin} min over the ${policy.allowedBreakMin}m allowance` });
    if ((raw.unscheduledExits ?? 0) > 0) exceptions.push({ type: AttendanceExceptionType.UNSCHEDULED_EXIT, minutes: raw.unscheduledExits, description: `${raw.unscheduledExits} unscheduled exit(s)` });
    if (overtimeMin > 0) exceptions.push({ type: AttendanceExceptionType.OVERTIME, minutes: overtimeMin, description: `${overtimeMin} min after ${policy.overtimeStartAfter} (approval required to pay)` });
    if (netPayableMin > 0 && netPayableMin < policy.fullDayMinMin) {
      exceptions.push({ type: AttendanceExceptionType.SHORT_HOURS, minutes: policy.fullDayMinMin - netPayableMin, description: `Short of a full day by ${policy.fullDayMinMin - netPayableMin} min` });
    }
  }

  return { dayType, lateMin, earlyLeaveMin, overtimeMin, personalOverMin, netPayableMin, status, exceptions };
}

/** Inclusive list of 'YYYY-MM-DD' dates between two dates (cap-guarded by caller). */
export function eachYmd(from: Date, to: Date, maxDays = 400): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  for (let i = 0; d <= end && i < maxDays; d.setUTCDate(d.getUTCDate() + 1), i++) out.push(d.toISOString().slice(0, 10));
  return out;
}
