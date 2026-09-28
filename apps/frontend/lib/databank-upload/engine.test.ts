import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompleteResult, InitResult, InitUploadFile, PartUrl } from './api-types.ts';
import { INIT_TIMEOUT_MS, MAX_PART_ATTEMPTS, STALL_MS, TransportError, UploadEngine } from './engine.ts';
import type { EngineEnv, UploadItem, UploadSource, UploadTransport } from './engine.ts';

/**
 * The upload engine against a FAKE server + R2 (plans parts, stores them, checks
 * them at complete, mirrors the backend's abort / 409 / 404 rules) with fault
 * injection: 403s, 404s, 5xx, drops, stalls, hangs, outages, garbage replies.
 * Time is VIRTUAL: while any fake request is in flight the clock moves 100 ms
 * per macrotask (so timeouts and stalls happen realistically); when nothing is
 * in flight it jumps straight to the next timer (so hour-long outages take
 * milliseconds). The invariant throughout: every part is stored exactly once per
 * session, every file is recorded exactly once.
 */

// ---- fakes ------------------------------------------------------------------

type Fault = 'ok' | 'hang' | 'slow' | number; // number = HTTP status (0 = network); slow = 8 s with no progress
type ApiFault = 'ok' | 'hang' | 'garbage' | number;

interface FakeSession {
  id: string;
  identity: string;
  size: number;
  partSize: number;
  partCount: number;
  stored: Map<number, number>; // partNumber -> bytes
  status: 'UPLOADING' | 'COMPLETING' | 'COMPLETED' | 'ABORTED';
}

const tick = () => new Promise<void>((r) => setImmediate(r));

function stopped(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new TransportError('aborted', 0));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

class FakeServer implements UploadTransport {
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

  /** Plan like the server, scaled down: ≤ 25 bytes SINGLE, else 10-byte parts. */
  plan(size: number) {
    return size <= 25 ? { partSize: size, partCount: 1 } : { partSize: 10, partCount: Math.ceil(size / 10) };
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

  async put(part: PartUrl, body: unknown, onProgress: (loaded: number) => void, signal: AbortSignal) {
    const [, , , id, n] = part.url.split('/');
    const partNumber = Number(n);
    const key = `${id}:${partNumber}`;
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
      if (fault === 'slow') await this.sleep(8000, signal); // e.g. a slow TLS start: no progress yet
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
function makeEnv(server: FakeServer, opts: { frozen?: boolean } = {}): EngineEnv & { clock: number } {
  interface Timer {
    at: number;
    fire: () => void;
    done: boolean;
  }
  const timers: Timer[] = [];
  let driving = false;
  const env = {
    clock: 1_000_000,
    now: () => env.clock,
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

class FakeSource implements UploadSource {
  readonly size: number;
  readonly sha: string;
  constructor(size: number, seed: string) {
    this.size = size;
    this.sha = Buffer.from(seed).toString('hex').padEnd(64, '0').slice(0, 64);
  }
  slice(start: number, end: number) {
    return { start, end };
  }
}

function item(name: string, size: number, extra: Partial<UploadItem> & { seed?: string } = {}): UploadItem {
  const { seed, ...rest } = extra;
  return { key: name, source: new FakeSource(size, seed ?? name), fileName: name, mimeType: 'application/pdf', folderId: null, ...rest };
}

function setup(opts: { frozen?: boolean; engine?: ConstructorParameters<typeof UploadEngine>[2] } = {}) {
  const server = new FakeServer();
  const env = makeEnv(server, { frozen: opts.frozen });
  server.sleep = env.sleep;
  const engine = new UploadEngine(server, env, opts.engine);
  return { server, env, engine };
}

function exactlyOnce(server: FakeServer) {
  for (const s of server.sessions.values()) {
    if (s.status !== 'COMPLETED') continue;
    for (let n = 1; n <= s.partCount; n++) {
      assert.equal(server.okPuts.get(`${s.id}:${n}`), 1, `${s.id} part ${n} stored exactly once`);
    }
  }
  assert.equal(new Set(server.recorded).size, server.recorded.length, 'each session recorded once');
}

const statuses = (e: UploadEngine) => Object.fromEntries(e.snapshot().files.map((f) => [f.key, f.status]));
const view = (e: UploadEngine, key: string) => e.snapshot().files.find((f) => f.key === key)!;

/** Wait (macrotask by macrotask) until `pred` holds. */
async function until(pred: () => boolean, max = 20_000): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (pred()) return;
    await tick();
  }
  throw new Error('condition never became true');
}

// ---- the basics -------------------------------------------------------------

test('happy path: single-PUT and multipart files all land, every part exactly once', async () => {
  const { server, engine } = setup();
  engine.add([item('a.pdf', 7), item('b.zip', 95), item('c.mov', 250)]);
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'a.pdf': 'done', 'b.zip': 'done', 'c.mov': 'done' });
  assert.equal(server.recorded.length, 3);
  exactlyOnce(server);
  for (const f of engine.snapshot().files) assert.equal(f.bytesDone, f.size);
  assert.ok(server.maxInFlight <= 6, `never more than 6 parts at once (saw ${server.maxInFlight})`);
});

test('drops + 5xx + throttling while the link is up: retried with backoff, every part lands once', async () => {
  const { server, engine } = setup();
  let n = 0;
  server.fault = ({ attempt }) => (attempt === 1 && n++ % 3 === 0 ? [0, 500, 503, 429][n % 4] : 'ok');
  engine.add([item('big.bin', 400), item('small.txt', 3)]);
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'big.bin': 'done', 'small.txt': 'done' });
  assert.ok(server.putAttempts > 41, 'some PUTs were retried');
  exactlyOnce(server);
});

