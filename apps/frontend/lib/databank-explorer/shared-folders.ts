/**
 * Build the explorer's "what's shared to JR" index from a listShares result.
 *
 * The Share-to-JR UI (Step 6) needs two things at a glance: whether the WHOLE
 * client is shared, and — for folder badges + the "Stop sharing" context-menu
 * action — a lookup from a shared folder's id to the share's own id (which is
 * what `unshareFromJr` revokes). Only folder shares with a live `folderId` land
 * in the map; the whole-client share (folderId null) is reflected by
 * `clientShared` instead.
 *
 * Kept pure and dependency-free (structural input, mirroring
 * `DatabankSharesResult` in ../processing) so it can be unit-tested under
 * `node --test` without pulling in the client-only processing module.
 */

/** Structural mirror of `DatabankShareRow` — only the fields this index needs. */
export interface ShareRowLike {
  id: string;
  folderId: string | null;
}

/** Structural mirror of `DatabankSharesResult`. */
export interface SharesResultLike {
  clientShared: boolean;
  shares: ShareRowLike[];
}

export interface SharedFolderIndex {
  /** True when the entire client databank is shared to JR. */
  clientShared: boolean;
  /** Shared folder id → its share's id (to revoke via `unshareFromJr`). */
  folderShareByFolderId: Map<string, string>;
}

export function buildSharedFolderIndex(
  result: SharesResultLike | null | undefined,
): SharedFolderIndex {
  const folderShareByFolderId = new Map<string, string>();
  if (!result) return { clientShared: false, folderShareByFolderId };
  for (const share of result.shares) {
    // Skip the whole-client share (folderId null) — reflected by clientShared.
    // Last write wins if the backend ever returns two active shares for one
    // folder (it shouldn't), keeping the map to one id per folder.
    if (share.folderId) folderShareByFolderId.set(share.folderId, share.id);
  }
  return { clientShared: result.clientShared === true, folderShareByFolderId };
}
