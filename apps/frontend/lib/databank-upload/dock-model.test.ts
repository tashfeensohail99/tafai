import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchSections, batchStateLine, dockHeadline, formatFinishAt, plainError, rowView } from './dock-model.ts';
import type { BatchView, QueueSnapshot, RowView } from './queue.ts';
import { EMPTY_SNAPSHOT } from './queue.ts';
import { summarize } from './summary.ts';
import type { FileStatus } from './engine.ts';

const STATUSES: FileStatus[] = [
  'queued', 'hashing', 'hashed', 'ready', 'uploading', 'completing', 'cancelling', 'done', 'skipped',
  'needs-decision', 'handed-off', 'fallback', 'failed', 'cancelled',
];

const row = (status: FileStatus, extra: Partial<RowView> = {}): RowView => ({
  rowId: `r-${status}`,
  batchId: 'b1',
  folderId: null,
  key: status,
  fileName: `${status}.pdf`,
  size: 1000,
  status,
  bytesDone: 0,
  bytesInFlight: 0,
  hashedBytes: 0,
  ...extra,
});

test('rowView: every status × flag gives a label, sensible actions, and never a raw internal status', () => {
  const flags: Array<Partial<RowView>> = [
    {},
    { legacy: true },
    { resumed: true, bytesDone: 400 },
    { retryable: false, error: 'Files of type .exe are not allowed.' },
    { duplicateKind: 'already-uploaded', existing: { id: 'e', fileName: 'x.pdf', folderId: null, folderName: 'Passport', createdAt: '2026-09-12T10:00:00Z' } },
    { duplicateKind: 'duplicate', existing: { id: 'e', fileName: 'x.pdf', folderId: 'f', folderName: null, createdAt: '2026-09-12T10:00:00Z' } },
    { duplicateKind: 'possible-duplicate', existing: { id: 'e', fileName: 'x.pdf', folderId: 'f', folderName: 'Bank', createdAt: '2026-09-12T10:00:00Z' } },
    { duplicateKind: 'same-drop', note: 'Same file as Other/x.pdf.' },
    { relocated: true },
    { note: 'It was already being saved, so it could not be cancelled — delete it from the folder if unwanted.' },
  ];
  for (const s of STATUSES) {
    for (const f of flags) {
      const v = rowView(row(s, f));
      assert.ok(v.chip.length > 0, `${s}: chip`);
      assert.notEqual(v.chip, 'fallback');
      assert.ok(!v.chip.includes('fallback'));
      for (const a of v.actions) assert.ok(['cancel', 'retry', 'discard', 'skip', 'upload-anyway', 'upload-again'].includes(a));
    }
  }
  assert.deepEqual(rowView(row('needs-decision', flags[5])).actions, ['skip', 'upload-anyway']);
  assert.deepEqual(rowView(row('failed', { error: 'x' })).actions, ['retry', 'discard']);
  assert.deepEqual(rowView(row('failed', { retryable: false, error: 'x' })).actions, ['discard']);
  assert.deepEqual(rowView(row('uploading', { legacy: true })).actions, [], 'a standard upload in progress cannot be cancelled');
  assert.deepEqual(rowView(row('cancelled')).actions, ['upload-again']);
  assert.equal(rowView(row('skipped', flags[4])).detail, 'In Passport');
  assert.match(rowView(row('needs-decision', flags[5])).detail!, /the top folder as “x\.pdf” \(12 Sept?\)/); // ICU spells it "Sep" or "Sept" (en-GB)
  assert.equal(rowView(row('done', { relocated: true })).tone, 'warning');
  assert.equal(rowView(row('ready', { resumed: true, bytesDone: 400 })).chip, 'Continuing');
});

test('rowView: progress is rounded and clamped to 0–100', () => {
  assert.equal(rowView(row('uploading', { bytesDone: 333, bytesInFlight: 0 })).pct, 33);
  assert.equal(rowView(row('uploading', { bytesDone: 900, bytesInFlight: 500 })).pct, 100);
  assert.equal(rowView(row('uploading', { size: 0 })).pct, 0);
  assert.equal(rowView(row('hashing', { hashedBytes: 2000 })).chip, 'Checking 100%');
});

test('plainError: known server messages in plain words; others pass through', () => {
  assert.equal(plainError('Larger than the 50 GB per-file upload limit.'), 'Too big — the limit is 50 GB per file.');
  assert.equal(plainError('Files of type .exe are not allowed.'), 'This file type (.exe) is not allowed in the databank.');
  assert.match(plainError('This client is assigned to another officer — you can view…'), /given to another officer/);
  assert.equal(plainError('Some new error'), 'Some new error');
  assert.equal(plainError(undefined), 'Something went wrong.');
});