test('an expired/refused URL (403) is re-signed and the part retried', async () => {
  const { server, engine } = setup();
  server.fault = ({ part, attempt }) => (part === 2 && attempt === 1 ? 403 : 'ok');
  engine.add([item('x.bin', 60)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['x.bin'], 'done');
  assert.ok(server.signCalls.some((c) => c.parts[0] === 2), 'part 2 was re-signed');
  exactlyOnce(server);
});

test('a 403 that never clears fails the file (no infinite re-sign loop)', async () => {
  const { server, engine } = setup();
  server.fault = ({ part }) => (part === 1 ? 403 : 'ok');
  engine.add([item('x.bin', 60)]);
  await engine.whenIdle();
  const f = view(engine, 'x.bin');
  assert.equal(f.status, 'failed');
  assert.match(f.error!, /403/);
  assert.ok(server.signCalls.length <= 5);
});

test('a stalled PUT (no progress for 60 s) is aborted and retried', async () => {
  const { server, env, engine } = setup();
  server.fault = ({ part, attempt }) => (part === 1 && attempt === 1 ? 'hang' : 'ok');
  const start = env.clock;
  engine.add([item('s.bin', 30)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['s.bin'], 'done');
  assert.ok(env.clock - start >= STALL_MS, 'waited out the stall window');
  assert.equal(server.attempts.get('s1:1'), 2);
  exactlyOnce(server);
});

test('resume: parts storage already holds are never sent again', async () => {
  const { server, engine } = setup();
  const src = item('resume.bin', 55);
  const first = await server.init(
    [{ fileName: 'resume.bin', mimeType: 'x', sizeBytes: 55, sha256: (src.source as FakeSource).sha, folderId: null }],
    new AbortController().signal,
  );
  const sid = (first as { results: Array<{ uploadId: string }> }).results[0].uploadId;
  for (const n of [1, 2, 3]) server.sessions.get(sid)!.stored.set(n, 10);
  engine.add([src]);
  await engine.whenIdle();
  const f = view(engine, 'resume.bin');
  assert.equal(f.status, 'done');
  assert.equal(f.resumed, true);
  for (const n of [1, 2, 3]) assert.equal(server.attempts.get(`${sid}:${n}`), undefined, `part ${n} not re-sent`);
  assert.deepEqual([4, 5, 6].map((n) => server.okPuts.get(`${sid}:${n}`)), [1, 1, 1]);
});

test('pause aborts in-flight parts and sends nothing until resume; then finishes', async () => {
  const { server, engine } = setup({ frozen: true });
  let paused = false;
  let hang = true;
  let putsWhilePaused = 0;
  server.fault = () => {
    if (paused) putsWhilePaused += 1;
    return hang ? 'hang' : 'ok';
  };
  engine.add([item('p.bin', 200)]);
  await until(() => server.inFlight >= 4);
  engine.pause();
  paused = true;
  await engine.whenIdle();
  assert.equal(putsWhilePaused, 0, 'no PUT starts while paused');
  assert.equal(engine.snapshot().paused, true);
  assert.equal(statuses(engine)['p.bin'], 'uploading');
  paused = false;
  hang = false;
  engine.resume();
  await engine.whenIdle();
  assert.equal(statuses(engine)['p.bin'], 'done');
  exactlyOnce(server);
});

test('cancel an uploading file: stops it and frees its server session', async () => {
  const { server, engine } = setup({ frozen: true });
  server.fault = () => 'hang';
  engine.add([item('c.bin', 200)]);
  await until(() => server.inFlight > 0);
  const sid = view(engine, 'c.bin').uploadId!;
  await engine.cancel('c.bin');
  await engine.whenIdle();
  assert.equal(statuses(engine)['c.bin'], 'cancelled');
  assert.deepEqual(server.abortCalls, [sid]);
  assert.equal(server.sessions.get(sid)!.status, 'ABORTED');
  assert.equal(server.inFlight, 0);
});

test('duplicate elsewhere → needs a decision; "upload anyway" re-inits with allowDuplicate', async () => {
  const { server, engine } = setup();
  const existing = { id: 'f9', fileName: 'dup.pdf', folderId: 'other', folderName: 'Other', createdAt: '2026-01-01T00:00:00Z' };
  server.initOverride = (f, index) => (f.allowDuplicate ? null : { index, status: 'duplicate', existing });
  engine.add([item('dup.pdf', 12)]);
  await engine.whenIdle();
  assert.equal(view(engine, 'dup.pdf').status, 'needs-decision');
  assert.deepEqual(view(engine, 'dup.pdf').existing, existing);
  engine.resolveDuplicate('dup.pdf', 'upload');
  await engine.whenIdle();
  assert.equal(view(engine, 'dup.pdf').status, 'done');
  assert.equal(server.initCalls.at(-1)![0].allowDuplicate, true);
});

test('"skip" a duplicate, and an identical file already in place is skipped with no PUT', async () => {
  const { server, engine } = setup();
  const existing = { id: 'f1', fileName: 'a', folderId: null, folderName: null, createdAt: '2026-01-01T00:00:00Z' };
  server.initOverride = (f, index) =>
    f.fileName === 'same.pdf' ? { index, status: 'already-uploaded', existing } : { index, status: 'possible-duplicate', existing };
  engine.add([item('same.pdf', 12), item('maybe.pdf', 12)]);
  await engine.whenIdle();
  engine.resolveDuplicate('maybe.pdf', 'skip');
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'same.pdf': 'skipped', 'maybe.pdf': 'skipped' });
  assert.equal(server.putAttempts, 0);
});

