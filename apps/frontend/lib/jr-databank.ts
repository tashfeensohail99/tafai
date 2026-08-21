'use client';

import { apiFetch } from './api-client';
import type {
  ApiDatabankFile,
  ApiDatabankFolder,
  ApiDatabankTree,
  DatabankFileSource,
} from './processing';

/**
 * JR view onto the SAME per-client databank the Processing team uses. These
 * helpers mirror the databank functions in `@/lib/processing` byte-for-byte but
 * hit `/jr/databank/...`. The store is shared: a JR matter's clientId is the
 * SAME client the Processing case belongs to, so an escalated client's
 * application documents surface here. Access is enforced server-side
 * (jr.portal.view read / jr.artifact.author write; DatabankService grants JR
 * paths in assertClientAccess). There is no JR-wide client list — JR reaches the
 * databank per-matter, so `fetchDatabankClients` has no JR twin.
 *
 * The response/type shapes are identical to the processing databank, so we
 * re-export them rather than duplicate.
 */

export type { ApiDatabankFile, ApiDatabankFolder, ApiDatabankTree, DatabankFileSource };

export function fetchJrDatabankTree(clientId: string): Promise<ApiDatabankTree> {
  return apiFetch<ApiDatabankTree>(`/jr/databank/clients/${clientId}/tree`, {
    cache: 'no-store',
  });
}

export function createJrDatabankFolder(
  clientId: string,
  name: string,
  parentFolderId: string | null = null,
): Promise<ApiDatabankFolder> {
  return apiFetch<ApiDatabankFolder>(`/jr/databank/clients/${clientId}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentFolderId }),
    cache: 'no-store',
  });
}

export function renameJrDatabankFolder(folderId: string, name: string): Promise<ApiDatabankFolder> {
  return apiFetch<ApiDatabankFolder>(`/jr/databank/folders/${folderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
    cache: 'no-store',
  });
}

export function moveJrDatabankFolder(
  folderId: string,
  parentFolderId: string | null,
): Promise<ApiDatabankFolder> {
  return apiFetch<ApiDatabankFolder>(`/jr/databank/folders/${folderId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentFolderId }),
    cache: 'no-store',
  });
}

export function deleteJrDatabankFolder(folderId: string): Promise<{ deletedFolders: number }> {
  return apiFetch<{ deletedFolders: number }>(`/jr/databank/folders/${folderId}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}

/** Upload a file into a client's databank (multipart). `source` is CLIPBOARD
 *  for a pasted screenshot, else UPLOAD. Mirrors uploadDatabankFile. */
export async function uploadJrDatabankFile(
  clientId: string,
  file: File,
  folderId: string | null = null,
  source: DatabankFileSource = 'UPLOAD',
): Promise<ApiDatabankFile> {
  const { getAccessToken } = await import('./auth-client');
  const token = getAccessToken();
  const form = new FormData();
  form.append('file', file);
  if (folderId) form.append('folderId', folderId);
  form.append('source', source);
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const res = await fetch(`${base}/jr/databank/clients/${clientId}/files`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const msg =
      errBody && typeof errBody === 'object' && 'message' in errBody
        ? String((errBody as { message?: unknown }).message)
        : `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

export function jrDatabankFileSignedUrl(
  fileId: string,
): Promise<{ url: string; fileName: string; mimeType: string | null }> {
  return apiFetch(`/jr/databank/files/${fileId}/signed-url`, { cache: 'no-store' });
}

export function renameJrDatabankFile(fileId: string, fileName: string): Promise<ApiDatabankFile> {
  return apiFetch<ApiDatabankFile>(`/jr/databank/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName }),
    cache: 'no-store',
  });
}

export function moveJrDatabankFile(fileId: string, folderId: string | null): Promise<ApiDatabankFile> {
  return apiFetch<ApiDatabankFile>(`/jr/databank/files/${fileId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderId }),
    cache: 'no-store',
  });
}

export function copyJrDatabankFile(
  fileId: string,
  opts: { targetClientId?: string; targetFolderId?: string | null } = {},
): Promise<ApiDatabankFile> {
  return apiFetch<ApiDatabankFile>(`/jr/databank/files/${fileId}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
    cache: 'no-store',
  });
}

export function deleteJrDatabankFile(fileId: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch<{ id: string; deleted: boolean }>(`/jr/databank/files/${fileId}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}
