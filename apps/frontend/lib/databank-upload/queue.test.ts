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
    /** 'lost': the commit is recorded, then its reply never arrives (status 0). */
    legacyCommitFault: (_name: string, _call: number): 'lost' | number | null => null,
    legacyCommitCalls: 0,
    /** storageKey → recorded row (the backend's commit is idempotent per key). */
    legacyRecorded: new Map<string, { id: string; fileName: string }>(),
    legacyDelay: (_name: string): number => 0,
    /** How long the server takes to record the file (the commit can't be aborted). */
    legacyCommitDelay: (_name: string): number => 0,
    /** Files whose bytes reached storage (only recording left). */
    stored: [] as string[],
    kseq: 0,
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
    async legacyUpload(_t, file, folderId, onProgress, signal, opts) {
      const name = (file as unknown as { name: string }).name;
      const commit = async (key: string) => {
        s.legacyCommitCalls += 1;
        const slow = s.legacyCommitDelay(name);
        if (slow) await server.sleep(slow); // (no signal: nothing on the tab can stop it now)
        const row = s.legacyRecorded.get(key) ?? { id: `legacy-${name}-${key}`, fileName: name };
        s.legacyRecorded.set(key, row);
        const cf = s.legacyCommitFault(name, s.legacyCommitCalls);
        if (cf === 'lost') throw new TransportError('connection reset', 0);
        if (typeof cf === 'number') throw new TransportError(`commit failed (${cf})`, cf);
        return row;
      };
      if (opts?.commitKey) return commit(opts.commitKey); // only record — no second upload
      s.legacyCalls.push({ folderId, name });
      server.pending += 1;
      try {
        await tick();
        const delay = s.legacyDelay(name);
        for (let t = 0; t < delay; t += 30_000) {
          // a slow upload that is alive: progress every 30 s (no stall)
          await server.sleep(Math.min(30_000, delay - t), signal);
          if (signal.aborted) throw new TransportError('aborted', 0);
          onProgress(Math.min(0.99, (t + 30_000) / delay));
        }
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
        const key = `k${++s.kseq}`;
        s.stored.push(name);
        opts?.onStored(key);
        return await commit(key);
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

test('queue: [review] a batch with failed files can be dismissed (locally: no DELETE — the session expires, or resumes on a re-drop); "Clear finished" leaves it', async () => {
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
  await tick();
  assert.deepEqual(server.abortCalls, [], 'no DELETE burst from a dismiss');
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

// ---- review round 2 ------------------------------------------------------------------------

test('queue: [review r2] a standard upload whose commit reply is lost is recorded ONCE (the retry only commits, same key)', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyCommitFault = (name, call) => (name === 'c.pdf' && call === 1 ? 'lost' : null);
  q.enqueueFiles(CLIENT_A, meta(), [drop('c.pdf', 5)]);
  await settled(q, 100_000);
  assert.equal(statusByName(q)['c.pdf'], 'done');
  assert.equal(s.legacyCalls.filter((c) => c.name === 'c.pdf').length, 1, 'uploaded once');
  assert.equal(s.legacyRecorded.size, 1, 'one row in the databank, not two');
});

test('queue: [review r2] "Skip all" / "Upload all anyway" answer a drop\'s duplicate choices at once', async () => {
  const { q, server } = qsetup();
  const existing = { id: 'f9', fileName: 'x.pdf', folderId: null, folderName: 'Old', createdAt: '2026-01-01T00:00:00Z' };
  server.initOverride = (f, index) => (f.allowDuplicate ? null : { index, status: 'possible-duplicate', existing });
  const id = q.enqueueFiles(CLIENT_A, meta(), Array.from({ length: 30 }, (_, i) => drop(`p${i}.pdf`, 5, undefined, 1, `p${i}`)));
  await settled(q);
  assert.equal(q.getSnapshot().batches[0].state, 'needs-you');
  q.resolveAllDuplicates(id, 'skip');
  await settled(q);
  assert.ok(rowsOf(q).every((r) => r.status === 'skipped'));
  assert.equal(q.getSnapshot().batches[0].state, 'finished');
});

test('queue: [review r2] dismissing a batch never discards a session a copy in ANOTHER batch uploads on, and sends no DELETE burst', async () => {
  const { q, server } = qsetup();
  let holdCopy = true;
  server.fault = ({ session, part, attempt }) => {
    if (session !== 's1') return 'ok';
    if (part === 2 && attempt === 1) return 400; // the folder drop's file fails, keeping s1
    return holdCopy && attempt > 1 ? 'hang' : 'ok';
  };
  const a = q.enqueueFolder(CLIENT_A, meta(), [drop('scan.bin', 60, 'P/scan.bin')]);
  await settled(q);
  assert.equal(statusByName(q)['P/scan.bin'], 'failed');
  // The officer drops the same file loose into the created folder: same identity → it resumes s1.
  const folderId = [...server.sessions.values()][0].identity.split('|')[0];
  q.enqueueFiles(CLIENT_A, meta('Ali Khan', folderId), [drop('scan.bin', 60, undefined, 1, 'P/scan.bin')]);
  await until(() => rowsOf(q).some((r) => r.fileName === 'scan.bin' && r.relativePath === undefined && r.status === 'uploading'), 50_000);
  q.dismissBatch(a);
  await tick();
  holdCopy = false;
  await settled(q, 100_000);
  assert.deepEqual(server.abortCalls, [], 'no DELETE: the copy is using that session');
  assert.equal(statusByName(q)['scan.bin'], 'done');
  exactlyOnce(server);
});

test('queue: [review r2] Cancel on a batch keeps a failed row\'s session when a copy elsewhere uses it', async () => {
  const { q, server } = qsetup();
  let holdCopy = true;
  server.fault = ({ session, part, attempt }) => {
    if (session !== 's1') return 'ok';
    if (part === 2 && attempt === 1) return 400;
    return holdCopy && attempt > 1 ? 'hang' : 'ok';
  };
  const a = q.enqueueFolder(CLIENT_A, meta(), [drop('scan.bin', 60, 'P/scan.bin')]);
  await settled(q);
  const folderId = [...server.sessions.values()][0].identity.split('|')[0];
  q.enqueueFiles(CLIENT_A, meta('Ali Khan', folderId), [drop('scan.bin', 60, undefined, 1, 'P/scan.bin')]);
  await until(() => rowsOf(q).some((r) => r.relativePath === undefined && r.status === 'uploading'), 50_000);
  await q.cancelBatch(a);
  holdCopy = false;
  await settled(q, 100_000);
  assert.deepEqual(server.abortCalls, []);
  assert.equal(statusByName(q)['scan.bin'], 'done');
});

test('queue: [review r3] kill switch: re-dropping a file the standard upload saved asks the server again — its duplicate check answers, nothing uploads twice', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyDelay = (name) => (name === 'slow.pdf' ? 60_000 : 0); // keeps the batch busy
  const existing = { id: 'f9', fileName: 'a.pdf', folderId: null, folderName: 'Databank', createdAt: '2026-01-01T00:00:00Z' };
  q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 5), drop('slow.pdf', 6)]);
  await until(() => statusByName(q)['a.pdf'] === 'done', 50_000);
  // #424: the server's duplicate check answers before its kill switch does
  server.mode = 'direct';
  server.initOverride = (f, index) => (f.allowDuplicate ? null : { index, status: 'possible-duplicate', existing });
  const asked = server.initCalls.length;
  q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 5)]);
  await until(() => statusByName(q)['a.pdf'] === 'needs-decision', 100_000);
  assert.ok(server.initCalls.slice(asked).some((fs) => fs.some((f) => f.fileName === 'a.pdf')), 'the re-drop was asked about (it may have been deleted since)');
  assert.equal(s.legacyCalls.filter((c) => c.name === 'a.pdf').length, 1, 'saved once');
  q.shutdown('logout');
});

