import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMode, resolveUploadV2 } from './flag.ts';
import { dataScopeOf, itemKey, jwtSub, targetKey } from './keys.ts';
import {
  MAX_FOLDER_DEPTH,
  chunkPaths,
  dirOf,
  orderForUpload,
  planFolderDrop,
  validateFolderPath,
} from './folder-plan.ts';

// ---- flag ----------------------------------------------------------------------

test('flag: build modes', () => {
  for (const v of [undefined, '', '0', 'off', 'banana', 'OFF']) assert.equal(parseMode(v), 'off', String(v));
  assert.equal(parseMode('pilot'), 'pilot');
  assert.equal(parseMode(' Pilot '), 'pilot');
  for (const v of ['on', '1', 'true', 'ON']) assert.equal(parseMode(v), 'on', v);
});

test('flag: off ignores everything; pilot needs an opt-in; on allows an opt-out', () => {
  assert.deepEqual(resolveUploadV2('off', '1', '1'), { enabled: false, persist: null });
  assert.deepEqual(resolveUploadV2('pilot', null, null), { enabled: false, persist: null });
  assert.deepEqual(resolveUploadV2('pilot', '1', null), { enabled: true, persist: null });
  assert.deepEqual(resolveUploadV2('pilot', null, '1'), { enabled: true, persist: '1' });
  assert.deepEqual(resolveUploadV2('pilot', '1', '0'), { enabled: false, persist: '0' });
  assert.deepEqual(resolveUploadV2('on', null, null), { enabled: true, persist: null });
  assert.deepEqual(resolveUploadV2('on', '0', null), { enabled: false, persist: null });
  assert.deepEqual(resolveUploadV2('on', '0', '1'), { enabled: true, persist: '1' });
  assert.deepEqual(resolveUploadV2('pilot', null, 'yes'), { enabled: false, persist: null }, 'junk query ignored');
});

// ---- keys ----------------------------------------------------------------------

test('keys: target / data scope / item', () => {
  assert.equal(targetKey('/processing/databank', { clientId: 'A' }), '/processing/databank|c:A');
  assert.equal(targetKey('/jr/databank', { clientId: 'A' }), '/jr/databank|c:A');
  assert.equal(targetKey('/processing/databank', { personal: true }), '/processing/databank|me');
  assert.equal(dataScopeOf({ clientId: 'A' }), 'c:A', 'no portal in the data scope');
  assert.equal(dataScopeOf({ personal: true }), 'me');
  assert.notEqual(itemKey(null, 'a.pdf', 1, 2), itemKey('x', 'a.pdf', 1, 2));
  assert.notEqual(itemKey('a|b', 'c', 1, 2), itemKey('a', 'b|c', 1, 2));
  assert.notEqual(itemKey('f', 'a.pdf', 1, 2), itemKey('f', 'a.pdf', 1, 3));
  assert.equal(itemKey('f', 'P/a.pdf', 10, 99), itemKey('f', 'P/a.pdf', 10, 99));
});

test('keys: jwtSub decodes an unpadded base64url payload, never throws', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'user-ü-1', exp: 1 })).toString('base64url');
  assert.equal(jwtSub(`hdr.${payload}.sig`), 'user-ü-1', 'UTF-8 payloads decode correctly');
  const ascii = Buffer.from(JSON.stringify({ sub: 'abc-123' })).toString('base64url');
  assert.equal(jwtSub(`h.${ascii}.s`), 'abc-123');
  assert.equal(jwtSub(null), null);
  assert.equal(jwtSub('garbage'), null);
  assert.equal(jwtSub('a.%%%.c'), null);
  assert.equal(jwtSub(`h.${Buffer.from('{"sub":42}').toString('base64url')}.s`), null);
});

// ---- folder-plan -----------------------------------------------------------------

test('dirOf', () => {
  assert.equal(dirOf('A/B/c.pdf'), 'A/B');
  assert.equal(dirOf('c.pdf'), '');
  assert.equal(dirOf('A/c.pdf'), 'A');
});

test('validateFolderPath: the backend parity vectors, same messages', () => {
  assert.equal(validateFolderPath('Passport/Scans'), null);
  assert.equal(validateFolderPath('/Passport//Scans/'), null);
  assert.equal(validateFolderPath('a\\b/c'), null, 'backslash stays inside a name');
  assert.equal(validateFolderPath('Résumé'), null);
  assert.equal(validateFolderPath('Visa \u{1F4C4}'), null, 'a valid surrogate pair');
  assert.equal(validateFolderPath('x'.repeat(120)), null);
  assert.equal(validateFolderPath(Array(MAX_FOLDER_DEPTH).fill('d').join('/')), null);
  const cases: Array<[string, string]> = [
    ['', 'A folder path is empty.'],
    ['/ / /', 'A folder path is empty.'],
    ['Passport/..', '".." is not a valid folder name.'],
    ['./Passport', '"." is not a valid folder name.'],
    ['Pass\u0000port', 'A folder name contains a control character.'],
    ['Pass\u007fport', 'A folder name contains a control character.'],
    ['Pass\ud800port', 'A folder name contains an invalid character.'],
    ['\udc00Scans', 'A folder name contains an invalid character.'],
    ['x'.repeat(121), 'A folder name is longer than 120 characters.'],
    [Array(MAX_FOLDER_DEPTH + 1).fill('d').join('/'), 'Folders can be nested at most 32 levels deep.'],
  ];
  for (const [raw, msg] of cases) assert.equal(validateFolderPath(raw), msg, JSON.stringify(raw).slice(0, 40));
});

