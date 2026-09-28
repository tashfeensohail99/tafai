/**
 * Folder-drop planning for the upload queue (Databank Phase 1, PR-7). Pure.
 *
 * Mirrors the backend's `folders/ensure-paths` rules (apps/backend/…/databank/
 * folder-paths.ts — a contract test keeps the limits in step) so that ONE bad
 * Drive folder name skips only its own subtree, with the server's exact wording,
 * instead of the whole drop failing with a 400.
 */

export const MAX_ENSURE_PATHS = 2000;
export const MAX_FOLDER_DEPTH = 32;
export const MAX_NEW_FOLDERS = 5000;
export const MAX_FOLDER_NAME = 120;
export const MAX_FILE_NAME = 255;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export interface Skipped {
  path: string;
  size: number;
  kind: 'bad-folder' | 'name' | 'blocked' | 'drive-stub' | 'too-big' | 'unreadable';
  reason: string;
}

/** "A/B/c.pdf" → "A/B"; "c.pdf" → "". */
export function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? '' : relPath.slice(0, i);
}

/** The backend's splitFolderPath checks, returning its EXACT message (or null
 *  when the path is fine). */
export function validateFolderPath(raw: string): string | null {
  const segments = raw
    .split('/')
    .map((s) => s.normalize('NFC').trim())
    .filter(Boolean);
  if (!segments.length) return 'A folder path is empty.';
  if (segments.length > MAX_FOLDER_DEPTH) return `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep.`;
  for (const s of segments) {
    if (s === '.' || s === '..') return `"${s}" is not a valid folder name.`;
    if (CONTROL_CHARS.test(s)) return 'A folder name contains a control character.';
    if (LONE_SURROGATE.test(s)) return 'A folder name contains an invalid character.';
    if (s.length > MAX_FOLDER_NAME) return `A folder name is longer than ${MAX_FOLDER_NAME} characters.`;
  }
  return null;
}

/** "(folder "…")" suffix exactly as the backend names a bad path. */
function named(message: string, path: string): string {
  const shown = path.length > 80 ? `${path.slice(0, 77)}...` : path;
  return `${message} (folder ${JSON.stringify(shown)})`;
}

const depth = (p: string) => (p ? p.split('/').length : 0);
const byDepthThenCode = (a: string, b: string) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0);

export interface DropEntry {
  name: string;
  size: number;
  relPath: string;
}

export interface FolderDropPlan<E extends DropEntry> {
  accepted: Array<{ entry: E; dir: string }>;
  skipped: Skipped[];
  /** EVERY ancestor prefix of every accepted directory (and empty dirs), deduped,
   *  shallowest first — so each ensure-paths call only ever creates folders it
   *  names (never an implied ancestor), keeping it under MAX_NEW_FOLDERS. */
  dirPaths: string[];
  /** Top-level names of the drop ("Passport", "Bank"), in first-seen order. */
  roots: string[];
}

/** Split a folder drop into what can go and what can't (with the reason). */
export function planFolderDrop<E extends DropEntry>(entries: E[], opts: { emptyDirs?: string[] } = {}): FolderDropPlan<E> {
  const accepted: Array<{ entry: E; dir: string }> = [];
  const skipped: Skipped[] = [];
  const badPrefix = new Map<string, string>(); // prefix → server message
  const verdict = new Map<string, string | null>();
  const check = (prefix: string): string | null => {
    let v = verdict.get(prefix);
    if (v === undefined) {
      v = validateFolderPath(prefix);
      verdict.set(prefix, v);
    }
    return v;
  };
  /** The first (shallowest) bad prefix of `dir`, if any. */
  const firstBad = (dir: string): { prefix: string; message: string } | null => {
    if (!dir) return null;
    const segs = dir.split('/');
    for (let i = 1; i <= segs.length; i++) {
      const prefix = segs.slice(0, i).join('/');
      const known = badPrefix.get(prefix);
      if (known) return { prefix, message: known };
      const v = check(prefix);
      if (v) {
        badPrefix.set(prefix, v);
        return { prefix, message: v };
      }
    }
    return null;
  };
  const dirs = new Set<string>();
  const roots: string[] = [];
  const seenRoots = new Set<string>();
  const noteRoot = (path: string) => {
    const root = path.split('/')[0];
    if (root && !seenRoots.has(root)) {
      seenRoots.add(root);
      roots.push(root);
    }
  };
  const addPrefixes = (dir: string) => {
    const segs = dir.split('/');
    for (let i = 1; i <= segs.length; i++) dirs.add(segs.slice(0, i).join('/'));
  };
  for (const entry of entries) {
    const dir = dirOf(entry.relPath);
    const bad = firstBad(dir);
    if (bad) {
      skipped.push({ path: entry.relPath, size: entry.size, kind: 'bad-folder', reason: named(bad.message, bad.prefix) });
      continue;
    }
    if (!entry.name || entry.name.length > MAX_FILE_NAME) {
      skipped.push({ path: entry.relPath, size: entry.size, kind: 'name', reason: `The file name must be 1–${MAX_FILE_NAME} characters.` });
      continue;
    }
    noteRoot(entry.relPath);
    accepted.push({ entry, dir });
    if (dir) addPrefixes(dir);
  }
  for (const d of opts.emptyDirs ?? []) {
    const dir = d.replace(/^\/+|\/+$/g, '');
    if (!dir || firstBad(dir)) continue; // an empty folder under a bad name is simply not created
    noteRoot(dir);
    addPrefixes(dir);
  }
  return { accepted, skipped, dirPaths: [...dirs].sort(byDepthThenCode), roots };
}

/** Split paths into ensure-paths calls: ≤ maxPaths each and ≤ maxBytes of JSON
 *  (the API's body limit is 2 MB), keeping the input order — with shallow-first
 *  input, every ancestor lands in the same or an earlier call. */
export function chunkPaths(paths: string[], opts: { maxPaths?: number; maxBytes?: number } = {}): string[][] {
  const maxPaths = Math.min(opts.maxPaths ?? 1000, MAX_ENSURE_PATHS);
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const enc = new TextEncoder();
  const out: string[][] = [];
  let cur: string[] = [];
  let bytes = 0;
  for (const p of paths) {
    const b = enc.encode(JSON.stringify(p)).length + 1;
    if (cur.length && (cur.length >= maxPaths || bytes + b > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(p);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Upload order: small files (≤ 32 MiB — one PUT each) first, then by path.
 *  The engine hashes and inits in queue order, so this lets a folder's hundreds
 *  of PDFs land while its video is still hashing. Stable. */
export function orderForUpload<T extends { size: number; path: string }>(xs: T[]): T[] {
  const SMALL = 32 * 1024 * 1024;
  return xs
    .map((x, i) => ({ x, i }))
    .sort((a, b) => {
      const sa = a.x.size <= SMALL ? 0 : 1;
      const sb = b.x.size <= SMALL ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (a.x.path !== b.x.path) return a.x.path < b.x.path ? -1 : 1;
      return a.i - b.i;
    })
    .map((v) => v.x);
}