test('complete reports missing parts → only those are re-sent, then it completes', async () => {
  const { server, engine } = setup();
  let lost = false;
  server.completeOverride = (id) => {
    if (lost) return null;
    lost = true;
    server.sessions.get(id)!.stored.delete(3);
    server.okPuts.delete(`${id}:3`);
    return { id, status: 'missing-parts', missingParts: [3] };
  };
  engine.add([item('m.bin', 45)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['m.bin'], 'done');
  assert.equal(server.attempts.get('s1:3'), 2);
  assert.equal(server.attempts.get('s1:1'), 1);
  exactlyOnce(server);
});

test('session gone from storage (404 on PUT) → a fresh session is opened and the file lands', async () => {
  const { server, engine } = setup();
  server.fault = ({ session }) => {
    if (session === 's1') {
      server.sessions.get('s1')!.status = 'ABORTED';
      return 404;
    }
    return 'ok';
  };
  engine.add([item('g.bin', 40)]);
  await engine.whenIdle();
  const f = view(engine, 'g.bin');
  assert.equal(f.status, 'done');
  assert.equal(f.uploadId, 's2', 'finished on the NEW session');
  assert.deepEqual(server.recorded, ['s2']);
});

test('dev storage (proxy mode) hands files back for the legacy upload', async () => {
  const { server, engine } = setup();
  server.mode = 'proxy';
  engine.add([item('d.pdf', 10)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['d.pdf'], 'fallback');
});

test('a fatal PUT error fails the file (confirmed bytes kept); Retry resumes without re-sending them', async () => {
  const { server, engine } = setup();
  server.fault = ({ part, attempt }) => (part === 4 && attempt === 1 ? 400 : 'ok');
  engine.add([item('f.bin', 50)]);
  await engine.whenIdle();
  const failed = view(engine, 'f.bin');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.retryable, true);
  assert.ok(failed.bytesDone > 0, '[review] storage keeps the parts — so does the row');
  engine.retryFailed();
  await engine.whenIdle();
  const f = view(engine, 'f.bin');
  assert.equal(f.status, 'done');
  assert.equal(f.resumed, true);
  exactlyOnce(server);
});

test('a part that fails while OTHER uploads get through stops after MAX_PART_ATTEMPTS', async () => {
  const { server, engine } = setup();
  let dead = true;
  // k.bin part 2 keeps dropping; big.bin (uploading alongside) proves the link is up.
  server.fault = ({ session, part }) => (dead && session === 's1' && part === 2 ? 0 : 'ok');
  engine.add([item('k.bin', 30), item('big.bin', 3000)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['k.bin'], 'failed');
  assert.equal(statuses(engine)['big.bin'], 'done');
  assert.ok(server.attempts.get('s1:2')! >= MAX_PART_ATTEMPTS);
  dead = false;
  engine.retry('k.bin');
  await engine.whenIdle();
  assert.equal(statuses(engine)['k.bin'], 'done');
  assert.equal(server.attempts.get('s1:1'), 1, 'part 1 not re-sent after the retry');
});

test('rejected by the server (e.g. blocked type) fails without a Retry option', async () => {
  const { server, engine } = setup();
  server.initOverride = (_f, index) => ({ index, status: 'rejected', reason: 'Files of type .exe are not allowed.' });
  engine.add([item('x.exe', 10)]);
  await engine.whenIdle();
  const f = view(engine, 'x.exe');
  assert.equal(f.status, 'failed');
  assert.equal(f.retryable, false);
  assert.match(f.error!, /exe/);
});

test('server still assembling (in-progress) is polled until it completes', async () => {
  const { server, engine } = setup();
  server.completeOverride = (id, call) => (call < 4 ? { id, status: 'in-progress' } : null);
  engine.add([item('i.bin', 80)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['i.bin'], 'done');
  assert.equal(server.completeCalls.length, 4);
});

test('batches: 120 files → init and complete calls of at most 50', async () => {
  const { server, engine } = setup({ engine: { readyAhead: 200 } });
  engine.add(Array.from({ length: 120 }, (_, i) => item(`f${i}.txt`, 5)));
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((s) => s === 'done'));
  assert.ok(server.initCalls.every((c) => c.length <= 50));
  assert.ok(server.completeCalls.every((c) => c.length <= 50));
  assert.equal(server.recorded.length, 120);
  exactlyOnce(server);
});

test('adaptive slots: halve on trouble (never below 2), grow after a run of successes (never above 6)', async () => {
  const { server, engine } = setup();
  let failures = 4;
  server.fault = () => (failures-- > 0 ? 503 : 'ok');
  const seen: number[] = [];
  engine.subscribe(() => seen.push(engine.snapshot().slots));
  engine.add([item('a.bin', 1000)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['a.bin'], 'done');
  assert.equal(Math.min(...seen), 2);
  assert.equal(Math.max(...seen), 6);
  assert.ok(server.maxInFlight <= 6);
  exactlyOnce(server);
});

test('the same queue key twice is queued once; a failed key dropped again is retried', async () => {
  const { server, engine } = setup();
  server.fault = ({ attempt }) => (attempt === 1 ? 400 : 'ok');
  engine.add([item('twice.pdf', 12)]);
  engine.add([item('twice.pdf', 12)]);
  await engine.whenIdle();
  assert.equal(engine.snapshot().files.length, 1);
  assert.equal(statuses(engine)['twice.pdf'], 'failed');
  engine.add([item('twice.pdf', 12)]); // [review] re-dropping a failed file retries it
  await engine.whenIdle();
  assert.equal(statuses(engine)['twice.pdf'], 'done');
  assert.equal(server.recorded.length, 1);
});

test('a file that cannot be read fails with a clear, retryable message', async () => {
  const { server, env, engine } = setup();
  env.hash = async () => {
    throw new Error('NotReadableError');
  };
  engine.add([item('gone.pdf', 12)]);
  await engine.whenIdle();
  const f = view(engine, 'gone.pdf');
  assert.equal(f.status, 'failed');
  assert.match(f.error!, /Could not read this file/);
  assert.equal(server.initCalls.length, 0);
});

test('a part cooling down after a drop keeps the file from completing early', async () => {
  const { server, engine } = setup();
  server.fault = ({ part, attempt }) => (part === 3 && attempt === 1 ? 0 : 'ok');
  engine.add([item('cool.bin', 30)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['cool.bin'], 'done');
  assert.equal(server.completeCalls.length, 1, 'complete only once every part is stored');
  exactlyOnce(server);
});

test('no signing retries while paused; resume picks the file back up', async () => {
  const { server, engine } = setup();
  let down = true;
  server.apiFault = (method) => (method === 'sign' && down ? 0 : 'ok');
  const realSign = server.signParts.bind(server);
  server.signParts = (id, parts, signal) => {
    if (down) engine.pause(); // the officer pauses while the link is down
    return realSign(id, parts, signal);
  };
  engine.add([item('sign.bin', 250)]); // 25 parts: init signs 16, the rest need /parts
  await engine.whenIdle();
  assert.equal(engine.snapshot().paused, true);
  assert.equal(server.signCalls.length, 1, 'no sign retries burned while paused');
  assert.equal(statuses(engine)['sign.bin'], 'uploading');
  down = false;
  engine.resume();
  await engine.whenIdle();
  assert.equal(statuses(engine)['sign.bin'], 'done');
  exactlyOnce(server);
});

// ---- review round 1: outages --------------------------------------------------

test('[review] a 10-minute outage (nothing gets through) fails NOTHING: everything waits, then finishes', async () => {
  const { server, env, engine } = setup();
  let outageFrom = Infinity;
  const outageFor = 10 * 60_000;
  const down = () => env.clock >= outageFrom && env.clock < outageFrom + outageFor;
  server.fault = () => (down() ? 0 : 'ok');
  server.apiFault = () => (down() ? 0 : 'ok');
  let sawLinkDown = false;
  engine.subscribe(() => {
    if (engine.snapshot().linkDown) sawLinkDown = true;
  });
  engine.add([item('a.bin', 500), item('b.bin', 300), item('c.pdf', 9)]);
  await until(() => server.okPuts.size >= 5);
  outageFrom = env.clock; // the power goes out mid-upload
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'a.bin': 'done', 'b.bin': 'done', 'c.pdf': 'done' });
  assert.ok(env.clock >= outageFrom + outageFor, 'it really waited the outage out');
  assert.ok(sawLinkDown, 'the dock can show "waiting for the network"');
  exactlyOnce(server);
});

test('[review] an init outage with 120 queued files: none fail, all land once the API is back', async () => {
  const { server, env, engine } = setup();
  const until10min = env.clock + 10 * 60_000;
  server.apiFault = (method) => (method === 'init' && env.clock < until10min ? 503 : 'ok');
  engine.add(Array.from({ length: 120 }, (_, i) => item(`f${i}.txt`, 5)));
  await engine.whenIdle();
  const s = Object.values(statuses(engine));
  assert.equal(s.filter((x) => x === 'failed').length, 0);
  assert.equal(s.filter((x) => x === 'done').length, 120);
});

test('[review] an outage longer than the give-up window does fail the files (bounded), and Retry works', async () => {
  const { server, env, engine } = setup({ engine: { giveUpMs: 5 * 60_000 } });
  let dead = true;
  server.fault = () => (dead ? 0 : 'ok');
  engine.add([item('long.bin', 40)]);
  const start = env.clock;
  await engine.whenIdle();
  const f = view(engine, 'long.bin');
  assert.equal(f.status, 'failed');
  assert.equal(f.retryable, true);
  assert.ok(env.clock - start >= 5 * 60_000);
  dead = false;
  engine.retryFailed();
  await engine.whenIdle();
  assert.equal(statuses(engine)['long.bin'], 'done');
});

test('[review] the browser going offline halts everything at once; back online, it finishes', async () => {
  const { server, engine } = setup({ frozen: true });
  let hang = true;
  server.fault = () => (hang ? 'hang' : 'ok');
  engine.add([item('o.bin', 200)]);
  await until(() => server.inFlight >= 4);
  engine.setOnline(false);
  await engine.whenIdle();
  const before = server.putAttempts;
  assert.equal(engine.snapshot().offline, true);
  assert.equal(server.inFlight, 0, 'in-flight PUTs were aborted');
  hang = false;
  engine.setOnline(true);
  await engine.whenIdle();
  assert.equal(statuses(engine)['o.bin'], 'done');
  assert.ok(server.putAttempts > before);
  exactlyOnce(server);
});

// ---- review round 1: cancel ----------------------------------------------------

test('[review] cancel while the server is already recording the file → ends DONE with a note, not "cancelled"', async () => {
  const { server, engine } = setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const realComplete = server.complete.bind(server);
  server.complete = async (ids, signal) => {
    if (server.completeCalls.length === 0) {
      for (const id of ids) server.sessions.get(id)!.status = 'COMPLETING'; // the server claims it…
      server.completeCalls.push(ids);
      await gate; // …and is still assembling when the officer hits Cancel
      for (const id of ids) {
        server.sessions.get(id)!.status = 'COMPLETED';
        server.recorded.push(id);
      }
      return { results: ids.map((id) => ({ id, status: 'completed' as const, file: { id: `file-${id}` } })) };
    }
    return realComplete(ids, signal);
  };
  engine.add([item('late.pdf', 40)]);
  await until(() => view(engine, 'late.pdf').status === 'completing' && server.completeCalls.length === 1);
  const cancelling = engine.cancel('late.pdf');
  await cancelling;
  release();
  await engine.whenIdle();
  const f = view(engine, 'late.pdf');
  assert.equal(f.status, 'done');
  assert.match(f.note!, /could not be cancelled/);
  assert.deepEqual(server.abortCalls, ['s1']);
  assert.deepEqual(server.recorded, ['s1']);
});

test('[review] cancel of a session the server no longer knows (404) still cancels', async () => {
  const { server, engine } = setup({ frozen: true });
  server.fault = () => 'hang';
  engine.add([item('lost.bin', 200)]);
  await until(() => server.inFlight > 0);
  server.sessions.clear();
  await engine.cancel('lost.bin');
  await engine.whenIdle();
  assert.equal(statuses(engine)['lost.bin'], 'cancelled');
});

test('[review] cancel during a server "retry" wait: whenIdle still resolves (no stranded wake-up)', async () => {
  const { server, engine } = setup();
  server.completeOverride = (id) => ({ id, status: 'retry', reason: 'busy' });
  engine.add([item('w.bin', 40)]);
  await until(() => server.completeCalls.length >= 1);
  await engine.cancel('w.bin');
  await engine.whenIdle();
  assert.equal(statuses(engine)['w.bin'], 'cancelled');
});

test('[review] a file that failed after an "in-progress" init keeps its session, so Cancel frees it', async () => {
  const { server, engine } = setup();
  server.sessions.set('sX', { id: 'sX', identity: 'x', size: 40, partSize: 10, partCount: 4, stored: new Map(), status: 'UPLOADING' });
  server.initOverride = (_f, index) => ({ index, status: 'in-progress', uploadId: 'sX' });
  server.completeOverride = (id) => ({ id, status: 'failed', reason: 'did not match' });
  engine.add([item('ip.bin', 40)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['ip.bin'], 'failed');
  assert.equal(view(engine, 'ip.bin').uploadId, 'sX');
  await engine.cancel('ip.bin');
  assert.deepEqual(server.abortCalls, ['sX']);
});

test('cancelling a FAILED file frees the session it kept for a retry', async () => {
  const { server, engine } = setup();
  server.fault = ({ part }) => (part === 2 ? 400 : 'ok');
  engine.add([item('broken-part.bin', 30)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['broken-part.bin'], 'failed');
  await engine.cancel('broken-part.bin');
  assert.equal(statuses(engine)['broken-part.bin'], 'cancelled');
  assert.deepEqual(server.abortCalls, ['s1']);
});

// ---- review round 1: timeouts, garbage, batches, twins --------------------------

test('[review] a black-holed init / complete times out and is retried, instead of freezing the queue', async () => {
  const { server, env, engine } = setup();
  server.apiFault = (method, call) => ((method === 'init' || method === 'complete') && call === 1 ? 'hang' : 'ok');
  const start = env.clock;
  engine.add([item('t.bin', 40)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['t.bin'], 'done');
  assert.ok(env.clock - start >= INIT_TIMEOUT_MS);
  assert.equal(server.calls.init, 2);
  assert.equal(server.calls.complete, 2);
});

test('[review] unreadable 2xx replies (init null, sign/complete {}) are retried, never stranding a file', async () => {
  const { server, engine } = setup();
  server.apiFault = (method, call) => (call === 1 ? 'garbage' : 'ok');
  engine.add([item('g1.bin', 250), item('g2.pdf', 8)]); // g1 needs /parts (25 parts)
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'g1.bin': 'done', 'g2.pdf': 'done' });
  exactlyOnce(server);
});

test('[review] one file the server rejects (400) does not fail the rest of its batch', async () => {
  const { server, engine } = setup();
  engine.add([item('ok1.pdf', 8), item('bad name.pdf', 8), item('ok2.pdf', 8)]);
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'ok1.pdf': 'done', 'bad name.pdf': 'failed', 'ok2.pdf': 'done' });
  assert.equal(view(engine, 'bad name.pdf').retryable, false);
});

test('[review] fields the server would 400 are fixed or checked locally', async () => {
  const { server, engine } = setup();
  engine.add([
    item('lm.pdf', 8, { lastModified: Number.NaN, relativePath: `${'d/'.repeat(600)}lm.pdf` }),
    item(`${'n'.repeat(256)}.pdf`, 8),
  ]);
  await engine.whenIdle();
  const sent = server.initCalls.flat();
  const lm = sent.find((f) => f.fileName === 'lm.pdf')!;
  assert.equal('lastModified' in lm, false, 'invalid lastModified dropped');
  assert.equal('relativePath' in lm, false, 'over-long relativePath dropped');
  assert.equal(statuses(engine)['lm.pdf'], 'done');
  assert.equal(statuses(engine)[`${'n'.repeat(256)}.pdf`], 'failed');
  assert.ok(!sent.some((f) => f.fileName.startsWith('nnnn')), 'the over-long name never reached the server');
});

test('[review] the same file twice in one drop (different keys) is uploaded once; the copy is skipped', async () => {
  const { server, engine } = setup();
  engine.add([
    item('scan.pdf', 60, { key: 'Passport/scan.pdf', seed: 'SAME' }),
    item('scan.pdf', 60, { key: 'Copy/scan.pdf', seed: 'SAME', lastModified: 2 }),
  ]);
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'Passport/scan.pdf': 'done', 'Copy/scan.pdf': 'skipped' });
  assert.equal(view(engine, 'Copy/scan.pdf').duplicateKind, 'same-drop');
  assert.equal(server.sessions.size, 1);
  exactlyOnce(server);
});

