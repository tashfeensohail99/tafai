/**
 * Test doubles for the upload engine, shared by engine.test.ts and the upload
 * queue's tests: a FAKE server + R2 (plans parts, stores them, checks them at
 * complete, mirrors the backend's abort 409/404 rules) with fault injection,
 * and a VIRTUAL clock. Not a test file itself (no "*.test.ts" name).
 */
import assert from 'node:assert/strict';
import type { CompleteResult, InitResult, InitUploadFile, PartUrl } from '../api-types.ts';
import { TransportError, UploadEngine } from '../engine.ts';
import type { EngineEnv, UploadItem, UploadSource, UploadTransport } from '../engine.ts';

// ---- fakes ------------------------------------------------------------------

export type Fault = 'ok' | 'hang' | 'slow' | 'slow-503' | number; // number = HTTP status (0 = network); slow = 8 s with no progress
export type ApiFault = 'ok' | 'hang' | 'garbage' | 'lost' | number; // lost = the server did it, the reply never arrived

interface FakeSession {
  id: string;
  identity: string;
  size: number;
  partSize: number;
  partCount: number;
  stored: Map<number, number>; // partNumber -> bytes
  status: 'UPLOADING' | 'COMPLETING' | 'COMPLETED' | 'ABORTED';
}

export const tick = () => new Promise<void>((r) => setImmediate(r));

export function stopped(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new TransportError('aborted', 0));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

export class FakeServer implements UploadTransport {
  sessions = new Map<string, FakeSession>();
  recorded: string[] = [];
  initCalls: InitUploadFile[][] = [];
  signCalls: Array<{ id: string; parts: number[] }> = [];
  completeCalls: string[][] = [];
  abortCalls: string[] = [];
  okPuts = new Map<string, number>();
  attempts = new Map<string, number>();
  putAttempts = 0;
  inFlight = 0;
  maxInFlight = 0;
  /** Requests of any kind currently in flight (drives the virtual clock). */
  pending = 0;
  seq = 0;
  mode: 'direct' | 'proxy' = 'direct';
  fault: (ctx: { session: string; part: number; attempt: number }) => Fault = () => 'ok';
  apiFault: (method: 'init' | 'sign' | 'complete' | 'abort', call: number) => ApiFault = () => 'ok';
  initOverride: (f: InitUploadFile, index: number) => InitResult | null = () => null;
  completeOverride: (id: string, call: number) => CompleteResult | null = () => null;
  calls = { init: 0, sign: 0, complete: 0, abort: 0 };
  /** Virtual sleep (set by setup) for faults that take time. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = async () => undefined;

  /** Plan like the server, scaled down: ≤ 25 bytes SINGLE, else 10-byte parts —
   *  and for "big" sizes (> 1 MB, e.g. a 300 MiB test file) 16 equal parts, so
   *  a test never plans millions of parts. */
  plan(size: number) {
    if (size <= 25) return { partSize: size, partCount: 1 };
    if (size <= 1_000_000) return { partSize: 10, partCount: Math.ceil(size / 10) };
    const partSize = Math.ceil(size / 16);
    return { partSize, partCount: Math.ceil(size / partSize) };
  }

  private async api<T>(method: 'init' | 'sign' | 'complete' | 'abort', signal: AbortSignal, body: () => T): Promise<T> {
    const call = ++this.calls[method];
    this.pending += 1;
    try {
      const f = this.apiFault(method, call);
      if (f === 'hang') await stopped(signal);
      await tick();
      if (signal.aborted) throw new TransportError('aborted', 0);
      if (typeof f === 'number') throw new TransportError(`${method} failed (${f})`, f);
      if (f === 'garbage') return (method === 'init' ? null : {}) as T;
      if (f === 'lost') {
        body(); // side effects happen on the server…
        throw new TransportError('connection reset', 0); // …but the reply is lost
      }
      return body();
    } finally {
      this.pending -= 1;
    }
  }

