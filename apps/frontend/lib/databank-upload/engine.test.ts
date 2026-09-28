import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompleteResult, InitResult, InitUploadFile, PartUrl } from './api-types.ts';
import { MAX_PART_ATTEMPTS, STALL_MS, TransportError, UploadEngine } from './engine.ts';
import type { EngineEnv, UploadItem, UploadSource, UploadTransport } from './engine.ts';

/**
 * The upload engine against a FAKE server + R2 (plans parts, stores them, checks
 * them at complete) with fault injection: 403s, 404s, 5xx, network drops,
 * stalls. The invariant in every test: each part is stored exactly once per
 * session and each file is recorded exactly once.
 */

// ---- fakes ------------------------------------------------------------------

type Fault = 'ok' | 'hang' | number; // number = HTTP status to fail with (0 = network)

interface FakeSession {
  id: string;
  identity: string;
  size: number;
  partSize: number;
  partCount: number;
  stored: Map<number, number>; // partNumber -> bytes
  status: 'UPLOADING' | 'COMPLETED' | 'ABORTED';
}

class FakeServer implements UploadTransport {
  sessions = new Map<string, FakeSession>();
  recorded: string[] = []; // session ids recorded as files
  initCalls: InitUploadFile[][] = [];
  signCalls: Array<{ id: string; parts: number[] }> = [];
  completeCalls: string[][] = [];
  aborted: string[] = [];
  /** Successful PUTs per `${session}:${part}`. */
  okPuts = new Map<string, number>();
  putAttempts = 0;
  inFlight = 0;
  maxInFlight = 0;
  seq = 0;
  /** Decide each PUT's fate. */
  fault: (ctx: { session: string; part: number; attempt: number }) => Fault = () => 'ok';
  /** Per-file init override (by fileName). */
  initOverride: (f: InitUploadFile, index: number) => InitResult | null = () => null;
  completeOverride: (id: string, call: number) => CompleteResult | null = () => null;
  mode: 'direct' | 'proxy' = 'direct';
  attempts = new Map<string, number>();
  /** Plan like the server, scaled down: ≤ 25 bytes SINGLE, else 10-byte parts. */
  plan(size: number) {
    return size <= 25 ? { partSize: size, partCount: 1 } : { partSize: 10, partCount: Math.ceil(size / 10) };
  }

  async init(files: InitUploadFile[]) {
    this.initCalls.push(files);
    await tick();
    if (this.mode === 'proxy') return { mode: 'proxy' as const };
    const results: InitResult[] = files.map((f, index) => {
      const o = this.initOverride(f, index);
      if (o) return o;
      const identity = `${f.folderId}|${f.fileName}|${f.sha256}`;
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
  }

  url(id: string, n: number): PartUrl {
    return { partNumber: n, url: `https://r2/${id}/${n}`, headers: { 'x-test': '1' } };
  }

  async signParts(id: string, parts: number[]) {
    this.signCalls.push({ id, parts });
    await tick();
    const s = this.sessions.get(id);
    if (!s) throw new TransportError('Upload not found.', 404);
    if (s.status !== 'UPLOADING') throw new TransportError(`This upload is ${s.status.toLowerCase()}.`, 409);
    return { parts: parts.map((n) => this.url(id, n)), urlsExpireAt: new Date(Date.now() + 6 * 3600_000).toISOString() };
  }

  async put(part: PartUrl, body: unknown, onProgress: (loaded: number) => void, signal: AbortSignal) {
    const [, , , id, n] = part.url.split('/');
    const partNumber = Number(n);
    const key = `${id}:${partNumber}`;
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    this.putAttempts += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      assert.equal(part.headers?.['x-test'], '1', 'headers from the presign are sent');
      const { start, end } = body as { start: number; end: number };
      const fault = this.fault({ session: id, part: partNumber, attempt });
      if (fault === 'hang') {
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new TransportError('aborted', 0))));
      }
      await tick();
      if (signal.aborted) throw new TransportError('aborted', 0);
      if (typeof fault === 'number') throw new TransportError(`PUT failed (${fault})`, fault);
      const s = this.sessions.get(id);
      if (!s || s.status !== 'UPLOADING') throw new TransportError('NoSuchUpload', 404);
      const expected = Math.min(s.partSize, s.size - (partNumber - 1) * s.partSize);
      assert.equal(end - start, expected, `part ${partNumber} has the planned size`);
      onProgress(end - start);
      s.stored.set(partNumber, end - start);
      this.okPuts.set(key, (this.okPuts.get(key) ?? 0) + 1);
    } finally {
      this.inFlight -= 1;
    }
  }

  async complete(ids: string[]) {
    this.completeCalls.push(ids);
    await tick();
    const call = this.completeCalls.length;
    const results: CompleteResult[] = ids.map((id) => {
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
  }

  async abort(id: string) {
    this.aborted.push(id);
    const s = this.sessions.get(id);
    if (s) s.status = 'ABORTED';
  }
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/** Wait (macrotask by macrotask) until `pred` holds — deterministic, unlike a timer. */
async function until(pred: () => boolean, max = 10_000): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (pred()) return;
    await tick();
  }
  throw new Error('condition never became true');
}

