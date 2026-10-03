'use client';

import { apiFetch } from './api-client';
import { DIRECT_VERSION_MAX_BYTES, databankSearchQuery, putToStorage } from './processing';
import type {
  ApiDatabankAssociate,
  ApiDatabankByAssociate,
  ApiDatabankClientRow,
  ApiDatabankFile,
  ApiDatabankFolder,
  ApiDatabankTree,
  CopyFolderResult,
  DatabankFileSource,
  DatabankSearchParams,
  DatabankSearchResult,
  DatabankUploadTarget,
  PresignedUploadResponse,
  TrashItem,
  Version,
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

export type {
  ApiDatabankAssociate,
  ApiDatabankByAssociate,
  ApiDatabankClientRow,
  ApiDatabankFile,
  ApiDatabankFolder,
  ApiDatabankTree,
  DatabankFileSource,
  DatabankSearchParams,
  DatabankSearchResult,
  DatabankUploadTarget,
  TrashItem,
  Version,
};

/**
 * Upload a file DIRECTLY to storage (R2) via the JR route then record it —
 * the JR twin of `directUploadDatabankFile`. `onProgress` reports this file's
 * byte progress (0..1). Falls back to the streaming multipart upload in dev
 * storage modes. Works for a client databank (`clientId`) or the caller's
 * personal area (`personal`). Delegates to the SAME shared backend service; the
 * only difference from the processing helper is the `/jr/databank` route + JR
 * permissions. */
export async function directUploadJrDatabankFile(
  target: DatabankUploadTarget,
  file: File,
  folderId: string | null = null,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  opts: { commitKey?: string; onStored?: (storageKey: string) => void } = {},
): Promise<ApiDatabankFile> {
  const mimeType = file.type || 'application/octet-stream';
  const bodyBase = {
    clientId: target.clientId,
    personal: target.personal,
    folderId,
    fileName: file.name,
    mimeType,
    fileSizeBytes: file.size,
  };
  const commit = (storageKey: string) =>
    apiFetch<ApiDatabankFile>('/jr/databank/uploads/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...bodyBase, storageKey }),
      cache: 'no-store',
      // No signal: once sent, the server records the file whatever the tab does —
      // aborting would only make the dock say "Cancelled" about a saved file.
    });
  // Already stored (only the commit's reply was lost): record it, don't re-upload.
  if (opts.commitKey) return commit(opts.commitKey);

  const presigned = await apiFetch<PresignedUploadResponse>('/jr/databank/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyBase),
    cache: 'no-store',
    signal,
  });

  // Dev storage (local/supabase): no direct-PUT path — stream through the backend.
  if (presigned.strategy === 'proxy' || !presigned.url) {
    onProgress?.(0);
    const res = target.personal
      ? await uploadJrPersonalFile(file, folderId, 'UPLOAD')
      : await uploadJrDatabankFile(target.clientId!, file, folderId, 'UPLOAD');
    onProgress?.(1);
    return res;
  }

  await putToStorage(
    presigned.url,
    file,
    presigned.headers ?? {},
    (loaded, total) => onProgress?.(total ? loaded / total : 0),
    signal,
  );
  opts.onStored?.(presigned.storageKey);
  return commit(presigned.storageKey);
}

/** The JR-matter clients the caller may browse (flat), each with a file count.
 *  Head sees all associates' clients; associate sees their own. */
export function fetchJrDatabankClients(q?: string): Promise<ApiDatabankClientRow[]> {
  const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return apiFetch<ApiDatabankClientRow[]>(`/jr/databank/clients${qs}`, { cache: 'no-store' });
}

/** The same clients grouped by their assigned JR associate (own group first for
 *  a head). Powers the associate-organised JR databank landing. */
export function fetchJrDatabankByAssociate(q?: string): Promise<ApiDatabankByAssociate> {
  const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return apiFetch<ApiDatabankByAssociate>(`/jr/databank/clients/by-associate${qs}`, {
    cache: 'no-store',
  });
}

export function fetchJrDatabankTree(clientId: string): Promise<ApiDatabankTree> {
  return apiFetch<ApiDatabankTree>(`/jr/databank/clients/${clientId}/tree`, {
    cache: 'no-store',
  });
}