test('queue: [review r2] Cancel right after the server answered "proxy" stops those files (none uploads afterwards)', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  let id = '';
  const realInit = server.init.bind(server);
  server.init = async (files, signal) => {
    const res = await realInit(files, signal);
    setImmediate(() => void q.cancelBatch(id)); // Cancel lands after the engine marked them 'proxy', before the next flush moves them
    return res;
  };
  id = q.enqueueFiles(CLIENT_A, meta(), Array.from({ length: 5 }, (_, i) => drop(`w${i}.pdf`, 5, undefined, 1, `w${i}`)));
  await settled(q, 100_000);
  assert.equal(s.legacyCalls.length, 0, 'nothing went to the standard upload after Cancel');
  assert.ok(rowsOf(q).every((r) => r.status === 'cancelled'));
});

test('queue: [review r2] proxy mode keeps admission: an express drop is not stuck behind a big migration', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyDelay = (name) => (name.startsWith('big') ? 10 * 60_000 : 0); // 10 min per big file
  q.enqueueFiles(CLIENT_A, meta(), Array.from({ length: 30 }, (_, i) => drop(`big${i}.bin`, 10 * MiB, undefined, 1, `b${i}`)));
  await until(() => rowsOf(q).some((r) => r.fileName.startsWith('big') && r.status === 'uploading'), 50_000);
  q.enqueueFiles(CLIENT_B, meta('Walk-in'), [drop('passport.pdf', 5)]);
  await until(() => statusByName(q)['passport.pdf'] === 'done', 400_000);
  const bigDone = rowsOf(q).filter((r) => r.fileName.startsWith('big') && r.status === 'done').length;
  assert.equal(rowsOf(q).filter((r) => r.fileName.startsWith('big') && r.status === 'failed').length, 0, '(precondition: the big uploads are slow, not failing)');
  assert.ok(bigDone <= 2, `the passport went up while the migration was still running (${bigDone}/30 big files done)`);
  q.shutdown('logout'); // (don't leave 5 virtual hours of uploads running)
});

