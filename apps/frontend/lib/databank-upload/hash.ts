'use client';

/**
 * Browser SHA-256 of a whole file, for the upload engine (EngineEnv.hash).
 *  - ≤ 32 MiB: WebCrypto digest (native, fastest; the file fits in memory).
 *  - larger: a Web Worker streams it through our incremental SHA-256
 *    (WebCrypto cannot hash incrementally, and a 25 GB file cannot be buffered).
 * Each large file gets its OWN worker, so cancelling one hash (terminating its
 * worker — the only way to stop a read midway) never disturbs another. The
 * worker start-up cost is nothing next to hashing a file of that size.
 */

const WEBCRYPTO_MAX = 32 * 1024 * 1024;

function toHex(buf: ArrayBuffer): string {
  let hex = '';
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

const aborted = () => new DOMException('Aborted', 'AbortError');

export async function hashFile(
  file: Blob,
  onProgress: (bytes: number) => void,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw aborted();
  if (file.size <= WEBCRYPTO_MAX && typeof crypto !== 'undefined' && crypto.subtle) {
    // Race the read against the signal: a read that hangs (a stalled network
    // drive) must not hold the hash slot — Cancel frees it at once.
    const stop = new Promise<never>((_, reject) => {
      if (signal.aborted) reject(aborted());
      else signal.addEventListener('abort', () => reject(aborted()), { once: true });
    });
    stop.catch(() => undefined);
    const bytes = await Promise.race([file.arrayBuffer(), stop]);
    const digest = await Promise.race([crypto.subtle.digest('SHA-256', bytes), stop]);
    onProgress(file.size);
    return toHex(digest);
  }
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('./hash-worker.ts', import.meta.url), { type: 'module' });
    const finish = (fn: () => void) => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      fn();
    };
    const onAbort = () => finish(() => reject(aborted()));
    signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (e: MessageEvent<{ type: string; bytes?: number; hex?: string; message?: string }>) => {
      if (e.data.type === 'progress') onProgress(e.data.bytes ?? 0);
      else if (e.data.type === 'done') finish(() => resolve(e.data.hex!));
      else finish(() => reject(new Error(e.data.message || 'Could not read the file')));
    };
    worker.onerror = (e) => finish(() => reject(new Error(e.message || 'Hashing failed')));
    worker.postMessage({ id: 1, file });
  });
}
