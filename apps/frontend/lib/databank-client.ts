'use client';

/**
 * ONE base-path-parameterized Databank API client. The Processing and JR
 * portals talk to the SAME shared backend DatabankService; the only thing that
 * differs between them is the route prefix (`/processing/databank` vs
 * `/jr/databank`) and — for Processing managers only — the `?userId=` query on
 * a direct upload that targets another associate's personal area. Previously
 * each portal had a hand-maintained twin set of these helpers that had to be
 * kept byte-for-byte in sync; `makeDatabankClient(base)` builds both from one
 * body so they can never drift again. `lib/databank-api.ts` spreads the
 * returned object into each portal's `DatabankApi` adapter.
 */

import { apiFetch } from './api-client';
import {
  DIRECT_VERSION_MAX_BYTES,
  databankSearchQuery,
  putToStorage,
  type ApiDatabankByAssociate,
  type ApiDatabankFile,
  type ApiDatabankFolder,
  type ApiDatabankTree,
  type CopyFolderResult,
  type DatabankFileSource,
  type DatabankSearchParams,
  type DatabankSearchResult,
  type DatabankUploadTarget,
  type PresignedUploadResponse,
  type TrashItem,
  type Version,
} from './processing';
import type { DatabankBasePath } from './databank-upload/transport';