test('queue: [review r2] a cancelled drop that gets work again backs off normally during an outage', async () => {
  const { q, server, s, env } = qsetup();
  server.mode = 'proxy';
  const id = q.enqueueFiles(CLIENT_A, meta(), [drop('r.pdf', 5)]);
  await q.cancelBatch(id);
  await settled(q);
  // outage: the standard upload gets no answer, the ping neither
  s.legacyFault = () => 0;
  server.apiFault = (m) => (m === 'ping' ? 0 : 'ok');
  q.retryFailed();
  const row = rowsOf(q).find((r) => r.fileName === 'r.pdf')!;
  q.retry(row.rowId);
  const t0 = env.clock;
  const calls0 = s.legacyCalls.length;
  await until(() => env.clock - t0 > 60_000, 200_000);
  assert.ok(s.legacyCalls.length - calls0 <= 12, `backed off (${s.legacyCalls.length - calls0} tries in a minute)`);
  q.shutdown('logout'); // (end the outage loop: tests share one process)
});

test('queue: [review r2] another officer signing in stops the uploads WITH a notice of what was left', async () => {
  const { q, server, s } = qsetup();
  server.fault = () => 'hang';
  q.enqueueFiles(CLIENT_A, meta('Ali Khan'), [drop('a.bin', 200), drop('b.bin', 200, undefined, 1, 'b')]);
  await until(() => server.inFlight > 0);
  s.token = jwt('officer-2');
  await until(() => !!q.getSnapshot().notice, 50_000);
  const n = q.getSnapshot().notice!;
  assert.equal(n.reason, 'user-changed');
  assert.deepEqual(n.lost.map((l) => ({ label: l.label, count: l.count })), [{ label: 'Ali Khan', count: 2 }]);
  assert.equal(q.getSnapshot().batches.length, 0);
  q.dismissNotice();
  assert.equal(q.getSnapshot().notice, undefined);
});

test('queue: [review r2] "can\'t read the files" (the drive is away) reaches the dock', async () => {
  const { q, env } = qsetup();
  let drive = false;
  env.readable = async () => drive;
  env.hash = async (source) => {
    await tick();
    if (!drive) throw new Error('NotReadableError');
    return (source as FakeSource).sha;
  };
  q.enqueueFiles(CLIENT_A, meta(), [drop('x.pdf', 5), drop('y.pdf', 5, undefined, 1, 'y')]);
  await until(() => q.getSnapshot().readsWaiting, 100_000);
  drive = true;
  await settled(q, 100_000);
  assert.equal(q.getSnapshot().readsWaiting, false);
  assert.deepEqual(statusByName(q), { 'x.pdf': 'done', 'y.pdf': 'done' });
});

// ---- review round 3 ------------------------------------------------------------------------

test('queue: [review r3] Cancel while the standard upload is being RECORDED: it finishes as saved and says so (never "Cancelled" about a saved file)', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyCommitDelay = (name) => (name === 'c.pdf' ? 5 * 60_000 : 0); // a slow save — longer than the stall watchdog
  q.enqueueFiles(CLIENT_A, meta(), [drop('c.pdf', 5)]);
  await until(() => s.stored.includes('c.pdf'), 50_000);
  await until(() => rowsOf(q).some((r) => r.fileName === 'c.pdf'));
  await q.cancel(rowsOf(q).find((r) => r.fileName === 'c.pdf')!.rowId);
  await settled(q, 100_000);
  const row = rowsOf(q).find((r) => r.fileName === 'c.pdf')!;
  assert.equal(row.status, 'done');
  assert.match(row.note ?? '', /could not be cancelled/);
  assert.equal(s.legacyRecorded.size, 1);
  assert.equal(s.legacyCommitCalls, 1, 'recorded once');
});

test('queue: [review r3] Cancel on a drop while a save is under way, and the save fails: "Cancelled — may already be saved", never tried again', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyCommitDelay = (name) => (name === 'c.pdf' ? 60_000 : 0);
  s.legacyCommitFault = (name) => (name === 'c.pdf' ? 'lost' : null); // every save loses its reply
  const id = q.enqueueFiles(CLIENT_A, meta(), [drop('c.pdf', 5)]);
  await until(() => s.stored.includes('c.pdf'), 50_000);
  await q.cancelBatch(id);
  await settled(q, 200_000);
  const row = rowsOf(q).find((r) => r.fileName === 'c.pdf')!;
  assert.equal(row.status, 'cancelled');
  assert.match(row.note ?? '', /may already have been saved/);
  assert.equal(s.legacyCommitCalls, 1, 'not re-sent after the Cancel');
});

