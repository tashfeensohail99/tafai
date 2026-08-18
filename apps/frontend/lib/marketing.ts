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
    /** Absolute revenue is NEVER included in this response — marketing users
     *  see spend + a ROAS ratio, but not the raw revenue amount. `roas` is the
     *  only derived signal shipped; the frontend renders it as a percentage. */
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
  /** No revenue on this response either — see MarketingOverview.kpis. */
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

/* ------------------------------------------------------------------ leads by rep ---------- */

export interface MarketingRepLeads {
  employeeId: string;
  name: string;
  isActive: boolean;
  total: number; // all leads received in the window
  fromAds: number; // subset attributed to a Meta ad
  other: number; // total − fromAds (WhatsApp walk-ins, UAN, imports, …)
}

export interface MarketingLeadsByRepResponse {
  window: MarketingWindow;
  reps: MarketingRepLeads[];
  unassigned: number;
  totals: { total: number; fromAds: number; other: number };
}

/** Per-rep count of leads RECEIVED in the window. Counts only — no money. */
export function getMarketingLeadsByRep(days?: number): Promise<MarketingLeadsByRepResponse> {
  const qs = buildQuery({ days });
  return apiFetch<MarketingLeadsByRepResponse>(`/admin/marketing/leads-by-rep${qs}`);
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

/* ------------------------------------------------------------------ AI insights (1G) --- */

export type InsightCategory = 'performance' | 'attribution' | 'routing' | 'creative' | 'budget' | 'other';
export type InsightSeverity = 'high' | 'medium' | 'low';

export interface MarketingInsight {
  key: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  rationale: string;
  action: string;
  confidence: number;
  targetAdId?: string | null;
  targetAdName?: string | null;
  targetCampaignId?: string | null;
  targetCampaignName?: string | null;
}

export interface MarketingInsightsResult {
  insights: MarketingInsight[];
  generatedAt: string;
  windowDays: number;
  model: string;
  cached: boolean;
  tokens?: { input: number; output: number };
  error?: string;
}

export function getMarketingInsights(days?: number): Promise<MarketingInsightsResult> {
  const qs = buildQuery({ days });
  return apiFetch<MarketingInsightsResult>(`/admin/marketing/ai${qs}`);
}

export function refreshMarketingInsights(days?: number): Promise<MarketingInsightsResult> {
  const qs = buildQuery({ days });
  return apiFetch<MarketingInsightsResult>(`/admin/marketing/ai/refresh${qs}`, { method: 'POST' });
}

/* ------------------------------------------------------------------ leads-by-ad --- */

export interface MarketingLeadsByAdRow {
  adId: string;
  adName: string | null;
  campaignId: string;
  campaignName: string | null;
  effectiveStatus: string | null;
  conversations: number;
  clientsConverted: number;
  conversionRate: number | null;
  /** Return-on-ad-spend as a ratio (rendered as a % in the UI). Absolute spend
   *  and revenue are NOT included in the response — this page is aggregate-only
   *  and deliberately hides money amounts from the Marketing role. */
  roas: number | null;
}

export interface MarketingLeadsByAdResponse {
  window: MarketingWindow;
  ads: MarketingLeadsByAdRow[];
}

export function getMarketingLeadsByAd(opts: ListOpts = {}): Promise<MarketingLeadsByAdResponse> {
  const qs = buildQuery({ days: opts.days, includeIdle: opts.includeIdle ? 'true' : undefined });
  return apiFetch<MarketingLeadsByAdResponse>(`/admin/marketing/leads${qs}`);
}

/* ------------------------------------------------------------------ leads-by-program --- */

export type AdProgram = 'C11' | 'JR' | 'VISIT_VISA' | 'C10' | 'RCIP' | 'OTHER';

export interface ProgramAdRow {
  name: string;
  responses: number;
}

export interface MarketingProgramRow {
  program: AdProgram;
  label: string;
  /** Ad responses (leads attributed to an ad of this program) in the window. */
  responses: number;
  converted: number;
  conversionRate: number | null;
  /** Share of all ad responses in the window (0..1). */
  share: number | null;
  topAds: ProgramAdRow[];
}

export interface MarketingProgramsResponse {
  window: MarketingWindow;
  totalResponses: number;
  programs: MarketingProgramRow[];
}

export function getMarketingLeadsByProgram(days?: number): Promise<MarketingProgramsResponse> {
  const qs = buildQuery({ days });
  return apiFetch<MarketingProgramsResponse>(`/admin/marketing/programs${qs}`);
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
  employeeIds: string[];
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A selectable rep for the routing UI (the roster + the "specific people" picker). */
export interface MarketingRoutingEmployee {
  id: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  /** True = in the WhatsApp lead round-robin (a lead can actually reach them). */
  inPool: boolean;
  presence: string;
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
  employeeIds: string[];
  notes?: string;
}): Promise<AdRoutingRule> {
  return apiFetch<AdRoutingRule>('/admin/marketing/routing/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function listRoutingEmployees(): Promise<MarketingRoutingEmployee[]> {
  return apiFetch<MarketingRoutingEmployee[]>('/admin/marketing/routing/employees');
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

/** ROAS as a percentage — 3.24x → "324%". Never displays the underlying
 *  revenue or spend amounts. */
export function fmtRoas(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v * 100)}%`;
}
