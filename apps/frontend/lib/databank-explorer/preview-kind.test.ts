import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewKind } from './preview-kind.ts';

test('previewKind: images', () => {
  assert.equal(previewKind('image/png'), 'image');
  assert.equal(previewKind('image/jpeg'), 'image');
  assert.equal(previewKind('IMAGE/WEBP'), 'image');
});

test('previewKind: pdf (incl. odd vendor spellings)', () => {
  assert.equal(previewKind('application/pdf'), 'pdf');
  assert.equal(previewKind('application/x-pdf'), 'pdf');
});

test('previewKind: media', () => {
  assert.equal(previewKind('video/mp4'), 'video');
  assert.equal(previewKind('audio/mpeg'), 'audio');
});

test('previewKind: text-like renders in an iframe', () => {
  assert.equal(previewKind('text/plain'), 'text');
  assert.equal(previewKind('application/json'), 'text');
});

test('previewKind: unknown / office / missing → none (Download fallback)', () => {
  assert.equal(previewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'none');
  assert.equal(previewKind('application/zip'), 'none');
  assert.equal(previewKind(null), 'none');
  assert.equal(previewKind(undefined), 'none');
  assert.equal(previewKind(''), 'none');
});
