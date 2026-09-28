import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_SNAPSHOT, UploadQueue } from './queue.ts';
import type { DropFile, LandedEvent, QueueDeps, QueueTarget } from './queue.ts';
import { TransportError, UploadEngine } from './engine.ts';
import { FakeServer, FakeSource, exactlyOnce, makeEnv, stopped, tick, until } from './testing/fake-server.ts';

/**
 * The upload queue driving the REAL engine against the fake server + R2, on
 * the virtual clock. A fake ensure-paths merges folders like the backend
 * (exact name per parent); a fake standard upload stands in for proxy mode; a
 * fake session hands out JWTs whose `sub` identifies the user.
 */

const MiB = 1024 * 1024;
const jwt = (sub: string, n = 0) => `h.${Buffer.from(JSON.stringify({ sub, n })).toString('base64url')}.s`;

function qsetup(opts: { engine?: QueueDeps['engineOptions'] } = {}) {
  const server = new FakeServer();
  const env = makeEnv(server);
  server.sleep = env.sleep;
  const s = {
    token: jwt('officer-1') as string | null,
    sub: 'officer-1',
    refreshWorks: true,
    restoreCalls: 0,
    ensureCalls: [] as Array<{ parent: string | null; paths: string[] }>,
    ensureFault: (_call: number): number | null => null,
    legacyCalls: [] as Array<{ folderId: string | null; name: string }>,
    legacyFault: (_name: string): number | 'hang' | null => null,
    legacyAborts: 0,
    folderIds: new Map<string, string>(),
    fseq: 0,
  };
  const deps: QueueDeps = {
    makeTransport: () => server,
    env,
    async ensurePaths(_t, parent, paths, signal) {
      s.ensureCalls.push({ parent, paths });
      server.pending += 1;
      try {
        await tick();
        if (signal.aborted) throw new TransportError('aborted', 0);
        const f = s.ensureFault(s.ensureCalls.length);
        if (f !== null) throw new TransportError(`ensure-paths failed (${f})`, f);
        let created = 0;
        const out: Record<string, string> = {};
        for (const p of paths) {
          let parentId = parent ?? '';
          for (const seg of p.split('/').filter(Boolean)) {
            const k = `${parentId}|${seg}`;
            let id = s.folderIds.get(k);
            if (!id) {
              id = `fold${++s.fseq}`;
              s.folderIds.set(k, id);
              created += 1;
            }
            parentId = id;
          }
          out[p] = parentId;
        }
        return { folders: out, created };
      } finally {
        server.pending -= 1;
      }
    },
    async legacyUpload(_t, file, folderId, onProgress, signal) {
      const name = (file as unknown as { name: string }).name;
      s.legacyCalls.push({ folderId, name });
      server.pending += 1;
      try {
        await tick();
        const f = s.legacyFault(name);
        if (f === 'hang') {
          try {
            await stopped(signal); // until aborted (Cancel / stall / sign-out)
          } catch (e) {
            s.legacyAborts += 1;
            throw e;
          }
        }
        if (signal.aborted) throw new TransportError('aborted', 0);
        if (typeof f === 'number') throw new TransportError(`upload failed (${f})`, f);
        onProgress(1);
        return { id: `legacy-${name}`, fileName: name };
      } finally {
        server.pending -= 1;
      }
    },
    accessToken: () => s.token,
    async restoreSession() {
      s.restoreCalls += 1;
      if (s.refreshWorks) s.token = jwt(s.sub, s.restoreCalls);
    },
    engineOptions: opts.engine,
  };
  const q = new UploadQueue(deps);
  return { q, server, env, s };
}

const CLIENT_A: QueueTarget = { base: '/processing/databank', target: { clientId: 'A' } };
const CLIENT_B: QueueTarget = { base: '/processing/databank', target: { clientId: 'B' } };
const meta = (label = 'Ali Khan', parentFolderId: string | null = null) => ({ label, parentLabel: 'Databank', parentFolderId });

function drop(name: string, size: number, relPath?: string, lastModified = 1, seed?: string): DropFile {
  const src = new FakeSource(size, seed ?? relPath ?? name) as FakeSource & { name: string; type: string; lastModified: number };
  src.name = name;
  src.type = 'application/pdf';
  src.lastModified = lastModified;
  return { file: src, relPath };
}

