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
