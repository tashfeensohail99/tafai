'use client';

/**
 * Resumable (multipart) upload of a NEW VERSION of an existing databank file,
 * for files over the direct-PUT cap (> 2 GB). Dependency-injected so it unit-
 * tests with fakes: the real wiring (the `initVersion` fetch, the shared
 * `makeUploadTransport(base, {})` session transport, and `hashFile`) is built
 * by lib/processing.ts + lib/jr-databank.ts. Mirrors the engine's part /
 * complete protocol but for ONE file with an inline 0..1 progress bar. It never
 * tracks ETags — the backend completes from storage `ListParts`, so a part
 * upload is just a PUT of the slice. Keep it standalone: do NOT reach into the
 * resumable engine / queue / dock.
 */

import { MAX_SIGN_PARTS } from './api-types.ts';
import type { CompleteResult, InitResult, PartUrl } from './api-types.ts';
import type { UploadTransport } from './engine.ts';
import type { ApiDatabankFile } from '../processing';

export interface VersionResumableDeps {
  /** POST {base}/files/{fileId}/versions/upload/init (+ ?userId= for a manager
   *  targeting another associate). Returns the single-file init response. */
  initVersion(
    fileId: string,
    body: { fileName: string; mimeType: string; sizeBytes: number; sha256: string },
  ): Promise<{ mode: 'proxy' } | { mode: 'direct'; maxBytes: number; result: InitResult }>;
  /** The SHARED session transport (makeUploadTransport(base, {})): only these
   *  three are used — they are session-id based and do NOT depend on the target
   *  scope (only init does, which `initVersion` replaces). put = xhrPut. */
  transport: Pick<UploadTransport, 'signParts' | 'complete' | 'put'>;
  hashFile(file: File, onProgress: (f: number) => void, signal: AbortSignal): Promise<string>;
  /** Back-off wait between init retries and complete polls. Defaults to a real
   *  timer; tests inject a no-op so the retry/poll paths run instantly. */
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
}

const INIT_RETRY_MS = 1000;
const INIT_MAX_TRIES = 5;
const POLL_MS = 1500;
const POLL_MAX_TRIES = 40;

/** Resolve after `ms`, or early (never rejecting) when `signal` aborts. */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function uploadVersionResumable(
  deps: VersionResumableDeps,
  fileId: string,
  file: File,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<ApiDatabankFile> {
  const signal = opts.signal ?? new AbortController().signal;
  const sleep = deps.sleep ?? defaultSleep;
  const onProgress = opts.onProgress ?? (() => undefined);
  const report = (fraction: number) => onProgress(Math.max(0, Math.min(1, file.size ? fraction : 1)));
  const mimeType = file.type || 'application/octet-stream';

  const sha256 = await deps.hashFile(file, () => undefined, signal);

  // 1-2. Init (with a short retry loop for the server's transient 'retry').
  let upload: Extract<InitResult, { status: 'upload' }> | null = null;
  let uploadId = '';
  for (let attempt = 1; ; attempt++) {
    const res = await deps.initVersion(fileId, { fileName: file.name, mimeType, sizeBytes: file.size, sha256 });
    if (res.mode === 'proxy') throw new Error('Uploading a new version is not available in this storage mode.');
    const r = res.result;
    if (r.status === 'rejected') throw new Error(r.reason);
    if (r.status === 'retry') {
      if (attempt >= INIT_MAX_TRIES) throw new Error(r.reason || 'Storage is busy — please try again.');
      await sleep(INIT_RETRY_MS, signal);
      continue;
    }
    if (r.status === 'in-progress') {
      uploadId = r.uploadId; // bytes already up — skip to the complete-poll
      break;
    }
    if (r.status === 'upload') {
      upload = r;
      uploadId = r.uploadId;
      break;
    }
    // already-uploaded / duplicate / possible-duplicate are new-file-only.
    throw new Error(`Unexpected upload status: ${(r as { status: string }).status}`);
  }

  // Byte length of part n (every part is `partSize` except a short last one).
  const partSize = upload?.partSize ?? 0;
  const partLen = (n: number) => Math.min(n * partSize, file.size) - (n - 1) * partSize;
  let base = 0; // bytes confirmed in storage

  /** Sign (any URL we don't hold, ≤ MAX_SIGN_PARTS at a time) then PUT the slices. */
  const putParts = async (nums: number[], urls: Map<number, PartUrl>) => {
    if (!partSize) throw new Error('Upload session not found.');
    const need = nums.filter((n) => !urls.has(n));
    for (let i = 0; i < need.length; i += MAX_SIGN_PARTS) {
      const chunk = need.slice(i, i + MAX_SIGN_PARTS);
      const signed = await deps.transport.signParts(uploadId, chunk, signal);
      for (const u of signed.parts) urls.set(u.partNumber, u);
    }
    for (const n of nums) {
      const body = file.slice((n - 1) * partSize, Math.min(n * partSize, file.size));
      const at = base;
      await deps.transport.put(urls.get(n)!, body, (loaded) => report((at + loaded) / file.size), signal);
      base += partLen(n);
    }
  };

  // 3. Upload parts (skipped for an in-progress session — the bytes are up).
  if (upload) {
    const done = new Set(upload.doneParts);
    base = upload.doneParts.reduce((sum, n) => sum + partLen(n), 0);
    report(base / file.size);
    if (upload.strategy === 'SINGLE') {
      await deps.transport.put(upload.urls[0], file, (loaded) => report(loaded / file.size), signal);
      base = file.size;
    } else {
      const urls = new Map(upload.urls.map((u) => [u.partNumber, u]));
      const todo: number[] = [];
      for (let n = 1; n <= upload.partCount; n++) if (!done.has(n)) todo.push(n);
      await putParts(todo, urls);
    }
  }

  // 4. Complete-poll (bounded). The server assembles from storage ListParts.
  for (let tries = 0; tries < POLL_MAX_TRIES; tries++) {
    const r: CompleteResult = (await deps.transport.complete([uploadId], signal)).results[0];
    if (r.status === 'completed') {
      report(1);
      return r.file as ApiDatabankFile;
    }
    if (r.status === 'missing-parts') {
      await putParts(r.missingParts, new Map());
      continue; // re-complete at once
    }
    if (r.status === 'in-progress' || r.status === 'retry') {
      await sleep(POLL_MS, signal);
      continue;
    }
    if (r.status === 'failed' || r.status === 'expired') {
      throw new Error((r as { reason?: string }).reason ?? 'Upload failed.');
    }
    if (r.status === 'not-found') throw new Error('Upload session not found.');
  }
  throw new Error('Timed out waiting for the upload to finish.');
}