test('queue: [review r3] a cancelled drop that waited on the drive no longer asks "is the drive connected?"', async () => {
  const { q, env } = qsetup();
  env.readable = async () => false;
  env.hash = async () => {
    await tick();
    throw new Error('NotReadableError');
  };
  const id = q.enqueueFiles(CLIENT_A, meta(), [drop('x.pdf', 5), drop('y.pdf', 5, undefined, 1, 'y')]);
  await until(() => q.getSnapshot().readsWaiting, 100_000);
  await q.cancelBatch(id);
  await until(() => !q.getSnapshot().readsWaiting, 10_000);
  assert.equal(q.hasActive(), false);
});

test('queue: [review r3] the "uploads stopped" notice stays for the next officer, and ends when the officer it is about drops again', async () => {
  const { q, server, s } = qsetup();
  server.fault = () => 'hang';
  q.enqueueFiles(CLIENT_A, meta('Ali Khan'), [drop('a.bin', 200), drop('b.bin', 200, undefined, 1, 'b')]);
  await until(() => server.inFlight > 0);
  s.token = jwt('officer-2');
  s.sub = 'officer-2';
  await until(() => !!q.getSnapshot().notice, 50_000);
  server.fault = () => 'ok';
  q.enqueueFiles(CLIENT_B, meta('Walk-in'), [drop('w.pdf', 5)]);
  await settled(q);
  assert.ok(q.getSnapshot().notice, 'the next officer still sees it (above their own uploads)');
  q.shutdown('logout'); // officer-2 signs out
  assert.ok(q.getSnapshot().notice, 'sign-out keeps it');
  s.token = jwt('officer-1');
  s.sub = 'officer-1';
  q.enqueueFiles(CLIENT_A, meta('Ali Khan'), [drop('a.bin', 200), drop('b.bin', 200, undefined, 1, 'b')]);
  await settled(q, 100_000);
  assert.equal(q.getSnapshot().notice, undefined, 'officer-1 is back and re-dropped: "2 files were not uploaded" would now be untrue');
  assert.deepEqual(statusByName(q), { 'a.bin': 'done', 'b.bin': 'done' });
});

// ---- review round 4 ------------------------------------------------------------------------

test('queue: [review r4] kill switch: a re-drop of a file saved after "Upload anyway" asks the server again — no silent second upload', async () => {
  const { q, server, s } = qsetup();
  s.legacyDelay = (name) => (name.startsWith('slow') ? 60_000 : 0); // keeps the drop busy
  const existing = { id: 'f9', fileName: 'a.pdf', folderId: null, folderName: 'Databank', createdAt: '2026-01-01T00:00:00Z' };
  // #424: the server's duplicate check answers first; files the officer chose to upload anyway go standard
  const realInit = server.init.bind(server);
  server.init = async (files, signal) => {
    if (files.every((f) => f.allowDuplicate)) {
      server.initCalls.push(files);
      return { mode: 'proxy' } as never;
    }
    return realInit(files, signal);
  };
  server.initOverride = (f, index) => (f.allowDuplicate ? null : { index, status: 'possible-duplicate', existing });
  const id = q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 5), drop('slow1.pdf', 6, undefined, 1, 's1'), drop('slow2.pdf', 7, undefined, 1, 's2')]);
  await until(() => q.getSnapshot().batches[0]?.state === 'needs-you', 50_000);
  q.resolveAllDuplicates(id, 'upload');
  await until(() => statusByName(q)['a.pdf'] === 'done', 100_000);
  q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 5)]); // the officer re-drops while the drop is still busy
  await until(() => statusByName(q)['a.pdf'] === 'needs-decision', 100_000);
  assert.equal(s.legacyCalls.filter((c) => c.name === 'a.pdf').length, 1, 'uploaded once');
  q.shutdown('logout');
});

test('queue: [review r4] Cancel on a standard-upload row WAITING to retry its save: cancelled at once ("check the folder"), never saved afterwards', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyCommitFault = (name) => (name === 'c.pdf' ? 'lost' : null); // the save's reply never arrives
  q.enqueueFiles(CLIENT_A, meta(), [drop('c.pdf', 5)]);
  await until(() => s.legacyCommitCalls >= 1, 50_000);
  q.pauseAll(); // (it now waits to retry the save — asking whether the link is up)
  for (let i = 0; i < 50; i++) await tick();
  await q.cancel(rowsOf(q).find((r) => r.fileName === 'c.pdf')!.rowId);
  await until(() => statusByName(q)['c.pdf'] === 'cancelled', 10_000);
  assert.match(rowsOf(q).find((r) => r.fileName === 'c.pdf')!.note ?? '', /may already have been saved/);
  q.resumeAll();
  await settled(q, 100_000);
  assert.equal(s.legacyCommitCalls, 1, 'not saved after the Cancel');
  assert.equal(statusByName(q)['c.pdf'], 'cancelled');
});

