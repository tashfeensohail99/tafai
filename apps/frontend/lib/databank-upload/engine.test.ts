import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HASH_STALL_MS, INIT_TIMEOUT_MS, MAX_PART_ATTEMPTS, NO_PROOF_GIVE_UP_MS, STALL_MS, TransportError, UploadEngine } from './engine.ts';
import type { UploadSource } from './engine.ts';
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

test('[review r2→r8] a file that can no longer be read — with nothing left to test its drive — fails after the short no-proof wait (not 12 h)', async () => {
  const { server, env, engine } = setup();
  let gone = false;
  const usb = item('usb.bin', 200);
  env.readable = async (src: UploadSource) => !(gone && src === usb.source); // only the USB drive's file is gone
  server.fault = ({ session }) => (session === 's1' && gone ? 0 : 'ok');
  engine.add([usb, item('other.pdf', 9)]);
  await until(() => server.okPuts.size >= 3);
  gone = true; // the USB drive is unplugged mid-upload
  const start = env.clock;
  await engine.whenIdle();
  const f = view(engine, 'usb.bin');
  assert.equal(f.status, 'failed');
  assert.match(f.error!, /moved, edited or renamed/);
  assert.equal(statuses(engine)['other.pdf'], 'done');
  // (other.pdf was read long before: it may be served from a cache, so it can't prove the drive)
  const took = env.clock - start;
  assert.ok(took >= NO_PROOF_GIVE_UP_MS && took < NO_PROOF_GIVE_UP_MS + 10 * 60_000, `the no-proof wait, not hours (${Math.round(took / 60_000)} min)`);
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

test('[review r3→r7] the ONLY file, unplugged: nothing shows its drive works, so it WAITS ("is the drive connected?") and resumes when plugged back', async () => {
  const { server, env, engine } = setup();
  let gone = false;
  env.readable = async () => !gone;
  // slow PUTs: parts already sent when the drive is pulled still finish AFTER it —
  // this file's own reads must not count as "its drive works"
  server.fault = ({ part }) => (gone ? 0 : part % 2 === 0 ? 'slow' : 'ok'); // staggered: some finish after the pull
  engine.add([item('solo.bin', 300)]);
  await until(() => server.okPuts.size >= 3, 100_000);
  await until(() => server.inFlight > 0);
  gone = true;
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000, 200_000);
  assert.notEqual(statuses(engine)['solo.bin'], 'failed', 'an unplugged drive can come back');
  assert.equal(engine.snapshot().readsWaiting, true, 'the dock asks whether the drive is connected');
  gone = false; // plugged back in
  await engine.whenIdle();
  assert.equal(statuses(engine)['solo.bin'], 'done');
  assert.equal(engine.snapshot().readsWaiting, false);
  exactlyOnce(server);
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
  // 6 parts in flight drop at once (6 failures in a row: "link down"), then
  // storage refuses the retries outright: the file fails, the count is left behind.
  const { server, env, engine } = setup({ engine: { slots: 6, minSlots: 6, maxSlots: 6 } });
  let gone = false;
  server.fault = ({ attempt }) => (!gone ? 'ok' : attempt === 1 ? 0 : 400);
  engine.add([item('solo.bin', 300)]);
  await until(() => server.okPuts.size >= 3);
  gone = true;
  await engine.whenIdle();
  assert.equal(statuses(engine)['solo.bin'], 'failed');
  assert.equal(engine.snapshot().linkDown, true, '(precondition: the failures left a "link down" count behind)');
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

// ---- review round 7 -------------------------------------------------------------

test('[review r7] the SOURCE is down but the internet works (NAS off, Drive not reconnected): no file fails; one test read at a time; all resume', async () => {
  const { server, env, engine } = setup();
  let nasDown = false;
  let reads = 0;
  env.readable = async () => !nasDown;
  env.hash = async (source) => {
    await tick();
    reads += 1;
    if (nasDown) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  server.fault = () => (nasDown ? 0 : 'ok'); // PUTs can't read the file either
  const files = [item('big.bin', 300), ...Array.from({ length: 40 }, (_, i) => item(`q${i}.pdf`, 12, { seed: `q${i}` }))];
  engine.add([files[0]]);
  await until(() => server.okPuts.size >= 3);
  nasDown = true; // load-shedding: the NAS goes off, the router (and our API) stay up
  engine.add(files.slice(1));
  const r0 = reads;
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000, 400_000);
  assert.equal(Object.values(statuses(engine)).filter((x) => x === 'failed').length, 0, 'nothing failed: the drive is away, not the files');
  assert.equal(engine.snapshot().readsWaiting, true, '"is the drive connected?"');
  assert.ok(reads - r0 < 40, `one test read at a time, spaced out — not every file spinning (${reads - r0} reads in 10 min)`);
  nasDown = false; // power is back
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((x) => x === 'done'), 'everything resumes by itself');
  exactlyOnce(server);
});

test('[review r7] a read that failed during a blip is not counted when the file reads fine right after (a flapping link fails nothing)', async () => {
  const { server, env, engine } = setup();
  let down = false;
  env.readable = async () => !down; // a Drive-streamed file: readable while the link is up
  server.apiFault = (m) => (down && m !== 'ping' ? 0 : 'ok');
  server.fault = () => (down ? 0 : 'ok');
  // The /health ping hangs while the link is down and answers once it is back:
  // the proof arrives AFTER a read that failed during the outage.
  const realPing = server.ping.bind(server);
  server.ping = async (signal) => {
    while (down) await server.sleep(500, signal);
    return realPing(signal);
  };
  const long = item('long.pdf', 12, { seed: 'long' });
  env.hash = async (source, onProgress) => {
    if (source === long.source) {
      for (let i = 1; i <= 10; i++) {
        await env.sleep(2_000); // a 20 s read — no 5 s "up" window lets it finish
        if (down) throw new Error('NotReadableError');
        onProgress(i);
      }
    }
    await tick();
    return (source as FakeSource).sha;
  };
  engine.add([item('sibling.pdf', 12, { seed: 'sib' })]);
  await engine.whenIdle(); // the sibling is read and uploaded: the drive is known to work
  engine.add([long]);
  for (let i = 0; i < 12; i++) {
    await env.sleep(5_000);
    down = !down; // 5 s up / 5 s down, six outages mid-read
  }
  down = false;
  await engine.whenIdle();
  assert.equal(statuses(engine)['long.pdf'], 'done', 'every failed read was a blip: it reads fine right after');
});

test('[review r7] a file that cannot be read while ANOTHER file reads fine still fails (the source is proven by the sibling)', async () => {
  const { env, engine } = setup();
  const bad = item('locked.pst', 12, { seed: 'locked' });
  env.readable = async (src: UploadSource) => src !== bad.source;
  env.hash = async (source) => {
    await tick();
    if (source === bad.source) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  engine.add([item('fine.pdf', 12), bad]);
  await until(() => statuses(engine)['locked.pst'] === 'failed', 60_000);
  assert.match(view(engine, 'locked.pst').error!, /Could not read this file/);
  await engine.whenIdle();
  assert.equal(statuses(engine)['fine.pdf'], 'done');
});

test('[review r7] Drive reconnecting SLOWER than our API after an ISP outage: files wait for it, none fails', async () => {
  const { server, env, engine } = setup();
  let isp = false;
  let drive = false;
  env.readable = async () => drive;
  server.apiFault = () => (isp ? 'ok' : 0);
  server.fault = () => (isp ? 'ok' : 0);
  env.hash = async (source) => {
    await tick();
    if (!drive) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  engine.add(Array.from({ length: 30 }, (_, i) => item(`g${i}.pdf`, 12, { seed: `g${i}` })));
  const t0 = env.clock;
  await until(() => env.clock - t0 > 5 * 60_000, 400_000); // ISP down 5 min
  isp = true; // our API is back…
  const t1 = env.clock;
  await until(() => env.clock - t1 > 2 * 60_000, 400_000); // …Drive for desktop takes 2 more minutes
  assert.equal(Object.values(statuses(engine)).filter((x) => x === 'failed').length, 0);
  drive = true;
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((x) => x === 'done'));
});

test('[review r7] the hash watchdog runs on the active clock: a laptop asleep mid-hash does not restart or strike the read', async () => {
  const { env, engine } = setup();
  let calls = 0;
  let slept = false;
  env.hash = async (source, onProgress) => {
    calls += 1;
    for (let i = 1; i <= 10; i++) {
      await env.sleep(7_000);
      if (i === 3 && !slept) {
        slept = true;
        env.clock += 60 * 60_000; // the lid closes for an hour…
        await env.sleep(20_000); // …and the read takes a moment to resume after waking
      }
      onProgress(i);
    }
    return (source as FakeSource).sha;
  };
  engine.add([item('long.bin', 12)]);
  await engine.whenIdle();
  assert.equal(statuses(engine)['long.bin'], 'done');
  assert.equal(calls, 1, 'hashed once — not restarted after the sleep');
});

test('[review r7] API for the queue: file(key) is one view; cancel(key, {keepSession}) stops the row without discarding its session', async () => {
  const { server, engine } = setup();
  server.fault = ({ part, attempt }) => (part === 2 && attempt === 1 ? 400 : 'ok');
  engine.add([item('k.bin', 60)]);
  await engine.whenIdle();
  const failed = engine.file('k.bin')!;
  assert.equal(failed.status, 'failed');
  assert.ok(failed.uploadId, 'the session is kept for Retry');
  assert.equal(engine.file('nope'), undefined);
  await engine.cancel('k.bin', { keepSession: true });
  assert.equal(engine.status('k.bin'), 'cancelled');
  assert.equal(server.abortCalls.length, 0, 'no DELETE: the session stays (another copy may be using it)');
});

test('[review r7] a file that fails when read in full, yet reads fine at that spot, still fails (with the link and drive fine) — never an endless loop', async () => {
  const { env, engine } = setup();
  const odd = item('odd.bin', 12, { seed: 'odd' });
  env.readable = async () => true; // every 1-byte read works…
  let reads = 0;
  env.hash = async (source) => {
    await tick();
    if (source === odd.source) {
      reads += 1;
      throw new Error('NotReadableError'); // …but reading it in full always fails
    }
    return (source as FakeSource).sha;
  };
  engine.add([item('fine.pdf', 12), odd]);
  await until(() => statuses(engine)['odd.bin'] === 'failed', 100_000);
  assert.ok(reads >= 3 && reads <= 8, `bounded (${reads} reads)`);
  await engine.whenIdle();
  assert.equal(statuses(engine)['fine.pdf'], 'done');
});

test('[review r7] after the laptop slept, a read that then gets stuck is still abandoned (the watchdog keeps one clock)', async () => {
  const { env, engine } = setup();
  let stuckReads = 0;
  let stuckSince = 0;
  env.hash = async (source, onProgress) => {
    if ((source as FakeSource).sha.startsWith(Buffer.from('stuck').toString('hex'))) {
      stuckReads += 1;
      if (stuckReads === 1) {
        await env.sleep(7_000);
        env.clock += 60 * 60_000; // asleep for an hour…
        await env.sleep(7_000);
        onProgress(1); // …it reads a bit after waking…
        stuckSince = env.clock;
      }
      return new Promise<string>(() => undefined); // …then the network share hangs
    }
    await tick();
    return (source as FakeSource).sha;
  };
  engine.add([item('stuck.bin', 12, { seed: 'stuck' }), item('next.pdf', 12)]);
  await until(() => statuses(engine)['next.pdf'] === 'done', 200_000);
  assert.ok(stuckReads >= 1);
  assert.ok(env.clock - stuckSince < HASH_STALL_MS + 2 * 60_000, 'abandoned within the stall window, not an hour later');
});

test('[review r8] cancelling every file that waited on the drive ends the wait (no stale "is the drive connected?")', async () => {
  const { env, engine } = setup();
  env.readable = async () => false;
  env.hash = async () => {
    await tick();
    throw new Error('NotReadableError');
  };
  engine.add([item('x.pdf', 12, { key: 'x', seed: 'x' }), item('y.pdf', 12, { key: 'y', seed: 'y' })]);
  await until(() => engine.snapshot().readsWaiting, 100_000);
  await engine.cancel('x');
  await engine.cancel('y');
  await until(() => !engine.snapshot().readsWaiting, 10_000);
  assert.equal(engine.hasWork(), false);
});

// ---- review round 8 ------------------------------------------------------------------------

/** A seeded PRNG (mulberry32): real browsers jitter every delay (Math.random). */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('[review r8] with real (jittered) delays the read wait never loses its wake-up: the only file, drive away 2 min, resumes by itself', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { env, engine } = setup();
    env.random = seeded(seed);
    let drive = false;
    env.readable = async () => drive;
    env.hash = async (source) => {
      await tick();
      if (!drive) throw new Error('NotReadableError');
      return (source as FakeSource).sha;
    };
    engine.add([item('solo.pdf', 12)]);
    const t0 = env.clock;
    await until(() => env.clock - t0 > 2 * 60_000, 100_000); // (a lost wake-up freezes the virtual clock here)
    assert.equal(engine.snapshot().readsWaiting, true);
    drive = true;
    await until(() => statuses(engine)['solo.pdf'] === 'done', 100_000);
  }
});

test('[review r8] with jittered delays: a NAS away 10 min under 5 queued files — the wait keeps testing and everything resumes', async () => {
  for (let seed = 1; seed <= 6; seed++) {
    const { env, engine } = setup();
    env.random = seeded(seed * 7);
    let nas = true;
    env.readable = async () => nas;
    env.hash = async (source) => {
      await tick();
      if (!nas) throw new Error('NotReadableError');
      return (source as FakeSource).sha;
    };
    engine.add([item('first.pdf', 12)]);
    await engine.whenIdle();
    nas = false;
    engine.add(Array.from({ length: 5 }, (_, i) => item(`q${i}.pdf`, 12, { seed: `q${i}` })));
    const t0 = env.clock;
    await until(() => env.clock - t0 > 10 * 60_000, 200_000);
    assert.equal(Object.values(statuses(engine)).filter((s) => s === 'failed').length, 0);
    nas = true;
    await until(() => Object.values(statuses(engine)).every((s) => s === 'done'), 200_000);
  }
});

test('[review r8] a sibling Drive for desktop still has CACHED does not prove Drive is back: the drop waits instead of failing', async () => {
  const { env, engine } = setup();
  const cached = item('cached.pdf', 12, { seed: 'cached' });
  let drive = true;
  env.readable = async (src: UploadSource) => drive || src === cached.source; // read before: served from the cache
  env.hash = async (source) => {
    await tick();
    if (!drive && source !== cached.source) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  engine.add([cached]);
  await engine.whenIdle();
  drive = false; // Drive reconnects slower than our API
  engine.add(Array.from({ length: 10 }, (_, i) => item(`d${i}.pdf`, 12, { seed: `d${i}` })));
  const t0 = env.clock;
  await until(() => env.clock - t0 > 5 * 60_000, 200_000);
  assert.equal(Object.values(statuses(engine)).filter((s) => s === 'failed').length, 0, 'nothing failed: Drive is away, not the files');
  assert.equal(engine.snapshot().readsWaiting, true);
  drive = true;
  await until(() => Object.values(statuses(engine)).every((s) => s === 'done'), 200_000);
});

test('[review r8] a sibling never read before DOES prove the drive: a file gone from it fails at once', async () => {
  const { server, env, engine } = setup();
  let gone = false;
  const usb = item('usb.bin', 200);
  let release!: () => void;
  const slowHash = new Promise<void>((r) => (release = r));
  const later = item('later.pdf', 9, { seed: 'later' });
  env.readable = async (src: UploadSource) => !(gone && src === usb.source);
  env.hash = async (source) => {
    await tick();
    if (source === later.source) await slowHash; // still being read: never read up to now
    return (source as FakeSource).sha;
  };
  server.fault = ({ session }) => (session === 's1' && gone ? 0 : 'ok');
  engine.add([usb, later]);
  await until(() => server.okPuts.size >= 3);
  gone = true;
  const start = env.clock;
  await until(() => statuses(engine)['usb.bin'] === 'failed', 100_000);
  assert.match(view(engine, 'usb.bin').error!, /no longer on this computer/);
  assert.ok(env.clock - start < 10 * 60_000, 'at once, not after the no-proof wait');
  release();
  await engine.whenIdle();
  assert.equal(statuses(engine)['later.pdf'], 'done');
});

test('[review r8] PUTs prove nothing about the drive (their bytes were read before): a sibling\'s PUT finishing AFTER the pull does not fail a file', async () => {
  const { server, env, engine } = setup();
  let gone = false;
  env.readable = async () => !gone;
  // small.pdf's one PUT is slow (its body was read when it started); big.bin's parts fail once the drive is pulled
  server.fault = ({ session, attempt }) => (session === 's1' ? (attempt === 1 ? 'slow' : 'ok') : gone ? 0 : 'ok');
  engine.add([item('small.pdf', 12, { seed: 'small' }), item('big.bin', 300, { seed: 'big' })]);
  await until(() => server.okPuts.size >= 3 && server.inFlight > 0, 100_000);
  assert.notEqual(statuses(engine)['small.pdf'], 'done', '(precondition: its PUT is still out)');
  assert.notEqual(statuses(engine)['big.bin'], 'done', '(precondition: big.bin has parts left)');
  gone = true; // …then small.pdf's PUT answers 200, AFTER big.bin found its part unreadable
  const t0 = env.clock;
  await until(() => statuses(engine)['small.pdf'] === 'done', 100_000);
  await until(() => env.clock - t0 > 10 * 60_000, 300_000);
  assert.notEqual(statuses(engine)['big.bin'], 'failed', 'the drive is away — a late 200 of bytes read earlier proves nothing');
  gone = false;
  await engine.whenIdle();
  assert.equal(statuses(engine)['big.bin'], 'done');
  exactlyOnce(server);
});

test('[review r8] an empty (0-byte) file read during an outage proves nothing: the others keep waiting', async () => {
  const { env, engine } = setup();
  let nas = true;
  env.readable = async (src: UploadSource) => nas || (src as FakeSource).size === 0;
  env.hash = async (source) => {
    await tick();
    if (!nas && (source as FakeSource).size > 0) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  engine.add([item('first.pdf', 12)]);
  await engine.whenIdle();
  nas = false;
  engine.add([item('a.pdf', 12, { seed: 'a' }), item('empty.txt', 0, { seed: 'e' }), item('b.pdf', 12, { seed: 'b' })]);
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000, 200_000);
  assert.equal(statuses(engine)['a.pdf'], 'queued');
  assert.equal(statuses(engine)['b.pdf'], 'queued');
  nas = true;
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((s) => s === 'done'));
});

test('[review r8] the ONLY file, edited or moved after the drop (never readable again): fails after the no-proof wait with the right words — not 12 h', async () => {
  const { env, engine } = setup();
  env.readable = async () => false;
  env.hash = async () => {
    await tick();
    throw new Error('NotReadableError');
  };
  engine.add([item('agreement.docx', 12)]);
  const t0 = env.clock;
  await until(() => statuses(engine)['agreement.docx'] === 'failed', 400_000);
  const took = env.clock - t0;
  assert.ok(took >= NO_PROOF_GIVE_UP_MS && took < NO_PROOF_GIVE_UP_MS + 5 * 60_000, `${Math.round(took / 60_000)} min`);
  assert.match(view(engine, 'agreement.docx').error!, /moved, edited or renamed/);
  assert.equal(engine.snapshot().readsWaiting, false, 'nothing waits any more');
});

test('[review r8] once given up, every file still queued behind the one test read fails together (not one per minute)', async () => {
  const { env, engine } = setup({ engine: { giveUpMs: 30 * 60_000 } });
  let nas = true;
  env.readable = async () => nas;
  env.hash = async (source) => {
    await tick();
    if (!nas) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  engine.add([item('first.pdf', 12)]);
  await engine.whenIdle();
  nas = false;
  engine.add(Array.from({ length: 40 }, (_, i) => item(`q${i}.pdf`, 12, { seed: `q${i}` })));
  const t0 = env.clock;
  await until(() => Object.values(statuses(engine)).some((s) => s === 'failed'), 400_000);
  const firstAt = env.clock;
  await until(() => Object.values(statuses(engine)).filter((s) => s === 'failed').length === 40, 400_000);
  assert.ok(env.clock - firstAt < 2 * 60_000, `all within ${Math.round((env.clock - firstAt) / 1000)} s of the first`);
  assert.ok(firstAt - t0 >= 30 * 60_000);
  assert.match(view(engine, 'q39.pdf').error!, /for hours/);
});

test('[review r8] the read wait ends when the files that waited are cancelled — even while other uploads carry on', async () => {
  const { server, env, engine } = setup();
  const w = item('w.pdf', 12, { seed: 'w' });
  env.readable = async (src: UploadSource) => src !== w.source;
  env.hash = async (source) => {
    await tick();
    if (source === w.source) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  server.fault = ({ session }) => (session === 's1' ? 'slow' : 'ok'); // big.bin keeps uploading a while
  engine.add([item('big.bin', 900, { seed: 'big' }), w]);
  await until(() => engine.snapshot().readsWaiting, 100_000);
  await engine.cancel('w.pdf');
  await until(() => !engine.snapshot().readsWaiting, 10_000);
  assert.notEqual(statuses(engine)['big.bin'], 'done', '(precondition: big.bin was still uploading)');
  await engine.whenIdle();
  assert.equal(statuses(engine)['big.bin'], 'done');
  void env;
});

test('[review r8] paused: a file that can\'t be read does NOT make the dock say "Waiting for internet" — it waits for Resume, uncounted', async () => {
  const { server, env, engine } = setup();
  const gone = item('gone.pdf', 12, { seed: 'gone' });
  let goneReads = 0;
  env.readable = async (src: UploadSource) => src !== gone.source;
  env.hash = async (source) => {
    await tick();
    if (source === gone.source) {
      goneReads += 1;
      throw new Error('NotReadableError');
    }
    return (source as FakeSource).sha;
  };
  engine.pause();
  const rest = Array.from({ length: 20 }, (_, i) => item(`r${i}.pdf`, 12, { seed: `r${i}` }));
  engine.add([item('a.pdf', 12, { seed: 'a' }), gone, item('b.pdf', 12, { seed: 'b' }), ...rest]);
  const t0 = env.clock;
  await until(() => rest.every((r) => statuses(engine)[r.key] === 'hashed'), 100_000);
  assert.ok(goneReads <= 2, `the rest hashed ahead, not one test read at a time around gone.pdf (read ${goneReads}×)`);
  await until(() => env.clock - t0 > 30 * 60_000, 100_000);
  const snap = engine.snapshot();
  assert.equal(snap.linkDown, false, 'no ping was sent — nothing says the internet is down');
  assert.equal(server.calls.ping, 0);
  assert.notEqual(statuses(engine)['gone.pdf'], 'failed', 'not judged while paused');
  engine.resume();
  await engine.whenIdle();
  assert.equal(statuses(engine)['gone.pdf'], 'failed');
  assert.equal(statuses(engine)['a.pdf'], 'done');
});

test('[review r8] paused: a hung read is still abandoned after the stall window (the watchdog does not freeze while paused)', async () => {
  const { env, engine } = setup();
  let stuckReads = 0;
  env.hash = async (source, _onProgress, signal) => {
    if ((source as FakeSource).sha.startsWith(Buffer.from('stuck').toString('hex')) && stuckReads++ === 0) {
      await stopped(signal!); // this read never settles (until abandoned)
    }
    await tick();
    return (source as FakeSource).sha;
  };
  engine.pause();
  engine.add([item('stuck.bin', 12, { seed: 'stuck' }), item('next.pdf', 12, { seed: 'next' })]);
  const t0 = env.clock;
  await until(() => statuses(engine)['next.pdf'] === 'hashed', 100_000);
  assert.ok(env.clock - t0 <= HASH_STALL_MS + 2 * 60_000, `hashed ahead while paused (${Math.round((env.clock - t0) / 60_000)} min)`);
  engine.resume();
  await engine.whenIdle();
  assert.equal(statuses(engine)['next.pdf'], 'done');
});

test('[review r8] a congested uplink (every /health ping slow) forgives a bad file only a few times — then it fails', async () => {
  const { server, env, engine } = setup();
  const odd = item('odd.bin', 12, { seed: 'odd' });
  env.readable = async () => true; // every 1-byte read works…
  let reads = 0;
  env.hash = async (source) => {
    await tick();
    if (source === odd.source) {
      reads += 1;
      throw new Error('NotReadableError'); // …but reading it in full always fails
    }
    return (source as FakeSource).sha;
  };
  // bufferbloat: the ping always takes 4 s — "link trouble" at every judgement, for good
  const realPing = server.ping.bind(server);
  server.ping = async (signal) => {
    await server.sleep(4_000, signal);
    return realPing(signal);
  };
  engine.add([item('fine.pdf', 12, { seed: 'fine' }), odd]);
  const t0 = env.clock;
  await until(() => statuses(engine)['odd.bin'] === 'failed', 400_000);
  // forgiven (spaced out) for the blip window, then counted: it fails — not re-read forever
  assert.ok(reads <= 80, `a few dozen re-reads at most (${reads})`);
  assert.ok(env.clock - t0 < 45 * 60_000, `failed after ${Math.round((env.clock - t0) / 60_000)} min`);
  await engine.whenIdle();
  assert.equal(statuses(engine)['fine.pdf'], 'done');
});

test('[review r8] re-reading the part of a big file that was read before (cached) proves nothing: an upload whose part is unreadable keeps waiting', async () => {
  const { server, env, engine } = setup();
  const MiB = 1024 * 1024;
  const scan = item('scan.mov', 64 * MiB, { seed: 'scan' });
  let drive = true;
  let pulled = false;
  // Drive goes away 20 MiB into scan.mov: those 20 MiB stay in Drive for desktop's
  // cache; the rest (and every other file) needs Drive
  env.readable = async (src: UploadSource, start: number) => drive || (src === scan.source && start < 20 * MiB);
  env.hash = async (source, onProgress) => {
    await tick();
    if (source === scan.source) {
      for (let at = 2 * MiB; at <= 64 * MiB; at += 2 * MiB) {
        if (at > 20 * MiB && !pulled) {
          pulled = true;
          drive = false;
        }
        if (!drive && at > 20 * MiB) throw new Error('NotReadableError');
        onProgress(at); // (a re-read gets through the cached 20 MiB first)
        await tick();
      }
    } else if (!drive) {
      throw new Error('NotReadableError');
    }
    return (source as FakeSource).sha;
  };
  // up.bin uploads slowly (it was hashed before the pull: its parts need Drive)
  server.fault = ({ session }) => (session === 's1' ? (drive ? 'slow' : 0) : 'ok');
  engine.add([item('up.bin', 300, { seed: 'up' })]);
  await until(() => server.okPuts.size >= 2, 100_000);
  engine.add([scan]);
  await until(() => !drive, 100_000);
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000, 400_000);
  assert.notEqual(statuses(engine)['up.bin'], 'failed', 'Drive is away: re-reading cached bytes is not proof that it is back');
  drive = true;
  await engine.whenIdle();
  assert.equal(statuses(engine)['up.bin'], 'done');
  assert.equal(statuses(engine)['scan.mov'], 'done');
});

test('[review r8] while an upload\'s part waits on the drive, the queued files still get their spaced-out test reads', async () => {
  const { server, env, engine } = setup();
  let drive = true;
  let qReads = 0;
  env.readable = async () => drive;
  env.hash = async (source) => {
    await tick();
    if ((source as FakeSource).sha.startsWith(Buffer.from('q').toString('hex'))) {
      qReads += 1;
      if (!drive) throw new Error('NotReadableError');
    } else if (!drive) {
      throw new Error('NotReadableError');
    }
    return (source as FakeSource).sha;
  };
  server.fault = ({ session }) => (session === 's1' ? (drive ? 'slow' : 0) : 'ok');
  engine.add([item('up.bin', 300, { seed: 'up' })]);
  await until(() => server.okPuts.size >= 2, 100_000);
  drive = false;
  engine.add(Array.from({ length: 3 }, (_, i) => item(`q${i}.pdf`, 12, { seed: `q${i}` })));
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000, 400_000);
  assert.ok(qReads >= 8, `test reads kept coming, one at a time (${qReads} in 10 min)`);
  assert.ok(qReads <= 40, `…and spaced out (${qReads} in 10 min)`);
  drive = true;
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((x) => x === 'done'));
});

