'use client';

import { apiFetch } from './api-client';

export interface AdminApiKey {
  id: string;
  provider: string;
  label: string;
  keyTail: string;
  isActive: boolean;
  lastUsedAt: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listApiKeys(): Promise<AdminApiKey[]> {
  return apiFetch<AdminApiKey[]>('/admin/api-keys', { cache: 'no-store' });
}

export function upsertApiKey(input: {
  provider: string;
  label: string;
  key: string;
}): Promise<AdminApiKey> {
  return apiFetch<AdminApiKey>('/admin/api-keys', {
    method: 'POST',
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

export function setApiKeyActive(id: string, isActive: boolean): Promise<AdminApiKey> {
  return apiFetch<AdminApiKey>(`/admin/api-keys/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
    cache: 'no-store',
  });
}

export function testApiKey(id: string): Promise<{ ok: boolean; error: string | null }> {
  return apiFetch<{ ok: boolean; error: string | null }>(`/admin/api-keys/${id}/test`, {
    method: 'POST',
    cache: 'no-store',
  });
}

export function deleteApiKey(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch<{ id: string; deleted: boolean }>(`/admin/api-keys/${id}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}
