'use client';

import { apiFetch, buildQuery } from './api-client';

export interface LeadStats {
  total: number;
  byStatus: Record<string, number>;
  converted: number;
  conversionRate: number;
  fromAds: number;
  newToday: number;
  recent: Array<{ date: string; count: number }>;
}

export interface AdPerformanceRow {
  sourceId: string | null;
  headline: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  leads: number;
  contacted: number;
  converted: number;
}

export interface AdminLead {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone: string;
  status: string;
  sourceChannel?: string | null;
  serviceInterest?: string | null;
  targetCountry?: string | null;
  createdAt: string;
  assignedEmployee?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  importRows?: Array<{ id: string; batch: { name: string } }>;
}

export interface LeadFilters {
  search?: string;
  status?: string;
  sourceChannel?: string;
  serviceInterest?: string;
  targetCountry?: string;
  assignedEmployeeId?: string;
  createdFrom?: string;
  createdTo?: string;
  fromAd?: boolean;
  adSourceId?: string;
}

export function fetchLeadStats(): Promise<LeadStats> {
  return apiFetch<LeadStats>('/leads/stats', { cache: 'no-store' });
}

export function fetchAdPerformance(): Promise<AdPerformanceRow[]> {
  return apiFetch<AdPerformanceRow[]>('/leads/ad-performance', { cache: 'no-store' });
}

export function listAdminLeads(filters: LeadFilters): Promise<AdminLead[]> {
  return apiFetch<AdminLead[]>(`/leads${buildQuery({ ...filters })}`, { cache: 'no-store' });
}

export function deleteLead(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/leads/${id}`, { method: 'DELETE' });
}

export function bulkDeleteLeads(ids: string[]): Promise<{ success: boolean; deleted: number }> {
  return apiFetch<{ success: boolean; deleted: number }>('/leads/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

/** Fetch the filtered CSV (auth via JWT) and trigger a browser download. */
export async function exportLeadsCsv(filters: LeadFilters): Promise<void> {
  const csv = await apiFetch<string>(`/leads/export.csv${buildQuery({ ...filters })}`, {
    cache: 'no-store',
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
