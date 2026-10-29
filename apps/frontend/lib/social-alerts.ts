'use client';

import { apiFetch, buildQuery } from './api-client';

export type AlertPlatform = 'INSTAGRAM' | 'FACEBOOK';
export type AlertChannel = 'EMAIL' | 'BELL' | 'BANNER';

export interface SocialAlertConfig {
  enabled: boolean;
  enabledAt: string | null;
  departments: string[];
  platforms: AlertPlatform[];
  channels: AlertChannel[];
  quietStartHour: number | null;
  quietEndHour: number | null;
  updatedAt: string;
  availableDepartments: string[];
}

export interface RecentAlert {
  id: string;
  platform: AlertPlatform;
  externalId: string;
  permalink: string | null;
  caption: string | null;
  postedAt: string | null;
  alertedAt: string | null;
  recipients: number;
}

export interface PollResult {
  ranAt: string;
  skippedReason?: string;
  postsSeen: number;
  alertsSent: number;
  recipients: number;
}

const BASE = '/admin/social-alerts';

export function getAlertConfig(): Promise<SocialAlertConfig> {
  return apiFetch<SocialAlertConfig>(`${BASE}/config`, { cache: 'no-store' });
}

export function updateAlertConfig(patch: Partial<{
  enabled: boolean;
  departments: string[];
  platforms: AlertPlatform[];
  channels: AlertChannel[];
  quietStartHour: number | null;
  quietEndHour: number | null;
}>): Promise<unknown> {
  return apiFetch(`${BASE}/config`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function getRecentAlerts(limit = 50): Promise<RecentAlert[]> {
  return apiFetch<RecentAlert[]>(`${BASE}/recent${buildQuery({ limit })}`, { cache: 'no-store' });
}

export function pollAlertsNow(): Promise<PollResult> {
  return apiFetch<PollResult>(`${BASE}/poll`, { method: 'POST' });
}