// ---- review round 9 ------------------------------------------------------------------------

const startsWith = (src: unknown, prefix: string) => (src as FakeSource).sha.startsWith(Buffer.from(prefix).toString('hex'));

test('[review r9→r10] a folder moved or renamed mid-drop: the other folders are not held back; its files fail within the short wait — not 12 h', async () => {
  const { env, engine } = setup();
  env.random = seeded(3);
  let bGone = false;
  env.readable = async (src: UploadSource) => !(bGone && startsWith(src, 'B'));
  env.hash = async (source) => {
    await env.sleep(2_000); // 2 s per PDF
    if (bGone && startsWith(source, 'B')) throw new Error('NotFoundError');
    return (source as FakeSource).sha;
  };
  const files = [
    ...Array.from({ length: 20 }, (_, i) => item(`A${i}.pdf`, 12, { seed: `A${i}`, folderId: 'fa' })),
    ...Array.from({ length: 30 }, (_, i) => item(`B${i}.pdf`, 12, { seed: `B${i}`, folderId: 'fb' })),
    ...Array.from({ length: 40 }, (_, i) => item(`C${i}.pdf`, 12, { seed: `C${i}`, folderId: 'fc' })),
  ];
  engine.add(files);
  await until(() => !['queued', 'hashing'].includes(statuses(engine)['A19.pdf']), 200_000);
  bGone = true; // a colleague renames B/ in the shared Drive
  const t0 = env.clock;
  let firstC = Infinity;
  let allC = Infinity;
  const watch = setInterval(() => {
    const st = statuses(engine);
    if (firstC === Infinity && files.slice(50).some((f) => !['queued', 'hashing'].includes(st[f.key]))) firstC = env.clock - t0;
    if (allC === Infinity && files.slice(50).every((f) => st[f.key] === 'done')) allC = env.clock - t0;
  }, 0);
  await engine.whenIdle();
  clearInterval(watch);
  const st = statuses(engine);
  assert.ok(files.slice(50).every((f) => st[f.key] === 'done'), 'every C file uploaded');
  assert.ok(files.slice(20, 50).every((f) => st[f.key] === 'failed'), 'the moved files fail (drop them again from where they are now)');
  assert.ok(firstC < 10 * 60_000, `C/ was not held back (${Math.round(firstC / 60_000)} min)`);
  assert.ok(allC < 20 * 60_000, `all of C/ uploaded in ${Math.round(allC / 60_000)} min`);
  // (gone files are judged one at a time; each fails at the latest when its own 30-min "can't tell" clock runs out)
  assert.ok(env.clock - t0 < 120 * 60_000, `settled in ${Math.round((env.clock - t0) / 60_000)} min, not 12 h`);
  assert.equal(engine.snapshot().readsWaiting, false);
});

