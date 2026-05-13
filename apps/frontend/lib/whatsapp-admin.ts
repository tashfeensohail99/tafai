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

/**
 * Result of pinging Meta with the saved access token. `ok=true` means the
 * credentials are live; otherwise `error` describes what Meta returned.
 */
export interface ChannelVerification {
  ok: boolean;
  verifiedName: string | null;
  displayPhoneNumber: string | null;
  qualityRating: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' | null;
  messagingLimitTier:
    | 'TIER_50'
    | 'TIER_250'
    | 'TIER_1K'
    | 'TIER_10K'
    | 'TIER_100K'
    | 'TIER_UNLIMITED'
    | null;
  codeVerificationStatus: 'VERIFIED' | 'NOT_VERIFIED' | 'EXPIRED' | null;
  platformType: string | null;
  error?: { code: number; message: string; title?: string };
}

/**
 * Returned by POST /whatsapp/channels — the upserted channel row plus the
 * outcome of the auto-verification ping that runs immediately after save.
 */
export type ConnectChannelResult = AdminChannel & { verification: ChannelVerification };

export function connectChannel(
  input: ConnectChannelInput,
): Promise<ConnectChannelResult> {
  return apiFetch<ConnectChannelResult>('/whatsapp/channels', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Manual "Test connection" — re-pings Meta with the stored token. */
export function verifyChannel(id: string): Promise<ChannelVerification> {
  return apiFetch<ChannelVerification>(`/whatsapp/channels/${id}/verify`, {
    method: 'POST',
  });
}

/**
 * Server-side truth about the integration environment: where Meta should
 * POST webhooks, what API version we're pinning to, and which of the
 * security env vars are configured. The frontend uses this so it never
 * has to hardcode a Railway hostname.
 */
export interface IntegrationInfo {
  webhookUrl: string | null;
  apiVersion: string;
  metaAppId: string | null;
  env: {
    verifyTokenConfigured: boolean;
    appSecretConfigured: boolean;
    encryptionKeyConfigured: boolean;
  };
}

export function getIntegrationInfo(): Promise<IntegrationInfo> {
  return apiFetch<IntegrationInfo>('/whatsapp/channels/integration-info');
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
