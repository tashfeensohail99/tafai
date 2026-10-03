import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settlePaste, type PasteJob } from './settle-paste.ts';

const job = (id: string, name = `${id}.pdf`): PasteJob => ({ id, name, go: async () => {} });

test('settlePaste: a stale 404 source does not abort the batch — the live sibling still pastes', async () => {
  const run = async (j: PasteJob) => {
    if (j.id === 'DEAD') throw Object.assign(new Error('File not found'), { status: 404 });
  };
  const r = await settlePaste([job('DEAD'), job('LIVE')], run);
  assert.deepEqual(r.succeeded, ['LIVE']);
  assert.deepEqual(r.failed, [{ id: 'DEAD', name: 'DEAD.pdf', gone: true }]);
  // Never rejects → doPaste always reaches its finally → reload always runs.
  await assert.doesNotReject(() => settlePaste([job('DEAD')], run));
});

test('settlePaste: a non-404 failure is gone:false (a copy clipboard keeps that entry)', async () => {
  const run = async () => {
    throw Object.assign(new Error('Server error'), { status: 500 });
  };
  const r = await settlePaste([job('X')], run);
  assert.equal(r.failed[0].gone, false);
  assert.deepEqual(r.succeeded, []);
});

test('settlePaste: a "not found" message (no status) is still classified gone', async () => {
  const run = async () => {
    throw new Error('Folder not found');
  };
  const r = await settlePaste([job('G')], run);
  assert.equal(r.failed[0].gone, true);
});

test('settlePaste: all jobs succeed → every id reported, nothing failed', async () => {
  const r = await settlePaste([job('a'), job('b'), job('c')], async () => {});
  assert.deepEqual(r.succeeded.sort(), ['a', 'b', 'c']);
  assert.deepEqual(r.failed, []);
});
