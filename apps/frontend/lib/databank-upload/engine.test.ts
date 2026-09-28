import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HASH_STALL_MS, INIT_TIMEOUT_MS, MAX_PART_ATTEMPTS, STALL_MS, TransportError, UploadEngine } from './engine.ts';
import {
  FakeServer,
  FakeSource,
  exactlyOnce,
  item,
  makeEnv,
  setup,
  statuses,
  stopped,
  tick,
  until,
  view,
} from './testing/fake-server.ts';

/**
 * The upload engine against the FAKE server + R2 in testing/fake-server.ts
 * (fault injection: 403s, 404s, 5xx, drops, stalls, hangs, outages, garbage
 * replies) on a VIRTUAL clock. The invariant throughout: every part is stored
 * exactly once per session, every file is recorded exactly once.
 */

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

// ---- review round 2 -------------------------------------------------------------

test('[review r2] the give-up window ignores time spent PAUSED (fail, pause overnight, one blip next morning)', async () => {
  const { server, env, engine } = setup();
  server.fault = ({ part, attempt }) => {
    if (part !== 2) return 'ok';
    if (attempt === 1) return 0; // fails — the give-up clock for part 2 starts
    if (attempt === 2) {
      queueMicrotask(() => engine.pause()); // the retry is under way when the officer pauses for the night
      return 'hang';
    }
    return attempt === 3 ? 0 : 'ok'; // next morning: one blip, then fine
  };
  engine.add([item('night.bin', 30)]);
  await engine.whenIdle();
  assert.equal(engine.snapshot().paused, true);
  assert.equal(server.attempts.get('s1:2'), 2);
  env.clock += 13 * 3600_000; // 13 h later
  engine.resume();
  await engine.whenIdle();
  assert.equal(statuses(engine)['night.bin'], 'done', 'a paused night must not count as 13 h of failing');
  assert.equal(server.attempts.get('s1:2'), 4);
});

test('[review r2] the give-up window ignores time the laptop was ASLEEP (a back-off that wakes 13 h late)', async () => {
  const { server, env, engine } = setup();
  const sleep = env.sleep;
  let lidClosed = false;
  server.fault = ({ part, attempt }) => {
    if (part !== 1) return 'ok';
    if (attempt === 1) {
      lidClosed = true; // the lid closes during the back-off after this failure
      return 0;
    }
    return attempt === 2 ? 0 : 'ok'; // on waking, one more blip before Wi-Fi reconnects
  };
  env.sleep = (ms, signal) => {
    if (lidClosed && ms >= 500 && ms < 5_000) { // the back-off (not a 5 s stall-watcher tick)
      lidClosed = false;
      const p = sleep(ms, signal);
      env.clock += 13 * 3600_000; // …and wakes 13 h late
      return p;
    }
    return sleep(ms, signal);
  };
  engine.add([item('lid.bin', 30)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['lid.bin'], 'done');
  assert.equal(server.attempts.get('s1:1'), 3);
});

test('[review r2] a file that can no longer be read fails at once (no 12 h "waiting for the network")', async () => {
  const { server, env, engine } = setup();
  let gone = false;
  env.readable = async () => !gone;
  server.fault = ({ session }) => (session === 's1' && gone ? 0 : 'ok');
  engine.add([item('usb.bin', 200), item('other.pdf', 9)]);
  await until(() => server.okPuts.size >= 3);
  gone = true; // the USB drive is unplugged mid-upload
  const start = env.clock;
  await engine.whenIdle();
  const f = view(engine, 'usb.bin');
  assert.equal(f.status, 'failed');
  assert.match(f.error!, /no longer on this computer/);
  assert.equal(statuses(engine)['other.pdf'], 'done');
  assert.ok(env.clock - start < 10 * 60_000, 'failed quickly, not after hours of retries');
  assert.equal(engine.snapshot().linkDown, false);
});

test('[review r2] while other PUTs get through, a failing part frees its slot during its back-off', async () => {
  const { server, engine } = setup({ engine: { slots: 2, minSlots: 2, maxSlots: 2 } });
  let fCooling = false;
  let bigInFlight = 0;
  let bigMaxDuringCooling = 0;
  // f.pdf's only PUT is slow and then fails (503) — meanwhile big.bin's parts succeed on the other slot.
  server.fault = ({ session, attempt }) => {
    if (session === 's1') {
      if (attempt === 1) return 'slow-503';
      fCooling = false; // its retry starts
    }
    return 'ok';
  };
  const realPut = server.put.bind(server);
  server.put = async (part, body, onProgress, signal) => {
    const big = part.url.includes('/s2/');
    if (big) {
      bigInFlight += 1;
      if (fCooling) bigMaxDuringCooling = Math.max(bigMaxDuringCooling, bigInFlight);
    }
    try {
      return await realPut(part, body, onProgress, signal);
    } catch (e) {
      if (!big) fCooling = true; // f.pdf just failed: its back-off starts
      throw e;
    } finally {
      if (big) bigInFlight -= 1;
    }
  };
  engine.add([item('f.pdf', 9), item('big.bin', 2000)]);
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'f.pdf': 'done', 'big.bin': 'done' });
  assert.equal(bigMaxDuringCooling, 2, "big.bin had BOTH slots while f.pdf's part cooled down");
  exactlyOnce(server);
});
test('[review r2] re-dropping a failed file uses the NEW drop — its File and its destination folder', async () => {
  const { server, engine } = setup();
  server.fault = ({ session, part, attempt }) => (session === 's1' && part === 2 && attempt === 1 ? 400 : 'ok');
  engine.add([item('scan.pdf', 30, { folderId: 'wrong-folder', seed: 'OLD' })]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['scan.pdf'], 'failed');
  const before = server.bodySeeds.length;
  engine.add([item('scan.pdf', 30, { folderId: 'right-folder', seed: 'OLD' })]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['scan.pdf'], 'done');
  assert.equal(server.initCalls.at(-1)![0].folderId, 'right-folder');
  const done = [...server.sessions.values()].find((x) => x.status === 'COMPLETED')!;
  assert.match(done.identity, /^right-folder\|/);
  assert.ok(server.bodySeeds.length > before);
});

