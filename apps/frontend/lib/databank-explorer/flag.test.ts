import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExplorerMode, resolveExplorerV2 } from './flag.ts';

test('parseExplorerMode: pilot → pilot, on|1|true → on, everything else off', () => {
  assert.equal(parseExplorerMode('pilot'), 'pilot');
  assert.equal(parseExplorerMode('PILOT'), 'pilot');
  assert.equal(parseExplorerMode('on'), 'on');
  assert.equal(parseExplorerMode('ON'), 'on');
  assert.equal(parseExplorerMode('1'), 'on');
  assert.equal(parseExplorerMode('true'), 'on');
  assert.equal(parseExplorerMode('off'), 'off');
  assert.equal(parseExplorerMode('0'), 'off');
  assert.equal(parseExplorerMode(''), 'off');
  assert.equal(parseExplorerMode(undefined), 'off');
});

test('resolveExplorerV2: pilot ⇒ disabled until opted in with 1 (query or stored)', () => {
  // pilot default: OFF until a browser opts in
  assert.deepEqual(resolveExplorerV2('pilot', null, null), { enabled: false, persist: null });
  // stored opt-in enables it
  assert.deepEqual(resolveExplorerV2('pilot', '1', null), { enabled: true, persist: null });
  // query opt-in enables AND persists
  assert.deepEqual(resolveExplorerV2('pilot', null, '1'), { enabled: true, persist: '1' });
  // query opt-out overrides a stored opt-in and persists
  assert.deepEqual(resolveExplorerV2('pilot', '1', '0'), { enabled: false, persist: '0' });
  // a bogus query is ignored (falls back to stored)
  assert.deepEqual(resolveExplorerV2('pilot', '1', 'yes'), { enabled: true, persist: null });
});

test('resolveExplorerV2: off ⇒ always disabled, never persists', () => {
  assert.deepEqual(resolveExplorerV2('off', null, null), { enabled: false, persist: null });
  assert.deepEqual(resolveExplorerV2('off', '1', '1'), { enabled: false, persist: null });
  assert.deepEqual(resolveExplorerV2('off', '0', '0'), { enabled: false, persist: null });
});

test('resolveExplorerV2: on ⇒ enabled unless opted out with 0', () => {
  // default: on for everyone
  assert.deepEqual(resolveExplorerV2('on', null, null), { enabled: true, persist: null });
  // stored opt-out sticks
  assert.deepEqual(resolveExplorerV2('on', '0', null), { enabled: false, persist: null });
  // stored opt-in is a no-op (already on)
  assert.deepEqual(resolveExplorerV2('on', '1', null), { enabled: true, persist: null });
});

test('resolveExplorerV2: query overrides stored and is persisted', () => {
  // query 0 overrides a stored 1
  assert.deepEqual(resolveExplorerV2('on', '1', '0'), { enabled: false, persist: '0' });
  // query 1 overrides a stored 0
  assert.deepEqual(resolveExplorerV2('on', '0', '1'), { enabled: true, persist: '1' });
  // a bogus query value is ignored (falls back to stored), and not persisted
  assert.deepEqual(resolveExplorerV2('on', '0', 'yes'), { enabled: false, persist: null });
  assert.deepEqual(resolveExplorerV2('on', null, '0'), { enabled: false, persist: '0' });
});