/** Virtual time: sleep() advances the clock instead of waiting. */
function makeEnv(opts: { advance?: boolean } = {}): EngineEnv & { clock: number } {
  const env = {
    clock: 1_000_000,
    now: () => env.clock,
    sleep: (ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        if (opts.advance !== false) env.clock += ms;
        setImmediate(resolve);
      }),
    random: () => 0.5,
    hash: async (source: UploadSource) => {
      await tick();
      return (source as FakeSource).sha;
    },
  };
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

function item(name: string, size: number, folderId: string | null = null): UploadItem {
  return { key: name, source: new FakeSource(size, name), fileName: name, mimeType: 'application/pdf', folderId };
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

// ---- tests ------------------------------------------------------------------

test('happy path: single-PUT and multipart files all land, every part exactly once', async () => {
  const server = new FakeServer();
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('a.pdf', 7), item('b.zip', 95), item('c.mov', 250)]);
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'a.pdf': 'done', 'b.zip': 'done', 'c.mov': 'done' });
  assert.equal(server.recorded.length, 3);
  exactlyOnce(server);
  for (const f of engine.snapshot().files) assert.equal(f.bytesDone, f.size);
  assert.ok(server.maxInFlight <= 6, `never more than 6 parts at once (saw ${server.maxInFlight})`);
});

test('network drops + 5xx + throttling: retried with backoff until every part lands once', async () => {
  const server = new FakeServer();
  let n = 0;
  server.fault = ({ attempt }) => (attempt === 1 && n++ % 3 === 0 ? [0, 500, 503, 429][n % 4] : 'ok');
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('big.bin', 400), item('small.txt', 3)]);
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'big.bin': 'done', 'small.txt': 'done' });
  assert.ok(server.putAttempts > 41, 'some PUTs were retried');
  exactlyOnce(server);
});

test('an expired/refused URL (403) is re-signed and the part retried', async () => {
  const server = new FakeServer();
  server.fault = ({ part, attempt }) => (part === 2 && attempt === 1 ? 403 : 'ok');
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('x.bin', 60)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['x.bin'], 'done');
  assert.ok(server.signCalls.some((c) => c.parts[0] === 2), 'part 2 was re-signed');
  exactlyOnce(server);
});

test('403 that never clears fails the file (no infinite re-sign loop)', async () => {
  const server = new FakeServer();
  server.fault = ({ part }) => (part === 1 ? 403 : 'ok');
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('x.bin', 60)]);
  await engine.whenIdle();
  const f = engine.snapshot().files[0];
  assert.equal(f.status, 'failed');
  assert.match(f.error!, /403/);
  assert.ok(server.signCalls.length <= 5);
});