/** Wait until nothing in the queue can make progress. */
async function settled(q: UploadQueue, max = 60_000): Promise<void> {
  await until(() => !q.hasActive(), max);
  await tick();
}

const rowsOf = (q: UploadQueue) => q.getSnapshot().batches.flatMap((b) => b.rows);
const statusByName = (q: UploadQueue) => Object.fromEntries(rowsOf(q).map((r) => [r.relativePath ?? r.fileName, r.status]));

// ---- files ---------------------------------------------------------------------

test('queue: a files drop lands every file exactly once and tells THAT databank', async () => {
  const { q, server } = qsetup();
  const landedA: LandedEvent[] = [];
  const landedB: LandedEvent[] = [];
  q.onLanded('c:A', (e) => landedA.push(e));
  q.onLanded('c:B', (e) => landedB.push(e));
  q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 7), drop('b.zip', 95), drop('c.mov', 250)]);
  await settled(q);
  assert.deepEqual(statusByName(q), { 'a.pdf': 'done', 'b.zip': 'done', 'c.mov': 'done' });
  exactlyOnce(server);
  const files = landedA.flatMap((e) => e.files) as Array<{ id: string }>;
  assert.equal(files.length, 3, 'each landed file reported once');
  assert.ok(landedA.some((e) => e.idle), 'the explorer is told the batch finished');
  assert.equal(landedB.length, 0);
  assert.equal(q.getSnapshot().summary.completed, 3);
});

test('queue: refuses targets it cannot serve, and a signed-out tab', () => {
  const { q, s } = qsetup();
  assert.throws(() => q.enqueueFiles({ base: '/processing/databank', target: { personal: true, userId: 'x' } }, meta(), []), /another associate/);
  s.token = null;
  assert.throws(() => q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 5)]), /Sign in again/);
});

// ---- folders ---------------------------------------------------------------------

test('queue: a folder drop creates every ancestor once (shallow-first) and files each file into its folder', async () => {
  const { q, server, s } = qsetup();
  const events: LandedEvent[] = [];
  q.onLanded('c:A', (e) => events.push(e));
  q.enqueueFolder(CLIENT_A, meta('Ali Khan', 'root-1'), [
    drop('p1.pdf', 5, 'Client/Passport/p1.pdf'),
    drop('b1.pdf', 5, 'Client/Bank/b1.pdf'),
    drop('c.pdf', 5, 'Client/c.pdf'),
  ]);
  assert.equal(q.getSnapshot().batches[0]?.state ?? 'preparing', 'preparing');
  await settled(q);
  assert.deepEqual(s.ensureCalls, [{ parent: 'root-1', paths: ['Client', 'Client/Bank', 'Client/Passport'] }]);
  const byPath = Object.fromEntries(rowsOf(q).map((r) => [r.relativePath, r.folderId]));
  assert.equal(byPath['Client/Passport/p1.pdf'], s.folderIds.get(`${s.folderIds.get('root-1|Client')}|Passport`));
  assert.equal(byPath['Client/c.pdf'], s.folderIds.get('root-1|Client'));
  assert.ok(events[0].foldersChanged, 'folders reported before any file');
  assert.equal(q.getSnapshot().batches[0].foldersCreated, 3);
  exactlyOnce(server);
});

test('queue: an over-long folder name skips only its own files, with the server wording; siblings upload', async () => {
  const { q } = qsetup();
  const long = 'L'.repeat(121);
  q.enqueueFolder(CLIENT_A, meta(), [drop('x.pdf', 5, `Client/${long}/x.pdf`), drop('ok.pdf', 5, 'Client/ok.pdf')]);
  await settled(q);
  const b = q.getSnapshot().batches[0];
  assert.deepEqual(b.rows.map((r) => [r.relativePath, r.status]), [['Client/ok.pdf', 'done']]);
  assert.equal(b.skipped.length, 1);
  assert.match(b.skipped[0].reason, /longer than 120 characters/);
});

