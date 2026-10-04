import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileKind, fileTypeLabel } from './file-kind.ts';

test('fileKind: extension wins even when the MIME is a useless octet-stream', () => {
  // Uploads frequently arrive as application/octet-stream — the name saves us.
  assert.equal(fileKind('application/octet-stream', 'Passport.pdf'), 'pdf');
  assert.equal(fileKind('application/octet-stream', 'Contract.docx'), 'word');
  assert.equal(fileKind('application/octet-stream', 'Budget.xlsx'), 'excel');
  assert.equal(fileKind('application/octet-stream', 'Deck.pptx'), 'powerpoint');
  assert.equal(fileKind(null, 'photo.JPG'), 'image');
});

test('fileKind: office families by extension', () => {
  for (const n of ['a.doc', 'a.docx', 'a.odt', 'a.rtf']) assert.equal(fileKind(null, n), 'word');
  for (const n of ['a.xls', 'a.xlsx', 'a.csv', 'a.ods']) assert.equal(fileKind(null, n), 'excel');
  for (const n of ['a.ppt', 'a.pptx', 'a.odp']) assert.equal(fileKind(null, n), 'powerpoint');
});

test('fileKind: media / archives / code / text by extension', () => {
  assert.equal(fileKind(null, 'clip.mp4'), 'video');
  assert.equal(fileKind(null, 'song.mp3'), 'audio');
  assert.equal(fileKind(null, 'bundle.zip'), 'archive');
  assert.equal(fileKind(null, 'archive.7z'), 'archive');
  assert.equal(fileKind(null, 'app.ts'), 'code');
  assert.equal(fileKind(null, 'data.json'), 'code');
  assert.equal(fileKind(null, 'notes.md'), 'text');
  assert.equal(fileKind(null, 'readme.txt'), 'text');
});

test('fileKind: falls back to MIME when the name has no / an unknown extension', () => {
  assert.equal(fileKind('application/pdf', 'scan'), 'pdf');
  assert.equal(fileKind('image/png', null), 'image');
  assert.equal(fileKind('video/webm', undefined), 'video');
  assert.equal(fileKind('audio/mpeg', 'track'), 'audio');
  assert.equal(fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x'), 'word');
  assert.equal(fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x'), 'excel');
  assert.equal(fileKind('application/vnd.ms-powerpoint', 'x'), 'powerpoint');
  assert.equal(fileKind('application/zip', 'x'), 'archive');
  assert.equal(fileKind('text/plain', 'x'), 'text');
});

test('fileKind: unknown → generic file', () => {
  assert.equal(fileKind(null, null), 'file');
  assert.equal(fileKind('', ''), 'file');
  assert.equal(fileKind('application/x-weird', 'thing.unknownext'), 'file');
});

test('fileTypeLabel: human labels', () => {
  assert.equal(fileTypeLabel('application/octet-stream', 'a.pdf'), 'PDF');
  assert.equal(fileTypeLabel('application/octet-stream', 'a.docx'), 'Word');
  assert.equal(fileTypeLabel('application/octet-stream', 'a.xlsx'), 'Excel');
  assert.equal(fileTypeLabel('image/png', null), 'Image');
  assert.equal(fileTypeLabel(null, null), 'File');
});