test('[review r9] two files that can never be read, last in the drop: they fail after the short wait with the right words — not 12 h', async () => {
  const { env, engine } = setup();
  env.random = seeded(4);
  env.readable = async (src: UploadSource) => !startsWith(src, 'L');
  env.hash = async (source) => {
    await tick();
    if (startsWith(source, 'L')) throw new Error('NotReadableError'); // locked (.pst / .ost) or deleted
    return (source as FakeSource).sha;
  };
  engine.add([
    ...Array.from({ length: 10 }, (_, i) => item(`g${i}.pdf`, 12, { seed: `g${i}` })),
    item('outlook.pst', 12, { seed: 'L1' }),
    item('outlook.ost', 12, { seed: 'L2' }),
  ]);
  const t0 = env.clock;
  await engine.whenIdle();
  const took = env.clock - t0;
  assert.ok(took < 45 * 60_000, `${Math.round(took / 60_000)} min`);
  for (const k of ['outlook.pst', 'outlook.ost']) {
    assert.equal(statuses(engine)[k], 'failed');
    assert.doesNotMatch(view(engine, k).error!, /for hours/);
  }
});

test('[review r9] a NAS off for 2½ h while the drop UPLOADS (everything read already): nothing fails, and the waiting parts back off', async () => {
  const { server, env, engine } = setup();
  env.random = seeded(5);
  let nas = true;
  let probes = 0;
  env.readable = async () => {
    probes += 1;
    return nas;
  };
  server.fault = () => (nas ? 'slow' : 0);
  engine.add(Array.from({ length: 40 }, (_, i) => item(`n${i}.pdf`, 12, { seed: `n${i}` })));
  await until(() => Object.values(statuses(engine)).every((x) => x !== 'queued' && x !== 'hashing'), 200_000);
  await until(() => server.okPuts.size >= 3, 200_000);
  nas = false; // load-shedding: the NAS goes off; router and internet stay on the UPS
  const signs0 = server.calls.sign;
  const t0 = env.clock;
  await until(() => env.clock - t0 > 150 * 60_000, 3_000_000);
  assert.equal(Object.values(statuses(engine)).filter((x) => x === 'failed').length, 0, 'the NAS is off — no file is "moved or edited"');
  assert.equal(engine.snapshot().readsWaiting, true);
  const signs = server.calls.sign - signs0;
  assert.ok(signs < 1_500, `waiting parts back off (${signs} sign calls in 150 min)`);
  assert.ok(probes < 3_500, `a few 1-byte probes per spaced-out part check (${probes} probes)`);
  nas = true;
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((x) => x === 'done'));
  exactlyOnce(server);
});

