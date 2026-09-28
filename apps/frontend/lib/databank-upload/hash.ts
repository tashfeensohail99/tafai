'use client';

/**
 * Browser SHA-256 of a whole file, for the upload engine (EngineEnv.hash).
 *  - ≤ 32 MiB: WebCrypto digest (native, fastest; the file fits in memory).
 *  - larger: one shared Web Worker streams it through our incremental SHA-256
 *    (WebCrypto cannot hash incrementally, and a 25 GB file cannot be buffered).
 * Files are hashed one at a time, so one worker is enough; it is re-created
 * only after a cancel (terminating it is the only way to stop a hash midway).
 */

const WEBCRYPTO_MAX = 32 * 1024 * 1024;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (hex: string) => void; reject: (e: Error) => void; onProgress: (bytes: number) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./hash-worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; type: string; bytes?: number; hex?: string; message?: string }>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    if (e.data.type === 'progress') job.onProgress(e.data.bytes ?? 0);
    else {
      pending.delete(e.data.id);
      if (e.data.type === 'done') job.resolve(e.data.hex!);
      else job.reject(new Error(e.data.message || 'Could not read the file'));
    }
  };
  w.onerror = (e) => {
    // The worker itself died: fail everything it was doing and start fresh next time.
    for (const job of pending.values()) job.reject(new Error(e.message || 'Hashing failed'));
    pending.clear();
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

function toHex(buf: ArrayBuffer): string {
  let hex = '';
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export async function hashFile(
  file: Blob,
  onProgress: (bytes: number) => void,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (file.size <= WEBCRYPTO_MAX && typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress(file.size);
    return toHex(digest);
  }
  const w = getWorker();
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id);
      // Stop the read now: a cancelled 20 GB hash must not keep the CPU busy.
      w.terminate();
      if (worker === w) worker = null;
      for (const job of pending.values()) job.reject(new Error('Hashing restarted'));
      pending.clear();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (hex) => {
        signal.removeEventListener('abort', onAbort);
        resolve(hex);
      },
      reject: (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
      onProgress,
    });
    w.postMessage({ id, file });
  });
}