test('queue: [review r4] a standard save that finishes after sign-out never reaches the next officer\'s explorer', async () => {
  const { q, server, s, env } = qsetup();
  server.mode = 'proxy';
  s.legacyCommitDelay = () => 60_000;
  q.enqueueFiles(CLIENT_A, meta(), [drop('p.pdf', 5)]);
  await until(() => s.stored.includes('p.pdf'), 50_000);
  const calls = s.legacyCommitCalls;
  q.shutdown('logout'); // officer-1 signs out while the save is being recorded
  s.token = jwt('officer-2');
  s.sub = 'officer-2';
  const seen: unknown[] = [];
  q.onLanded('c:A', (e) => seen.push(...e.files));
  const t0 = env.clock;
  await until(() => env.clock - t0 >= 60_000, 100_000); // the save is recorded after all…
  for (let i = 0; i < 50; i++) await tick();
  assert.equal(s.legacyCommitCalls, calls, '(precondition: the one save in flight, not a new one)');
  assert.equal(s.legacyRecorded.size, 1, '(precondition: it was recorded)');
  assert.deepEqual(seen, [], "…but officer-1's file is not shown to officer-2");
  assert.equal(q.getSnapshot().batches.length, 0);
});

test('queue: [review r4] "uploads stopped" lines are per officer and place: a later stop adds to them, a drop elsewhere keeps them', async () => {
  const { q, server, s } = qsetup();
  server.fault = () => 'hang';
  q.enqueueFiles(CLIENT_A, meta('Ali Khan'), [drop('a.bin', 200), drop('b.bin', 200, undefined, 1, 'b')]);
  await until(() => server.inFlight > 0);
  s.token = jwt('officer-2');
  s.sub = 'officer-2';
  await until(() => !!q.getSnapshot().notice, 50_000);
  // officer-2 starts a walk-in upload that is still running when officer-3 signs in
  q.enqueueFiles(CLIENT_B, meta('Walk-in'), [drop('w.bin', 200, undefined, 1, 'w')]);
  await until(() => server.inFlight > 0 && rowsOf(q).some((r) => r.fileName === 'w.bin'), 50_000);
  s.token = jwt('officer-3');
  s.sub = 'officer-3';
  q.enqueueFiles(CLIENT_B, meta('Walk-in'), [drop('x.pdf', 5, undefined, 1, 'x')]);
  await until(() => (q.getSnapshot().notice?.lost.length ?? 0) === 2, 50_000);
  const labels = q.getSnapshot().notice!.lost.map((l) => l.label).sort();
  assert.deepEqual(labels, ['Ali Khan', 'Walk-in'], "officer-1's line is still there");
  q.shutdown('logout');
  // officer-1 is back and first drops into ANOTHER client: their Ali Khan line stays
  server.fault = () => 'ok';
  s.token = jwt('officer-1');
  s.sub = 'officer-1';
  q.enqueueFiles(CLIENT_B, meta('Walk-in'), [drop('r.pdf', 5, undefined, 1, 'r')]);
  await settled(q, 100_000);
  assert.ok(q.getSnapshot().notice!.lost.some((l) => l.label === 'Ali Khan'), 'a drop elsewhere does not clear it');
  // …then re-drops Ali Khan's files: that line ends; officer-2's stays
  q.enqueueFiles(CLIENT_A, meta('Ali Khan'), [drop('a.bin', 200), drop('b.bin', 200, undefined, 1, 'b')]);
  await settled(q, 100_000);
  assert.deepEqual(q.getSnapshot().notice!.lost.map((l) => l.label), ['Walk-in']);
});

test('queue: [review r4] a drop with a file to check is never "clean": Clear finished keeps it, and it counts as needing the officer', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyCommitDelay = (name) => (name === 'c.pdf' ? 60_000 : 0);
  s.legacyCommitFault = (name) => (name === 'c.pdf' ? 'lost' : null);
  const id = q.enqueueFiles(CLIENT_A, meta(), [drop('c.pdf', 5)]);
  await until(() => s.stored.includes('c.pdf'), 50_000);
  await q.cancelBatch(id); // Cancel while it is being saved; the save's reply is lost
  await settled(q, 200_000);
  assert.equal(statusByName(q)['c.pdf'], 'cancelled');
  q.clearFinished();
  await tick();
  await until(() => q.getSnapshot().rev > 0);
  assert.equal(q.getSnapshot().batches.length, 1, 'kept: the officer must check the folder first');
  assert.ok(q.getSnapshot().attention >= 1);
});

