/**
 * Can the clipboard's folder be pasted into `destFolderId`?
 *
 * Mirrors the tree's drag-drop guard and the backend cycle check: a folder can
 * never be pasted into itself or into one of its own descendants. A files-only
 * clipboard (no `clipFolderId`) is always allowed, and the root (null) is never
 * inside any folder. `parentOf` maps every folder id to its parent id (or null
 * for a root folder); the component builds it from its folder list.
 */
export function canPasteInto(
  destFolderId: string | null,
  clipFolderId: string | null,
  parentOf: Map<string, string | null>,
): boolean {
  if (!clipFolderId) return true; // files-only clipboard — never blocked
  if (destFolderId === null) return true; // the root cannot be inside a folder
  if (destFolderId === clipFolderId) return false; // into itself

  // Walk the destination's ancestors; blocked if the clip folder is one of them
  // (i.e. the destination lives inside the folder being pasted). `seen` guards
  // against a malformed cycle in the data.
  const seen = new Set<string>();
  let cur: string | null | undefined = destFolderId;
  while (cur && !seen.has(cur)) {
    if (cur === clipFolderId) return false;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return true;
}