export function makeDatabankClient(base: DatabankBasePath) {
  // ---- presign / commit for a NEW file version (private to uploadFileVersion).
  const presignVersion = (
    fileId: string,
    body: { mimeType: string; fileSizeBytes: number; fileName?: string },
  ): Promise<PresignedUploadResponse> =>
    apiFetch<PresignedUploadResponse>(`${base}/files/${fileId}/versions/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

  const commitVersion = (
    fileId: string,
    body: { storageKey: string; mimeType: string; fileSizeBytes: number; sha256: string },
    ifMatch?: string,
  ): Promise<ApiDatabankFile> =>
    apiFetch<ApiDatabankFile>(`${base}/files/${fileId}/versions/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

  function fetchByAssociate(q?: string): Promise<ApiDatabankByAssociate> {
    const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    return apiFetch<ApiDatabankByAssociate>(`${base}/clients/by-associate${qs}`, {
      cache: 'no-store',
    });
  }

  function fetchTree(clientId: string): Promise<ApiDatabankTree> {
    return apiFetch<ApiDatabankTree>(`${base}/clients/${clientId}/tree`, {
      cache: 'no-store',
    });
  }

  function fetchPersonalTree(): Promise<ApiDatabankTree> {
    return apiFetch<ApiDatabankTree>(`${base}/me/tree`, { cache: 'no-store' });
  }

  function createFolder(
    clientId: string,
    name: string,
    parentFolderId: string | null = null,
  ): Promise<ApiDatabankFolder> {
    return apiFetch<ApiDatabankFolder>(`${base}/clients/${clientId}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentFolderId }),
      cache: 'no-store',
    });
  }

  function createPersonalFolder(
    name: string,
    parentFolderId: string | null = null,
  ): Promise<ApiDatabankFolder> {
    return apiFetch<ApiDatabankFolder>(`${base}/me/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentFolderId }),
      cache: 'no-store',
    });
  }

  async function uploadFile(
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
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const res = await fetch(`${apiBase}${base}/clients/${clientId}/files`, {
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

  async function uploadPersonalFile(
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
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const res = await fetch(`${apiBase}${base}/me/files`, {
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

  async function directUpload(
    target: DatabankUploadTarget,
    file: File,
    folderId: string | null = null,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
    opts: { commitKey?: string; onStored?: (storageKey: string) => void } = {},
  ): Promise<ApiDatabankFile> {
    const mimeType = file.type || 'application/octet-stream';
    // `?userId=` targets another associate's personal area — a Processing-manager
    // feature with no JR route, so it is only ever appended on the Processing
    // portal (mirrors makeUploadTransport's `base === '/processing/databank'`).
    const q =
      target.userId && base === '/processing/databank'
        ? `?userId=${encodeURIComponent(target.userId)}`
        : '';
    const body = {
      clientId: target.clientId,
      personal: target.personal,
      folderId,
      fileName: file.name,
      mimeType,
      fileSizeBytes: file.size,
    };
    const commit = (storageKey: string) =>
      apiFetch<ApiDatabankFile>(`${base}/uploads/commit${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, storageKey }),
        cache: 'no-store',
        // No signal: once sent, the server records the file whatever the tab does —
        // aborting would only make the dock say "Cancelled" about a saved file.
      });
    // Already stored (only the commit's reply was lost last time): record it —
    // the server returns the row it already made for this key. No second copy.
    if (opts.commitKey) return commit(opts.commitKey);

    const presigned = await apiFetch<PresignedUploadResponse>(`${base}/uploads/presign${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal,
    });

    // Dev storage (local/supabase): no direct-PUT path — stream through the backend.
    if (presigned.strategy === 'proxy' || !presigned.url) {
      onProgress?.(0);
      const res = target.personal
        ? await uploadPersonalFile(file, folderId, 'UPLOAD')
        : await uploadFile(target.clientId!, file, folderId, 'UPLOAD');
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

  function renameFolder(folderId: string, name: string): Promise<ApiDatabankFolder> {
    return apiFetch<ApiDatabankFolder>(`${base}/folders/${folderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      cache: 'no-store',
    });
  }

  function moveFolder(
    folderId: string,
    parentFolderId: string | null,
  ): Promise<ApiDatabankFolder> {
    return apiFetch<ApiDatabankFolder>(`${base}/folders/${folderId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentFolderId }),
      cache: 'no-store',
    });
  }

  function deleteFolder(folderId: string): Promise<{ deletedFolders: number }> {
    return apiFetch<{ deletedFolders: number }>(`${base}/folders/${folderId}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
  }

  function signedUrl(
    fileId: string,
  ): Promise<{ url: string; fileName: string; mimeType: string | null }> {
    return apiFetch(`${base}/files/${fileId}/signed-url`, { cache: 'no-store' });
  }

  function renameFile(fileId: string, fileName: string): Promise<ApiDatabankFile> {
    return apiFetch<ApiDatabankFile>(`${base}/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName }),
      cache: 'no-store',
    });
  }

  function updateFile(
    fileId: string,
    patch: { fileName?: string; description?: string | null; tags?: string[] },
  ): Promise<ApiDatabankFile> {
    return apiFetch<ApiDatabankFile>(`${base}/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      cache: 'no-store',
    });
  }

  function search(params: DatabankSearchParams): Promise<DatabankSearchResult> {
    return apiFetch<DatabankSearchResult>(`${base}/search${databankSearchQuery(params)}`, {
      cache: 'no-store',
    });
  }

  function moveFile(fileId: string, folderId: string | null): Promise<ApiDatabankFile> {
    return apiFetch<ApiDatabankFile>(`${base}/files/${fileId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
      cache: 'no-store',
    });
  }

  function copyFile(
    fileId: string,
    opts: { targetClientId?: string; targetFolderId?: string | null } = {},
  ): Promise<ApiDatabankFile> {
    return apiFetch<ApiDatabankFile>(`${base}/files/${fileId}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
      cache: 'no-store',
    });
  }

  function copyFolder(
    folderId: string,
    opts: { targetClientId?: string; targetFolderId?: string | null } = {},
  ): Promise<CopyFolderResult> {
    return apiFetch<CopyFolderResult>(`${base}/folders/${folderId}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
      cache: 'no-store',
    });
  }

  function deleteFile(fileId: string): Promise<{ id: string; deleted: boolean }> {
    return apiFetch<{ id: string; deleted: boolean }>(`${base}/files/${fileId}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
  }

  function fetchTrash(
    scope: { clientId: string } | { personal: true },
  ): Promise<TrashItem[]> {
    const sp = new URLSearchParams();
    if ('clientId' in scope) sp.set('clientId', scope.clientId);
    else sp.set('personal', 'true');
    return apiFetch<TrashItem[]>(`${base}/trash?${sp.toString()}`, { cache: 'no-store' });
  }

  function restoreTrashedFolder(folderId: string): Promise<ApiDatabankFolder> {
    return apiFetch<ApiDatabankFolder>(`${base}/folders/${folderId}/restore`, {
      method: 'POST',
      cache: 'no-store',
    });
  }

  function restoreTrashedFile(fileId: string): Promise<ApiDatabankFile> {
    return apiFetch<ApiDatabankFile>(`${base}/files/${fileId}/restore`, {
      method: 'POST',
      cache: 'no-store',
    });
  }

  function purgeTrashedFolder(
    folderId: string,
  ): Promise<{ purgedFolders: number; purgedFiles: number }> {
    return apiFetch(`${base}/folders/${folderId}/purge`, {
      method: 'DELETE',
      cache: 'no-store',
    });
  }

  function purgeTrashedFile(fileId: string): Promise<{ id: string; purged: true }> {
    return apiFetch(`${base}/files/${fileId}/purge`, {
      method: 'DELETE',
      cache: 'no-store',
    });
  }

  function listFileVersions(
    fileId: string,
  ): Promise<{ etag: string; versions: Version[] }> {
    return apiFetch(`${base}/files/${fileId}/versions`, { cache: 'no-store' });
  }

  function versionSignedUrl(
    fileId: string,
    versionId: string,
  ): Promise<{ url: string; fileName: string; mimeType: string | null }> {
    return apiFetch(`${base}/files/${fileId}/versions/${versionId}/signed-url`, {
      cache: 'no-store',
    });
  }

  async function uploadFileVersion(
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
            apiFetch(`${base}/files/${id}/versions/upload/init`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              cache: 'no-store',
            }),
          transport: makeUploadTransport(base, {}),
          hashFile,
        },
        fileId,
        file,
        { onProgress },
      );
    }
    const mimeType = file.type || 'application/octet-stream';
    const presigned = await presignVersion(fileId, {
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
    return commitVersion(fileId, {
      storageKey: presigned.storageKey,
      mimeType,
      fileSizeBytes: file.size,
      sha256,
    });
  }

  function restoreFileVersion(
    fileId: string,
    versionId: string,
    ifMatch?: string,
  ): Promise<ApiDatabankFile> {
    return apiFetch<ApiDatabankFile>(`${base}/files/${fileId}/versions/${versionId}/restore`, {
      method: 'POST',
      headers: ifMatch ? { 'If-Match': ifMatch } : undefined,
      cache: 'no-store',
    });
  }

  function renameFileVersion(
    fileId: string,
    versionId: string,
    name: string,
    ifMatch?: string,
  ): Promise<{ etag: string; versions: Version[] }> {
    return apiFetch(`${base}/files/${fileId}/versions/${versionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
      body: JSON.stringify({ name }),
      cache: 'no-store',
    });
  }

  function deleteFileVersion(
    fileId: string,
    versionId: string,
    ifMatch?: string,
  ): Promise<{ id: string; deleted: true }> {
    return apiFetch(`${base}/files/${fileId}/versions/${versionId}`, {
      method: 'DELETE',
      headers: ifMatch ? { 'If-Match': ifMatch } : undefined,
      cache: 'no-store',
    });
  }

  return {
    fetchByAssociate,
    fetchTree,
    fetchPersonalTree,
    createFolder,
    createPersonalFolder,
    uploadFile,
    uploadPersonalFile,
    directUpload,
    renameFolder,
    moveFolder,
    deleteFolder,
    signedUrl,
    renameFile,
    updateFile,
    search,
    moveFile,
    copyFile,
    copyFolder,
    deleteFile,
    fetchTrash,
    restoreTrashedFolder,
    restoreTrashedFile,
    purgeTrashedFolder,
    purgeTrashedFile,
    listFileVersions,
    versionSignedUrl,
    uploadFileVersion,
    restoreFileVersion,
    renameFileVersion,
    deleteFileVersion,
  };
}
