/**
 * Drift guard: the limits folder-plan.ts checks in the browser must be the
 * backend's (folder-paths.ts). A mismatch means drops the dock accepts get a
 * 400 from ensure-paths (or good folders are refused up front). Read as text —
 * no backend code is imported.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as plan from './folder-plan.ts';

const backend = readFileSync(
  new URL('../../../backend/src/modules/processing/databank/folder-paths.ts', import.meta.url),
  'utf8',
);

function backendConst(name: string): number {
  const m = new RegExp(`export const ${name}\\s*=\\s*([\\d_]+)\\s*;`).exec(backend);
  assert.ok(m, `${name} is no longer declared in the backend's folder-paths.ts`);
  return Number(m[1].replace(/_/g, ''));
}

for (const name of ['MAX_ENSURE_PATHS', 'MAX_FOLDER_DEPTH', 'MAX_NEW_FOLDERS', 'MAX_FOLDER_NAME'] as const) {
  test(`[contract] ${name} matches the backend`, () => {
    assert.equal(plan[name], backendConst(name));
  });
}