test('formatFinishAt: only for ETAs of 10 minutes or more', () => {
  const now = Date.UTC(2026, 8, 28, 13, 0, 0);
  assert.equal(formatFinishAt(null, now), null);
  assert.equal(formatFinishAt(599, now), null);
  assert.match(formatFinishAt(2 * 3600, now)!, /^done around /);
});

function snap(rows: RowView[], over: Partial<QueueSnapshot> = {}, batchOver: Partial<BatchView> = {}): QueueSnapshot {
  const b: BatchView = {
    id: 'b1', label: 'Ali Khan', parentLabel: 'Databank', kind: 'files', rootNames: [], dataScope: 'c:A',
    state: 'running', rows, skipped: [], alreadyListed: 0, summary: summarize(rows), createdAt: 0, ...batchOver,
  };
  return { ...EMPTY_SNAPSHOT, batches: [b], summary: summarize(rows), active: true, ...over };
}

test('dockHeadline: each state reads right', () => {
  const now = Date.UTC(2026, 8, 28, 13, 0, 0);
  const up = [row('uploading', { size: 2e9, bytesDone: 1e9 }), row('done', { size: 1e9, bytesDone: 1e9 }), row('queued', { size: 1e9 })];
  const h = dockHeadline(snap(up, { bytesPerSecond: 3.1 * 1024 * 1024, etaSeconds: 6600 }), now);
  assert.equal(h.title, 'Uploading 2 of 3 files');
  assert.match(h.sub!, /GB of .* GB · 3\.1 MB\/s · ~1 h 50 min · done around/);
  assert.equal(dockHeadline(snap([row('hashing'), row('queued')]), now).title, 'Checking files… nothing is sent yet');
  assert.equal(dockHeadline(snap(up, { paused: true }), now).title, 'Paused — 2 files waiting');
  assert.equal(dockHeadline(snap(up, { offline: true }), now).title, 'Waiting for internet…');
  assert.equal(dockHeadline(snap(up, { linkDown: true }), now).title, 'Waiting for internet…');
  assert.equal(dockHeadline(snap(up, { authLost: true }), now).title, 'Paused — you were signed out');
  const done = Array.from({ length: 1805 }, (_, i) => row('done', { rowId: `d${i}` }));
  assert.equal(dockHeadline(snap(done, { active: false }), now).title, 'All 1,805 files saved');
  assert.equal(dockHeadline(snap([row('done')], { active: false }), now).title, 'All 1 file saved');
  assert.equal(
    dockHeadline(snap([...done.slice(0, 3), row('skipped', { rowId: 's' })], { active: false }), now).title,
    'All 3 files saved · 1 already there',
  );
  assert.equal(dockHeadline(snap([row('done'), row('failed')], { active: false }), now).title, '1 saved · 1 needs attention');
  assert.equal(dockHeadline(snap([row('done'), row('failed', { rowId: 'x' }), row('failed', { rowId: 'y' })], { active: false }), now).title, '1 saved · 2 need attention');
});

test('batchSections: what needs the officer first; waiting capped at 20; saved collapsed', () => {
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => row('queued', { rowId: `q${i}` })),
    row('failed', { rowId: 'f' }),
    row('needs-decision', { rowId: 'n' }),
    row('uploading', { rowId: 'u' }),
    row('done', { rowId: 'd' }),
    row('skipped', { rowId: 's' }),
  ];
  const secs = batchSections({ ...snap(rows).batches[0], skipped: [{ path: 'a/x.exe', size: 1, kind: 'blocked', reason: 'no' }] });
  assert.deepEqual(secs.map((x) => x.key), ['choice', 'problems', 'progress', 'waiting', 'saved', 'not-uploaded']);
  const waiting = secs.find((x) => x.key === 'waiting')!;
  assert.equal(waiting.rows.length, 20);
  assert.equal(waiting.more, 10);
  const saved = secs.find((x) => x.key === 'saved')!;
  assert.equal(saved.collapsed, true);
  assert.equal(saved.title, '1 saved · 1 already there');
});

test('batchStateLine covers every state', () => {
  const base = snap([row('done')]).batches[0];
  for (const state of ['preparing', 'prepare-failed', 'waiting-turn', 'running', 'paused', 'needs-you', 'finished'] as const) {
    const l = batchStateLine({ ...base, state, prepareError: 'ensure-paths failed (400)' });
    assert.ok(l.text.length > 0, state);
  }
  assert.match(batchStateLine({ ...base, state: 'prepare-failed', prepareError: 'A folder name is longer than 120 characters. (folder "X")' }).text, /Nothing was uploaded/);
});