test('[review r9] a Drive-streamed read broken by 20 ISP flaps in a row still finishes (blips are forgiven by time, not by count)', async () => {
  const { server, env, engine } = setup();
  let down = false;
  env.readable = async () => !down;
  server.apiFault = (m) => (down && m !== 'ping' ? 0 : 'ok');
  server.fault = () => (down ? 0 : 'ok');
  const realPing = server.ping.bind(server);
  server.ping = async (signal) => {
    while (down) await server.sleep(500, signal);
    return realPing(signal);
  };
  const long = item('long.mov', 12, { seed: 'long' });
  env.hash = async (source, onProgress) => {
    if (source === long.source) {
      for (let i = 1; i <= 10; i++) {
        await env.sleep(2_000); // a 20 s read — no 5 s "up" window lets it finish
        if (down) throw new Error('NotReadableError');
        onProgress(i);
      }
    }
    await tick();
    return (source as FakeSource).sha;
  };
  engine.add([item('sibling.pdf', 12, { seed: 'sib' })]);
  await engine.whenIdle();
  engine.add([long]);
  for (let i = 0; i < 40; i++) {
    await env.sleep(5_000);
    down = !down; // 5 s up / 5 s down, twenty outages mid-read
  }
  down = false;
  await engine.whenIdle();
  assert.equal(statuses(engine)['long.mov'], 'done');
});