  init(files: InitUploadFile[], signal: AbortSignal) {
    this.initCalls.push(files);
    return this.api('init', signal, () => {
      if (this.mode === 'proxy') return { mode: 'proxy' as const };
      if (files.some((f) => f.fileName.includes('bad'))) throw new TransportError('files.0.fileName is invalid', 400);
      const results: InitResult[] = files.map((f, index) => {
        const o = this.initOverride(f, index);
        if (o) return o;
        const identity = `${f.folderId}|${f.fileName}|${f.sizeBytes}|${f.sha256}`;
        let s = [...this.sessions.values()].find((x) => x.identity === identity && x.status === 'UPLOADING');
        const resumed = !!s;
        if (!s) {
          const { partSize, partCount } = this.plan(f.sizeBytes);
          s = { id: `s${++this.seq}`, identity, size: f.sizeBytes, partSize, partCount, stored: new Map(), status: 'UPLOADING' };
          this.sessions.set(s.id, s);
        }
        const done = [...s.stored.keys()].sort((a, b) => a - b);
        const todo: number[] = [];
        for (let n = 1; n <= s.partCount && todo.length < 16; n++) if (!s.stored.has(n)) todo.push(n);
        return {
          index,
          status: 'upload',
          uploadId: s.id,
          strategy: s.partCount === 1 ? 'SINGLE' : 'MULTIPART',
          partSize: s.partSize,
          partCount: s.partCount,
          doneParts: done,
          urls: todo.map((n) => this.url(s!.id, n)),
          urlsExpireAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
          resumed,
          sessionExpiresAt: new Date(Date.now() + 6 * 86400_000).toISOString(),
        };
      });
      return { mode: 'direct' as const, maxBytes: 1e12, results };
    });
  }

  url(id: string, n: number): PartUrl {
    return { partNumber: n, url: `https://r2/${id}/${n}`, headers: { 'x-test': '1' } };
  }

  signParts(id: string, parts: number[], signal: AbortSignal) {
    this.signCalls.push({ id, parts });
    return this.api('sign', signal, () => {
      const s = this.sessions.get(id);
      if (!s) throw new TransportError('Upload not found.', 404);
      if (s.status !== 'UPLOADING') throw new TransportError(`This upload is ${s.status.toLowerCase()}.`, 409);
      return { parts: parts.map((n) => this.url(id, n)), urlsExpireAt: new Date(Date.now() + 6 * 3600_000).toISOString() };
    });
  }

  /** PUT start order ("session:part") and the sources their bodies came from. */
  starts: string[] = [];
  bodySeeds: string[] = [];

  async put(part: PartUrl, body: unknown, onProgress: (loaded: number) => void, signal: AbortSignal) {
    const [, , , id, n] = part.url.split('/');
    const partNumber = Number(n);
    const key = `${id}:${partNumber}`;
    this.starts.push(key);
    this.bodySeeds.push((body as { seed?: string }).seed ?? '');
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    this.putAttempts += 1;
    this.inFlight += 1;
    this.pending += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      assert.equal(part.headers?.['x-test'], '1', 'headers from the presign are sent');
      const { start, end } = body as { start: number; end: number };
      const fault = this.fault({ session: id, part: partNumber, attempt });
      if (fault === 'hang') await stopped(signal);
      if (fault === 'slow' || fault === 'slow-503') await this.sleep(8000, signal); // e.g. a slow TLS start: no progress yet
      if (fault === 'slow-503') throw new TransportError('PUT failed (503)', 503);
      await tick();
      if (signal.aborted) throw new TransportError('aborted', 0);
      if (typeof fault === 'number') throw new TransportError(`PUT failed (${fault})`, fault);
      const s = this.sessions.get(id);
      if (!s || s.status !== 'UPLOADING') throw new TransportError('NoSuchUpload', 404);
      assert.equal(end - start, Math.min(s.partSize, s.size - (partNumber - 1) * s.partSize), 'planned part size');
      onProgress(end - start);
      s.stored.set(partNumber, end - start);
      this.okPuts.set(key, (this.okPuts.get(key) ?? 0) + 1);
    } finally {
      this.inFlight -= 1;
      this.pending -= 1;
    }
  }

  complete(ids: string[], signal: AbortSignal) {
    this.completeCalls.push(ids);
    const call = this.completeCalls.length;
    return this.api('complete', signal, () => {
      const results: CompleteResult[] = [...new Set(ids)].map((id) => {
        const o = this.completeOverride(id, call);
        if (o) return o;
        const s = this.sessions.get(id);
        if (!s) return { id, status: 'not-found' };
        if (s.status === 'COMPLETED') return { id, status: 'completed', file: { id: `file-${id}` } };
        const missing: number[] = [];
        for (let n = 1; n <= s.partCount; n++) if (!s.stored.has(n)) missing.push(n);
        if (missing.length) return { id, status: 'missing-parts', missingParts: missing };
        s.status = 'COMPLETED';
        this.recorded.push(id);
        return { id, status: 'completed', file: { id: `file-${id}` } };
      });
      return { results };
    });
  }

  /** Mirrors the backend: UPLOADING/ABORTED → aborted (idempotent), a session
   *  being/already recorded → 409, unknown → 404. */
  async abort(id: string, signal: AbortSignal) {
    this.abortCalls.push(id);
    await this.api('abort', signal, () => {
      const s = this.sessions.get(id);
      if (!s) throw new TransportError('Upload not found.', 404);
      if (s.status === 'COMPLETING' || s.status === 'COMPLETED') {
        throw new TransportError('This upload is already finishing and can no longer be cancelled.', 409);
      }
      s.status = 'ABORTED';
      return {};
    });
  }
}

