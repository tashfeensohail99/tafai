'use client';

/**
 * The browser side of the resumable-upload API: our backend over apiFetch
 * (auth + token refresh), part PUTs straight to R2 over XHR (fetch has no
 * upload progress), and the browser EngineEnv. One transport per upload
 * target — the Processing or JR databank, a client or a personal area.
 */

import { apiFetch } from '../api-client.ts';
import type {
  CompleteResponse,
  InitResponse,
  InitUploadFile,
  PartUrl,
  SignPartsResponse,
} from './api-types.ts';
import { TransportError } from './engine.ts';
import type { EngineEnv, UploadSource, UploadTransport } from './engine.ts';
import { hashFile } from './hash.ts';

export type DatabankBasePath = '/processing/databank' | '/jr/databank';

export interface UploadTarget {
  /** A client's databank … */
  clientId?: string;
  /** … or the caller's personal area. */
  personal?: boolean;
  /** Processing managers only: another associate's personal area. */
  userId?: string;
}

/** Re-throw any API failure as a TransportError carrying the HTTP status
 *  (0 = no response: offline, DNS, CORS, reset, abort/timeout). A 2xx whose
 *  body is not a JSON object (a proxy's HTML page, an empty reply) is also a
 *  status-0 failure — never handed to the engine as data. */
async function call<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  let body: unknown;
  try {
    // Race the signal too: on a 401, apiFetch awaits a token refresh that does
    // not take our signal — a timeout / pause / cancel must still end OUR wait.
    body = await Promise.race([apiFetch<T>(path, { cache: 'no-store', ...init, signal }), whenAborted(signal)]);
  } catch (e) {
    const status = (e as { status?: unknown } | null)?.status;
    throw new TransportError(e instanceof Error ? e.message : String(e), typeof status === 'number' ? status : 0);
  }
  if (body === null || typeof body !== 'object') {
    throw new TransportError('The server sent an unreadable reply.', 0);
  }
  return body as T;
}

/** Rejects (TransportError 0) once `signal` aborts; never settles otherwise. */
function whenAborted(signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (!signal) return;
    const fail = () => reject(new TransportError('Stopped', 0));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function makeUploadTransport(base: DatabankBasePath, target: UploadTarget): UploadTransport {
  const q = target.userId && base === '/processing/databank' ? `?userId=${encodeURIComponent(target.userId)}` : '';
  const scope = target.personal ? { personal: true } : { clientId: target.clientId };
  return {
    init: (files: InitUploadFile[], signal: AbortSignal) =>
      call<InitResponse>(`${base}/uploads/init${q}`, json({ ...scope, files }), signal),
    signParts: (id: string, partNumbers: number[], signal: AbortSignal) =>
      call<SignPartsResponse>(`${base}/uploads/${id}/parts`, json({ partNumbers }), signal),
    complete: (ids: string[], signal: AbortSignal) =>
      call<CompleteResponse>(`${base}/uploads/complete`, json({ ids }), signal),
    abort: async (id: string, signal: AbortSignal) => {
      await call(`${base}/uploads/${id}`, { method: 'DELETE' }, signal);
    },
    put: xhrPut,
  };
}

/** Get-or-create a dropped folder tree in one call: paths → folder ids. */
export function ensureFolderPaths(
  base: DatabankBasePath,
  target: UploadTarget,
  parentFolderId: string | null,
  paths: string[],
): Promise<{ folders: Record<string, string>; created: number }> {
  const q = target.userId && base === '/processing/databank' ? `?userId=${encodeURIComponent(target.userId)}` : '';
  const scope = target.personal ? { personal: true } : { clientId: target.clientId };
  return call(`${base}/folders/ensure-paths${q}`, json({ ...scope, parentFolderId, paths }));
}

/** PUT one part straight to R2 with upload progress. No auth header — the
 *  presigned URL carries its own signature; only the presign's headers are sent. */
function xhrPut(
  part: PartUrl,
  body: unknown,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new TransportError('Aborted', 0));
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = (fn: () => void) => {
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    xhr.open('PUT', part.url, true);
    for (const [k, v] of Object.entries(part.headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      settle(() =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new TransportError(`Storage responded ${xhr.status}`, xhr.status)),
      );
    xhr.onerror = () => settle(() => reject(new TransportError('Network error', 0)));
    xhr.onabort = () => settle(() => reject(new TransportError('Aborted', 0)));
    xhr.send(body as Blob);
  });
}

/** The real-browser EngineEnv. */
export const browserEnv: EngineEnv = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        signal?.removeEventListener('abort', done);
        resolve();
      }
      signal?.addEventListener('abort', done, { once: true });
    }),
  random: () => Math.random(),
  hash: (source: UploadSource, onProgress, signal) => hashFile(source as Blob, onProgress, signal),
  // Reading one byte fails (NotReadableError / NotFoundError) once the file was
  // moved, edited or its drive unplugged — the same failure a PUT reports as a
  // bare network error.
  readable: async (source: UploadSource, start: number, end: number) => {
    try {
      await (source as Blob).slice(start, Math.min(end, start + 1)).arrayBuffer();
      return true;
    } catch {
      return false;
    }
  },
};