test('queue: ensure-paths 503s are retried; a 400 fails the batch with the server text (nothing sent) until "Try again"', async () => {
  const { q, server, s } = qsetup();
  s.ensureFault = (n) => (n <= 2 ? 503 : null);
  q.enqueueFolder(CLIENT_A, meta(), [drop('a.pdf', 5, 'F/a.pdf')]);
  await settled(q);
  assert.equal(statusByName(q)['F/a.pdf'], 'done');
  assert.equal(s.ensureCalls.length, 3);

  const q2 = qsetup();
  q2.s.ensureFault = (n) => (n === 1 ? 400 : null);
  const id = q2.q.enqueueFolder(CLIENT_A, meta(), [drop('a.pdf', 5, 'G/a.pdf')]);
  await settled(q2.q);
  const b = q2.q.getSnapshot().batches[0];
  assert.equal(b.state, 'prepare-failed');
  assert.match(b.prepareError!, /ensure-paths failed \(400\)/);
  assert.equal(q2.server.initCalls.length, 0, 'nothing uploaded');
  assert.equal(q2.q.getSnapshot().attention, 1);
  q2.q.retryPrepare(id);
  await settled(q2.q);
  assert.equal(statusByName(q2.q)['G/a.pdf'], 'done');
  assert.ok(server.recorded.length === 1 && q2.server.recorded.length === 1);
});

test('queue: while offline, folder preparation waits (no attempts burned) and continues when back online', async () => {
  const { q, s } = qsetup();
  q.setOnline(false);
  q.enqueueFolder(CLIENT_A, meta(), [drop('a.pdf', 5, 'O/a.pdf')]);
  s.ensureFault = () => 0; // unreachable while offline
  await until(() => s.ensureCalls.length >= 1);
  await tick();
  const before = s.ensureCalls.length;
  s.ensureFault = () => null;
  q.setOnline(true);
  await settled(q);
  assert.equal(before, 1, 'one attempt, then it waited for the connection');
  assert.equal(statusByName(q)['O/a.pdf'], 'done');
});

// ---- admission ---------------------------------------------------------------------

test('queue: ONE big batch at a time; a small drop runs alongside at once and finishes first', async () => {
  const { q, server } = qsetup();
  const big = (p: string) => drop(`${p}.bin`, 300 * MiB, undefined, 1, p);
  q.enqueueFiles(CLIENT_A, meta('A'), [big('a1')]);
  q.enqueueFiles(CLIENT_B, meta('B'), [big('b1')]);
  q.enqueueFiles(CLIENT_A, meta('A'), [drop('small.pdf', 5)]);
  await until(() => server.initCalls.length >= 2);
  const initNames = () => server.initCalls.flat().map((f) => f.fileName);
  assert.ok(initNames().includes('a1.bin'));
  assert.ok(initNames().includes('small.pdf'), 'the express drop started at once');
  assert.ok(!initNames().includes('b1.bin'), 'the second big batch waits its turn');
  const waiting = q.getSnapshot().batches.find((b) => b.label === 'B')!;
  assert.equal(waiting.state, 'waiting-turn');
  await until(() => statusByName(q)['small.pdf'] === 'done');
  assert.notEqual(statusByName(q)['a1.bin'], 'done', 'the small file finished first');
  await settled(q, 400_000);
  assert.deepEqual(statusByName(q), { 'a1.bin': 'done', 'b1.bin': 'done', 'small.pdf': 'done' });
  exactlyOnce(server);
});

test('queue: "Start now" runs the chosen big batch first; the other resumes after without re-sending parts', async () => {
  const { q, server } = qsetup();
  q.enqueueFiles(CLIENT_A, meta('A'), [drop('a.bin', 300 * MiB, undefined, 1, 'A')]);
  const bId = q.enqueueFiles(CLIENT_B, meta('B'), [drop('b.bin', 300 * MiB, undefined, 1, 'B')]);
  await until(() => server.okPuts.size >= 3);
  q.prioritize(bId);
  await until(() => statusByName(q)['b.bin'] === 'done', 400_000);
  assert.notEqual(statusByName(q)['a.bin'], 'done', 'B went first');
  await settled(q, 400_000);
  assert.equal(statusByName(q)['a.bin'], 'done');
  exactlyOnce(server);
});

test('queue: nothing is hashed for a batch that is not running yet', async () => {
  const { q, env } = qsetup();
  let hashed: string[] = [];
  const realHash = env.hash;
  env.hash = async (src, onP, sig) => {
    hashed.push((src as unknown as { name: string }).name);
    return realHash(src, onP, sig);
  };
  q.enqueueFiles(CLIENT_A, meta('A'), [drop('a.bin', 300 * MiB, undefined, 1, 'A')]);
  q.enqueueFiles(CLIENT_B, meta('B'), [drop('b.bin', 300 * MiB, undefined, 1, 'B')]);
  await until(() => hashed.includes('a.bin'));
  await tick();
  assert.ok(!hashed.includes('b.bin'), 'B waits un-hashed');
  hashed = [];
  await settled(q, 400_000);
  assert.ok(hashed.includes('b.bin'));
});