test('[review] files a folder plan left out are never "all saved": headline, batch line, and an OPEN list', () => {
  const now = Date.UTC(2026, 8, 28, 13, 0, 0);
  const left = [{ path: 'Client/Very long folder/x.pdf', size: 1, kind: 'bad-folder' as const, reason: 'A folder name is longer than 120 characters.' }];
  const s = snap([row('done')], { active: false });
  const withLeft = { ...s, batches: [{ ...s.batches[0], state: 'finished' as const, skipped: left }] };
  assert.equal(dockHeadline(withLeft, now).title, '1 saved · 1 not uploaded');
  const line = batchStateLine(withLeft.batches[0]);
  assert.equal(line.tone, 'warning');
  assert.equal(line.text, '1 saved · 1 not uploaded');
  const secs = batchSections(withLeft.batches[0]);
  assert.equal(secs.find((x) => x.key === 'not-uploaded')!.collapsed, false, 'the reasons are shown, not tucked away');
});

test('[review r2] the drive is away: the headline asks whether it is connected (not "waiting for internet")', () => {
  const now = Date.UTC(2026, 8, 28, 13, 0, 0);
  const s = snap([row('queued'), row('queued', { rowId: 'q2' })], { readsWaiting: true });
  assert.equal(dockHeadline(s, now).title, 'Can’t read the files — is the drive connected?');
  assert.equal(dockHeadline({ ...s, linkDown: true }, now).title, 'Waiting for internet…', 'no internet takes precedence');
});

// ---- review round 4 ------------------------------------------------------------------------

test('[review r4] cancelled files are never "saved": own section, and the headline says so', () => {
  const now = Date.UTC(2026, 8, 28, 13, 0, 0);
  const rows = [
    ...Array.from({ length: 3 }, (_, i) => row('done', { rowId: `d${i}` })),
    ...Array.from({ length: 27 }, (_, i) => row('cancelled', { rowId: `c${i}` })),
  ];
  const s = snap(rows, { active: false }, { state: 'finished' });
  assert.equal(dockHeadline(s, now).title, '3 saved · 27 cancelled');
  const line = batchStateLine(s.batches[0]);
  assert.equal(line.text, '3 saved · 27 cancelled');
  assert.equal(line.tone, 'neutral', 'cancelled on purpose: not a warning, but not "success" either');
  const secs = batchSections(s.batches[0]);
  assert.equal(secs.find((x) => x.key === 'saved')!.title, '3 saved');
  const c = secs.find((x) => x.key === 'cancelled')!;
  assert.equal(c.title, 'Cancelled (27)');
  assert.equal(c.collapsed, true);
});

test('[review r4] a Cancel that came while the file was being saved: "Check the folder", open, and counted', () => {
  const now = Date.UTC(2026, 8, 28, 13, 0, 0);
  const late = row('done', { rowId: 'late', note: 'It was already being saved, so it could not be cancelled — delete it from the folder if unwanted.' });
  const maybe = row('cancelled', { rowId: 'maybe', note: 'It may already have been saved — check the folder and delete it if unwanted.' });
  const s = snap([late, maybe, row('done', { rowId: 'ok' })], { active: false }, { state: 'finished' });
  const secs = batchSections(s.batches[0]);
  const check = secs.find((x) => x.key === 'check')!;
  assert.equal(check.title, 'Check the folder (2)');
  assert.equal(check.collapsed, false, 'shown, not tucked into "saved"');
  assert.deepEqual(check.rows.map((r) => r.rowId).sort(), ['late', 'maybe']);
  assert.equal(secs.find((x) => x.key === 'saved')!.title, '1 saved');
  assert.equal(dockHeadline(s, now).title, '2 saved · 1 cancelled · 2 to check');
  assert.equal(batchStateLine(s.batches[0]).tone, 'warning');
});

test('[review r4] the saved list shows the newest files and says how many more there are', () => {
  const rows = Array.from({ length: 120 }, (_, i) => row('done', { rowId: `d${i}` }));
  const saved = batchSections(snap(rows).batches[0]).find((x) => x.key === 'saved')!;
  assert.equal(saved.rows.length, 50);
  assert.equal(saved.rows[49].rowId, 'd119');
  assert.equal(saved.more, 70);
});

test('[review r5] a Cancel that came while saving is flagged on a "handed-off" row too, and a failed row shows its note', () => {
  const now = Date.UTC(2026, 8, 28, 13, 0, 0);
  const note = 'It was already being saved, so it could not be cancelled — delete it from the folder if unwanted.';
  const s = snap([row('handed-off', { rowId: 'h', note }), row('done', { rowId: 'd' })], { active: false }, { state: 'finished' });
  assert.equal(batchSections(s.batches[0]).find((x) => x.key === 'check')!.title, 'Check the folder (1)');
  assert.equal(dockHeadline(s, now).title, '2 saved · 1 to check');
  assert.equal(rowView(row('handed-off', { note })).tone, 'warning');
  assert.match(rowView(row('handed-off', { note })).detail!, /could not be cancelled/);
  assert.match(rowView(row('failed', { error: 'connection reset', note: 'It may already have been saved — check the folder before retrying.' })).detail!, /may already have been saved/);
});