test('queue: [review r4] Cancel while the retry is still asking whether the link is up: cancelled, and the save is not sent again', async () => {
  const { q, server, s, env } = qsetup();
  server.mode = 'proxy';
  s.legacyCommitFault = (name) => (name === 'c.pdf' ? 'lost' : null); // the save's reply never arrives
  const realPing = server.ping.bind(server);
  let pings = 0;
  server.ping = async (signal) => {
    pings += 1;
    await server.sleep(15_000, signal); // a slow /health answer
    return realPing(signal);
  };
  q.enqueueFiles(CLIENT_A, meta(), [drop('c.pdf', 5)]);
  await until(() => s.legacyCommitCalls >= 1 && pings >= 1, 50_000);
  await q.cancel(rowsOf(q).find((r) => r.fileName === 'c.pdf')!.rowId); // (during that ping)
  await settled(q, 100_000);
  for (let i = 0; i < 50; i++) await tick();
  void env;
  assert.equal(s.legacyCommitCalls, 1, 'not sent again after the Cancel');
  assert.equal(statusByName(q)['c.pdf'], 'cancelled');
  assert.match(rowsOf(q).find((r) => r.fileName === 'c.pdf')!.note ?? '', /may already have been saved/);
});

// ---- review round 5 ------------------------------------------------------------------------

test('queue: [review r5] "Remove" on a failed standard-upload row whose bytes were stored says to check the folder (the save may have landed)', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyCommitFault = (name) => (name === 'c.pdf' ? 'lost' : null); // recorded — the replies never arrive
  q.enqueueFiles(CLIENT_A, meta(), [drop('c.pdf', 5)]);
  await until(() => statusByName(q)['c.pdf'] === 'failed', 400_000);
  assert.match(rowsOf(q).find((r) => r.fileName === 'c.pdf')!.note ?? '', /may already have been saved/);
  await q.discard(rowsOf(q).find((r) => r.fileName === 'c.pdf')!.rowId);
  await until(() => statusByName(q)['c.pdf'] === 'cancelled', 10_000);
  assert.match(rowsOf(q).find((r) => r.fileName === 'c.pdf')!.note ?? '', /may already have been saved/);
  assert.ok(q.getSnapshot().attention >= 1, 'a file to check needs the officer');
});

test('queue: [review r5] kill switch: Retry on a standard-upload row approved with "Upload anyway" that never stored its bytes keeps the approval', async () => {
  const { q, server, s } = qsetup();
  const existing = { id: 'f9', fileName: 'a.pdf', folderId: null, folderName: 'Databank', createdAt: '2026-01-01T00:00:00Z' };
  const realInit = server.init.bind(server);
  server.init = async (files, signal) => {
    if (files.every((f) => f.allowDuplicate)) {
      server.initCalls.push(files);
      return { mode: 'proxy' } as never;
    }
    return realInit(files, signal);
  };
  server.initOverride = (f, index) => (f.allowDuplicate ? null : { index, status: 'possible-duplicate', existing });
  s.legacyFault = () => 400; // the standard upload fails outright (nothing stored)
  const id = q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 5)]);
  await until(() => q.getSnapshot().batches[0]?.state === 'needs-you', 50_000);
  q.resolveAllDuplicates(id, 'upload');
  await until(() => statusByName(q)['a.pdf'] === 'failed', 100_000);
  s.legacyFault = () => null;
  q.retryFailed();
  await settled(q, 100_000);
  assert.equal(statusByName(q)['a.pdf'], 'done', 'not asked again');
});

test('queue: [review r5] the "uploads stopped" notice does not count files the officer cancelled on purpose', async () => {
  const { q, server, s } = qsetup();
  const id = q.enqueueFiles(CLIENT_A, meta('Ali Khan'), Array.from({ length: 5 }, (_, i) => drop(`x${i}.pdf`, 5, undefined, 1, `x${i}`)));
  await q.cancelBatch(id);
  await settled(q);
  server.fault = () => 'hang';
  q.enqueueFiles(CLIENT_B, meta('Walk-in'), [drop('w.bin', 200, undefined, 1, 'w')]);
  await until(() => server.inFlight > 0, 50_000);
  s.token = jwt('officer-2');
  s.sub = 'officer-2';
  q.enqueueFiles(CLIENT_B, meta('Other'), [drop('o.pdf', 5, undefined, 1, 'o')]); // officer-2 drops a file
  await until(() => !!q.getSnapshot().notice, 50_000);
  assert.deepEqual(q.getSnapshot().notice!.lost.map((l) => l.label), ['Walk-in'], 'the cancelled Ali Khan drop is not "not uploaded"');
  q.shutdown('logout');
});