const e = (relPath: string, size = 10) => ({ name: relPath.split('/').pop()!, size, relPath });

test('planFolderDrop: every ancestor prefix, shallow-first, deduped; roots found', () => {
  const plan = planFolderDrop([e('Client/Passport/Scans/a.pdf'), e('Client/Bank/b.pdf'), e('Client/c.pdf'), e('Other/d.pdf')]);
  assert.deepEqual(plan.dirPaths, ['Client', 'Other', 'Client/Bank', 'Client/Passport', 'Client/Passport/Scans']);
  assert.deepEqual(plan.roots, ['Client', 'Other']);
  assert.equal(plan.accepted.length, 4);
  assert.deepEqual(plan.accepted.map((a) => a.dir), ['Client/Passport/Scans', 'Client/Bank', 'Client', 'Other']);
  assert.deepEqual(plan.skipped, []);
});

test('planFolderDrop: one over-long folder name skips ONLY its subtree, with the server wording', () => {
  const long = 'L'.repeat(121);
  const plan = planFolderDrop([e(`Client/${long}/x.pdf`), e(`Client/${long}/deep/y.pdf`), e('Client/ok/z.pdf')]);
  assert.deepEqual(plan.accepted.map((a) => a.entry.relPath), ['Client/ok/z.pdf']);
  assert.equal(plan.skipped.length, 2);
  assert.ok(plan.skipped.every((s) => s.kind === 'bad-folder'));
  assert.equal(
    plan.skipped[0].reason,
    `A folder name is longer than 120 characters. (folder ${JSON.stringify(`Client/${long}`.slice(0, 77) + '...')})`,
  );
  assert.ok(!plan.dirPaths.some((d) => d.includes(long)), 'the bad folder is never sent');
});

test('planFolderDrop: file names over 255 characters are skipped; empty dirs are created', () => {
  const plan = planFolderDrop([e(`A/${'n'.repeat(256)}.pdf`), e('A/ok.pdf')], { emptyDirs: ['A/Empty', '/B/', `A/${'q'.repeat(121)}`] });
  assert.deepEqual(plan.skipped.map((s) => s.kind), ['name']);
  assert.deepEqual(plan.dirPaths, ['A', 'B', 'A/Empty']);
  assert.deepEqual(plan.roots, ['A', 'B']);
});

test('chunkPaths: ≤ maxPaths and ≤ maxBytes per chunk, order kept, ancestors never after descendants', () => {
  const paths = Array.from({ length: 4500 }, (_, i) => `R/${String(i).padStart(4, '0')}`);
  const chunks = chunkPaths(['R', ...paths]);
  assert.ok(chunks.every((c) => c.length <= 1000));
  assert.deepEqual(chunks.flat(), ['R', ...paths]);
  const long = Array.from({ length: 1000 }, (_, i) => `${'é'.repeat(1950)}${i}`); // ~3,900 bytes each in UTF-8
  const byBytes = chunkPaths(long);
  assert.ok(byBytes.length > 1);
  for (const c of byBytes) assert.ok(Buffer.byteLength(JSON.stringify(c)) <= 1_000_000, 'JSON body stays under 1 MB');
  assert.deepEqual(chunkPaths([]), []);
  // shallow-first input from planFolderDrop → a prefix is never in a later chunk than its child
  const plan = planFolderDrop(Array.from({ length: 3000 }, (_, i) => e(`T/${i % 50}/${i}/f.pdf`)));
  const cs = chunkPaths(plan.dirPaths);
  const chunkOf = new Map<string, number>();
  cs.forEach((c, i) => c.forEach((p) => chunkOf.set(p, i)));
  for (const p of plan.dirPaths) {
    const parent = dirOf(p);
    if (parent) assert.ok(chunkOf.get(parent)! <= chunkOf.get(p)!, `${parent} before ${p}`);
  }
});

test('orderForUpload: small files first, then by path, stable', () => {
  const MB = 1024 * 1024;
  const xs = [
    { path: 'b/video.mp4', size: 900 * MB, n: 1 },
    { path: 'a/scan.pdf', size: 2 * MB, n: 2 },
    { path: 'c/big.zip', size: 40 * MB, n: 3 },
    { path: 'a/scan.pdf', size: 32 * MB, n: 4 },
    { path: 'a/0.pdf', size: 1, n: 5 },
  ];
  assert.deepEqual(orderForUpload(xs).map((x) => x.n), [5, 2, 4, 1, 3]);
});
