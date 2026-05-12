'use client';

import { apiFetch } from './api-client';

// ---- Channels -----------------------------------------------------------

export interface AdminChannel {
  id: string;
  label: string;
  wabaId: string;
  phoneNumberId: string;
  displayNumber: string;
  tier: 'TIER_1K' | 'TIER_10K' | 'TIER_100K' | 'TIER_UNLIMITED';
  status: 'ACTIVE' | 'PAUSED' | 'REVOKED';
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectChannelInput {
  label: string;
  wabaId: string;
  phoneNumberId: string;
  displayNumber: string;
  accessToken: string;
}

export function listChannels(): Promise<AdminChannel[]> {
  return apiFetch<AdminChannel[]>('/whatsapp/channels');
}

export function connectChannel(input: ConnectChannelInput): Promise<AdminChannel> {
  return apiFetch<AdminChannel>('/whatsapp/channels', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function setChannelStatus(
  id: string,
  status: AdminChannel['status'],
  reason?: string,
): Promise<AdminChannel> {
  return apiFetch<AdminChannel>(`/whatsapp/channels/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
  });
}

export function syncChannelTemplates(
  id: string,
): Promise<{ jobId: string; channelId: string; queuedAt: string }> {
  return apiFetch(`/whatsapp/channels/${id}/sync-templates`, { method: 'POST' });
}

// ---- Team / presence dashboard ------------------------------------------

export interface TeamPresenceRow {
  id: string;
  name: string;
  email: string;
  whatsappInboxMember: boolean;
  skills: string[];
  explicit: 'ONLINE' | 'AWAY' | 'OFFLINE';
  effective: 'ONLINE' | 'AWAY' | 'OFFLINE';
  lastActivityAt: string | null;
  openLeads: number;
}

export function listTeamPresence(): Promise<TeamPresenceRow[]> {
  return apiFetch<TeamPresenceRow[]>('/whatsapp/presence/team');
}
