'use client';
import { apiFetch, apiFetchBlob } from './api-client';

// ── Types (mirror backend) ──
export interface AttendancePolicy {
  id: string; orgId: string; version: number;
  workStart: string; workEnd: string; breakStart: string; breakEnd: string;
  allowedBreakMin: number; graceMin: number; fullDayMinMin: number; halfDayMinMin: number;
  workingDays: number[]; saturdayPolicy: 'OPTIONAL_WFH' | 'OFF' | 'WORKING';
  overtimeRequiresApproval: boolean; overtimeStartAfter: string; overtimeMinBlockMin: number;
  salaryBasis: 'THIRTY_DAYS' | 'WORKING_DAYS'; roundingMin: number;
  annualLeaveQuota: number; sickLeaveQuota: number; casualLeaveQuota: number;
}
export interface Holiday { id: string; date: string; name: string; type: string; }
export interface Compensation { id: string; employeeId: string; basicSalary: string; allowances: string; effectiveFrom: string; isActive: boolean; remarks: string | null; }
export type AttendanceReviewStatus = 'COMPUTED' | 'NEEDS_REVIEW' | 'APPROVED' | 'LOCKED';
export interface AttendanceRecord {
  id: string; employeeId: string; date: string; status: string; dayType: string;
  checkInAt: string | null; checkOutAt: string | null;
  grossPresenceMin: number; lateMin: number; earlyLeaveMin: number; overtimeMin: number;
  personalOverMin: number; officialDutyMin: number; approvedExtraBreakMin: number; netPayableMin: number;
  reviewStatus: AttendanceReviewStatus; notes: string | null; isOverride: boolean;
}
export interface AttendanceException {
  id: string; employeeId: string; date: string; type: string; status: 'PENDING' | 'APPROVED' | 'REJECTED';
  minutes: number; description: string | null; overtimeResolution: string | null; remark: string | null;
}
export interface DailyRow { employeeId: string; name: string; email: string | null; record: AttendanceRecord | null; exceptions: AttendanceException[]; }
export interface OfficialDuty { id: string; employeeId: string; date: string; fromTime: string; toTime: string; minutes: number; reason: string; location: string | null; status: string; remarks: string | null; }
export interface LeaveRequest { id: string; employeeId: string; kind: string; fromDate: string; toDate: string; days: number; paid: boolean; reason: string | null; status: string; remarks: string | null; }
export interface PayrollPeriod { id: string; year: number; month: number; startDate: string; endDate: string; status: 'DRAFT' | 'LOCKED'; generatedAt: string | null; lockedAt: string | null; }
export interface Payslip {
  id: string; employeeId: string; basicSalary: string; allowances: string; dailyRate: string;
  workingDays: number; presentDays: string; absentDays: string; halfDays: number; paidLeaveDays: string; unpaidLeaveDays: string; holidays: number;
  absenceDeduction: string; unpaidLeaveDeduction: string; overtimePay: string; grossPay: string; totalDeductions: string; netPayable: string;
  breakdown: unknown; employee: { name: string; email: string | null; code: string | null } | null;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ── Policy ──
export const fetchPolicy = () => apiFetch<AttendancePolicy>('/payroll/policy', { cache: 'no-store' });
export const updatePolicy = (body: Partial<AttendancePolicy>) => apiFetch<AttendancePolicy>('/payroll/policy', { ...json(body), method: 'PATCH' });
// ── Holidays ──
export const fetchHolidays = (year?: number) => apiFetch<Holiday[]>(`/payroll/holidays${year ? `?year=${year}` : ''}`, { cache: 'no-store' });
export const upsertHoliday = (body: { date: string; name: string; type?: string }) => apiFetch<Holiday>('/payroll/holidays', json(body));
export const deleteHoliday = (id: string) => apiFetch(`/payroll/holidays/${id}`, { method: 'DELETE' });
// ── Compensation ──
export const fetchCompensation = (employeeId: string) => apiFetch<Compensation[]>(`/payroll/compensation/${employeeId}`, { cache: 'no-store' });
export const setCompensation = (body: { employeeId: string; basicSalary: number; allowances?: number; effectiveFrom: string; remarks?: string }) => apiFetch<Compensation>('/payroll/compensation', json(body));
// ── Engine ──
export const recompute = (body: { date?: string; from?: string; to?: string }) => apiFetch<{ processed: number; needsReview: number }>('/payroll/attendance/recompute', json(body));
export const fetchDaily = (date: string) => apiFetch<{ date: string; rows: DailyRow[] }>(`/payroll/attendance/daily?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
export const approveDay = (employeeId: string, date: string) => apiFetch('/payroll/attendance/approve', json({ employeeId, date }));
export const bulkApprove = (date: string) => apiFetch<{ approved: number }>(`/payroll/attendance/bulk-approve?date=${encodeURIComponent(date)}`, { method: 'POST', body: JSON.stringify({}) });
export const adjustDay = (body: { employeeId: string; date: string; reason: string; officialDutyMin?: number; approvedExtraBreakMin?: number; status?: string; notes?: string }) => apiFetch('/payroll/attendance/adjust', json(body));
export const reviewException = (id: string, body: { status: 'APPROVED' | 'REJECTED'; overtimeResolution?: string; remark?: string }) => apiFetch(`/payroll/exceptions/${id}/review`, json(body));
// ── Official duty ──
export const fetchDuty = (status?: string) => apiFetch<OfficialDuty[]>(`/payroll/duty${status ? `?status=${status}` : ''}`, { cache: 'no-store' });
export const createDuty = (body: { employeeId: string; date: string; fromTime: string; toTime: string; reason: string; location?: string }) => apiFetch<OfficialDuty>('/payroll/duty', json(body));
export const reviewDuty = (id: string, body: { status: string; remarks?: string }) => apiFetch(`/payroll/duty/${id}/review`, json(body));
// ── Leave ──
export const fetchLeave = (status?: string) => apiFetch<LeaveRequest[]>(`/payroll/leave${status ? `?status=${status}` : ''}`, { cache: 'no-store' });
export const createLeave = (body: { employeeId: string; kind: string; fromDate: string; toDate: string; reason?: string }) => apiFetch<LeaveRequest>('/payroll/leave', json(body));
export const reviewLeave = (id: string, body: { status: string; remarks?: string }) => apiFetch(`/payroll/leave/${id}/review`, json(body));
export const fetchLeaveBalances = (employeeId: string, year?: number) => apiFetch<any>(`/payroll/leave/balances/${employeeId}${year ? `?year=${year}` : ''}`, { cache: 'no-store' });
// ── Payroll ──
export const fetchPeriods = () => apiFetch<PayrollPeriod[]>('/payroll/periods', { cache: 'no-store' });
export const generatePayroll = (year: number, month: number) => apiFetch<{ periodId: string; generated: number; workingDays: number; unapprovedDays: number }>('/payroll/generate', json({ year, month }));
export const fetchPayslips = (periodId: string) => apiFetch<{ period: PayrollPeriod; payslips: Payslip[] }>(`/payroll/periods/${periodId}/payslips`, { cache: 'no-store' });
/** Fetch a single payslip as a branded PDF (authed) and open it in a new tab. */
export async function openPayslipPdf(payslipId: string): Promise<void> {
  const blob = await apiFetchBlob(`/payroll/payslips/${payslipId}/pdf`);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export const lockPeriod = (id: string) => apiFetch<PayrollPeriod>(`/payroll/periods/${id}/lock`, { method: 'POST', body: JSON.stringify({}) });
export const unlockPeriod = (id: string) => apiFetch<PayrollPeriod>(`/payroll/periods/${id}/unlock`, { method: 'POST', body: JSON.stringify({}) });
