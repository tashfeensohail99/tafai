import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLandingReloader, mergeLandedFiles } from './landing.ts';
import type { Timers } from './landing.ts';
import { _resetPresenceForTests, confirmStopUploads, hasActiveUploads, isQueuePresent, registerQueue, subscribePresence } from './presence.ts';
import { attachLifecycle } from './lifecycle.ts';

// ---- landing ------------------------------------------------------------------

test('mergeLandedFiles: upserts by id, newest landed first, ignores junk', () => {
  const files = [
    { id: 'a', fileName: 'a.pdf', v: 1 },
    { id: 'b', fileName: 'b.pdf', v: 1 },
  ];
  const out = mergeLandedFiles(files, [
    { id: 'c', fileName: 'c.pdf', v: 1 },
    { id: 'b', fileName: 'b.pdf', v: 2 }, // re-recorded
    { id: 'd', fileName: 'd.pdf', v: 1 },
    null,
    { id: 7, fileName: 'x' },
    { id: 'e' },
    { id: 'c', fileName: 'c.pdf', v: 1 }, // duplicate in the same event
  ]);
  assert.deepEqual(out.map((f) => `${f.id}${f.v}`), ['d1', 'c1', 'a1', 'b2']);
  assert.equal(mergeLandedFiles(files, []), files, 'no change → same array');
});

function fakeTimers() {
  let now = 0;
  const q: Array<{ at: number; fn: () => void; dead: boolean }> = [];
  const timers: Timers = {
    set(fn, ms) {
      const t = { at: now + ms, fn, dead: false };
      q.push(t);
      return t;
    },
    clear(h) {
      (h as { dead: boolean }).dead = true;
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = q.filter((t) => !t.dead && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.dead = true;
      next.fn();
    }
    now = until;
  };
  return { timers, advance, now: () => now };
}

test('landing reloader: debounced, at most once per 5 s, flush now, dispose cancels', () => {
  const t = fakeTimers();
  let reloads = 0;
  const r = createLandingReloader({ timers: t.timers, now: t.now, reload: () => reloads++ });
  r.request();
  t.advance(1000);
  assert.equal(reloads, 0, 'debounced');
  t.advance(600);
  assert.equal(reloads, 1, 'fired after 1.5 s');
  for (let i = 0; i < 20; i++) {
    r.request();
    t.advance(200);
  }
  assert.equal(reloads, 1, 'a stream of requests within 5 s reloads once more at most… not yet');
  t.advance(2000);
  assert.equal(reloads, 2, 'rate-limited to one per 5 s');
  r.request();
  r.flush();
  assert.equal(reloads, 3, 'flush reloads at once');
  t.advance(10_000);
  assert.equal(reloads, 3, 'the flushed request does not fire again');
  r.request();
  r.dispose();
  t.advance(10_000);
  assert.equal(reloads, 3, 'dispose cancels');
});

// ---- presence -----------------------------------------------------------------

test('presence: registered queue, active state, sign-out confirm', () => {
  _resetPresenceForTests();
  let active = false;
  let notified = 0;
  subscribePresence(() => notified++);
  assert.equal(isQueuePresent(), false);
  assert.equal(confirmStopUploads(() => false), true, 'no queue → never asks');
  registerQueue({ hasActive: () => active });
  assert.equal(isQueuePresent(), true);
  assert.equal(notified, 1);
  assert.equal(hasActiveUploads(), false);
  let asked = 0;
  assert.equal(confirmStopUploads(() => (asked++, false)), true, 'idle → no prompt');
  assert.equal(asked, 0);
  active = true;
  assert.equal(confirmStopUploads(() => (asked++, false)), false, 'active + declined');
  assert.equal(confirmStopUploads(() => (asked++, true)), true, 'active + accepted');
  assert.equal(asked, 2);
});

// ---- lifecycle ----------------------------------------------------------------

function fakeQueue() {
  let active = false;
  const subs = new Set<() => void>();
  const calls: string[] = [];
  return {
    calls,
    setActive(v: boolean) {
      active = v;
      for (const fn of subs) fn();
    },
    q: {
      setOnline: (v: boolean) => calls.push(`online:${v}`),
      hasActive: () => active,
      subscribe: (fn: () => void) => (subs.add(fn), () => subs.delete(fn)),
      shutdown: (r: string) => calls.push(`shutdown:${r}`),
    },
  };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

test('lifecycle: online/offline, logout, and a leave-page guard only while uploading', async () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const fq = fakeQueue();
  const detach = attachLifecycle(fq.q, win, { onLine: false }, doc);
  assert.deepEqual(fq.calls, ['online:false'], 'seeded from navigator.onLine');
  win.dispatchEvent(new Event('online'));
  win.dispatchEvent(new Event('offline'));
  win.dispatchEvent(new Event('tafsheen:logout'));
  assert.deepEqual(fq.calls, ['online:false', 'online:true', 'online:false', 'shutdown:logout']);

  const leave = () => {
    const e = new Event('beforeunload', { cancelable: true });
    win.dispatchEvent(e);
    return e.defaultPrevented;
  };
  assert.equal(leave(), false, 'idle: no leave prompt');
  fq.setActive(true);
  assert.equal(leave(), true, 'uploading: leave prompt');
  fq.setActive(false);
  assert.equal(leave(), false);
  detach();
  win.dispatchEvent(new Event('online'));
  assert.equal(fq.calls.length, 4, 'detached');
  await flush();
});

test('lifecycle: stray-drop guard is inert when a drop zone already handled the event', () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const fq = fakeQueue();
  attachLifecycle(fq.q, win, {}, doc);
  fq.setActive(true);
  const stray = new Event('drop', { cancelable: true });
  win.dispatchEvent(stray);
  assert.equal(stray.defaultPrevented, true, 'a file dropped outside a zone does not open in the tab');
  const handled = new Event('drop', { cancelable: true });
  handled.preventDefault(); // the explorer's drop zone got it first
  win.dispatchEvent(handled);
  assert.equal(handled.defaultPrevented, true);
  fq.setActive(false);
  const idle = new Event('drop', { cancelable: true });
  win.dispatchEvent(idle);
  assert.equal(idle.defaultPrevented, false, 'no guard when idle');
});

test('lifecycle: wake lock while active + visible, released when idle, re-taken on return, failures swallowed', async () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let requests = 0;
  let releases = 0;
  const nav = {
    wakeLock: {
      request: async () => {
        requests++;
        return { release: async () => void releases++ };
      },
    },
  };
  const fq = fakeQueue();
  attachLifecycle(fq.q, win, nav, doc);
  fq.setActive(true);
  await flush();
  assert.equal(requests, 1);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  await flush();
  assert.equal(requests, 2, 're-taken after the tab comes back');
  fq.setActive(false);
  await flush();
  assert.equal(releases, 1, 'released when idle');

  // a browser that refuses (battery saver) never breaks anything
  const nav2 = { wakeLock: { request: () => Promise.reject(new Error('NotAllowedError')) } };
  const fq2 = fakeQueue();
  attachLifecycle(fq2.q, new EventTarget(), nav2, Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  fq2.setActive(true);
  await flush();
  const nav3 = {
    wakeLock: {
      request: () => {
        throw new Error('sync throw');
      },
    },
  };
  const fq3 = fakeQueue();
  attachLifecycle(fq3.q, new EventTarget(), nav3 as never, Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  fq3.setActive(true);
  await flush();
});