test('[review r9] the lid closes for an hour while PAUSED mid-hash: the read is not abandoned on wake (sleep counts as sleep)', async () => {
  const { env, engine } = setup();
  let calls = 0;
  let slept = false;
  env.hash = async (source, onProgress) => {
    calls += 1;
    for (let i = 1; i <= 10; i++) {
      await env.sleep(7_000);
      if (i === 3 && !slept) {
        slept = true;
        env.clock += 60 * 60_000; // the lid closes for an hour…
        await env.sleep(20_000); // …and the read takes a moment to resume after waking
      }
      onProgress(i);
    }
    return (source as FakeSource).sha;
  };
  engine.pause();
  engine.add([item('long.bin', 12)]);
  await until(() => statuses(engine)['long.bin'] === 'hashed', 200_000);
  assert.equal(calls, 1, 'hashed once — not restarted after the sleep');
  engine.resume();
  await engine.whenIdle();
  assert.equal(statuses(engine)['long.bin'], 'done');
});

test('[review r9] a NAS cut seconds after a file read fine: that recent read vouches for ONE strike at most — no file fails', async () => {
  const { env, engine } = setup();
  let nas = true;
  env.readable = async () => nas;
  env.hash = async (source) => {
    await env.sleep(1_000);
    if (!nas) throw new Error('NotReadableError');
    if (startsWith(source, 'first')) nas = false; // the NAS loses power right after this read
    return (source as FakeSource).sha;
  };
  engine.add([item('first.pdf', 12, { seed: 'first' }), ...Array.from({ length: 5 }, (_, i) => item(`q${i}.pdf`, 12, { seed: `q${i}` }))]);
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000, 400_000);
  assert.equal(Object.values(statuses(engine)).filter((x) => x === 'failed').length, 0, 'the NAS is off — no file is struck out');
  nas = true;
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((x) => x === 'done'));
});

test('[review r9] paused, then the drive goes away: a few reads fail and the paused engine stops reading until Resume (not every file in turn)', async () => {
  const { env, engine } = setup();
  let drive = true;
  let reads = 0;
  env.readable = async () => drive;
  env.hash = async (source) => {
    await tick();
    reads += 1;
    if (!drive) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  engine.pause();
  drive = false; // Drive for desktop quits / the USB drive is pulled while paused
  engine.add(Array.from({ length: 200 }, (_, i) => item(`p${i}.pdf`, 12, { seed: `p${i}` })));
  const t0 = env.clock;
  await until(() => env.clock - t0 > 60 * 60_000, 400_000);
  assert.ok(reads <= 10, `${reads} reads while paused, not one per file every few minutes`);
  assert.equal(engine.snapshot().linkDown, false);
  drive = true;
  engine.resume();
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((x) => x === 'done'));
});