// ---- pause / auth ------------------------------------------------------------------

test('queue: Pause all sends nothing for 10 minutes; Resume finishes', async () => {
  const { q, server, env } = qsetup();
  q.enqueueFiles(CLIENT_A, meta(), [drop('p.bin', 200, undefined, 1, 'P')]);
  await until(() => server.okPuts.size >= 1);
  q.pauseAll();
  await tick();
  const puts = server.putAttempts;
  const inits = server.initCalls.length;
  const t0 = env.clock;
  await env.sleep(10 * 60_000);
  assert.ok(env.clock - t0 >= 10 * 60_000);
  assert.equal(server.putAttempts, puts);
  assert.equal(server.initCalls.length, inits);
  assert.equal(q.getSnapshot().paused, true);
  q.resumeAll();
  await settled(q);
  assert.equal(statusByName(q)['p.bin'], 'done');
  exactlyOnce(server);
});

test('queue: a 401 PAUSES everything (no file fails); a refreshed session for the same officer resumes it', async () => {
  const { q, server, s } = qsetup();
  let expired = true;
  s.refreshWorks = false;
  server.apiFault = (method) => (expired && method === 'init' ? 401 : 'ok');
  q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 5), drop('b.bin', 60)]);
  await until(() => q.getSnapshot().authLost);
  await tick();
  assert.equal(rowsOf(q).filter((r) => r.status === 'failed').length, 0, 'nothing failed');
  // the refresh works again (or the officer signs in again): new token, same person
  expired = false;
  s.refreshWorks = true;
  await settled(q, 100_000);
  assert.equal(q.getSnapshot().authLost, false);
  assert.deepEqual(statusByName(q), { 'a.pdf': 'done', 'b.bin': 'done' });
});

test('queue: if a DIFFERENT person signs in, the queue is wiped and sends nothing more', async () => {
  const { q, server, s } = qsetup();
  s.refreshWorks = false;
  server.apiFault = (method) => (method === 'init' ? 401 : 'ok');
  q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 5)]);
  await until(() => q.getSnapshot().authLost);
  s.token = jwt('someone-else');
  await q.checkAuth();
  await tick();
  assert.equal(q.getSnapshot().batches.length, 0);
  assert.equal(q.hasActive(), false);
  const calls = server.initCalls.length;
  server.apiFault = () => 'ok';
  await tick();
  assert.equal(server.initCalls.length, calls);
});

// ---- re-drops -------------------------------------------------------------------------

test('queue: re-dropping files already in the queue does not add them twice', async () => {
  const { q, server } = qsetup();
  server.fault = () => 'hang';
  q.enqueueFiles(CLIENT_A, meta(), [drop('a.bin', 60), drop('b.bin', 60)]);
  await until(() => server.inFlight > 0);
  q.enqueueFiles(CLIENT_A, meta(), [drop('a.bin', 60), drop('b.bin', 60)]);
  await tick();
  await until(() => q.getSnapshot().batches.length === 2);
  const second = q.getSnapshot().batches[0];
  assert.equal(second.alreadyListed, 2);
  assert.equal(second.rows.length, 0);
});

test('queue: re-dropping a file that waits on a duplicate choice does not add a second row', async () => {
  const { q, server } = qsetup();
  const existing = { id: 'f9', fileName: 'dup.pdf', folderId: null, folderName: 'Old', createdAt: '2026-01-01T00:00:00Z' };
  server.initOverride = (f, index) => (f.allowDuplicate ? null : { index, status: 'duplicate', existing });
  q.enqueueFiles(CLIENT_A, meta(), [drop('dup.pdf', 12)]);
  await settled(q);
  assert.equal(statusByName(q)['dup.pdf'], 'needs-decision');
  q.enqueueFiles(CLIENT_A, meta(), [drop('dup.pdf', 12)]);
  await until(() => q.getSnapshot().batches.length === 2);
  const second = q.getSnapshot().batches[0];
  assert.equal(second.alreadyListed, 1);
  assert.equal(rowsOf(q).length, 1, 'still one row, still waiting for the choice');
});

