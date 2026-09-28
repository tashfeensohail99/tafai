'use client';

/**
 * Browser SHA-256 of a whole file, for the upload engine (EngineEnv.hash).
 *  - ≤ 32 MiB: read in 4 MiB slices (progress for the engine's stall watchdog),
 *    then one WebCrypto digest (native, fastest; the file fits in memory).
 *  - larger: a Web Worker streams it through our incremental SHA-256
 *    (WebCrypto cannot hash incrementally, and a 25 GB file cannot be buffered).
 *    If the worker itself cannot start (its script failed to load — a network
 *    blip, or a deploy replaced it), the same incremental hash runs on this
 *    thread instead: slower, but the file is fine and must not look unreadable.
 * Each large file gets its OWN worker, so cancelling one hash (terminating its
 * worker — the only way to stop a read midway) never disturbs another. The
 * worker start-up cost is nothing next to hashing a file of that size.
 */
import { Sha256 } from './sha256.ts';

const WEBCRYPTO_MAX = 32 * 1024 * 1024;
/** Progress after every slice (the engine's stall watchdog needs a tick well
 *  inside 5 min even on a slow Drive stream: 2 MiB ≈ 7 KB/s). */
const SMALL_SLICE = 1024 * 1024;
const SLICE = 2 * 1024 * 1024;

function toHex(buf: ArrayBuffer): string {
  let hex = '';
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

const aborted = () => new DOMException('Aborted', 'AbortError');

/** Rejects once `signal` aborts: raced against every read, so a read that hangs
 *  (a stalled network drive) never holds the hash slot past a Cancel. */
function whenAborted(signal: AbortSignal): Promise<never> {
  const stop = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(aborted());
    else signal.addEventListener('abort', () => reject(aborted()), { once: true });
  });
  stop.catch(() => undefined);
  return stop;
}

/** The worker's loop, on this thread (the fallback when no worker can start). */
async function hashHere(file: Blob, onProgress: (bytes: number) => void, signal: AbortSignal): Promise<string> {
  const stop = whenAborted(signal);
  const h = new Sha256();
  for (let off = 0; off < file.size; off += SLICE) {
    const end = Math.min(off + SLICE, file.size);
    h.update(new Uint8Array(await Promise.race([file.slice(off, end).arrayBuffer(), stop])));
    onProgress(end);
  }
  if (signal.aborted) throw aborted();
  return h.digestHex();
}

export async function hashFile(
  file: Blob,
  onProgress: (bytes: number) => void,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw aborted();
  if (file.size <= WEBCRYPTO_MAX && typeof crypto !== 'undefined' && crypto.subtle) {
    const stop = whenAborted(signal);
    // (The whole-file buffer is allocated only once the first slice was read: a
    // file that can't be read — retried during an outage — allocates nothing.)
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    for (let off = 0; off < file.size; off += SMALL_SLICE) {
      const end = Math.min(off + SMALL_SLICE, file.size);
      const chunk = new Uint8Array(await Promise.race([file.slice(off, end).arrayBuffer(), stop]));
      bytes ??= new Uint8Array(file.size);
      bytes.set(chunk, off);
      onProgress(end);
    }
    bytes ??= new Uint8Array(0);
    const digest = await Promise.race([crypto.subtle.digest('SHA-256', bytes), stop]);
    onProgress(file.size);
    return toHex(digest);
  }
  if (typeof Worker === 'undefined') return hashHere(file, onProgress, signal);
  return new Promise<string>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./hash-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      hashHere(file, onProgress, signal).then(resolve, reject);
      return;
    }
    let heard = false; // the worker answered at least once (it started)
    const finish = (fn: () => void) => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      fn();
    };
    const onAbort = () => finish(() => reject(aborted()));
    signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (e: MessageEvent<{ type: string; bytes?: number; hex?: string; message?: string }>) => {
      heard = true;
      if (e.data.type === 'progress') onProgress(e.data.bytes ?? 0);
      else if (e.data.type === 'done') finish(() => resolve(e.data.hex!));
      else finish(() => reject(new Error(e.data.message || 'Could not read the file')));
    };
    worker.onerror = (e) => {
      // Read errors come back as an 'error' MESSAGE (the worker catches them).
      // An error event before the worker ever answered = it could not start.
      if (!heard) {
        e.preventDefault?.();
        finish(() => hashHere(file, onProgress, signal).then(resolve, reject));
        return;
      }
      finish(() => reject(new Error(e.message || 'Hashing failed')));
    };
    worker.postMessage({ id: 1, file });
  });
}