test('queue: [review r5] "Remove" on a standard-upload row whose save was refused after its bytes were stored says to check the folder', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyCommitFault = (name) => (name === 'c.pdf' ? 409 : null); // e.g. "already used": not retried, the bytes are stored
  q.enqueueFiles(CLIENT_A, meta(), [drop('c.pdf', 5)]);
  await until(() => statusByName(q)['c.pdf'] === 'failed', 200_000);
  await q.discard(rowsOf(q).find((r) => r.fileName === 'c.pdf')!.rowId);
  await until(() => statusByName(q)['c.pdf'] === 'cancelled', 10_000);
  assert.match(rowsOf(q).find((r) => r.fileName === 'c.pdf')!.note ?? '', /may already have been saved/);
});

// ---- review round 6 ------------------------------------------------------------------------

test('queue: [review r6] Cancel on a drop stops it at once — the rest does not keep uploading while the DELETEs go out', async () => {
  const { q, server } = qsetup();
  const realAbort = server.abort.bind(server);
  server.abort = async (id, signal) => {
    await server.sleep(800, signal); // DELETEs are slow (the Seoul DB)
    return realAbort(id, signal);
  };
  const realPut = server.put.bind(server);
  server.put = async (part, body, onProgress, signal) => {
    await server.sleep(300, signal);
    return realPut(part, body, onProgress, signal);
  };
  const id = q.enqueueFiles(CLIENT_A, meta(), Array.from({ length: 300 }, (_, i) => drop(`k${i}.pdf`, 5, undefined, 1, `k${i}`)));
  await until(() => server.recorded.length >= 20, 400_000);
  const at = server.recorded.length;
  await q.cancelBatch(id);
  await settled(q, 400_000);
  assert.ok(server.recorded.length - at <= 10, `${server.recorded.length - at} files still recorded after Stop`);
});

test('queue: [review r6] Retry on a standard-upload row whose bytes were stored only records them — no second upload, no question again', async () => {
  const { q, server, s } = qsetup();
  const existing = { id: 'f9', fileName: 'a.pdf', folderId: null, folderName: 'Databank', createdAt: '2026-01-01T00:00:00Z' };
  const realInit = server.init.bind(server);
  server.init = async (files, signal) => {
    if (files.every((f) => f.allowDuplicate)) {
      server.initCalls.push(files);
      return { mode: 'proxy' } as never;
    }
    return realInit(files, signal);
  };
  server.initOverride = (f, index) => (f.allowDuplicate ? null : { index, status: 'possible-duplicate', existing });
  let lose = true;
  s.legacyCommitFault = (name) => (name === 'a.pdf' && lose ? 'lost' : null); // recorded — its replies lost
  const id = q.enqueueFiles(CLIENT_A, meta(), [drop('a.pdf', 5)]);
  await until(() => q.getSnapshot().batches[0]?.state === 'needs-you', 50_000);
  q.resolveAllDuplicates(id, 'upload');
  await until(() => statusByName(q)['a.pdf'] === 'failed', 400_000);
  lose = false;
  q.retryFailed();
  await settled(q, 200_000);
  assert.equal(statusByName(q)['a.pdf'], 'done');
  assert.equal(s.legacyCalls.filter((c) => c.name === 'a.pdf').length, 1, 'uploaded once');
  assert.equal(s.legacyRecorded.size, 1, 'recorded once');
});

test('queue: [review r6] the "uploads stopped" notice does not count files whose Cancel is still going out', async () => {
  const { q, server, s } = qsetup();
  const realAbort = server.abort.bind(server);
  server.abort = async (id, signal) => {
    await server.sleep(10 * 60_000, signal); // a Cancel that takes a long time to be answered
    return realAbort(id, signal);
  };
  server.fault = () => 'hang';
  const id = q.enqueueFiles(CLIENT_A, meta('Ali Khan'), [drop('a.bin', 200), drop('b.bin', 200, undefined, 1, 'b')]);
  await until(() => server.inFlight > 0, 50_000);
  void q.cancelBatch(id);
  await until(() => rowsOf(q).some((r) => r.status === 'cancelling'), 50_000);
  server.fault = () => 'ok';
  s.token = jwt('officer-2');
  s.sub = 'officer-2';
  q.enqueueFiles(CLIENT_B, meta('Walk-in'), [drop('w.pdf', 5, undefined, 1, 'w')]);
  await tick();
  assert.equal(q.getSnapshot().notice, undefined, 'nothing to report: those were being cancelled');
  q.shutdown('logout');
});

// ---- review round 7 ------------------------------------------------------------------------

