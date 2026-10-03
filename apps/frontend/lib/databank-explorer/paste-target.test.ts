import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPasteInto } from './paste-target.ts';

// clip ← child ← grandchild ; other and clip are both roots.
const parentOf = new Map<string, string | null>([
  ['child', 'clip'],
  ['grandchild', 'child'],
  ['other', null],
  ['clip', null],
]);

test('canPasteInto: false for the clip folder itself and any of its descendants', () => {
  assert.equal(canPasteInto('clip', 'clip', parentOf), false);
  assert.equal(canPasteInto('child', 'clip', parentOf), false);
  assert.equal(canPasteInto('grandchild', 'clip', parentOf), false);
});

test('canPasteInto: true for an unrelated folder and for the root', () => {
  assert.equal(canPasteInto('other', 'clip', parentOf), true);
  assert.equal(canPasteInto(null, 'clip', parentOf), true);
});

test('canPasteInto: a files-only clipboard (no clip folder) is never blocked', () => {
  assert.equal(canPasteInto('clip', null, parentOf), true);
  assert.equal(canPasteInto(null, null, parentOf), true);
});