/** The caller's OWN personal databank (folders/files tied to no client — only
 *  they and a JR head see it). Same owner-scoped store the processing "My
 *  folders" uses, reached via the JR route + JR permissions. */
export function fetchJrPersonalTree(): Promise<ApiDatabankTree> {
  return apiFetch<ApiDatabankTree>(`/jr/databank/me/tree`, { cache: 'no-store' });
}

export function createJrPersonalFolder(
  name: string,
  parentFolderId: string | null = null,
): Promise<ApiDatabankFolder> {
  return apiFetch<ApiDatabankFolder>(`/jr/databank/me/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentFolderId }),
    cache: 'no-store',
  });
}

export async function uploadJrPersonalFile(
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
  const res = await fetch(`${base}/jr/databank/me/files`, {
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

/** Rename AND/OR set metadata (description, tags). JR twin of
 *  `updateDatabankFile`. */
export function updateJrDatabankFile(
  fileId: string,
  patch: { fileName?: string; description?: string | null; tags?: string[] },
): Promise<ApiDatabankFile> {
  return apiFetch<ApiDatabankFile>(`/jr/databank/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    cache: 'no-store',
  });
}

/** File search over ONE scope (a JR-matter client or the caller's personal
 *  area). JR twin of `searchDatabankFiles`. */