test('queue: re-dropping a failed file retries THAT row with the new file', async () => {
  const { q, server } = qsetup();
  server.fault = ({ part, attempt, session }) => (session === 's1' && part === 2 && attempt === 1 ? 400 : 'ok');
  q.enqueueFiles(CLIENT_A, meta(), [drop('f.bin', 60)]);
  await settled(q);
  assert.equal(statusByName(q)['f.bin'], 'failed');
  q.enqueueFiles(CLIENT_A, meta(), [drop('f.bin', 60)]);
  await settled(q);
  assert.equal(rowsOf(q).length, 1, 'no second row');
  assert.equal(statusByName(q)['f.bin'], 'done');
});

// ---- proxy / standard upload --------------------------------------------------------

test('queue: proxy mode (dev storage / kill switch) → the standard upload, one file at a time; > 2 GB fails clearly', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  const landed: unknown[] = [];
  q.onLanded('c:A', (e) => landed.push(...e.files));
  q.enqueueFiles(CLIENT_A, meta('A', 'fold-x'), [drop('a.pdf', 5), drop('b.pdf', 6), drop('huge.iso', 3 * 1024 * MiB)]);
  await settled(q);
  assert.deepEqual(s.legacyCalls.map((c) => c.name).sort(), ['a.pdf', 'b.pdf']);
  assert.ok(s.legacyCalls.every((c) => c.folderId === 'fold-x'));
  const st = statusByName(q);
  assert.equal(st['a.pdf'], 'done');
  assert.equal(st['b.pdf'], 'done');
  assert.equal(st['huge.iso'], 'failed');
  assert.match(rowsOf(q).find((r) => r.fileName === 'huge.iso')!.error!, /2 GB/);
  assert.equal(landed.length, 2);
  assert.equal(q.getSnapshot().compat, true);
  assert.ok(rowsOf(q).every((r) => r.status !== 'fallback'), 'the raw fallback status is never shown');
});

// ---- snapshot / throttle ----------------------------------------------------------------

test('queue: snapshots are throttled and stable between flushes', async () => {
  const { q } = qsetup();
  assert.equal(q.getSnapshot(), EMPTY_SNAPSHOT);
  let notified = 0;
  q.subscribe(() => notified++);
  q.enqueueFiles(CLIENT_A, meta(), Array.from({ length: 40 }, (_, i) => drop(`f${i}.pdf`, 5)));
  const a = q.getSnapshot();
  assert.equal(q.getSnapshot(), a, 'same object until the next flush');
  await settled(q);
  const revs = q.getSnapshot().rev;
  assert.ok(notified <= revs, 'one notification per snapshot');
  assert.ok(notified < 200, `throttled (${notified} snapshots for 40 files)`);
});

// ---- cancel / shutdown ---------------------------------------------------------------------

test('queue: Cancel on a batch sends at most 4 DELETEs at once', async () => {
  const { q, server } = qsetup();
  server.fault = () => 'hang';
  let live = 0;
  let peak = 0;
  const realAbort = server.abort.bind(server);
  server.abort = async (id, signal) => {
    live += 1;
    peak = Math.max(peak, live);
    try {
      await server.sleep(1000, signal);
      await realAbort(id, signal);
    } finally {
      live -= 1;
    }
  };
  const id = q.enqueueFiles(CLIENT_A, meta(), Array.from({ length: 12 }, (_, i) => drop(`c${i}.bin`, 60, undefined, 1, `c${i}`)));
  await until(() => rowsOf(q).filter((r) => r.uploadId).length >= 8);
  await q.cancelBatch(id);
  await settled(q);
  assert.ok(peak <= 4, `peak ${peak} concurrent DELETEs`);
  assert.ok(rowsOf(q).every((r) => r.status === 'cancelled' || r.status === 'done'));
});

test('queue: sign-out stops everything locally (no DELETE — sessions stay resumable) and nothing is sent after', async () => {
  const { q, server } = qsetup();
  server.fault = () => 'hang';
  q.enqueueFiles(CLIENT_A, meta(), [drop('s.bin', 200)]);
  await until(() => server.inFlight > 0);
  q.shutdown('logout');
  await tick();
  assert.equal(server.abortCalls.length, 0, 'no DELETE');
  assert.equal(q.getSnapshot().batches.length, 0);
  const puts = server.putAttempts;
  server.fault = () => 'ok';
  await tick();
  await tick();
  assert.equal(server.putAttempts, puts, 'nothing sent after sign-out');
});

