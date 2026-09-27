import {
  ExistingFolder,
  FolderPathError,
  MAX_FOLDER_DEPTH,
  MAX_NEW_FOLDERS,
  planFolderPaths,
  splitFolderPath,
} from './folder-paths';

/** Pure tests for `folders/ensure-paths` planning — no DB. */

const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};
const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
const folder = (id: string, parentFolderId: string | null, name: string, created = 0): ExistingFolder => ({
  id,
  parentFolderId,
  name,
  createdAt: at(created),
});

describe('splitFolderPath', () => {
  it('drops the empty segments of leading, trailing and doubled slashes', () => {
    expect(splitFolderPath('/Passport//Scans/')).toEqual(['Passport', 'Scans']);
  });

  it('trims each segment and NFC-normalises it (macOS sends decomposed names)', () => {
    const decomposed = 'Résumé'; // "Résumé" as e + combining accent
    expect(splitFolderPath(`  ${decomposed} / Scans `)).toEqual(['Résumé', 'Scans']);
  });

  it('keeps a backslash as part of the name — browsers only separate with "/"', () => {
    expect(splitFolderPath('a\\b/c')).toEqual(['a\\b', 'c']);
  });

  it.each([
    ['', 'empty'],
    ['/ / /', 'empty'],
    ['Passport/..', 'not a valid'],
    ['./Passport', 'not a valid'],
    ['Pass\u0000port', 'control character'],
    ['Pass\nport', 'control character'],
    ['x'.repeat(121), 'longer than 120'],
    [Array(MAX_FOLDER_DEPTH + 1).fill('d').join('/'), 'nested at most'],
  ])('rejects %j (%s)', (raw, msg) => {
    expect(() => splitFolderPath(raw)).toThrow(FolderPathError);
    expect(() => splitFolderPath(raw)).toThrow(msg);
  });

  it('accepts exactly the limits', () => {
    expect(splitFolderPath('x'.repeat(120))).toHaveLength(1);
    expect(splitFolderPath(Array(MAX_FOLDER_DEPTH).fill('d').join('/'))).toHaveLength(MAX_FOLDER_DEPTH);
  });
});

describe('planFolderPaths', () => {
  it('creates a missing tree once, parents before children, sharing prefixes', () => {
    const plan = planFolderPaths(null, ['A/B/C', 'A/B', 'A/D'], [], ids());
    expect(plan.create).toEqual([
      { id: 'new-1', parentFolderId: null, name: 'A' },
      { id: 'new-2', parentFolderId: 'new-1', name: 'B' },
      { id: 'new-3', parentFolderId: 'new-2', name: 'C' },
      { id: 'new-4', parentFolderId: 'new-1', name: 'D' },
    ]);
    expect(plan.folders).toEqual({ 'A/B/C': 'new-3', 'A/B': 'new-2', 'A/D': 'new-4' });
  });

  it('reuses existing same-name folders and never suffixes "(2)"', () => {
    const existing = [folder('p', null, 'Passport'), folder('s', 'p', 'Scans')];
    const plan = planFolderPaths(null, ['Passport/Scans/2024', 'Passport'], existing, ids());
    expect(plan.create).toEqual([{ id: 'new-1', parentFolderId: 's', name: '2024' }]);
    expect(plan.folders).toEqual({ 'Passport/Scans/2024': 'new-1', Passport: 'p' });
  });

  it('is idempotent: re-planning against what it created creates nothing and returns the same ids', () => {
    const paths = ['Client/Passport/Scans', 'Client/Bank', '/Client/Bank/'];
    const first = planFolderPaths(null, paths, [], ids());
    const now = first.create.map((f) => ({ ...f, createdAt: at(1) }));
    const again = planFolderPaths(null, paths, now, ids());
    expect(again.create).toEqual([]);
    expect(again.folders).toEqual(first.folders);
  });

  it('merges case-insensitively when there is no exact match (Windows/macOS folders)', () => {
    const plan = planFolderPaths(null, ['passport/SCANS'], [folder('p', null, 'Passport'), folder('s', 'p', 'Scans')], ids());
    expect(plan.create).toEqual([]);
    expect(plan.folders['passport/SCANS']).toBe('s');
  });

  it('prefers an exact-name sibling over a case-insensitive one', () => {
    const existing = [folder('upper', null, 'Passport', 0), folder('lower', null, 'passport', 5)];
    expect(planFolderPaths(null, ['passport'], existing, ids()).folders.passport).toBe('lower');
    expect(planFolderPaths(null, ['Passport'], existing, ids()).folders.Passport).toBe('upper');
  });

  it('matches an existing decomposed-Unicode name to the same composed segment', () => {
    const plan = planFolderPaths(null, ['Résumé'], [folder('r', null, 'Résumé')], ids());
    expect(plan.create).toEqual([]);
  });

  it('picks the OLDEST of duplicate same-name siblings, deterministically', () => {
    const existing = [folder('newer', null, 'Bank', 9), folder('older', null, 'Bank', 1), folder('tie-b', null, 'Tax', 3), folder('tie-a', null, 'Tax', 3)];
    const plan = planFolderPaths(null, ['Bank', 'Tax'], existing, ids());
    expect(plan.folders).toEqual({ Bank: 'older', Tax: 'tie-a' });
  });

  it('only matches under the drop target — a same-name folder elsewhere is not reused', () => {
    const existing = [folder('base', null, 'Case'), folder('elsewhere', null, 'Passport')];
    const plan = planFolderPaths('base', ['Passport'], existing, ids());
    expect(plan.create).toEqual([{ id: 'new-1', parentFolderId: 'base', name: 'Passport' }]);
  });

  it('keys the result by each path exactly as sent, even when two spellings share a folder', () => {
    const plan = planFolderPaths(null, ['A/B', '/A/B/', 'a/b'], [], ids());
    expect(plan.create).toHaveLength(2);
    expect(plan.folders).toEqual({ 'A/B': 'new-2', '/A/B/': 'new-2', 'a/b': 'new-2' });
  });

  it('treats "__proto__" as an ordinary folder name', () => {
    const plan = planFolderPaths(null, ['__proto__'], [], ids());
    expect(Object.keys(plan.folders)).toEqual(['__proto__']);
    expect(plan.folders['__proto__']).toBe('new-1');
    expect(JSON.stringify(plan.folders)).toBe('{"__proto__":"new-1"}');
  });

  it('caps how many folders one call may create', () => {
    const paths = Array.from({ length: MAX_NEW_FOLDERS + 1 }, (_, i) => `f${i}`);
    expect(() => planFolderPaths(null, paths, [], ids())).toThrow(FolderPathError);
    expect(planFolderPaths(null, paths.slice(1), [], ids()).create).toHaveLength(MAX_NEW_FOLDERS);
  });

  it('ignores the input order of existing folders (no dependence on DB row order)', () => {
    const a = [folder('x2', null, 'Dup', 2), folder('x1', null, 'Dup', 1)];
    expect(planFolderPaths(null, ['Dup'], a, ids()).folders.Dup).toBe('x1');
    expect(planFolderPaths(null, ['Dup'], [...a].reverse(), ids()).folders.Dup).toBe('x1');
  });
});