test('[review r9] a NAS off while files upload: the dock asks about the DRIVE (our API still answers) — not "Waiting for internet"', async () => {
  const { server, env, engine } = setup();
  env.random = seeded(9);
  let nas = true;
  env.readable = async () => nas;
  server.fault = () => (nas ? 'slow' : 0); // a PUT whose body can't be read fails like a dropped connection
  const realSign = server.signParts.bind(server);
  server.signParts = async (id, parts, signal) => {
    await server.sleep(500, signal); // a real round trip to our API
    return realSign(id, parts, signal);
  };
  engine.add(Array.from({ length: 8 }, (_, i) => item(`v${i}.mov`, 600, { seed: `v${i}` })));
  await until(() => Object.values(statuses(engine)).every((x) => x !== 'queued' && x !== 'hashing'), 200_000);
  await until(() => server.okPuts.size >= 5, 200_000);
  nas = false;
  const t0 = env.clock;
  for (const m of [5, 10, 15, 20, 25]) {
    await until(() => env.clock - t0 > m * 60_000, 2_000_000);
    const snap = engine.snapshot();
    assert.equal(snap.linkDown, false, `at ${m} min: not "Waiting for internet"`);
    assert.equal(snap.readsWaiting, true, `at ${m} min: "is the drive connected?"`);
  }
  nas = true;
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((x) => x === 'done'));
  exactlyOnce(server);
});

test('[review r9] an untestable file\'s 30-min clock stops during an internet outage: files added meanwhile never fail, nor does it', async () => {
  const { server, env, engine } = setup();
  let isp = true;
  const f = item('f.pdf', 12, { seed: 'F' });
  env.readable = async (src: UploadSource) => isp && src !== f.source;
  env.hash = async (source) => {
    await tick();
    if (!isp || source === f.source) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  server.apiFault = () => (isp ? 'ok' : 0); // (the /health ping too)
  server.fault = () => (isp ? 'ok' : 0);
  engine.add([f]); // the only file, and it can't be read: nothing to test the source with
  const t0 = env.clock;
  await until(() => env.clock - t0 > 2 * 60_000, 200_000);
  isp = false; // the ISP drops (Wi-Fi stays up)
  await until(() => env.clock - t0 > 8 * 60_000, 200_000);
  const later = Array.from({ length: 3 }, (_, i) => item(`n${i}.pdf`, 12, { seed: `n${i}` }));
  engine.add(later); // re-dropped / retried while the internet is down
  await until(() => env.clock - t0 > 40 * 60_000, 2_000_000);
  assert.equal(later.filter((x) => statuses(engine)[x.key] === 'failed').length, 0, 'an outage fails nothing');
  assert.notEqual(statuses(engine)['f.pdf'], 'failed', '…and the outage did not count toward its clock');
  isp = true;
  await until(() => later.every((x) => statuses(engine)[x.key] === 'done'), 400_000);
});

// ---- review round 10 -----------------------------------------------------------------------

test('[review r10] three short hiccups of the drive (a loose USB cable, Drive for desktop restarting): no file is struck out', async () => {
  const { env, engine } = setup();
  env.random = seeded(11);
  let away = false;
  let probes = 0;
  const gone = (src: unknown) => startsWith(src, 'gone');
  env.readable = async (src: UploadSource) => {
    probes += 1;
    return !away && !gone(src);
  };
  env.hash = async (source) => {
    if (away || gone(source)) {
      await env.sleep(7);
      throw new Error('NotReadableError');
    }
    await env.sleep(1_000); // a Drive-streamed PDF
    if (away) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  // ~10 min of reading; a few deleted files among them keep source checks going all the time
  engine.add(Array.from({ length: 600 }, (_, i) => (i % 40 === 20 ? item(`gone${i}.pdf`, 12, { seed: `gone${i}` }) : item(`h${i}.pdf`, 12, { seed: `h${i}` }))));
  const t0 = env.clock;
  for (const at of [1, 3, 5]) {
    await until(() => env.clock - t0 > at * 60_000, 400_000);
    away = true;
    const s0 = env.clock;
    await until(() => env.clock - s0 > 30_000, 400_000);
    away = false;
  }
  await engine.whenIdle();
  const failed = Object.entries(statuses(engine)).filter(([, x]) => x === 'failed').map(([k]) => k);
  assert.ok(failed.every((k) => k.startsWith('gone')), `only the deleted files fail (${failed.filter((k) => !k.startsWith('gone')).length} others did)`);
  assert.ok(probes < 400, `a burst of failures shares one source check (${probes} probes)`);
});

test('[review r10] Drive for desktop drops out twice, 34 min apart, during the hash phase: the second dropout does not fail files at once', async () => {
  const { env, engine } = setup();
  env.random = seeded(12);
  let drive = true;
  const cached = new Set<unknown>(); // what Drive for desktop keeps locally (every file read before)
  env.readable = async (src: UploadSource) => drive || cached.has(src);
  env.hash = async (source) => {
    await env.sleep(20_000); // a slow Drive stream: the drop reads for ~50 min
    if (!drive && !cached.has(source)) throw new Error('NotReadableError');
    cached.add(source);
    return (source as FakeSource).sha;
  };
  engine.add(Array.from({ length: 150 }, (_, i) => item(`d${i}.pdf`, 12, { seed: `d${i}` })));
  const t0 = env.clock;
  for (const at of [2, 36]) {
    await until(() => env.clock - t0 > at * 60_000, 2_000_000);
    drive = false;
    const s0 = env.clock;
    await until(() => env.clock - s0 > 3 * 60_000, 2_000_000);
    assert.equal(Object.values(statuses(engine)).filter((x) => x === 'failed').length, 0, `dropout at ${at} min: nothing failed`);
    drive = true;
  }
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((x) => x === 'done'));
});

test('[review r10] a big upload through two Drive reconnect lags, 34 min apart: its parts reading again stops the "can\'t tell" clock', async () => {
  const { server, env, engine } = setup();
  env.random = seeded(13);
  const video = item('lecture.mov', 16_000, { seed: 'video' }); // 1,600 parts: an hour of uploading
  const known = item('first.pdf', 12, { seed: 'first' });
  let drive = true;
  env.readable = async (src: UploadSource) => drive || src === known.source; // the first file stays in Drive's cache
  server.fault = ({ session }) => (session === 's2' ? (drive ? 'slow' : 0) : 'ok'); // the video's parts need Drive
  engine.add([known, video]);
  await until(() => statuses(engine)['first.pdf'] === 'done' && statuses(engine)['lecture.mov'] === 'uploading', 200_000);
  const t0 = env.clock;
  for (const at of [2, 36]) {
    await until(() => env.clock - t0 > at * 60_000, 3_000_000);
    drive = false; // ISP came back, Drive has not reconnected yet
    const s0 = env.clock;
    await until(() => env.clock - s0 > 3 * 60_000, 3_000_000);
    assert.notEqual(statuses(engine)['lecture.mov'], 'failed', `lag at ${at} min`);
    drive = true;
  }
  await engine.whenIdle();
  assert.equal(statuses(engine)['lecture.mov'], 'done');
  exactlyOnce(server);
});

test('[review r10] paused and no longer testing the drive: the dock says "Paused", not "can\'t read the files"', async () => {
  const { env, engine } = setup();
  let drive = true;
  env.readable = async () => drive;
  env.hash = async (source) => {
    await tick();
    if (!drive) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  engine.add([item('first.pdf', 12, { seed: 'first' })]);
  await engine.whenIdle();
  drive = false;
  engine.add(Array.from({ length: 20 }, (_, i) => item(`w${i}.pdf`, 12, { seed: `w${i}` })));
  await until(() => engine.snapshot().readsWaiting, 200_000);
  engine.pause();
  const t0 = env.clock;
  await until(() => env.clock - t0 > 30 * 60_000, 400_000);
  const snap = engine.snapshot();
  assert.equal(snap.paused, true);
  assert.equal(snap.readsWaiting, false, 'nothing is being tested while paused — it says Paused');
  drive = true;
  engine.resume();
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((x) => x === 'done'));
});

test('[review r10] a NAS cut while multi-part files upload never flips the dock to "Waiting for internet"', async () => {
  const { server, env, engine } = setup();
  env.random = seeded(14);
  let nas = true;
  let probes = 0;
  env.readable = async () => {
    probes += 1;
    return nas;
  };
  server.fault = () => (nas ? 'slow' : 0);
  const realSign = server.signParts.bind(server);
  server.signParts = async (id, parts, signal) => {
    await server.sleep(450, signal);
    return realSign(id, parts, signal);
  };
  engine.add(Array.from({ length: 4 }, (_, i) => item(`m${i}.mov`, 600, { seed: `m${i}` })));
  await until(() => Object.values(statuses(engine)).every((x) => x !== 'queued' && x !== 'hashing'), 200_000);
  await until(() => server.okPuts.size >= 5, 200_000);
  nas = false;
  const t0 = env.clock;
  const signs0 = server.calls.sign;
  let wrong = 0;
  for (let k = 1; k <= 80; k++) {
    await until(() => env.clock - t0 > k * 15_000, 2_000_000);
    if (engine.snapshot().linkDown) wrong += 1;
  }
  assert.equal(wrong, 0, `"Waiting for internet" in ${wrong} of 80 samples`);
  // a file waiting on its drive retries only the part that found it unreadable — not every part in turn
  assert.ok(probes < 1_500, `${probes} probes in 20 min`);
  assert.ok(server.calls.sign - signs0 < 600, `${server.calls.sign - signs0} sign calls in 20 min`);
  nas = true;
  await engine.whenIdle();
  assert.ok(Object.values(statuses(engine)).every((x) => x === 'done'));
});

// ---- review round 11 -----------------------------------------------------------------------

test('[review r11] a moved folder of 100 files mid-drop: they all fail within minutes of each other — not one per minute for hours', async () => {
  const { env, engine } = setup();
  env.random = seeded(21);
  let bGone = false;
  env.readable = async (src: UploadSource) => !(bGone && startsWith(src, 'B'));
  env.hash = async (source) => {
    await env.sleep(200);
    if (bGone && startsWith(source, 'B')) throw new Error('NotFoundError');
    return (source as FakeSource).sha;
  };
  const files = [
    ...Array.from({ length: 50 }, (_, i) => item(`A${i}.pdf`, 12, { seed: `A${i}`, folderId: 'fa' })),
    ...Array.from({ length: 100 }, (_, i) => item(`B${i}.pdf`, 12, { seed: `B${i}`, folderId: 'fb' })),
    ...Array.from({ length: 150 }, (_, i) => item(`C${i}.pdf`, 12, { seed: `C${i}`, folderId: 'fc' })),
  ];
  engine.add(files);
  await until(() => !['queued', 'hashing'].includes(statuses(engine)['A49.pdf']), 200_000);
  bGone = true;
  const t0 = env.clock;
  await engine.whenIdle();
  const st = statuses(engine);
  assert.ok(files.slice(150).every((f) => st[f.key] === 'done'));
  assert.ok(files.slice(50, 150).every((f) => st[f.key] === 'failed'));
  assert.ok(env.clock - t0 < 45 * 60_000, `settled in ${Math.round((env.clock - t0) / 60_000)} min`);
});

test('[review r11] a file edited during a NAS cut (never readable again): once the NAS is back it fails within the short wait — not 12 h', async () => {
  const { server, env, engine } = setup();
  env.random = seeded(22);
  let nas = true;
  let edited = false;
  const doc = item('doc7.pdf', 12, { seed: 'doc7' });
  env.readable = async (src: UploadSource) => nas && !(edited && src === doc.source);
  server.fault = ({ session }) => {
    if (!nas) return 0;
    if (edited && session === 's8') return 0; // doc7's PUTs can't read it any more
    return 'slow';
  };
  engine.add([...Array.from({ length: 7 }, (_, i) => item(`doc${i}.pdf`, 12, { seed: `doc${i}` })), doc, ...Array.from({ length: 22 }, (_, i) => item(`e${i}.pdf`, 12, { seed: `e${i}` }))]);
  await until(() => Object.values(statuses(engine)).every((x) => x !== 'queued' && x !== 'hashing'), 200_000);
  await until(() => server.okPuts.size >= 3, 200_000);
  nas = false;
  edited = true; // meanwhile someone saves over doc7.pdf
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000, 2_000_000);
  nas = true;
  await until(() => statuses(engine)['doc7.pdf'] === 'failed', 3_000_000);
  assert.ok(env.clock - t0 < 60 * 60_000, `failed after ${Math.round((env.clock - t0) / 60_000)} min, not 12 h`);
  await engine.whenIdle();
  assert.equal(Object.values(statuses(engine)).filter((x) => x === 'done').length, 29);
});

