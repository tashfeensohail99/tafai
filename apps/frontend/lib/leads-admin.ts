'use client';

import { apiFetch, buildQuery } from './api-client';

export interface MoneyByCurrency {
  currency: string;
  amount: number;
}

export interface LeadStats {
  total: number;
  byStatus: Record<string, number>;
  converted: number;
  conversionRate: number;
  fromAds: number;
  newToday: number;
  recent: Array<{ date: string; count: number }>;
  // Phase 1 efficiency/ROI metrics (optional — tolerate an older backend).
  revenueReceived?: MoneyByCurrency[]; // real cash collected (verified payments)
  revenueWon?: MoneyByCurrency[];
  revenuePipeline?: MoneyByCurrency[];
  lostReasons?: Array<{ reason: string; count: number }>;
  speedToLead?: { medianMinutes: number | null; pctUnder5min: number | null; sample: number };
  // Phase 2 ad-spend ROI (Meta Marketing API). Optional — empty until a
  // `meta_ads` credential is configured + a sync has run.
  adSpend?: MoneyByCurrency[]; // total spend in native ad-account currency
  adSpendBaseCad?: number; // total spend rolled to CAD base
  adRevenueBaseCad?: number; // CAD revenue attributable to ad-sourced leads
  blendedCpl?: number | null; // CAD spend per ad-sourced lead
  blendedRoas?: number | null; // CAD revenue ÷ CAD spend
}

export interface AdPerformanceRow {
  sourceId: string | null;
  headline: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  leads: number;
  contacted: number;
  converted: number;
  // Phase 2 — null until Meta ad spend is synced for this ad.
  spend?: number | null; // native ad-account currency
  spendCurrency?: string | null;
  revenueBaseCad?: number; // CAD revenue from this ad's converted leads
  cpl?: number | null; // spend ÷ leads (native currency)
  cpa?: number | null; // spend ÷ converted (native currency)
  roas?: number | null; // CAD revenue ÷ CAD spend
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