test('queue: [review r7] Stop also stops failed standard-upload rows: "Retry failed" later does not save the stopped drop', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyFault = (name) => (name === 'f.pdf' ? 400 : null); // fails outright (nothing stored)
  s.legacyDelay = (name) => (name === 'slow.pdf' ? 60_000 : 0); // keeps the drop running
  const id = q.enqueueFiles(CLIENT_A, meta(), [drop('f.pdf', 5), drop('slow.pdf', 6, undefined, 1, 'slow')]);
  await until(() => statusByName(q)['f.pdf'] === 'failed', 200_000);
  await q.cancelBatch(id);
  await settled(q, 200_000);
  s.legacyFault = () => null;
  q.retryFailed();
  await settled(q, 200_000);
  assert.equal(statusByName(q)['f.pdf'], 'cancelled', 'not saved after Stop');
  assert.equal(s.legacyCalls.filter((c) => c.name === 'f.pdf').length, 1);
});

test('queue: [review r7] a save of stored bytes that is refused outright: Retry starts afresh instead of re-sending the same key forever', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  let refuse = true;
  s.legacyCommitFault = (name) => (name === 'c.pdf' && refuse ? 409 : null);
  q.enqueueFiles(CLIENT_A, meta(), [drop('c.pdf', 5)]);
  await until(() => statusByName(q)['c.pdf'] === 'failed', 200_000);
  refuse = false;
  q.retryFailed();
  await settled(q, 200_000);
  assert.equal(statusByName(q)['c.pdf'], 'done');
  assert.equal(s.legacyCalls.filter((c) => c.name === 'c.pdf').length, 2, 'uploaded afresh (a new key)');
});

// ---- review round 13 (dock) ----------------------------------------------------------------

test('queue: [review r13] "Cancel all" leaves a finished drop\'s failed file to retry — it only stops the running drop', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.legacyFault = (name) => (name === 'f.pdf' ? 400 : null); // A: one file fails outright (nothing stored)
  s.legacyDelay = (name) => (name === 'slow.pdf' ? 60_000 : 0); // B: keeps running
  q.enqueueFiles(CLIENT_A, meta('Ali'), [drop('ok.pdf', 5, undefined, 1, 'ok'), drop('f.pdf', 6)]);
  await until(() => statusByName(q)['ok.pdf'] === 'done' && statusByName(q)['f.pdf'] === 'failed', 200_000);
  q.enqueueFiles(CLIENT_B, meta('Bilal'), [drop('slow.pdf', 7, undefined, 1, 'slow')]);
  await until(() => statusByName(q)['slow.pdf'] === 'uploading', 200_000);
  await q.cancelAll(); // the header "Cancel all" (drop B is running)
  await settled(q, 200_000);
  assert.equal(statusByName(q)['f.pdf'], 'failed', "the finished drop's un-uploaded file is still there");
  assert.equal(statusByName(q)['slow.pdf'], 'cancelled', 'the running drop was stopped');
  assert.ok(q.getSnapshot().attention >= 1, 'the un-uploaded file still needs the officer');
  s.legacyFault = () => null;
  q.retryFailed();
  await settled(q, 200_000);
  assert.equal(statusByName(q)['f.pdf'], 'done', 'Retry failed saves it');
  assert.equal(s.legacyCalls.filter((c) => c.name === 'f.pdf').length, 2);
});

test('queue: [review r13] "Cancel all" leaves a prepare-failed folder as "Try again" — never an empty "0 saved" that Clear finished removes', async () => {
  const { q, server, s } = qsetup();
  server.mode = 'proxy';
  s.ensureFault = (n) => (n === 1 ? 400 : null); // folder A: prepare fails outright (nothing uploaded)
  s.legacyDelay = (name) => (name === 'slow.pdf' ? 60_000 : 0); // B: keeps running
  const folder = q.enqueueFolder(CLIENT_A, meta(), [drop('a.pdf', 5, 'G/a.pdf')]);
  await until(() => q.getSnapshot().batches.find((x) => x.id === folder)?.state === 'prepare-failed', 200_000);
  q.enqueueFiles(CLIENT_B, meta('Bilal'), [drop('slow.pdf', 7, undefined, 1, 'slow')]);
  await until(() => statusByName(q)['slow.pdf'] === 'uploading', 200_000);
  await q.cancelAll();
  await settled(q, 200_000);
  const fb = q.getSnapshot().batches.find((x) => x.id === folder);
  assert.equal(fb?.state, 'prepare-failed', 'the folder that could not be prepared is still there to try again');
  assert.ok(q.getSnapshot().attention >= 1, 'it still needs the officer');
  assert.equal(statusByName(q)['slow.pdf'], 'cancelled', 'the running drop was stopped');
  q.clearFinished();
  assert.ok(q.getSnapshot().batches.some((x) => x.id === folder), 'Clear finished does not remove it');
});
