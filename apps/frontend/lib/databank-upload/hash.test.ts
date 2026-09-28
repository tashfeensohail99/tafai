import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { hashFile } from './hash.ts';

/**
 * hash.ts in Node (which has Blob and WebCrypto, but no Web Worker): the small-
 * file path reads in slices with progress, and a worker that cannot start
 * falls back to hashing on this thread instead of reporting the file unreadable.
 */

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

test('hash: a small file (≤ 32 MiB) is read in slices — progress for the stall watchdog — and matches node:crypto', async () => {
  const bytes = randomBytes(9 * 1024 * 1024 + 123);
  const seen: number[] = [];
  const hex = await hashFile(new Blob([bytes]), (n) => seen.push(n), new AbortController().signal);
  assert.equal(hex, sha(bytes));
  assert.ok(seen.length >= 3, `progress per slice (${seen.length})`);
  assert.equal(seen.at(-1), bytes.length);
});

test('hash: a large file whose worker cannot start (its script failed to load) is hashed on this thread', async () => {
  const g = globalThis as unknown as { Worker?: unknown };
  const had = 'Worker' in g;
  const prev = g.Worker;
  let started = 0;
  g.Worker = class {
    onerror: ((e: { message?: string; preventDefault?: () => void }) => void) | null = null;
    onmessage: unknown = null;
    constructor() {
      started += 1;
      setTimeout(() => this.onerror?.({ preventDefault: () => undefined }), 0); // a 404 on the chunk: no message
    }
    postMessage() {}
    terminate() {}
  };
  try {
    const bytes = randomBytes(33 * 1024 * 1024);
    let last = 0;
    const hex = await hashFile(new Blob([bytes]), (n) => (last = n), new AbortController().signal);
    assert.equal(started, 1, 'the worker was tried first');
    assert.equal(hex, sha(bytes));
    assert.equal(last, bytes.length);
  } finally {
    if (had) g.Worker = prev;
    else delete g.Worker;
  }
});

test('hash: a read error reported BY the worker is still a read error (no silent fallback)', async () => {
  const g = globalThis as unknown as { Worker?: unknown };
  const had = 'Worker' in g;
  const prev = g.Worker;
  g.Worker = class {
    onerror: unknown = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    constructor() {
      setTimeout(() => this.onmessage?.({ data: { type: 'error', message: 'NotReadableError' } }), 0);
    }
    postMessage() {}
    terminate() {}
  };
  try {
    await assert.rejects(
      hashFile(new Blob([randomBytes(33 * 1024 * 1024)]), () => undefined, new AbortController().signal),
      /NotReadableError/,
    );
  } finally {
    if (had) g.Worker = prev;
    else delete g.Worker;
  }
});
