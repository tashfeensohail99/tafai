// Admin API for the camera-attendance enrollment review queue + master toggle.
import { apiFetch } from './api-client';

export type EnrollmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DUPLICATE';

export interface EnrollmentRequest {
  id: string;
  status: EnrollmentStatus;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  cnic: string | null;
  joiningDate: string | null;
  cameraEmpCode: string | null;
  note: string | null;
  source: string;
  employeeId: string | null;
  matchedEmployeeId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleOption {
  id: string;
  name: string;
  displayName: string;
}

export function fetchEnrollmentSettings(): Promise<{ enabled: boolean }> {
  return apiFetch<{ enabled: boolean }>('/attendance/enrollment/settings', { cache: 'no-store' });
}

export function setEnrollmentEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
  return apiFetch<{ enabled: boolean }>('/attendance/enrollment/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export function fetchEnrollmentRequests(status?: EnrollmentStatus): Promise<EnrollmentRequest[]> {
  const qs = status ? `?status=${status}` : '';
  return apiFetch<EnrollmentRequest[]>(`/attendance/enrollment/requests${qs}`, { cache: 'no-store' });
}

export function approveEnrollment(
  id: string,
  body: { email: string; roleName: string; firstName?: string; lastName?: string },
): Promise<{ employeeId: string; status: string }> {
  return apiFetch<{ employeeId: string; status: string }>(
    `/attendance/enrollment/requests/${id}/approve`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

export function rejectEnrollment(id: string, reason?: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/attendance/enrollment/requests/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export function fetchRoles(): Promise<RoleOption[]> {
  return apiFetch<RoleOption[]>('/roles', { cache: 'no-store' });
}

// ────────────────────────────────────────────────────────────────────────────
// Attendance records — daily board, per-employee history, camera sync, manual mark
// ────────────────────────────────────────────────────────────────────────────

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LATE' | 'ON_LEAVE';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'ABSENT'];

export interface AttendanceDailyRow {
  employeeId: string;
  name: string;
  email: string | null;
  code: string | null;
  status: AttendanceStatus | null; // null = no data for that day
  checkInAt: string | null;
  checkOutAt: string | null;
  notes: string | null;
  isOverride: boolean;
}

export interface AttendanceDailyBoard {
  date: string;
  rows: AttendanceDailyRow[];
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: AttendanceStatus;
  notes: string | null;
  isOverride: boolean;
  overriddenByUserId: string | null;
}

export interface AttendancePing {
  configured: boolean;
  ok: boolean;
  employeeCount?: number;
  error?: string;
}

export function fetchAttendancePing(): Promise<AttendancePing> {
  return apiFetch<AttendancePing>('/attendance/ping', { cache: 'no-store' });
}

export function fetchAttendanceDaily(date: string): Promise<AttendanceDailyBoard> {
  return apiFetch<AttendanceDailyBoard>(`/attendance/daily?date=${encodeURIComponent(date)}`, {
    cache: 'no-store',
  });
}

export function fetchEmployeeAttendance(
  employeeId: string,
  from: string,
  to: string,
): Promise<{ employeeId: string; from: string; to: string; records: AttendanceRecord[] }> {
  const qs = `employeeId=${encodeURIComponent(employeeId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return apiFetch(`/attendance/records?${qs}`, { cache: 'no-store' });
}

export function syncAttendance(
  body: { date?: string; from?: string; to?: string },
): Promise<{ from: string; to: string; days: number; imported: number; skipped: number; unmatched: number }> {
  return apiFetch('/attendance/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function markAttendance(body: {
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  checkIn?: string;
  checkOut?: string;
  notes?: string;
}): Promise<AttendanceRecord> {
  return apiFetch('/attendance/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