/** Virtual time (see the header). `frozen`: timers never fire (only aborts end them). */
/** `clock` is the MONOTONIC virtual time timers run on (a forward jump = the
 *  machine slept: timers come due at once, like a real browser on wake);
 *  `wallSkew` shifts only what now() reports — like the PC clock being set
 *  back or forward, which a real setTimeout ignores. */
export function makeEnv(server: FakeServer, opts: { frozen?: boolean } = {}): EngineEnv & { clock: number; wallSkew: number } {
  interface Timer {
    at: number;
    fire: () => void;
    done: boolean;
  }
  const timers: Timer[] = [];
  let driving = false;
  const env = {
    clock: 1_000_000,
    wallSkew: 0,
    now: () => env.clock + env.wallSkew,
    sleep: (ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        const t: Timer = { at: env.clock + ms, done: false, fire: () => undefined };
        const onAbort = () => t.fire();
        t.fire = () => {
          if (t.done) return;
          t.done = true;
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        timers.push(t);
        drive();
      }),
    random: () => 0.5,
    hash: async (source: UploadSource) => {
      await tick();
      return (source as FakeSource).sha;
    },
  };
  function drive() {
    if (driving || opts.frozen) return;
    driving = true;
    const step = () => {
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].done) timers.splice(i, 1);
      if (!timers.length) {
        driving = false;
        return;
      }
      const next = Math.min(...timers.map((t) => t.at));
      env.clock = server.pending === 0 ? Math.max(env.clock, next) : env.clock + 100;
      for (const t of [...timers]) if (t.at <= env.clock) t.fire();
      setImmediate(step);
    };
    setImmediate(step);
  }
  return env;
}

export class FakeSource implements UploadSource {
  readonly size: number;
  readonly sha: string;
  constructor(size: number, seed: string) {
    this.size = size;
    this.sha = Buffer.from(seed).toString('hex').padEnd(64, '0').slice(0, 64);
  }
  slice(start: number, end: number) {
    return { start, end, seed: this.sha.slice(0, 8) };
  }
}

export function item(name: string, size: number, extra: Partial<UploadItem> & { seed?: string } = {}): UploadItem {
  const { seed, ...rest } = extra;
  return { key: name, source: new FakeSource(size, seed ?? name), fileName: name, mimeType: 'application/pdf', folderId: null, ...rest };
}

export function setup(opts: { frozen?: boolean; engine?: ConstructorParameters<typeof UploadEngine>[2] } = {}) {
  const server = new FakeServer();
  const env = makeEnv(server, { frozen: opts.frozen });
  server.sleep = env.sleep;
  const engine = new UploadEngine(server, env, opts.engine);
  return { server, env, engine };
}

export function exactlyOnce(server: FakeServer) {
  for (const s of server.sessions.values()) {
    if (s.status !== 'COMPLETED') continue;
    for (let n = 1; n <= s.partCount; n++) {
      assert.equal(server.okPuts.get(`${s.id}:${n}`), 1, `${s.id} part ${n} stored exactly once`);
    }
  }
  assert.equal(new Set(server.recorded).size, server.recorded.length, 'each session recorded once');
}

export const statuses = (e: UploadEngine) => Object.fromEntries(e.snapshot().files.map((f) => [f.key, f.status]));
export const view = (e: UploadEngine, key: string) => e.snapshot().files.find((f) => f.key === key)!;

/** Wait (macrotask by macrotask) until `pred` holds. */
export async function until(pred: () => boolean, max = 20_000): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (pred()) return;
    await tick();
  }
  throw new Error('condition never became true');
}

/** Queue-level timers on the engine's (virtual) clock: set(fn, ms) → handle, clear(handle). */
export function makeTimers(env: EngineEnv) {
  return {
    set(fn: () => void, ms: number): AbortController {
      const c = new AbortController();
      void env.sleep(ms, c.signal).then(() => {
        if (!c.signal.aborted) fn();
      });
      return c;
    },
    clear(h: unknown): void {
      (h as AbortController).abort();
    },
  };
}
