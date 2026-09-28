/**
 * Web Worker: SHA-256 of one large file, read in 8 MiB slices so memory stays
 * flat for a 25 GB file and the page never freezes. Posts progress after each
 * slice. Started by hash.ts (new Worker(new URL('./hash-worker.ts', import.meta.url))).
 */
import { Sha256 } from './sha256.ts';

const SLICE = 8 * 1024 * 1024;

// Typed loosely on purpose: the app's tsconfig uses the DOM lib, and pulling
// in the "webworker" lib alongside it conflicts.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; file: Blob }>) => void) | null;
  postMessage(msg: unknown): void;
};

ctx.onmessage = async (e) => {
  const { id, file } = e.data;
  try {
    const h = new Sha256();
    for (let off = 0; off < file.size; off += SLICE) {
      const end = Math.min(off + SLICE, file.size);
      h.update(new Uint8Array(await file.slice(off, end).arrayBuffer()));
      ctx.postMessage({ id, type: 'progress', bytes: end });
    }
    ctx.postMessage({ id, type: 'done', hex: h.digestHex() });
  } catch (err) {
    ctx.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
