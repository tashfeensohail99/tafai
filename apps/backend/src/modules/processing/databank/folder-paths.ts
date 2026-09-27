/**
 * Pure planning for `folders/ensure-paths` (Databank Phase 1 —
 * docs/databank-phase1-resumable-uploads.md §2): turn the directory paths of a
 * dropped folder into "reuse this existing folder / create this new one", so a
 * whole Drive-exported tree lands in ONE call instead of one POST per folder.
 *
 * Merge rule (the plan's default: "merge existing folders silently"): a path
 * segment REUSES a live same-name sibling — exact name first, then a
 * case-insensitive match (Windows/macOS folders are case-insensitive, so a
 * dropped "passport" is the officer's existing "Passport") — and never gets a
 * "(2)" suffix. Only a segment with no match becomes a new folder. Re-sending
 * the same paths therefore creates nothing and returns the same ids.
 *
 * No I/O here; the service runs it under the scope's folder lock.
 */

/** Paths per request (each one's missing ancestors are created too). */
export const MAX_ENSURE_PATHS = 2000;
/** Deepest folder path accepted (Drive trees are rarely > 10). */
export const MAX_FOLDER_DEPTH = 32;
/** New folders one call may create — a sane ceiling for one drop. */
export const MAX_NEW_FOLDERS = 5000;
/** Same limit as a hand-made folder name (CreateFolderDto). */
export const MAX_FOLDER_NAME = 120;

/** A bad path — the service turns it into a 400. */
export class FolderPathError extends Error {}

export interface ExistingFolder {
  id: string;
  parentFolderId: string | null;
  name: string;
  createdAt: Date;
}

export interface NewFolder {
  id: string;
  parentFolderId: string | null;
  name: string;
}

export interface FolderPlan {
  /** Every requested path (exactly as sent) → the folder id it resolves to. */
  folders: Record<string, string>;
  /** Folders to create, parents always BEFORE their children. */
  create: NewFolder[];
}

// Control characters (incl. NUL, which Postgres text cannot store at all).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Normalise one relative folder path ("Passport/Scans", "/Passport/Scans/",
 *  "Passport//Scans") into its segments. Browsers separate with "/" only
 *  (webkitRelativePath, FileSystemEntry.fullPath), so "\" stays part of a name.
 *  Segments are NFC-normalised (macOS names arrive decomposed) and trimmed —
 *  like a hand-made folder name. */
export function splitFolderPath(raw: string): string[] {
  const segments = raw
    .split('/')
    .map((s) => s.normalize('NFC').trim())
    .filter(Boolean);
  if (!segments.length) throw new FolderPathError('A folder path is empty.');
  if (segments.length > MAX_FOLDER_DEPTH) {
    throw new FolderPathError(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep.`);
  }
  for (const s of segments) {
    if (s === '.' || s === '..') throw new FolderPathError(`"${s}" is not a valid folder name.`);
    if (CONTROL_CHARS.test(s)) throw new FolderPathError('A folder name contains a control character.');
    if (s.length > MAX_FOLDER_NAME) {
      throw new FolderPathError(`A folder name is longer than ${MAX_FOLDER_NAME} characters.`);
    }
  }
  return segments;
}

const fold = (name: string): string => name.normalize('NFC').toLowerCase();

/**
 * Resolve every path under `baseFolderId` (null = the databank root) against
 * the scope's live folders. `existing` must be ALL live folders of the scope
 * (only those reachable from the base are ever matched). `newId` mints the id
 * of each folder to create, so the caller can insert them without a read-back.
 */
export function planFolderPaths(
  baseFolderId: string | null,
  paths: string[],
  existing: ExistingFolder[],
  newId: () => string,
): FolderPlan {
  // parent → (exact name → id) and parent → (folded name → id). Several live
  // siblings can share a name (a hand-made "Passport" raced another); the
  // OLDEST wins — deterministic, and the one users have been filing into.
  const exact = new Map<string, Map<string, string>>();
  const folded = new Map<string, Map<string, string>>();
  const key = (parent: string | null) => parent ?? '';
  const put = (index: Map<string, Map<string, string>>, parent: string | null, name: string, id: string) => {
    let names = index.get(key(parent));
    if (!names) index.set(key(parent), (names = new Map()));
    if (!names.has(name)) names.set(name, id);
  };
  const sorted = [...existing].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const f of sorted) {
    put(exact, f.parentFolderId, f.name.normalize('NFC'), f.id);
    put(folded, f.parentFolderId, fold(f.name), f.id);
  }

  // No prototype: a folder literally named "__proto__" must be a plain key.
  const folders: Record<string, string> = Object.create(null);
  const create: NewFolder[] = [];
  for (const raw of paths) {
    let parent = baseFolderId;
    for (const name of splitFolderPath(raw)) {
      const hit = exact.get(key(parent))?.get(name) ?? folded.get(key(parent))?.get(fold(name));
      if (hit) {
        parent = hit;
        continue;
      }
      if (create.length >= MAX_NEW_FOLDERS) {
        throw new FolderPathError(
          `One upload can create at most ${MAX_NEW_FOLDERS} folders — upload this folder in parts.`,
        );
      }
      const id = newId();
      create.push({ id, parentFolderId: parent, name });
      // Register it so later paths sharing this prefix reuse it, not duplicate it.
      put(exact, parent, name, id);
      put(folded, parent, fold(name), id);
      parent = id;
    }
    folders[raw] = parent as string; // ≥1 segment, so never the base itself
  }
  return { folders, create };
}
