import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSharedFolderIndex } from './shared-folders.ts';

test('buildSharedFolderIndex: maps each folder share to its share id', () => {
  const idx = buildSharedFolderIndex({
    clientShared: false,
    shares: [
      { id: 'share-a', folderId: 'folder-1' },
      { id: 'share-b', folderId: 'folder-2' },
    ],
  });
  assert.equal(idx.clientShared, false);
  assert.equal(idx.folderShareByFolderId.get('folder-1'), 'share-a');
  assert.equal(idx.folderShareByFolderId.get('folder-2'), 'share-b');
  assert.equal(idx.folderShareByFolderId.size, 2);
});

test('buildSharedFolderIndex: the whole-client share (folderId null) is not a folder entry', () => {
  const idx = buildSharedFolderIndex({
    clientShared: true,
    shares: [
      { id: 'share-client', folderId: null },
      { id: 'share-a', folderId: 'folder-1' },
    ],
  });
  assert.equal(idx.clientShared, true);
  assert.equal(idx.folderShareByFolderId.size, 1);
  assert.equal(idx.folderShareByFolderId.get('folder-1'), 'share-a');
  assert.equal(idx.folderShareByFolderId.has('share-client'), false);
});

test('buildSharedFolderIndex: null / empty input yields an empty, unshared index', () => {
  for (const input of [null, undefined, { clientShared: false, shares: [] }]) {
    const idx = buildSharedFolderIndex(input);
    assert.equal(idx.clientShared, false);
    assert.equal(idx.folderShareByFolderId.size, 0);
  }
});