test('[review r11] a whole client folder moved mid-upload: its own files are never the "known good" drive test, so a stuck file fails in the short wait — not 12 h', async () => {
  const { server, env, engine } = setup();
  env.random = seeded(23);
  let xGone = false;
  const inX = (src: unknown) => startsWith(src, 'X');
  env.readable = async (src: UploadSource) => !(xGone && inX(src));
  const video = item('interview.mp4', 130, { seed: 'Xvideo', folderId: 'xv', relativePath: 'X/Videos/interview.mp4' });
  let videoSession = '';
  server.fault = ({ session }) => (xGone && session === videoSession ? 0 : 'slow');
  engine.add([
    ...Array.from({ length: 10 }, (_, i) => item(`b${i}.pdf`, 12, { seed: `Xb${i}`, folderId: 'xb', relativePath: `X/Bank/b${i}.pdf` })),
    ...Array.from({ length: 10 }, (_, i) => item(`p${i}.pdf`, 12, { seed: `Xp${i}`, folderId: 'xp', relativePath: `X/Passport/p${i}.pdf` })),
    ...Array.from({ length: 10 }, (_, i) => item(`y${i}.pdf`, 12, { seed: `Y${i}`, folderId: 'y', relativePath: `Y/y${i}.pdf` })),
    video,
  ]);
  await until(() => statuses(engine)['interview.mp4'] === 'uploading', 400_000);
  videoSession = view(engine, 'interview.mp4').uploadId!;
  await until(() => server.okPuts.size >= 25, 400_000);
  xGone = true; // the client folder X is moved in the shared Drive
  const t0 = env.clock;
  await until(() => statuses(engine)['interview.mp4'] === 'failed', 3_000_000);
  assert.ok(env.clock - t0 < 60 * 60_000, `failed after ${Math.round((env.clock - t0) / 60_000)} min`);
  assert.match(view(engine, 'interview.mp4').error!, /moved|no longer on this computer/);
});