test('a stalled PUT (no progress for 60 s) is aborted and retried', async () => {
  const server = new FakeServer();
  server.fault = ({ part, attempt }) => (part === 1 && attempt === 1 ? 'hang' : 'ok');
  const env = makeEnv();
  const engine = new UploadEngine(server, env);
  const start = env.clock;
  engine.add([item('s.bin', 30)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['s.bin'], 'done');
  assert.ok(env.clock - start >= STALL_MS, 'waited out the stall window');
  assert.equal(server.attempts.get('s1:1'), 2);
  exactlyOnce(server);
});

test('resume: parts storage already holds are never sent again', async () => {
  const server = new FakeServer();
  // A previous tab uploaded parts 1–3 of this file, then the laptop slept.
  const src = item('resume.bin', 55);
  const first = await server.init([{ fileName: 'resume.bin', mimeType: 'x', sizeBytes: 55, sha256: (src.source as FakeSource).sha, folderId: null }]);
  const sid = (first as { results: Array<{ uploadId: string }> }).results[0].uploadId;
  for (const n of [1, 2, 3]) server.sessions.get(sid)!.stored.set(n, 10);

  const engine = new UploadEngine(server, makeEnv());
  engine.add([src]);
  await engine.whenIdle();
  const f = engine.snapshot().files[0];
  assert.equal(f.status, 'done');
  assert.equal(f.resumed, true);
  for (const n of [1, 2, 3]) assert.equal(server.attempts.get(`${sid}:${n}`), undefined, `part ${n} not re-sent`);
  assert.deepEqual([4, 5, 6].map((n) => server.okPuts.get(`${sid}:${n}`)), [1, 1, 1]);
});

test('pause aborts in-flight parts and sends nothing until resume; then finishes', async () => {
  const server = new FakeServer();
  // Frozen clock: the hung first attempts must end by PAUSE, not by the stall watchdog.
  const engine = new UploadEngine(server, makeEnv({ advance: false }));
  let paused = false;
  let hang = true; // until the pause, every PUT hangs (so the pause has live PUTs to abort)
  let putsWhilePaused = 0;
  server.fault = () => {
    if (paused) putsWhilePaused += 1;
    return hang ? 'hang' : 'ok';
  };
  engine.add([item('p.bin', 200)]);
  await until(() => server.inFlight >= 4); // four PUTs hanging mid-air
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

test('cancel stops the file and frees its server session', async () => {
  const server = new FakeServer();
  server.fault = () => 'hang';
  const engine = new UploadEngine(server, makeEnv({ advance: false }));
  engine.add([item('c.bin', 200)]);
  await until(() => server.inFlight > 0);
  const sid = engine.snapshot().files[0].uploadId!;
  assert.ok(sid);
  await engine.cancel('c.bin');
  await engine.whenIdle(); // the hung PUTs were aborted, nothing left running
  assert.equal(statuses(engine)['c.bin'], 'cancelled');
  assert.deepEqual(server.aborted, [sid]);
  assert.equal(server.inFlight, 0);
});

test('duplicate elsewhere → needs a decision; "upload anyway" re-inits with allowDuplicate', async () => {
  const server = new FakeServer();
  const existing = { id: 'f9', fileName: 'dup.pdf', folderId: 'other', folderName: 'Other', createdAt: '2026-01-01T00:00:00Z' };
  server.initOverride = (f, index) => (f.allowDuplicate ? null : { index, status: 'duplicate', existing });
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('dup.pdf', 12)]);
  await engine.whenIdle();
  let f = engine.snapshot().files[0];
  assert.equal(f.status, 'needs-decision');
  assert.deepEqual(f.existing, existing);
  engine.resolveDuplicate('dup.pdf', 'upload');
  await engine.whenIdle();
  f = engine.snapshot().files[0];
  assert.equal(f.status, 'done');
  assert.equal(server.initCalls.at(-1)![0].allowDuplicate, true);
});

test('"skip" a duplicate, and an identical file already in place is skipped with no PUT', async () => {
  const server = new FakeServer();
  const existing = { id: 'f1', fileName: 'a', folderId: null, folderName: null, createdAt: '2026-01-01T00:00:00Z' };
  server.initOverride = (f, index) =>
    f.fileName === 'same.pdf'
      ? { index, status: 'already-uploaded', existing }
      : { index, status: 'possible-duplicate', existing };
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('same.pdf', 12), item('maybe.pdf', 12)]);
  await engine.whenIdle();
  engine.resolveDuplicate('maybe.pdf', 'skip');
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'same.pdf': 'skipped', 'maybe.pdf': 'skipped' });
  assert.equal(server.putAttempts, 0);
});

