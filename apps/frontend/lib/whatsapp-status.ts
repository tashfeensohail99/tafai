'use client';

import { apiFetch, buildQuery } from './api-client';

export type WhatsAppStatusState = 'DRAFT' | 'SCHEDULED' | 'POSTED' | 'EXPIRED' | 'FAILED';
export type WhatsAppStatusMediaType = 'IMAGE' | 'VIDEO';

export interface WhatsAppStatusItem {
  id: string;
  state: WhatsAppStatusState;
  mediaType: WhatsAppStatusMediaType;
  mediaMimeType: string;
  mediaSizeBytes: number;
  mediaUrl: string;
  caption: string | null;
  scheduledAt: string | null;
  postedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getStatusAccess(): Promise<{ enabled: boolean }> {
  return apiFetch<{ enabled: boolean }>('/whatsapp/status/access');
}

export function listStatuses(opts: {
  state?: WhatsAppStatusState;
  search?: string;
  limit?: number;
} = {}): Promise<WhatsAppStatusItem[]> {
  const qs = buildQuery({
    ...(opts.state ? { state: opts.state } : {}),
    ...(opts.search ? { search: opts.search } : {}),
    ...(opts.limit ? { limit: opts.limit } : {}),
  });
  return apiFetch<WhatsAppStatusItem[]>(`/whatsapp/status${qs}`);
}

export async function createStatus(input: {
  file: Blob;
  filename: string;
  caption?: string;
  initialState?: 'DRAFT' | 'SCHEDULED' | 'POSTED';
  scheduledAt?: Date;
}): Promise<WhatsAppStatusItem> {
  const form = new FormData();
  form.append('file', input.file, input.filename);
  if (input.caption) form.append('caption', input.caption);
  if (input.initialState) form.append('initialState', input.initialState);
  if (input.scheduledAt) form.append('scheduledAt', input.scheduledAt.toISOString());
  return apiFetch<WhatsAppStatusItem>('/whatsapp/status', {
    method: 'POST',
    body: form,
  });
}

export function patchStatus(id: string, input: {
  caption?: string;
  state?: 'DRAFT' | 'SCHEDULED';
  scheduledAt?: Date | null;
}): Promise<WhatsAppStatusItem> {
  return apiFetch<WhatsAppStatusItem>(`/whatsapp/status/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.state ? { state: input.state } : {}),
      ...(input.scheduledAt !== undefined
        ? { scheduledAt: input.scheduledAt ? input.scheduledAt.toISOString() : null }
        : {}),
    }),
  });
}

export function markStatusPosted(id: string): Promise<WhatsAppStatusItem> {
  return apiFetch<WhatsAppStatusItem>(`/whatsapp/status/${id}/post`, { method: 'POST' });
}

export function deleteStatus(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/whatsapp/status/${id}`, { method: 'DELETE' });
}