test('queue: finished batches can be cleared; busy ones cannot', async () => {
  const { q, server } = qsetup();
  q.enqueueFiles(CLIENT_A, meta(), [drop('done.pdf', 5)]);
  await settled(q);
  server.fault = () => 'hang';
  const busy = q.enqueueFiles(CLIENT_A, meta(), [drop('busy.bin', 60)]);
  await until(() => server.inFlight > 0);
  q.dismissBatch(busy);
  q.clearFinished();
  await tick();
  await until(() => q.getSnapshot().batches.length === 1);
  assert.equal(q.getSnapshot().batches[0].id, busy);
});

test('queue: maxBytes comes from the server once an init answered', async () => {
  const { q } = qsetup();
  assert.equal(q.maxBytes('/processing/databank'), undefined);
  q.enqueueFiles(CLIENT_A, meta(), [drop('m.pdf', 5)]);
  await settled(q);
  assert.equal(q.maxBytes('/processing/databank'), 1e12);
});

// ---- review round 1 ------------------------------------------------------------------------

test('queue: [review] kill switch — every file is asked first: a session still finishing is followed, only "proxy" files go standard', async () => {
  const { q, server, s } = qsetup();
  // The server (switch on) answers per file: a file whose earlier session is
  // being recorded → 'in-progress'; everything else → the standard upload.
  let switchOn = true;
  server.initOverride = (f, index) => {
    if (!switchOn) return null;
    if (f.fileName === 'finishing.bin') {
      const id = 'sess-finishing';
      if (!server.sessions.has(id)) {
        server.sessions.set(id, { id, identity: 'x', size: f.sizeBytes, partSize: f.sizeBytes, partCount: 1, stored: new Map([[1, f.sizeBytes]]), status: 'COMPLETING' });
      }
      return { index, status: 'in-progress', uploadId: id };
    }
    return null;
  };
  const realInit = server.init.bind(server);
  server.init = async (files, signal) => {
    const res = await realInit(files, signal);
    if (!switchOn || res.mode !== 'direct') return res;
    // new files in a batch with nothing under way: whole-batch 'proxy' (the backend's rule)
    if (!res.results.some((r) => r.status === 'in-progress')) return { mode: 'proxy' as const };
    return { ...res, results: res.results.map((r) => (r.status === 'in-progress' ? r : { index: r.index, status: 'retry' as const, reason: 'switching' })) };
  };
  q.enqueueFiles(CLIENT_A, meta(), [drop('finishing.bin', 20), drop('new.pdf', 5)]);
  await settled(q, 100_000);
  assert.deepEqual(s.legacyCalls.map((c) => c.name), ['new.pdf'], 'only the "proxy" file took the standard upload');
  assert.equal(statusByName(q)['finishing.bin'] !== 'failed', true);
  assert.ok(server.completeCalls.flat().includes('sess-finishing'), 'the finishing session was followed, not re-uploaded');
  assert.equal(q.getSnapshot().compat, true);
  // The switch goes off again: the next drop is asked first and goes resumable.
  switchOn = false;
  q.enqueueFiles(CLIENT_A, meta(), [drop('after.bin', 60)]);
  await settled(q, 100_000);
  assert.equal(statusByName(q)['after.bin'], 'done');
  assert.deepEqual(s.legacyCalls.map((c) => c.name), ['new.pdf'], 'nothing else went standard');
  assert.equal(q.getSnapshot().compat, false, 'the "standard upload" banner clears on a direct answer');
});

test('queue: [review] a file sent to the standard upload is re-asked on Retry (never straight back to it)', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyFault = (name) => (name === 'r.pdf' ? 400 : null); // the standard upload rejects it once
  q.enqueueFiles(CLIENT_A, meta(), [drop('r.pdf', 5)]);
  await settled(q);
  assert.equal(statusByName(q)['r.pdf'], 'failed');
  const inits = server.initCalls.length;
  server.mode = 'direct'; // switch off meanwhile
  s.legacyFault = () => null;
  q.retryFailed();
  await settled(q);
  assert.ok(server.initCalls.length > inits, 'the server was asked again');
  assert.equal(statusByName(q)['r.pdf'], 'done');
  assert.equal(s.legacyCalls.length, 1, 'the retry went resumable');
});