export function searchJrDatabankFiles(params: DatabankSearchParams): Promise<DatabankSearchResult> {
  return apiFetch<DatabankSearchResult>(
    `/jr/databank/search${databankSearchQuery(params)}`,
    { cache: 'no-store' },
  );
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

export function copyJrDatabankFolder(
  folderId: string,
  opts: { targetClientId?: string; targetFolderId?: string | null } = {},
): Promise<CopyFolderResult> {
  return apiFetch<CopyFolderResult>(`/jr/databank/folders/${folderId}/copy`, {
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

// ---------------------------------------------------------------------------
// Databank P3 — Trash + file version history (JR twins). Same shared backend
// service as the processing helpers above; only the `/jr/databank` route +
// JR permissions differ. Types are re-exported from `@/lib/processing`.
// ---------------------------------------------------------------------------

/** The TOP-LEVEL trashed items in ONE scope. JR twin of `fetchDatabankTrash`. */
export function fetchJrDatabankTrash(
  scope: { clientId: string } | { personal: true },
): Promise<TrashItem[]> {
  const sp = new URLSearchParams();
  if ('clientId' in scope) sp.set('clientId', scope.clientId);
  else sp.set('personal', 'true');
  return apiFetch<TrashItem[]>(`/jr/databank/trash?${sp.toString()}`, { cache: 'no-store' });
}

export function restoreJrDatabankFolder(folderId: string): Promise<ApiDatabankFolder> {
  return apiFetch<ApiDatabankFolder>(`/jr/databank/folders/${folderId}/restore`, {
    method: 'POST',
    cache: 'no-store',
  });
}

export function restoreJrDatabankFile(fileId: string): Promise<ApiDatabankFile> {
  return apiFetch<ApiDatabankFile>(`/jr/databank/files/${fileId}/restore`, {
    method: 'POST',
    cache: 'no-store',
  });
}

export function purgeJrDatabankFolder(
  folderId: string,
): Promise<{ purgedFolders: number; purgedFiles: number }> {
  return apiFetch(`/jr/databank/folders/${folderId}/purge`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}

export function purgeJrDatabankFile(fileId: string): Promise<{ id: string; purged: true }> {
  return apiFetch(`/jr/databank/files/${fileId}/purge`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}

/** JR twin of `fetchDatabankFileVersions`. */
export function fetchJrDatabankFileVersions(
  fileId: string,
): Promise<{ etag: string; versions: Version[] }> {
  return apiFetch(`/jr/databank/files/${fileId}/versions`, { cache: 'no-store' });
}

/** JR twin of `databankVersionSignedUrl`. */
export function jrDatabankVersionSignedUrl(
  fileId: string,
  versionId: string,
): Promise<{ url: string; fileName: string; mimeType: string | null }> {
  return apiFetch(`/jr/databank/files/${fileId}/versions/${versionId}/signed-url`, {
    cache: 'no-store',
  });
}

/** JR twin of `presignDatabankVersion`. */
export function presignJrDatabankVersion(
  fileId: string,
  body: { mimeType: string; fileSizeBytes: number; fileName?: string },
): Promise<PresignedUploadResponse> {
  return apiFetch<PresignedUploadResponse>(`/jr/databank/files/${fileId}/versions/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

/** JR twin of `commitDatabankVersion`. */
export function commitJrDatabankVersion(
  fileId: string,
  body: { storageKey: string; mimeType: string; fileSizeBytes: number; sha256: string },
  ifMatch?: string,
): Promise<ApiDatabankFile> {
  return apiFetch<ApiDatabankFile>(`/jr/databank/files/${fileId}/versions/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

/** JR twin of `restoreDatabankVersion`. */
export function restoreJrDatabankVersion(
  fileId: string,
  versionId: string,
  ifMatch?: string,
): Promise<ApiDatabankFile> {
  return apiFetch<ApiDatabankFile>(`/jr/databank/files/${fileId}/versions/${versionId}/restore`, {
    method: 'POST',
    headers: ifMatch ? { 'If-Match': ifMatch } : undefined,
    cache: 'no-store',
  });
}

/** JR twin of `renameDatabankVersion`. */
export function renameJrDatabankVersion(
  fileId: string,
  versionId: string,
  name: string,
  ifMatch?: string,
): Promise<{ etag: string; versions: Version[] }> {
  return apiFetch(`/jr/databank/files/${fileId}/versions/${versionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
    body: JSON.stringify({ name }),
    cache: 'no-store',
  });
}

/** JR twin of `deleteDatabankVersion`. */
export function deleteJrDatabankVersion(
  fileId: string,
  versionId: string,
  ifMatch?: string,
): Promise<{ id: string; deleted: true }> {
  return apiFetch(`/jr/databank/files/${fileId}/versions/${versionId}`, {
    method: 'DELETE',
    headers: ifMatch ? { 'If-Match': ifMatch } : undefined,
    cache: 'no-store',
  });
}

/** JR twin of `uploadDatabankFileVersion` — files ≤ 2 GB go presign → sha256 →
 *  direct PUT → commit via the `/jr/databank` route (shared hasher +
 *  `putToStorage`); bigger ones delegate to the resumable multipart uploader. */
export async function uploadJrDatabankFileVersion(
  fileId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<ApiDatabankFile> {
  if (file.size > DIRECT_VERSION_MAX_BYTES) {
    const [{ uploadVersionResumable }, { makeUploadTransport }, { hashFile }] = await Promise.all([
      import('./databank-upload/version-resumable'),
      import('./databank-upload/transport'),
      import('./databank-upload/hash'),
    ]);
    return uploadVersionResumable(
      {
        initVersion: (id, body) =>
          apiFetch(`/jr/databank/files/${id}/versions/upload/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            cache: 'no-store',
          }),
        transport: makeUploadTransport('/jr/databank', {}),
        hashFile,
      },
      fileId,
      file,
      { onProgress },
    );
  }
  const mimeType = file.type || 'application/octet-stream';
  const presigned = await presignJrDatabankVersion(fileId, {
    mimeType,
    fileSizeBytes: file.size,
    fileName: file.name,
  });
  if (file.size > presigned.maxBytes) {
    throw new Error(
      `Files larger than ${Math.round(presigned.maxBytes / (1024 ** 3))} GB can't be uploaded as a version here yet — use the main upload.`,
    );
  }
  if (presigned.strategy === 'proxy' || !presigned.url) {
    throw new Error('Uploading a new version is not available in this storage mode.');
  }
  const { hashFile } = await import('./databank-upload/hash');
  const sha256 = await hashFile(file, () => undefined, new AbortController().signal);
  await putToStorage(
    presigned.url,
    file,
    presigned.headers ?? {},
    (loaded, total) => onProgress?.(total ? loaded / total : 0),
  );
  return commitJrDatabankVersion(fileId, {
    storageKey: presigned.storageKey,
    mimeType,
    fileSizeBytes: file.size,
    sha256,
  });
}