test('[review r11] a NAS that comes back for a moment and goes again: a read in that moment does not make a waiting upload "no longer on this computer"', async () => {
  for (const seed of [31, 32, 33, 34]) {
    const { server, env, engine } = setup();
    env.random = seeded(seed);
    let nas = true;
    env.readable = async () => nas;
    env.hash = async (source) => {
      await env.sleep(3_000);
      if (!nas) throw new Error('NotReadableError');
      return (source as FakeSource).sha;
    };
    const video = item('film.mov', 1_600, { seed: 'film' }); // 160 parts
    let videoSession = '';
    server.fault = ({ session }) => (!nas && session === videoSession ? 0 : session === videoSession ? 'slow' : 'ok');
    engine.add([video, ...Array.from({ length: 200 }, (_, i) => item(`q${i}.pdf`, 12, { seed: `q${i}` }))]);
    await until(() => statuses(engine)['film.mov'] === 'uploading', 400_000);
    videoSession = view(engine, 'film.mov').uploadId!;
    await until(() => server.okPuts.size >= 20, 400_000);
    const t0 = env.clock;
    for (const [off, on] of [[0, 2], [2.5, 20]]) {
      await until(() => env.clock - t0 >= off * 60_000, 2_000_000);
      nas = false;
      await until(() => env.clock - t0 >= on * 60_000 - (on === 2 ? 30_000 : 0), 2_000_000);
      nas = true; // (back for 30 s between the two cuts)
    }
    assert.notEqual(statuses(engine)['film.mov'], 'failed', `seed ${seed}: the NAS was away — not the file`);
    engine.pause();
  }
});

// ---- review round 12 -----------------------------------------------------------------------

test('[review r12] a file unlucky once (a strike with proof) is not finished off by later, unrelated Drive dropouts', async () => {
  for (const seed of [1, 2, 3]) {
    const { env, engine } = setup();
    env.random = seeded(seed);
    let drive = true;
    const cached = new Set<unknown>(); // Drive for desktop keeps what was read
    const x = item('x.pdf', 12, { seed: 'xfile' });
    let xBusyUntil = -1;
    let xTried = false;
    env.readable = async (src: UploadSource) => {
      if (src === x.source && env.clock < xBusyUntil) return false;
      return drive || cached.has(src);
    };
    env.hash = async (source) => {
      if (source === x.source && !xTried) {
        xTried = true;
        xBusyUntil = env.clock + 15_000; // Drive was syncing it: unreadable for 15 s
        await env.sleep(500);
        throw new Error('NotReadableError');
      }
      await env.sleep(20_000); // a slow Drive stream
      if (source === x.source && env.clock < xBusyUntil) throw new Error('NotReadableError');
      if (!drive && !cached.has(source)) throw new Error('NotReadableError');
      cached.add(source);
      return (source as FakeSource).sha;
    };
    const files = Array.from({ length: 200 }, (_, i) => item(`d${i}.pdf`, 12, { seed: `d${i}` }));
    files.splice(3, 0, x);
    engine.add(files);
    const t0 = env.clock;
    for (const at of [20, 50]) {
      await until(() => env.clock - t0 > at * 60_000, 3_000_000);
      drive = false;
      const s0 = env.clock;
      await until(() => env.clock - s0 > 3 * 60_000, 3_000_000);
      drive = true;
    }
    await engine.whenIdle();
    const failed = Object.entries(statuses(engine)).filter(([, s]) => s === 'failed').map(([k]) => k);
    assert.deepEqual(failed, [], `seed ${seed}`);
  }
});

test('[review r12] ISP flaps followed by Drive reconnect lags do not strike out a file that was unlucky once', async () => {
  for (const seed of [1, 2, 3]) {
    const { server, env, engine } = setup();
    env.random = seeded(seed);
    let isp = true;
    let drive = true;
    const cached = new Set<unknown>();
    const x = item('x.pdf', 12, { seed: 'xfile' });
    let xBusyUntil = -1;
    let xTried = false;
    server.apiFault = () => (isp ? 'ok' : 0);
    server.fault = () => (isp ? 'ok' : 0);
    env.readable = async (src: UploadSource) => {
      if (src === x.source && env.clock < xBusyUntil) return false;
      return drive || cached.has(src);
    };
    env.hash = async (source) => {
      if (source === x.source && !xTried) {
        xTried = true;
        xBusyUntil = env.clock + 15_000;
        await env.sleep(500);
        throw new Error('NotReadableError');
      }
      if (!drive && !cached.has(source)) {
        await env.sleep(2_000);
        throw new Error('NotReadableError');
      }
      await env.sleep(20_000);
      if (!drive && !cached.has(source)) throw new Error('NotReadableError');
      cached.add(source);
      return (source as FakeSource).sha;
    };
    const files = Array.from({ length: 200 }, (_, i) => item(`d${i}.pdf`, 12, { seed: `d${i}` }));
    files.splice(3, 0, x);
    engine.add(files);
    const t0 = env.clock;
    for (const at of [15, 40]) {
      await until(() => env.clock - t0 > at * 60_000, 3_000_000);
      isp = false;
      drive = false;
      const s0 = env.clock;
      await until(() => env.clock - s0 > 8_000, 3_000_000);
      isp = true; // the internet is back…
      await until(() => env.clock - s0 > 98_000, 3_000_000);
      drive = true; // …Drive for desktop reconnects 90 s later
    }
    await engine.whenIdle();
    const failed = Object.entries(statuses(engine)).filter(([, s]) => s === 'failed').map(([k]) => k);
    assert.deepEqual(failed, [], `seed ${seed}`);
  }
});

test('[review r12] a moved part of ONE client folder, spanning 10 subfolders: the rest of the folder is not held behind "is the drive connected?"', async () => {
  const { env, engine } = setup();
  env.random = seeded(24);
  let moved = false;
  const isMoved = (src: unknown) => startsWith(src, 'M');
  env.readable = async (src: UploadSource) => !(moved && isMoved(src));
  env.hash = async (source) => {
    if (moved && isMoved(source)) {
      await env.sleep(3);
      throw new Error('NotFoundError');
    }
    await env.sleep(200);
    return (source as FakeSource).sha;
  };
  const before = Array.from({ length: 100 }, (_, i) => item(`a${i}.pdf`, 12, { seed: `A${i}`, folderId: `fa${i % 5}`, relativePath: `Client/Before/s${i % 5}/a${i}.pdf` }));
  const gone = Array.from({ length: 200 }, (_, i) => item(`m${i}.pdf`, 12, { seed: `M${i}`, folderId: `fm${i % 10}`, relativePath: `Client/Moved/s${i % 10}/m${i}.pdf` }));
  const after = Array.from({ length: 300 }, (_, i) => item(`c${i}.pdf`, 12, { seed: `C${i}`, folderId: `fc${i % 5}`, relativePath: `Client/After/s${i % 5}/c${i}.pdf` }));
  engine.add([...before, ...gone, ...after]);
  await until(() => !['queued', 'hashing'].includes(statuses(engine)['a99.pdf']), 400_000);
  moved = true;
  const t0 = env.clock;
  await until(() => after.filter((f) => statuses(engine)[f.key] === 'done').length >= 150, 3_000_000);
  assert.ok(env.clock - t0 < 5 * 60_000, `half of the rest done ${Math.round((env.clock - t0) / 60_000)} min after the move`);
  await engine.whenIdle();
  assert.ok(after.every((f) => statuses(engine)[f.key] === 'done'));
  // (one moved file may have been read just before the move — it uploads normally)
  assert.ok(gone.filter((f) => statuses(engine)[f.key] === 'failed').length >= gone.length - 1);
  assert.ok(gone.every((f) => ['failed', 'done'].includes(statuses(engine)[f.key])));
});