test('queue: [review] re-dropping a big finished drop copies no engine views per file (no main-thread freeze)', async () => {
  const { q } = qsetup();
  const files = Array.from({ length: 400 }, (_, i) => drop(`f${i}.pdf`, 5, `root/f${i}.pdf`, 1, `s${i}`));
  q.enqueueFolder(CLIENT_A, meta(), files);
  await settled(q, 400_000);
  const running = q.enqueueFolder(CLIENT_A, meta(), [drop('slow.bin', 60, 'other/slow.bin')]); // keeps a batch busy
  void running;
  const proto = UploadEngine.prototype as unknown as { snapshot: () => unknown; hasWork: () => boolean };
  const real = { snapshot: proto.snapshot, hasWork: proto.hasWork };
  let copies = 0;
  let scans = 0;
  proto.snapshot = function (this: unknown) {
    copies += 1;
    return real.snapshot.call(this);
  };
  proto.hasWork = function (this: unknown) {
    scans += 1;
    return real.hasWork.call(this);
  };
  try {
    q.enqueueFolder(CLIENT_A, meta(), files);
    await until(() => q.getSnapshot().batches.length === 3, 50_000);
  } finally {
    proto.snapshot = real.snapshot;
    proto.hasWork = real.hasWork;
  }
  assert.ok(copies < 40, `engine views copied ${copies} times for a 400-file re-drop`);
  assert.ok(scans < 40, `engine scanned for work ${scans} times for a 400-file re-drop (once per pass, not per file)`);
});

test('queue: [review] the tab silently switching to ANOTHER user (no 401) stops the queue before anything is sent as them', async () => {
  const { q, server, s } = qsetup();
  server.fault = () => 'hang';
  q.enqueueFiles(CLIENT_A, meta(), [drop('mine.bin', 200), drop('mine2.bin', 200, undefined, 1, 'm2')]);
  await until(() => server.inFlight > 0);
  const inits = server.initCalls.length;
  const signs = server.signCalls.length;
  s.token = jwt('officer-2'); // another officer signed in; this tab's token was refreshed as them
  server.fault = () => 'ok';
  await until(() => q.getSnapshot().batches.length === 0, 50_000);
  await tick();
  assert.equal(q.hasActive(), false);
  const before = { i: server.initCalls.length, g: server.signCalls.length, c: server.completeCalls.length };
  await tick();
  await tick();
  assert.deepEqual({ i: server.initCalls.length, g: server.signCalls.length, c: server.completeCalls.length }, before, 'nothing more sent');
  assert.ok(server.initCalls.length <= inits + 1 && server.signCalls.length <= signs + 1, 'at most the call in flight');
});

test('queue: [review] folder prep during an ISP outage (browser still "online") waits for the link instead of failing', async () => {
  const { q, server, s, env } = qsetup();
  let outage = true;
  s.ensureFault = () => (outage ? 0 : null);
  server.apiFault = (m) => (outage && m === 'ping' ? 0 : 'ok');
  q.enqueueFolder(CLIENT_A, meta(), [drop('a.pdf', 5, 'Client/a.pdf'), drop('b.pdf', 5, 'Client/Sub/b.pdf')]);
  const t0 = env.clock;
  await until(() => env.clock - t0 > 15 * 60_000, 400_000);
  const snap = q.getSnapshot();
  assert.equal(snap.batches[0].state, 'preparing', 'still waiting, not "could not create the folders"');
  assert.equal(snap.linkDown, true, 'the dock says it is waiting for the internet');
  assert.ok(s.ensureCalls.length > 8, `kept trying (${s.ensureCalls.length})`);
  outage = false;
  await settled(q, 200_000);
  assert.deepEqual(statusByName(q), { 'Client/a.pdf': 'done', 'Client/Sub/b.pdf': 'done' });
});

test('queue: [review] folder prep still gives up on a failure while the link WORKS (ping answers)', async () => {
  const { q, s } = qsetup();
  s.ensureFault = () => 0; // this call keeps failing, the link does not
  q.enqueueFolder(CLIENT_A, meta(), [drop('a.pdf', 5, 'C/a.pdf')]);
  await until(() => q.getSnapshot().batches[0]?.state === 'prepare-failed', 400_000);
  assert.equal(s.ensureCalls.length, 8);
});