test('complete reports missing parts → only those are re-sent, then it completes', async () => {
  const server = new FakeServer();
  let lost = false;
  server.completeOverride = (id) => {
    if (lost) return null;
    lost = true;
    server.sessions.get(id)!.stored.delete(3); // storage "lost" part 3
    server.okPuts.delete(`${id}:3`);
    return { id, status: 'missing-parts', missingParts: [3] };
  };
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('m.bin', 45)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['m.bin'], 'done');
  assert.equal(server.attempts.get('s1:3'), 2);
  assert.equal(server.attempts.get('s1:1'), 1);
  exactlyOnce(server);
});

test('session gone from storage (404 on PUT) → a fresh session is opened and the file lands', async () => {
  const server = new FakeServer();
  server.fault = ({ session }) => {
    if (session === 's1') {
      server.sessions.get('s1')!.status = 'ABORTED'; // R2 auto-aborted it
      return 404;
    }
    return 'ok';
  };
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('g.bin', 40)]);
  await engine.whenIdle();
  const f = engine.snapshot().files[0];
  assert.equal(f.status, 'done');
  assert.equal(f.uploadId, 's2', 'finished on the NEW session');
  assert.deepEqual(server.recorded, ['s2']);
});

test('dev storage (proxy mode) hands files back for the legacy upload', async () => {
  const server = new FakeServer();
  server.mode = 'proxy';
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('d.pdf', 10)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['d.pdf'], 'fallback');
});

test('a fatal PUT error fails the file; Retry resumes it without re-sending stored parts', async () => {
  const server = new FakeServer();
  server.fault = ({ part, attempt }) => (part === 4 && attempt === 1 ? 400 : 'ok');
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('f.bin', 50)]);
  await engine.whenIdle();
  const failed = engine.snapshot().files[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.retryable, true);
  engine.retryFailed();
  await engine.whenIdle();
  const f = engine.snapshot().files[0];
  assert.equal(f.status, 'done');
  assert.equal(f.resumed, true);
  exactlyOnce(server);
});

test('a link that keeps dropping stops the file after MAX_PART_ATTEMPTS; parts already sent are kept', async () => {
  const server = new FakeServer();
  let dead = true;
  server.fault = ({ part }) => (dead && part === 2 ? 0 : 'ok');
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('k.bin', 30)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['k.bin'], 'failed');
  assert.equal(server.attempts.get('s1:2'), MAX_PART_ATTEMPTS);
  dead = false;
  engine.retry('k.bin');
  await engine.whenIdle();
  assert.equal(statuses(engine)['k.bin'], 'done');
  assert.equal(server.attempts.get('s1:1'), 1, 'part 1 not re-sent after the retry');
});

test('rejected by the server (e.g. blocked type) fails without a Retry option', async () => {
  const server = new FakeServer();
  server.initOverride = (_f, index) => ({ index, status: 'rejected', reason: 'Files of type .exe are not allowed.' });
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('x.exe', 10)]);
  await engine.whenIdle();
  const f = engine.snapshot().files[0];
  assert.equal(f.status, 'failed');
  assert.equal(f.retryable, false);
  assert.match(f.error!, /exe/);
});

test('server still assembling (in-progress) is polled until it completes', async () => {
  const server = new FakeServer();
  server.completeOverride = (id, call) => (call < 4 ? { id, status: 'in-progress' } : null);
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('i.bin', 80)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['i.bin'], 'done');
  assert.equal(server.completeCalls.length, 4);
});

test('batches: 120 files → init and complete calls of at most 50', async () => {
  const server = new FakeServer();
  const engine = new UploadEngine(server, makeEnv(), { readyAhead: 200 });
  engine.add(Array.from({ length: 120 }, (_, i) => item(`f${i}.txt`, 5)));
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((s) => s === 'done'));
  assert.ok(server.initCalls.every((c) => c.length <= 50));
  assert.ok(server.completeCalls.every((c) => c.length <= 50));
  assert.equal(server.recorded.length, 120);
  exactlyOnce(server);
});

