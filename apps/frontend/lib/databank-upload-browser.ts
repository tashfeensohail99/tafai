'use client';

/**
 * Browser glue for the resumable upload queue (Databank Phase 1, PR-7). Lives
 * OUTSIDE lib/databank-upload/ (that folder is plain, test-run TypeScript), so
 * it may use React and the app's own modules. Loaded only via `await import()`
 * from the explorer, and by the dock once a queue exists — users who never
 * upload never download the engine.
 */

import { useSyncExternalStore } from 'react';
import { apiFetch } from './api-client';
import { getAccessToken, getRefreshToken } from './auth-client';
import { refreshTokens } from './session';
import { jrDatabankApi, processingDatabankApi } from './databank-api';
import { EMPTY_SNAPSHOT, UploadQueue } from './databank-upload/queue';
import type { LandedEvent, QueueSnapshot, QueueTarget } from './databank-upload/queue';
import type { Skipped } from './databank-upload/folder-plan';
import { browserEnv, ensureFolderPaths, makeUploadTransport } from './databank-upload/transport';
import type { DatabankBasePath, UploadTarget } from './databank-upload/transport';
import { attachLifecycle } from './databank-upload/lifecycle';
import type { NavigatorLike } from './databank-upload/lifecycle';
import { isQueuePresent, registerQueue } from './databank-upload/presence';

declare global {
  // One queue per tab — survives React StrictMode double-mounts and HMR.
  // eslint-disable-next-line no-var
  var __tafsheenUploadQueue: UploadQueue | undefined;
}

export function getUploadQueue(): UploadQueue {
  const existing = globalThis.__tafsheenUploadQueue;
  if (existing) {
    if (!isQueuePresent()) registerQueue(existing); // presence.ts was hot-reloaded
    return existing;
  }
  const q = new UploadQueue({
    makeTransport: (t) => makeUploadTransport(t.base, t.target),
    env: browserEnv,
    ensurePaths: (t, parent, paths, signal) => ensureFolderPaths(t.base, t.target, parent, paths, signal),
    // The standard (≤ 2 GB) upload for proxy mode: a direct presign PUT when the
    // server allows it (the kill switch), multipart through the backend in dev.
    legacyUpload: (t, file, folderId, onProgress) =>
      (t.base === '/jr/databank' ? jrDatabankApi : processingDatabankApi).directUpload(t.target, file as File, folderId, onProgress),
    accessToken: getAccessToken,
    restoreSession: async () => {
      if (getAccessToken()) {
        // An (expired) access token: any authenticated call makes apiFetch
        // refresh it through ITS single-flight — never a second, racing refresh
        // of the same one-time refresh token (the loser would be signed out).
        await apiFetch('/auth/me', { cache: 'no-store' }).catch(() => undefined);
        return;
      }
      // No access token in this tab (e.g. signed in again in another tab — the
      // refresh token is shared): mint one, as useSession does on load.
      if (getRefreshToken()) await refreshTokens();
    },
  });
  globalThis.__tafsheenUploadQueue = q;
  attachLifecycle(q, window, navigator as unknown as NavigatorLike, document);
  registerQueue(q);
  return q;
}

/** The queue's snapshot for React (≤ 4 updates a second). */
export function useUploadQueue(): QueueSnapshot {
  return useSyncExternalStore(
    (fn) => getUploadQueue().subscribe(fn),
    () => getUploadQueue().getSnapshot(),
    () => EMPTY_SNAPSHOT,
  );
}

/** Where a drop goes, as the dock names it. */
export interface UploadDest {
  base: DatabankBasePath;
  target: UploadTarget;
  /** "Ali Khan" / "My folders". */
  label: string;
  href?: string;
  /** "Databank › Passport". */
  parentLabel: string;
}

const qt = (d: UploadDest): QueueTarget => ({ base: d.base, target: d.target });

export function enqueueFiles(dest: UploadDest, folderId: string | null, files: File[], skipped: Skipped[] = []): string {
  return getUploadQueue().enqueueFiles(
    qt(dest),
    { label: dest.label, href: dest.href, parentLabel: dest.parentLabel, parentFolderId: folderId },
    files.map((file) => ({ file })),
    skipped,
  );
}

export function enqueueFolder(
  dest: UploadDest,
  parentFolderId: string | null,
  entries: Array<{ file: File; relPath: string }>,
  emptyDirs?: string[],
): string {
  return getUploadQueue().enqueueFolder(
    qt(dest),
    { label: dest.label, href: dest.href, parentLabel: dest.parentLabel, parentFolderId },
    entries.map((e) => ({ file: e.file, relPath: e.relPath })),
    { emptyDirs },
  );
}

export function onLanded(dataScope: string, fn: (e: LandedEvent) => void): () => void {
  return getUploadQueue().onLanded(dataScope, fn);
}
