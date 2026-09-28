import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesOf, partBytes, partRange, partsToSend } from './parts.ts';
import { backoffMs, classifyApi, classifyPut } from './retry.ts';
import { SpeedMeter } from './speed.ts';
import { formatBytes, formatEta, headline, summarize } from './summary.ts';
import type { FileView } from './engine.ts';

test('parts: ranges follow the server plan (equal parts, short last one)', () => {
  assert.deepEqual(partRange(1, 10, 25), [0, 10]);
  assert.deepEqual(partRange(3, 10, 25), [20, 25]);
  assert.equal(partBytes(3, 10, 25), 5);
  assert.deepEqual(partRange(1, 25, 25), [0, 25]); // SINGLE
  assert.deepEqual(partRange(1, 0, 0), [0, 0]); // empty file
  assert.deepEqual(partsToSend(5, [1, 3]), [2, 4, 5]);
  assert.equal(bytesOf([1, 3], 10, 25), 15);
  // A 20 GB file in 8 MiB parts: the last part is exact.
  const size = 20e9;
  const ps = 8 * 1024 * 1024;
  const count = Math.ceil(size / ps);
  assert.equal(bytesOf(Array.from({ length: count }, (_, i) => i + 1), ps, size), size);
});

test('retry: exponential backoff with jitter, capped at 30 s', () => {
  assert.equal(backoffMs(1, () => 1), 1000);
  assert.equal(backoffMs(1, () => 0), 500);
  assert.equal(backoffMs(3, () => 1), 4000);
  assert.equal(backoffMs(99, () => 1), 30_000);
  assert.equal(backoffMs(99, () => 0), 15_000);
});

test('retry: failure classes', () => {
  assert.equal(classifyPut(403), 'resign');
  assert.equal(classifyPut(404), 'session-gone');
  for (const s of [0, 408, 429, 500, 502, 503]) assert.equal(classifyPut(s), 'transient', String(s));
  for (const s of [400, 411, 413]) assert.equal(classifyPut(s), 'fatal', String(s));
  assert.equal(classifyApi(0), 'transient');
  assert.equal(classifyApi(503), 'transient');
  assert.equal(classifyApi(403), 'fatal');
  assert.equal(classifyApi(400), 'fatal');
});

test('speed: smoothed rate and ETA; a discarded part never makes it negative', () => {
  const m = new SpeedMeter(10_000);
  assert.equal(m.etaSeconds(100), null);
  m.sample(0, 0);
  m.sample(5_000_000, 1000); // 5 MB/s
  assert.equal(m.bytesPerSecond, 5_000_000);
  assert.equal(m.etaSeconds(50_000_000), 10);
  m.sample(4_000_000, 2000); // a failed part's progress was dropped
  assert.ok(m.bytesPerSecond > 0 && m.bytesPerSecond < 5_000_000);
  m.sample(4_000_000, 2100); // < 250 ms later: ignored
  assert.equal(m.etaSeconds(0), 0);
});

const f = (status: FileView['status'], size: number, bytesDone = 0, bytesInFlight = 0): FileView => ({
  key: `${status}${size}`,
  fileName: 'x',
  size,
  status,
  bytesDone,
  bytesInFlight,
  hashedBytes: 0,
});

test('summary: counts, bytes (skipped/cancelled/duplicates excluded), headline wording', () => {
  const files = [
    f('done', 4e9, 4e9),
    f('done', 1e9, 1e9),
    f('handed-off', 1e9, 1e9),
    f('uploading', 10e9, 3e9, 1e8),
    f('hashing', 1e9),
    f('queued', 2e9),
    f('failed', 1e9, 5e8),
    f('skipped', 7e9),
    f('needs-decision', 3e9),
  ];
  const s = summarize(files);
  assert.equal(s.files, 9);
  assert.equal(s.completed, 3);
  assert.equal(s.uploading, 2);
  assert.equal(s.waiting, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.skipped, 1);
  assert.equal(s.needsDecision, 1);
  assert.equal(s.bytesTotal, 20e9);
  assert.equal(s.bytesSent, 4e9 + 1e9 + 1e9 + 3.1e9 + 5e8);
  assert.equal(s.active, true);
  assert.equal(
    headline(s, 6.2e6, 48 * 60),
    '9 files — 3 completed · 2 uploading · 1 waiting · 1 to review · 1 already there · 1 failed — 9.6 GB of 20 GB · 6.2 MB/s · ~48 min',
  );
});

test('summary: finished batch shows no speed/ETA; singular "file"', () => {
  const s = summarize([f('done', 950_000, 950_000)]);
  assert.equal(s.active, false);
  assert.equal(headline(s, 1e6, 3), '1 file — 1 completed — 950 KB of 950 KB');
});

test('formatting', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1500), '1.5 KB');
  assert.equal(formatBytes(4.1e9), '4.1 GB');
  assert.equal(formatBytes(25e9), '25 GB');
  assert.equal(formatBytes(2e9), '2 GB');
  assert.equal(formatEta(null), null);
  assert.equal(formatEta(30), '< 1 min');
  assert.equal(formatEta(48 * 60), '~48 min');
  assert.equal(formatEta(125 * 60), '~2 h 5 min');
  assert.equal(formatEta(120 * 60), '~2 h');
});