test('queue: [review] the standard upload waits out an outage, can be cancelled mid-way, and Remove works on its rows', async () => {
  const { q, server, s, env } = qsetup();
  server.mode = 'proxy';
  let outage = true;
  s.legacyFault = (name) => (name === 'hang.pdf' ? 'hang' : outage ? 0 : name === 'bad.pdf' ? 400 : null);
  server.apiFault = (m) => (outage && m === 'ping' ? 0 : 'ok');
  q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 5), drop('bad.pdf', 6)]);
  const t0 = env.clock;
  await until(() => env.clock - t0 > 10 * 60_000, 400_000);
  assert.equal(rowsOf(q).filter((r) => r.status === 'failed').length, 0, 'an outage fails nothing');
  outage = false;
  await settled(q, 200_000);
  assert.equal(statusByName(q)['a.pdf'], 'done');
  assert.equal(statusByName(q)['bad.pdf'], 'failed');
  const bad = rowsOf(q).find((r) => r.fileName === 'bad.pdf')!;
  await q.discard(bad.rowId);
  await until(() => statusByName(q)['bad.pdf'] === 'cancelled');
  // a standard upload in flight can be stopped
  q.enqueueFiles(CLIENT_A, meta(), [drop('hang.pdf', 7)]);
  await until(() => statusByName(q)['hang.pdf'] === 'uploading', 50_000);
  const hang = rowsOf(q).find((r) => r.fileName === 'hang.pdf')!;
  await q.cancel(hang.rowId);
  await settled(q, 100_000);
  assert.equal(statusByName(q)['hang.pdf'], 'cancelled');
  assert.equal(s.legacyAborts, 1, 'the upload itself was stopped, not just relabelled');
  q.enqueueFiles(CLIENT_A, meta(), [drop('after.pdf', 8)]);
  await until(() => statusByName(q)['after.pdf'] === 'done', 50_000);
  assert.equal(q.hasActive(), false, 'nothing left running');
});

test('queue: [review] a batch with failed files can be dismissed (their sessions freed); "Clear finished" leaves it', async () => {
  const { q, server } = qsetup();
  server.fault = ({ session, part }) => (session === 's1' && part === 1 ? 400 : 'ok');
  const id = q.enqueueFiles(CLIENT_A, meta(), [drop('f.bin', 60)]);
  await settled(q);
  assert.equal(statusByName(q)['f.bin'], 'failed');
  q.clearFinished();
  await tick();
  await until(() => q.getSnapshot().rev > 0);
  assert.equal(q.getSnapshot().batches.length, 1, 'clear-finished keeps a batch with a problem');
  q.dismissBatch(id);
  await until(() => q.getSnapshot().batches.length === 0);
  await until(() => server.abortCalls.includes('s1'), 50_000);
});

test('queue: [review] files a folder plan left out are never "all saved"', async () => {
  const { q } = qsetup();
  const long = 'x'.repeat(121);
  q.enqueueFolder(CLIENT_A, meta(), [drop('ok.pdf', 5, 'Client/ok.pdf'), drop('lost.pdf', 5, `Client/${long}/lost.pdf`)]);
  await settled(q);
  const snap = q.getSnapshot();
  assert.equal(snap.batches[0].skipped.length, 1);
  assert.ok(snap.attention >= 1, 'it needs the officer');
  q.clearFinished();
  await tick();
  await tick();
  assert.equal(q.getSnapshot().batches.length, 1, 'not cleared without asking');
});

test('queue: [review] a PC clock set back does not freeze the dock', async () => {
  const { q, env } = qsetup();
  q.enqueueFiles(CLIENT_A, meta(), [drop('c.pdf', 5)]);
  await settled(q);
  const rev = q.getSnapshot().rev;
  env.wallSkew = -3 * 3600_000; // Windows time sync moved the clock back 3 hours
  q.enqueueFiles(CLIENT_A, meta(), [drop('d.pdf', 5)]);
  const t0 = env.clock;
  await until(() => q.getSnapshot().rev > rev, 50_000);
  assert.ok(env.clock - t0 < 60_000, 'a new snapshot within seconds, not hours');
});
