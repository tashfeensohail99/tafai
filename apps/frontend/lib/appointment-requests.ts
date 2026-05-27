'use client';

import { apiFetch } from './api-client';

export interface AppointmentRequestRow {
  id: string;
  leadId: string;
  threadId: string | null;
  rawText: string;
  preferredDay: string | null;
  preferredTime: string | null;
  modality: string | null;
  status: string;
  linkedAppointmentId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  lead: {
    firstName: string;
    lastName: string;
    phone: string;
    assignedEmployee: { firstName: string | null; lastName: string | null } | null;
  } | null;
}

export function listAppointmentRequests(params: { status?: string; search?: string } = {}): Promise<AppointmentRequestRow[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.search) qs.set('search', params.search);
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<AppointmentRequestRow[]>(`/sales/appointment-requests${tail}`, { cache: 'no-store' });
}

export function rejectAppointmentRequest(id: string): Promise<{ rejected: boolean }> {
  return apiFetch<{ rejected: boolean }>(`/sales/appointment-requests/${id}/reject`, {
    method: 'PATCH',
    cache: 'no-store',
  });
}