test('[review r2] re-dropping a changed file (new size) hashes the NEW File again', async () => {
  const { server, engine } = setup();
  server.fault = ({ session, part, attempt }) => (session === 's1' && part === 2 && attempt === 1 ? 400 : 'ok');
  engine.add([item('edit.pdf', 30, { seed: 'V1' })]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['edit.pdf'], 'failed');
  engine.add([item('edit.pdf', 40, { seed: 'V2' })]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['edit.pdf'], 'done');
  const last = server.initCalls.at(-1)![0];
  assert.equal(last.sizeBytes, 40);
  assert.equal(last.sha256, Buffer.from('V2').toString('hex').padEnd(64, '0').slice(0, 64));
});

test('[review r2] re-dropping a DONE file asks the server again (it may have been deleted since)', async () => {
  const { server, engine } = setup();
  engine.add([item('restore.pdf', 12)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['restore.pdf'], 'done');
  const inits = server.initCalls.length;
  engine.add([item('restore.pdf', 12)]); // after a colleague deleted it
  await engine.whenIdle();
  assert.equal(server.initCalls.length, inits + 1, 'went back to the server');
  assert.equal(statuses(engine)['restore.pdf'], 'done');
  assert.equal(server.recorded.length, 2, 'uploaded again (the fake keeps no file rows, like a deleted file)');
});

test('[review r2] a finished copy is not a "same-drop" twin: a new copy of a done file goes to the server', async () => {
  const { server, engine } = setup();
  engine.add([item('a.pdf', 12, { key: 'k1', seed: 'X' })]);
  await engine.whenIdle();
  const existing = { id: 'f1', fileName: 'a.pdf', folderId: null, folderName: null, createdAt: '2026-01-01T00:00:00Z' };
  server.initOverride = (_f, index) => ({ index, status: 'already-uploaded', existing });
  engine.add([item('a.pdf', 12, { key: 'k2', seed: 'X', lastModified: 5 })]);
  await engine.whenIdle();
  const k2 = view(engine, 'k2');
  assert.equal(k2.status, 'skipped');
  assert.equal(k2.duplicateKind, 'already-uploaded', 'decided by the server, not locally');
});

test('[review r2] a failed row and a re-dropped copy sharing a session: the copy owns it, Cancel on the old row spares it', async () => {
  const { server, engine } = setup();
  server.fault = ({ part, attempt }) => (part === 2 && attempt === 1 ? 400 : 'ok');
  engine.add([item('big.bin', 60, { key: 'old', seed: 'S' })]);
  await engine.whenIdle();
  assert.equal(view(engine, 'old').status, 'failed');
  assert.equal(view(engine, 'old').uploadId, 's1');
  engine.add([item('big.bin', 60, { key: 'copy', seed: 'S', lastModified: 9 })]); // resumes s1
  await until(() => view(engine, 'copy').uploadId === 's1');
  assert.equal(view(engine, 'old').uploadId, undefined, 'the old row let go of s1');
  await engine.cancel('old');
  assert.deepEqual(server.abortCalls, [], 'the live upload was not discarded');
  await engine.whenIdle();
  assert.equal(view(engine, 'copy').status, 'done');
  assert.equal(server.recorded.length, 1);
  exactlyOnce(server);
});

test('[review r2] Retry on a failed row while a copy is uploading skips it instead of racing the copy', async () => {
  const { server, engine } = setup({ frozen: true });
  server.fault = ({ part, attempt }) => (part === 2 && attempt === 1 ? 400 : 'hang');
  engine.add([item('dup.bin', 60, { key: 'a', seed: 'D' })]);
  await until(() => view(engine, 'a').status === 'failed');
  engine.add([item('dup.bin', 60, { key: 'b', seed: 'D', lastModified: 3 })]);
  await until(() => view(engine, 'b').status === 'uploading');
  engine.retry('a');
  assert.equal(view(engine, 'a').status, 'skipped');
  assert.equal(view(engine, 'a').duplicateKind, 'same-drop');
});

test('[review r2] Cancel during an outage never claims "cancelled": it waits, then follows the server (409 → done)', async () => {
  const { server, env, engine } = setup();
  let down = false;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const realComplete = server.complete.bind(server);
  server.complete = async (ids, signal) => {
    if (server.completeCalls.length === 0) {
      for (const id of ids) server.sessions.get(id)!.status = 'COMPLETING';
      server.completeCalls.push(ids);
      await gate;
      for (const id of ids) {
        server.sessions.get(id)!.status = 'COMPLETED';
        server.recorded.push(id);
      }
      return { results: ids.map((id) => ({ id, status: 'completed' as const, file: {} })) };
    }
    return realComplete(ids, signal);
  };
  const abortAt: number[] = [];
  server.apiFault = (method) => {
    if (method === 'abort') abortAt.push(env.clock);
    return method === 'abort' && down ? 0 : 'ok';
  };
  engine.add([item('late.pdf', 40)]);
  await until(() => server.completeCalls.length === 1);
  down = true;
  engine.setOnline(false); // load-shedding: the office goes offline
  const cancelling = engine.cancel('late.pdf');
  await until(() => server.calls.abort >= 4);
  // While offline the DELETE keeps being retried — but spaced by back-off, not in a hot loop.
  assert.ok(abortAt[3] - abortAt[2] >= 1000, `retries are backed off (${abortAt[3] - abortAt[2]} ms apart)`);
  env.clock += 60 * 60_000; // an hour offline
  assert.equal(view(engine, 'late.pdf').status, 'cancelling', 'not claiming "cancelled" without an answer');
  release(); // the server finishes recording it meanwhile
  down = false;
  engine.setOnline(true);
  await cancelling;
  await engine.whenIdle();
  const f = view(engine, 'late.pdf');
  assert.equal(f.status, 'done');
  assert.match(f.note!, /could not be cancelled/);
});

test('[review r2] a Cancel that never gets an answer ends "failed — may still be saved", keeping the session', async () => {
  const { server, engine } = setup({ engine: { giveUpMs: 10 * 60_000 } });
  server.fault = () => 'hang';
  server.apiFault = (method) => (method === 'abort' ? 0 : 'ok');
  engine.add([item('q.bin', 200)]);
  await until(() => server.inFlight > 0);
  await engine.cancel('q.bin');
  const f = view(engine, 'q.bin');
  assert.equal(f.status, 'failed');
  assert.match(f.error!, /may still be saved/);
  assert.equal(f.uploadId, 's1', 'kept, so Cancel can be tried again');
  assert.ok(server.calls.abort > 3, 'kept asking under the outage rules');
});

test('[review r2] a lost init reply (the server did it) is retried into the SAME session — one upload, recorded once', async () => {
  const { server, engine } = setup();
  server.apiFault = (method, call) => (method === 'init' && call === 1 ? 'lost' : 'ok');
  engine.add([item('lost.bin', 60)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['lost.bin'], 'done');
  assert.equal(server.sessions.size, 1);
  assert.equal(view(engine, 'lost.bin').resumed, true);
  exactlyOnce(server);
});

// ---- review round 3 -------------------------------------------------------------

test('[review r3] the lid closes during a RETRY PUT (after one blip): waking 13 h later does not fail the file', async () => {
  const { server, env, engine } = setup();
  server.fault = ({ part, attempt }) => {
    if (part !== 2) return 'ok';
    if (attempt === 1) return 0; // one blip — part 2's give-up clock starts
    if (attempt === 2) {
      env.clock += 13 * 3600_000; // the retry PUT is in flight when the lid closes overnight…
      return 'hang'; // …and on waking, the stall watcher aborts it
    }
    return 'ok';
  };
  engine.add([item('lid2.bin', 30)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['lid2.bin'], 'done');
});

test('[review r3] waking from sleep: an offline event that fires before the overdue timer still excludes the sleep', async () => {
  const { server, env, engine } = setup();
  const sleep = env.sleep;
  let armed = false;
  server.fault = ({ part, attempt }) => {
    if (part !== 1) return 'ok';
    if (attempt === 1) {
      armed = true;
      return 0;
    }
    return attempt === 2 ? 0 : 'ok';
  };
  env.sleep = (ms, signal) => {
    if (armed && ms >= 500 && ms < 5_000) {
      armed = false;
      const p = sleep(ms, signal);
      env.clock += 13 * 3600_000; // lid closed during this back-off
      engine.setOnline(false); // on wake the browser fires 'offline' first…
      engine.setOnline(true); // …then 'online'
      return p;
    }
    return sleep(ms, signal);
  };
  engine.add([item('wake.bin', 30)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['wake.bin'], 'done');
});

test('[review r3] halted for 11 min with a Cancel retrying, then asleep 13 h inside its back-off: no double-counted time', async () => {
  const { server, env, engine } = setup({ engine: { giveUpMs: 10 * 60_000 } });
  let blipped = false;
  let resumed = false;
  let secondBlip = false;
  let downAbort = true;
  server.fault = ({ session, part }) => {
    if (session === 's1' && part === 1) {
      if (!blipped) {
        blipped = true;
        return 0; // x.bin's part 1 blips: its give-up clock starts
      }
      if (!resumed) return 'hang'; // its retry is in flight when we pause (stopped, not charged)
      if (!secondBlip) {
        secondBlip = true;
        return 0; // …and blips once more after resuming: THIS failure is charged
      }
      return 'ok';
    }
    return session === 's2' ? 'hang' : 'ok';
  };
  server.apiFault = (method) => (method === 'abort' && downAbort ? 0 : 'ok');
  engine.add([item('x.bin', 30), item('y.bin', 200)]);
  await until(() => blipped && !!view(engine, 'y.bin').uploadId && server.inFlight > 0);
  engine.pause();
  const pausedAt = env.clock;
  const cancelling = engine.cancel('y.bin'); // keeps retrying while paused
  // 11 minutes pass in ordinary ticks (the Cancel's back-offs, ≤ 30 s apart — no "sleep" gap)
  await until(() => env.clock - pausedAt >= 11 * 60_000, 100_000);
  const sleep = env.sleep;
  env.sleep = (ms, signal) => {
    env.sleep = sleep;
    const p = sleep(ms, signal);
    env.clock += 13 * 3600_000;
    return p;
  };
  await until(() => server.calls.abort >= 3);
  downAbort = false;
  await cancelling;
  resumed = true;
  engine.resume();
  await engine.whenIdle();
  assert.ok(secondBlip, 'the post-resume blip was charged');
  assert.equal(statuses(engine)['x.bin'], 'done', 'neither the paused 11 min nor the 13 h sleep counted');
});

test('[review r3] the probed part is reserved: another part finishing during a slow probe does not complete early', async () => {
  const { server, env, engine } = setup();
  let probing = false;
  let release!: () => void;
  env.readable = async () => {
    probing = true;
    await new Promise<void>((r) => (release = r));
    return true;
  };
  server.fault = ({ part, attempt }) => (part === 2 && attempt === 1 ? 0 : part === 3 && attempt === 1 ? 'slow' : 'ok');
  engine.add([item('probe.bin', 30)]);
  await until(() => probing && (server.okPuts.get('s1:3') ?? 0) === 1); // part 3 landed during the probe
  release();
  await engine.whenIdle();
  assert.equal(statuses(engine)['probe.bin'], 'done');
  assert.equal(server.completeCalls.length, 1, 'no early complete');
  exactlyOnce(server);
});

test('[review r3] a network-backed file unreadable DURING an outage is not failed; it resumes when the link returns', async () => {
  const { server, env, engine } = setup();
  let outage = false;
  env.readable = async () => !outage; // a Drive-streamed / NAS file: unreadable while the network is down
  server.fault = () => (outage ? 0 : 'ok');
  server.apiFault = () => (outage ? 0 : 'ok');
  engine.add([item('nas.bin', 300)]);
  await until(() => server.okPuts.size >= 3);
  outage = true;
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000); // 10 minutes of load-shedding
  assert.notEqual(statuses(engine)['nas.bin'], 'failed');
  outage = false;
  await engine.whenIdle();
  assert.equal(statuses(engine)['nas.bin'], 'done');
  exactlyOnce(server);
});

test('[review r3] the ONLY file, unplugged: a re-sign proves the link, then it fails fast as "no longer on this computer"', async () => {
  const { server, env, engine } = setup();
  let gone = false;
  env.readable = async () => !gone;
  server.fault = () => (gone ? 0 : 'ok');
  engine.add([item('solo.bin', 300)]);
  await until(() => server.okPuts.size >= 3);
  gone = true;
  const t0 = env.clock;
  await engine.whenIdle();
  assert.equal(statuses(engine)['solo.bin'], 'failed');
  assert.match(view(engine, 'solo.bin').error!, /no longer on this computer/);
  assert.ok(env.clock - t0 < 5 * 60_000, 'fast — not 12 h of "waiting for the network"');
});

test('[review r3] a stale cancel intent never cancels a later deliberate re-upload', async () => {
  const { server, engine } = setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const realComplete = server.complete.bind(server);
  server.complete = async (ids, signal) => {
    if (server.completeCalls.length === 0) {
      for (const id of ids) server.sessions.get(id)!.status = 'COMPLETING';
      server.completeCalls.push(ids);
      await gate;
      for (const id of ids) {
        server.sessions.get(id)!.status = 'COMPLETED';
        server.recorded.push(id);
      }
      return { results: ids.map((id) => ({ id, status: 'completed' as const, file: {} })) };
    }
    return realComplete(ids, signal);
  };
  engine.add([item('again.pdf', 40)]);
  await until(() => server.completeCalls.length === 1);
  const c = engine.cancel('again.pdf'); // 409 → follows to done
  await c;
  release();
  await engine.whenIdle();
  assert.equal(statuses(engine)['again.pdf'], 'done');
  // the officer deletes it, then deliberately uploads it again; storage then reports a lost part once
  let lost = false;
  server.completeOverride = (id) => {
    if (lost) return null;
    lost = true;
    server.sessions.get(id)!.stored.delete(1);
    server.okPuts.delete(`${id}:1`);
    return { id, status: 'missing-parts', missingParts: [1] };
  };
  engine.add([item('again.pdf', 40)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['again.pdf'], 'done', 'the old cancel intent was cleared');
  assert.deepEqual(server.abortCalls, ['s1']);
});

test('[review r3] cancel → 409 → the session then turns out expired: the row ends "cancelled", not re-uploaded', async () => {
  const { server, engine } = setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  server.complete = async (ids) => {
    server.completeCalls.push(ids);
    if (server.completeCalls.length === 1) {
      for (const id of ids) server.sessions.get(id)!.status = 'COMPLETING';
      await gate;
    }
    return { results: ids.map((id) => ({ id, status: 'expired' as const })) };
  };
  engine.add([item('exp.pdf', 40)]);
  await until(() => server.completeCalls.length === 1);
  await engine.cancel('exp.pdf');
  release();
  await engine.whenIdle();
  assert.equal(statuses(engine)['exp.pdf'], 'cancelled');
  assert.equal(server.initCalls.length, 1, 'never re-initialised');
});

test('[review r3] cancelling a copy mid-init never frees a RESUMED session a failed row keeps for Retry', async () => {
  const { server, engine } = setup();
  server.fault = ({ session, part, attempt }) => (session === 's1' && part === 2 && attempt === 1 ? 400 : 'ok');
  engine.add([item('keep.bin', 60, { key: 'old', seed: 'K' })]);
  await engine.whenIdle();
  assert.equal(view(engine, 'old').status, 'failed');
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const realInit = server.init.bind(server);
  server.init = async (files, signal) => {
    await gate;
    return realInit(files, signal);
  };
  engine.add([item('keep.bin', 60, { key: 'copy', seed: 'K', lastModified: 4 })]);
  await until(() => server.initCalls.length >= 1 && view(engine, 'copy').status === 'hashed');
  await engine.cancel('copy'); // local cancel while its init is in flight
  release();
  await engine.whenIdle();
  assert.deepEqual(server.abortCalls, [], 's1 (resumed) was not freed');
  engine.retry('old');
  await engine.whenIdle();
  assert.equal(view(engine, 'old').status, 'done');
  assert.equal(view(engine, 'old').resumed, true, 'Retry resumed the kept parts');
});

test('[review r3] "Retry failed" skips a file whose Cancel went unanswered; an explicit Retry still works', async () => {
  const { server, engine } = setup({ engine: { giveUpMs: 10 * 60_000 } });
  server.fault = () => 'hang';
  server.apiFault = (method) => (method === 'abort' ? 0 : 'ok');
  engine.add([item('unwanted.bin', 200)]);
  await until(() => server.inFlight > 0);
  await engine.cancel('unwanted.bin');
  assert.equal(statuses(engine)['unwanted.bin'], 'failed');
  server.fault = () => 'ok';
  const inits = server.initCalls.length;
  engine.retryFailed();
  await engine.whenIdle();
  assert.equal(statuses(engine)['unwanted.bin'], 'failed', 'not resumed by "Retry failed"');
  assert.equal(server.initCalls.length, inits);
  engine.retry('unwanted.bin');
  await engine.whenIdle();
  assert.equal(statuses(engine)['unwanted.bin'], 'done', 'an explicit Retry is the officer’s choice');
});

test('[review r3] dropping a file again while its Cancel is still being retried uploads it once the Cancel settles', async () => {
  const { server, engine } = setup();
  server.fault = ({ attempt }) => (attempt === 1 ? 'hang' : 'ok');
  let abortDown = true;
  server.apiFault = (method) => (method === 'abort' && abortDown ? 0 : 'ok');
  engine.add([item('change.bin', 200)]);
  await until(() => server.inFlight > 0);
  const c = engine.cancel('change.bin');
  await until(() => server.calls.abort >= 2);
  engine.add([item('change.bin', 200)]); // "oh wait, I do want it"
  abortDown = false;
  await c;
  await engine.whenIdle();
  assert.equal(statuses(engine)['change.bin'], 'done');
});

test('[review r3] re-dropping a "same-drop" copy while its twin is still uploading keeps it skipped', async () => {
  const { server, engine } = setup({ frozen: true });
  server.fault = () => 'hang';
  engine.add([item('s.pdf', 60, { key: 'A', seed: 'T' }), item('s.pdf', 60, { key: 'B', seed: 'T', lastModified: 2 })]);
  await until(() => view(engine, 'B').status === 'skipped' && view(engine, 'A').status === 'uploading');
  engine.add([item('s.pdf', 60, { key: 'B', seed: 'T', lastModified: 2 })]);
  assert.equal(view(engine, 'B').status, 'skipped');
  assert.equal(view(engine, 'B').duplicateKind, 'same-drop');
});

// ---- review round 4 -------------------------------------------------------------

test('[review r4] a sibling PUT landing just BEFORE an outage is no proof: a streamed file is not failed as "gone"', async () => {
  const { server, env, engine } = setup({ engine: { slots: 2, minSlots: 2, maxSlots: 2 } });
  let outage = false;
  env.readable = async () => !outage; // a Drive-streamed / NAS file: unreadable while the network is down
  server.apiFault = () => (outage ? 0 : 'ok');
  const realPut = server.put.bind(server);
  server.put = async (part, body, onProgress, signal) => {
    const [, , , , n] = part.url.split('/');
    if (outage) throw new TransportError('network down', 0);
    if (n === '1' && (server.attempts.get('s1:1') ?? 0) === 0) {
      server.attempts.set('s1:1', 1);
      // part 1 is a long PUT: part 2 lands while it runs, then the outage hits it
      await until(() => outage || signal.aborted);
      throw new TransportError('network down', 0);
    }
    return realPut(part, body, onProgress, signal);
  };
  engine.add([item('drive.bin', 60)]);
  await until(() => (server.okPuts.get('s1:2') ?? 0) === 1); // a sibling landed during part 1's PUT
  outage = true;
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000);
  assert.notEqual(statuses(engine)['drive.bin'], 'failed', 'not "no longer on this computer" during an outage');
  outage = false;
  await engine.whenIdle();
  assert.equal(statuses(engine)['drive.bin'], 'done');
});

test('[review r4] a black-holed complete fails on the real give-up window (its 120 s timeout is not "sleep")', async () => {
  const { server, env, engine } = setup({ engine: { giveUpMs: 10 * 60_000 } });
  server.apiFault = (method) => (method === 'complete' ? 'hang' : 'ok');
  engine.add([item('bh.pdf', 12)]);
  const t0 = env.clock;
  await engine.whenIdle();
  assert.equal(statuses(engine)['bh.pdf'], 'failed');
  assert.ok(env.clock - t0 < 20 * 60_000, `gave up after ${Math.round((env.clock - t0) / 60_000)} min, not ~7× the window`);
});

test('[review r4] freeing the session of a cancelled init is tracked: whenIdle waits for it', async () => {
  const { server, engine } = setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const realInit = server.init.bind(server);
  let initStarted = false;
  server.init = async (files, signal) => {
    initStarted = true;
    await gate;
    return realInit(files, signal);
  };
  let abortFinished = false;
  const realAbort = server.abort.bind(server);
  server.abort = async (id, signal) => {
    await server.sleep(5_000, signal); // the DELETE takes a while
    await realAbort(id, signal);
    abortFinished = true;
  };
  engine.add([item('orphan.bin', 60)]);
  await until(() => initStarted);
  await engine.cancel('orphan.bin'); // local: no session yet
  release(); // the init still opens a NEW session…
  await engine.whenIdle();
  assert.ok(abortFinished, '…which is freed BEFORE the engine reports idle');
  assert.deepEqual(server.abortCalls, ['s1']);
});

test('[review r4] the PC clock set BACK mid-upload never hides a stall', async () => {
  const { server, env, engine } = setup();
  let stepped = false;
  let steppedAt = 0;
  let retriedAt = 0;
  server.fault = ({ part, attempt }) => {
    if (part === 1 && attempt === 1) {
      if (!stepped) {
        stepped = true;
        env.wallSkew -= 2 * 3600_000; // Windows time sync / the officer sets the PC clock back 2 h
        steppedAt = env.clock;
      }
      return 'hang';
    }
    if (part === 1 && attempt === 2) retriedAt = env.clock;
    return 'ok';
  };
  engine.add([item('clock.bin', 30)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['clock.bin'], 'done', 'the stalled PUT was aborted and retried');
  assert.equal(server.attempts.get('s1:1'), 2);
  assert.ok(retriedAt - steppedAt < 5 * 60_000, `stall caught on time (${Math.round((retriedAt - steppedAt) / 60_000)} min), not 2 h late`);
});

test('[review r4] nothing is hashed while offline; a read that fails while online is retried before failing', async () => {
  const { server, env, engine } = setup();
  let hashes = 0;
  let failNext = 2;
  env.hash = async (source) => {
    hashes += 1;
    await tick();
    if (failNext-- > 0) throw new Error('NotReadableError'); // a Drive stream hiccup, twice
    return (source as FakeSource).sha;
  };
  engine.setOnline(false);
  engine.add([item('h.pdf', 12)]);
  await engine.whenIdle();
  assert.equal(hashes, 0, 'no reads while offline');
  engine.setOnline(true);
  await engine.whenIdle();
  assert.equal(statuses(engine)['h.pdf'], 'done');
  assert.equal(hashes, 3, 'two failed reads were retried');
  assert.equal(server.recorded.length, 1);
});

// ---- review round 5 -------------------------------------------------------------

test('[review r5] an attempt that streamed bytes voids an old "unreadable" mark: a second outage does not fail a streamed file', async () => {
  const { server, env, engine } = setup();
  let outage = 0; // 0 = up; 1 / 2 = first / second outage
  env.readable = async () => outage === 0;
  server.apiFault = () => (outage ? 0 : 'ok');
  let attempt1 = 0;
  const realPut = server.put.bind(server);
  server.put = async (part, body, onProgress, signal) => {
    const [, , , , n] = part.url.split('/');
    if (n !== '1') {
      if (outage) throw new TransportError('network down', 0);
      return realPut(part, body, onProgress, signal);
    }
    attempt1 += 1;
    if (attempt1 === 1) {
      outage = 1; // outage 1 hits part 1 → "unreadable" mark
      throw new TransportError('network down', 0);
    }
    if (attempt1 === 2) {
      onProgress(4); // the retry STREAMS bytes (the file is readable again)…
      await server.sleep(2_000, signal);
      outage = 2; // …then a second short drop
      throw new TransportError('network down', 0);
    }
    return realPut(part, body, onProgress, signal);
  };
  engine.add([item('flap.bin', 30)]);
  await until(() => outage === 1);
  const t1 = env.clock;
  await until(() => env.clock - t1 > 60_000);
  outage = 0; // link back: part 1 is re-signed and retried
  await until(() => outage === 2);
  const t2 = env.clock;
  await until(() => env.clock - t2 > 60_000);
  assert.notEqual(statuses(engine)['flap.bin'], 'failed', 'the old mark was not taken as proof');
  outage = 0;
  await engine.whenIdle();
  assert.equal(statuses(engine)['flap.bin'], 'done');
});

test('[review r5] back online while PAUSED: hashing restarts and listeners hear about it', async () => {
  const { server, engine } = setup();
  engine.pause();
  engine.setOnline(false);
  engine.add([item('p1.pdf', 12), item('p2.pdf', 12)]);
  await engine.whenIdle(); // offline: queued files wait
  assert.deepEqual(Object.values(statuses(engine)), ['queued', 'queued']);
  let notified = 0;
  engine.subscribe(() => notified++);
  engine.setOnline(true); // still paused
  await engine.whenIdle();
  assert.ok(notified > 0, 'the dock is told the connection is back');
  assert.equal(engine.snapshot().offline, false);
  assert.deepEqual(Object.values(statuses(engine)), ['hashed', 'hashed'], 'hashing ran while paused');
  assert.equal(server.initCalls.length, 0, 'but nothing was sent');
  engine.resume();
  await engine.whenIdle();
  assert.deepEqual(Object.values(statuses(engine)), ['done', 'done']);
});

test('[review r5] resume() during an outage still tells listeners the pause ended', async () => {
  const { engine } = setup();
  engine.setOnline(false);
  engine.pause();
  await tick(); // let the pause's own update go by first
  let notified = 0;
  engine.subscribe(() => notified++);
  engine.resume();
  await tick();
  assert.ok(notified > 0);
  assert.equal(engine.snapshot().paused, false);
});

test('[review r5] reads failing while the ENGINE sees the link down (browser still "online") are not counted', async () => {
  const { server, env, engine } = setup();
  let outage = true;
  server.apiFault = () => (outage ? 0 : 'ok');
  let reads = 0;
  env.hash = async (source) => {
    await tick();
    if ((source as FakeSource).sha.startsWith(Buffer.from('streamed').toString('hex')) && outage) {
      reads += 1;
      throw new Error('NotReadableError'); // a Drive stream: unreadable while the ISP is down
    }
    return (source as FakeSource).sha;
  };
  engine.add([item('local.pdf', 12), item('streamed-a.pdf', 12, { seed: 'streamed-a' }), item('streamed-b.pdf', 12, { seed: 'streamed-b' })]);
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000); // ten minutes of ISP outage (Wi-Fi up)
  assert.ok(reads > 4, `the streamed files kept being retried (${reads} reads)`);
  assert.equal(Object.values(statuses(engine)).filter((s) => s === 'failed').length, 0, 'none failed');
  outage = false;
  await engine.whenIdle();
  assert.deepEqual(Object.values(statuses(engine)), ['done', 'done', 'done']);
});

// ---- review round 6 -------------------------------------------------------------

/** Part 1: outage 1 fails it with no response (the probe can't read the file →
 *  "unreadable" mark); the link returns; the retry STREAMS bytes and then ends in
 *  `second` (a stall or a 503) as outage 2 starts; the next attempt, inside
 *  outage 2, fails with no response and the probe can't read it again. */
async function flapping(second: 'stall' | 503) {
  const { server, env, engine } = setup();
  let outage = 0; // 0 = up; 1 / 2 = first / second outage
  env.readable = async () => outage === 0;
  server.apiFault = () => (outage ? 0 : 'ok');
  let attempt1 = 0;
  const realPut = server.put.bind(server);
  server.put = async (part, body, onProgress, signal) => {
    const [, , , , n] = part.url.split('/');
    if (n !== '1') {
      if (outage) throw new TransportError('network down', 0);
      return realPut(part, body, onProgress, signal);
    }
    attempt1 += 1;
    if (attempt1 === 1) {
      outage = 1;
      throw new TransportError('network down', 0);
    }
    if (attempt1 === 2) {
      onProgress(4); // the retry READ the file and sent bytes…
      outage = 2; // …then the link drops again
      if (second === 503) throw new TransportError('bad gateway', 503);
      await stopped(signal); // no reset, no progress: the stall watchdog ends it
    }
    if (outage) throw new TransportError('network down', 0);
    return realPut(part, body, onProgress, signal);
  };
  engine.add([item('flap.bin', 30)]);
  await until(() => outage === 1);
  const t1 = env.clock;
  await until(() => env.clock - t1 > 60_000);
  outage = 0; // link back: part 1 is re-signed and retried
  await until(() => attempt1 >= 3);
  const t2 = env.clock;
  await until(() => env.clock - t2 > 60_000);
  assert.notEqual(statuses(engine)['flap.bin'], 'failed', `${second}: the outage-1 mark was disproved by the streamed attempt`);
  outage = 0;
  await engine.whenIdle();
  assert.equal(statuses(engine)['flap.bin'], 'done');
  exactlyOnce(server);
}

test('[review r6] a streamed attempt that then STALLS voids the old "unreadable" mark (a flapping link fails nothing)', async () => {
  await flapping('stall');
});

test('[review r6] a streamed attempt that then gets a 503 voids the old "unreadable" mark too', async () => {
  await flapping(503);
});

test('[review r6] "waiting for the network" does not outlive the requests: after the only file fails, it clears while idle', async () => {
  const { server, env, engine } = setup();
  let gone = false;
  env.readable = async () => !gone;
  server.fault = () => (gone ? 0 : 'ok');
  engine.add([item('solo.bin', 300)]);
  await until(() => server.okPuts.size >= 3);
  gone = true; // the USB stick is pulled
  await engine.whenIdle();
  assert.equal(statuses(engine)['solo.bin'], 'failed');
  let heard = 0;
  engine.subscribe(() => heard++);
  const t0 = env.clock;
  await until(() => !engine.snapshot().linkDown || env.clock - t0 > 30 * 60_000, 200_000);
  assert.equal(engine.snapshot().linkDown, false, 'no stuck "waiting for the network" banner');
  assert.ok(env.clock - t0 <= 4 * 60_000, 'it goes stale within minutes');
  assert.ok(heard > 0, 'and the dock is told');
});

test('[review r6] a file that cannot be read while the link WORKS fails after 3 reads — even with nothing else running (a ping proves the link)', async () => {
  const { server, env, engine } = setup();
  let reads = 0;
  env.hash = async (source) => {
    await tick();
    if ((source as FakeSource).sha.startsWith(Buffer.from('locked').toString('hex'))) {
      reads += 1;
      throw new Error('NotReadableError'); // open in another program / deleted after the drop
    }
    return (source as FakeSource).sha;
  };
  engine.add([item('locked.pst', 12, { seed: 'locked' })]);
  await until(() => statuses(engine)['locked.pst'] === 'failed', 60_000); // (a regression would wait forever)
  assert.equal(statuses(engine)['locked.pst'], 'failed');
  assert.match(view(engine, 'locked.pst').error!, /Could not read this file/);
  assert.equal(reads, 3);
  assert.ok(server.calls.ping > 0, 'the link was proven with a ping');
  assert.equal(server.initCalls.length, 0);
});

test('[review r6] a Drive-streamed drop hashed during an ISP outage (nothing in flight to prove the link) fails no file', async () => {
  const { server, env, engine } = setup();
  let outage = true;
  server.apiFault = () => (outage ? 0 : 'ok');
  server.fault = () => (outage ? 0 : 'ok');
  let reads = 0;
  env.hash = async (source) => {
    await tick();
    if (outage) {
      reads += 1;
      throw new Error('NotReadableError'); // streamed from Drive: unreadable while the ISP is down
    }
    return (source as FakeSource).sha;
  };
  engine.add([item('a.pdf', 12), item('b.pdf', 12), item('c.pdf', 12)]);
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000, 200_000);
  assert.ok(reads >= 6, `the files kept being re-read (${reads})`);
  assert.equal(Object.values(statuses(engine)).filter((s) => s === 'failed').length, 0, 'none failed');
  outage = false;
  await engine.whenIdle();
  assert.deepEqual(Object.values(statuses(engine)), ['done', 'done', 'done']);
});

test('[review r6] a read that never settles is abandoned after HASH_STALL_MS: the next file hashes and uploads', async () => {
  const { env, engine } = setup();
  let stuckReads = 0;
  env.hash = async (source) => {
    if ((source as FakeSource).sha.startsWith(Buffer.from('stuck').toString('hex'))) {
      stuckReads += 1;
      return new Promise<string>(() => undefined); // a stalled network share: never settles, ignores Cancel
    }
    await tick();
    return (source as FakeSource).sha;
  };
  engine.add([item('stuck.bin', 12, { seed: 'stuck' }), item('next.pdf', 12)]);
  const t0 = env.clock;
  await until(() => statuses(engine)['next.pdf'] === 'done', 200_000);
  assert.ok(env.clock - t0 >= HASH_STALL_MS, 'it waited out the stall window first');
  await engine.whenIdle();
  assert.equal(statuses(engine)['stuck.bin'], 'failed', 'the link works (ping), so 3 abandoned reads fail it');
  assert.match(view(engine, 'stuck.bin').error!, /stopped responding/);
  assert.equal(stuckReads, 3);
});

test('[review r6] a re-dropped done file starts with a clean read record (earlier hiccups do not count against it)', async () => {
  const { server, env, engine } = setup();
  let failNext = 2;
  env.hash = async (source) => {
    await tick();
    if (failNext-- > 0) throw new Error('read hiccup');
    return (source as FakeSource).sha;
  };
  engine.add([item('f.pdf', 12)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['f.pdf'], 'done');
  failNext = 1;
  engine.add([item('f.pdf', 14)]); // edited (new size): same key, hashed again — one hiccup
  await engine.whenIdle();
  assert.equal(statuses(engine)['f.pdf'], 'done');
  assert.equal(server.recorded.length, 2);
});

test('[review r6] an answer that arrives as the engine halts (a 401 on sign-out) is judged after resume, never fails files', async () => {
  for (const where of ['init', 'sign', 'complete'] as const) {
    const { server, engine } = setup();
    let first = true;
    const trip = () => {
      if (!first) return false;
      first = false;
      engine.pause(); // the queue pauses everything on a 401 first…
      return true;
    };
    const realInit = server.init.bind(server);
    const realSign = server.signParts.bind(server);
    const realComplete = server.complete.bind(server);
    server.init = async (files, signal) => {
      if (where === 'init' && trip()) throw new TransportError('Signed out', 401); // …and the 401 still reaches the engine
      return realInit(files, signal);
    };
    server.signParts = async (id, parts, signal) => {
      if (where === 'sign' && trip()) throw new TransportError('Signed out', 401);
      return realSign(id, parts, signal);
    };
    server.complete = async (ids, signal) => {
      if (where === 'complete' && trip()) throw new TransportError('Signed out', 401);
      return realComplete(ids, signal);
    };
    engine.add([item('big.bin', 300)]);
    await until(() => !first);
    await engine.whenIdle();
    assert.notEqual(statuses(engine)['big.bin'], 'failed', `${where}: not failed while paused`);
    engine.resume();
    await engine.whenIdle();
    assert.equal(statuses(engine)['big.bin'], 'done', `${where}: finished after resume`);
    exactlyOnce(server);
  }
});

// ---- API for the upload queue --------------------------------------------------------

test('[queue api] hasWork()/status() answer without copying views', async () => {
  const { server, engine } = setup();
  assert.equal(engine.hasWork(), false);
  assert.equal(engine.status('x.pdf'), undefined);
  server.fault = () => 'hang';
  engine.add([item('x.pdf', 60)]);
  await until(() => engine.status('x.pdf') === 'uploading');
  assert.equal(engine.hasWork(), true);
  server.fault = () => 'ok';
  await engine.cancel('x.pdf');
  await engine.whenIdle();
  assert.equal(engine.status('x.pdf'), 'cancelled');
  assert.equal(engine.hasWork(), false);
});

test('[queue api] a file the server sent to the standard upload ("proxy") asks again when dropped again or retried', async () => {
  const { server, engine } = setup();
  server.mode = 'proxy';
  engine.add([item('p.pdf', 12), item('q.pdf', 12)]);
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'p.pdf': 'fallback', 'q.pdf': 'fallback' });
  assert.equal(engine.hasWork(), false, 'fallback is terminal for the engine');
  server.mode = 'direct'; // the kill switch is off again
  engine.add([item('p.pdf', 12)]);
  engine.retry('q.pdf');
  await engine.whenIdle();
  assert.deepEqual(statuses(engine), { 'p.pdf': 'done', 'q.pdf': 'done' });
  assert.equal(server.recorded.length, 2);
});