test('[review] a slow signParts (58 s) never makes the PUT that follows look stalled', async () => {
  const { server, env, engine } = setup();
  const realSign = server.signParts.bind(server);
  server.signParts = async (id, parts, signal) => {
    await env.sleep(58_000, signal); // just under the 60 s sign timeout
    return realSign(id, parts, signal);
  };
  // …and each of those PUTs then shows no progress for its first 8 s. Counting
  // the signing time, that is > 60 s "without progress" — a false stall.
  server.fault = ({ part }) => (part >= 17 ? 'slow' : 'ok');
  engine.add([item('slow.bin', 250)]); // parts 17–25 need /parts
  await engine.whenIdle();
  assert.equal(statuses(engine)['slow.bin'], 'done');
  for (let n = 17; n <= 25; n++) assert.equal(server.attempts.get(`s1:${n}`), 1, `part ${n}: one attempt`);
});

test('no complete answer for a file → asked again, not stuck', async () => {
  const { server, engine } = setup();
  const realComplete = server.complete.bind(server);
  let calls = 0;
  server.complete = async (ids, signal) => (++calls === 1 ? { results: [] } : realComplete(ids, signal));
  engine.add([item('quiet.bin', 12)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['quiet.bin'], 'done');
  assert.equal(calls, 2);
});

test('an init answer that never comes fails the file after bounded follow-ups', async () => {
  const { server, engine } = setup();
  server.init = async () => {
    server.calls.init += 1;
    await tick();
    return { mode: 'direct' as const, maxBytes: 1e12, results: [] };
  };
  engine.add([item('mute.bin', 12)]);
  await engine.whenIdle();
  const f = view(engine, 'mute.bin');
  assert.equal(f.status, 'failed');
  assert.equal(f.error, 'No answer from the server.');
  assert.ok(server.calls.init > 1 && server.calls.init <= 41, `bounded (${server.calls.init} calls)`);
});