test('adaptive slots: halve on trouble (never below 2), grow after a run of successes (never above 6)', async () => {
  const server = new FakeServer();
  let failures = 4;
  server.fault = () => (failures-- > 0 ? 503 : 'ok');
  const engine = new UploadEngine(server, makeEnv());
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

test('the same file dropped twice is queued once', async () => {
  const server = new FakeServer();
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('twice.pdf', 12)]);
  engine.add([item('twice.pdf', 12)]);
  await engine.whenIdle();
  assert.equal(engine.snapshot().files.length, 1);
  assert.equal(server.recorded.length, 1);
});

test('a file that cannot be read fails with a clear, retryable message', async () => {
  const server = new FakeServer();
  const env = makeEnv();
  env.hash = async () => {
    throw new Error('NotReadableError');
  };
  const engine = new UploadEngine(server, env);
  engine.add([item('gone.pdf', 12)]);
  await engine.whenIdle();
  const f = engine.snapshot().files[0];
  assert.equal(f.status, 'failed');
  assert.match(f.error!, /Could not read this file/);
  assert.equal(server.initCalls.length, 0);
});

// ---- regressions from self-review --------------------------------------------

test('[review] a part cooling down after a drop keeps the file from completing early', async () => {
  const server = new FakeServer();
  server.fault = ({ part, attempt }) => (part === 3 && attempt === 1 ? 0 : 'ok');
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('cool.bin', 30)]); // parts 1–3; part 3 drops once
  await engine.whenIdle();
  assert.equal(statuses(engine)['cool.bin'], 'done');
  assert.equal(server.completeCalls.length, 1, 'complete only once every part is stored');
  exactlyOnce(server);
});

test('[review] a file the server gives no complete answer for is asked again, not stuck', async () => {
  const server = new FakeServer();
  const real = server.complete.bind(server);
  let calls = 0;
  server.complete = async (ids: string[]) => (++calls === 1 ? { results: [] } : real(ids));
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('quiet.bin', 12)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['quiet.bin'], 'done');
  assert.equal(calls, 2);
});

test('[review] a file the server never gives an init answer for fails after bounded retries', async () => {
  const server = new FakeServer();
  let calls = 0;
  server.init = async () => {
    calls += 1;
    return { mode: 'direct' as const, maxBytes: 1e12, results: [] };
  };
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('mute.bin', 12)]);
  await engine.whenIdle();
  const f = engine.snapshot().files[0];
  assert.equal(f.status, 'failed');
  assert.equal(f.error, 'No answer from the server.');
  assert.ok(calls > 1 && calls <= 41, `bounded (${calls} calls)`);
});

test('[review] cancelling a FAILED file frees the session it kept for a retry', async () => {
  const server = new FakeServer();
  server.fault = ({ part }) => (part === 2 ? 400 : 'ok');
  const engine = new UploadEngine(server, makeEnv());
  engine.add([item('bad.bin', 30)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['bad.bin'], 'failed');
  await engine.cancel('bad.bin');
  assert.equal(statuses(engine)['bad.bin'], 'cancelled');
  assert.deepEqual(server.aborted, ['s1']);
});

test('[review] no signing retries while paused; resume picks the file back up', async () => {
  const server = new FakeServer();
  const real = server.signParts.bind(server);
  let down = true;
  let signCalls = 0;
  let engine!: UploadEngine;
  server.signParts = async (id: string, parts: number[]) => {
    signCalls += 1;
    if (down) {
      engine.pause(); // the officer pauses while the link is down
      throw new TransportError('offline', 0);
    }
    return real(id, parts);
  };
  engine = new UploadEngine(server, makeEnv());
  engine.add([item('sign.bin', 250)]); // 25 parts: init signs 16, the rest need /parts
  await engine.whenIdle();
  assert.equal(engine.snapshot().paused, true);
  assert.equal(signCalls, 1, 'no sign retries burned while paused');
  assert.equal(statuses(engine)['sign.bin'], 'uploading');
  down = false;
  engine.resume();
  await engine.whenIdle();
  assert.equal(statuses(engine)['sign.bin'], 'done');
  exactlyOnce(server);
});
