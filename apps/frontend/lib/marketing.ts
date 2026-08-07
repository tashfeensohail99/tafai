'use client';

import { apiFetch, buildQuery } from './api-client';

/**
 * Marketing dashboard API client (Phase 1D).
 *
 * Wraps the three aggregation endpoints on the backend MarketingController.
 * All monetary values in responses are already base CAD; per-currency spend
 * is provided on the Overview so the tooltip can show native currency alongside.
 */

export interface MarketingWindow {
  from: string; // YYYY-MM-DD
  to: string;
  days: number;
}

export interface SpendByCurrency {
  currency: string;
  amount: number;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  spendBaseCad: number;
  leads: number;
}

export interface TopCampaign {
  campaignId: string;
  name: string | null;
  effectiveStatus: string | null;
  spendBaseCad: number;
  leads: number;
  cpl: number | null;
}

export interface MarketingOverview {
  window: MarketingWindow;
  kpis: {
    spendBaseCad: number;
    spendByCurrency: SpendByCurrency[];
    leads: number;
    clientsConverted: number;
    revenueBaseCad: number;
    cpl: number | null;
    cpa: number | null;
    roas: number | null;
    conversionRate: number | null;
  };
  timeSeries: DailyPoint[];
  topCampaigns: TopCampaign[];
}

export interface MarketingAd {
  adId: string;
  adName: string | null;
  adsetId: string;
  adsetName: string | null;
  campaignId: string;
  campaignName: string | null;
  effectiveStatus: string | null;
  spendBaseCad: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number | null;
  ctr: number | null;
}

export interface MarketingAdsResponse {
  window: MarketingWindow;
  ads: MarketingAd[];
}

export interface MarketingAdset {
  adsetId: string;
  name: string | null;
  effectiveStatus: string | null;
  spendBaseCad: number;
  leads: number;
  cpl: number | null;
}

export interface MarketingCampaign {
  campaignId: string;
  name: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  spendBaseCad: number;
  leads: number;
  clientsConverted: number;
  revenueBaseCad: number;
  cpl: number | null;
  cpa: number | null;
  roas: number | null;
  adsets: MarketingAdset[];
}

export interface MarketingCampaignsResponse {
  window: MarketingWindow;
  campaigns: MarketingCampaign[];
}

export interface ListOpts {
  days?: number;
  includeIdle?: boolean;
}

export function getMarketingOverview(days?: number): Promise<MarketingOverview> {
  const qs = buildQuery({ days });
  return apiFetch<MarketingOverview>(`/admin/marketing/overview${qs}`);
}

export function getMarketingAds(opts: ListOpts = {}): Promise<MarketingAdsResponse> {
  const qs = buildQuery({ days: opts.days, includeIdle: opts.includeIdle ? 'true' : undefined });
  return apiFetch<MarketingAdsResponse>(`/admin/marketing/ads${qs}`);
}

export function getMarketingCampaigns(opts: ListOpts = {}): Promise<MarketingCampaignsResponse> {
  const qs = buildQuery({ days: opts.days, includeIdle: opts.includeIdle ? 'true' : undefined });
  return apiFetch<MarketingCampaignsResponse>(`/admin/marketing/campaigns${qs}`);
}

/* ------------------------------------------------------------------ alerts + health (1F) --- */

export type MarketingAlertSeverity = 'critical' | 'warning' | 'info';
export type MarketingAlertType =
  | 'AD_DISAPPROVED'
  | 'AD_SPEND_NO_LEADS'
  | 'CPL_SPIKE'
  | 'NEW_UNROUTED_AD';

export interface MarketingAlert {
  key: string;
  severity: MarketingAlertSeverity;
  type: MarketingAlertType;
  title: string;
  description: string;
  adId?: string | null;
  adName?: string | null;
  campaignName?: string | null;
  metric?: { label: string; value: string } | null;
  since?: string | null;
}

export type HealthPipeStatus = 'healthy' | 'warning' | 'stale' | 'error' | 'never';

export interface HealthPipe {
  key: string;
  label: string;
  status: HealthPipeStatus;
  detail: string;
  lastAt: string | null;
  ageSeconds: number | null;
  facts?: Array<{ label: string; value: string }>;
}

export interface MarketingHealth {
  generatedAt: string;
  pipes: HealthPipe[];
  metaAccount: {
    configured: boolean;
    source: string | null;
    accountId: string | null;
  };
}

export function getMarketingAlerts(): Promise<MarketingAlert[]> {
  return apiFetch<MarketingAlert[]>('/admin/marketing/alerts');
}

export function getMarketingHealth(): Promise<MarketingHealth> {
  return apiFetch<MarketingHealth>('/admin/marketing/health');
}

/* ------------------------------------------------------------------ routing (1E) --- */

export type AdRoutingTargetType = 'AD' | 'CAMPAIGN';

export interface MarketingBranch {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  employeeCount: number;
}

export interface AdRoutingRule {
  id: string;
  targetType: AdRoutingTargetType;
  targetId: string;
  branchIds: string[];
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listRoutingBranches(): Promise<MarketingBranch[]> {
  return apiFetch<MarketingBranch[]>('/admin/marketing/routing/branches');
}

export function listRoutingRules(): Promise<AdRoutingRule[]> {
  return apiFetch<AdRoutingRule[]>('/admin/marketing/routing/rules');
}

export function upsertRoutingRule(input: {
  targetType: AdRoutingTargetType;
  targetId: string;
  branchIds: string[];
  notes?: string;
}): Promise<AdRoutingRule> {
  return apiFetch<AdRoutingRule>('/admin/marketing/routing/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteRoutingRule(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/admin/marketing/routing/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ format helpers ------ */

/** CAD money with thousands separators; auto-shrinks to K/M for large sums. */
export function fmtCad(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (opts.compact) {
    if (Math.abs(v) >= 1_000_000) return `CAD ${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 10_000) return `CAD ${(v / 1_000).toFixed(1)}K`;
  }
  return `CAD ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Native-currency amount without conversion, used in the spend-tooltip line. */
export function fmtNativeAmount(v: number | null | undefined, currency: string): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 10_000) return `${currency} ${(v / 1_000).toFixed(1)}K`;
  return `${currency} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString();
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtRoas(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(2)}x`;
}
