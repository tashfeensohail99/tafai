/**
 * Shared folder-upload helpers (Databank) — the per-file size cap and the
 * recursive drag-dropped-directory reader, used by BOTH the legacy DatabankTab
 * and the rebuilt DatabankExplorerV2 so there is exactly one copy.
 *
 * Deliberately dependency-free (only the DOM `File`/Entries API as types), so it
 * is safe both for the plain, node --test TypeScript in this folder and for the
 * React components that import it.
 */

/** Per-file upload cap. Uploads go STRAIGHT to R2 (presigned PUT), never through
 *  the backend, so a whole client folder can be any size (files upload one at a
 *  time). The per-FILE ceiling is the backend's DatabankFile.fileSizeBytes
 *  column — a 32-bit int (max ~2 GB); a bigger single file needs the DB column
 *  widened + multipart (a planned follow-up). A file over this is skipped up
 *  front with a clear message instead of a failed request. */
export const MAX_FILE_BYTES = 2_147_483_647; // Postgres int4 max (must match the backend)

export const fmtMB = (n: number) =>
  n >= 1024 * 1024 * 1024
    ? `${(n / (1024 * 1024 * 1024)).toFixed(n % (1024 * 1024 * 1024) === 0 ? 0 : 1)} GB`
    : `${Math.round(n / (1024 * 1024))} MB`;

/** One file picked for a folder upload, carrying its path relative to the
 *  dropped/selected folder (e.g. "Passport/scan.pdf") so we can recreate the
 *  subfolder tree. */
export type FolderEntry = { file: File; relPath: string };

/** Recursively walk a drag-and-dropped FileSystemEntry into FolderEntry[],
 *  preserving the relative path. `webkitGetAsEntry()` is the only cross-browser
 *  way to read a dropped DIRECTORY (dataTransfer.files is empty for folders).
 *  Typed loosely — the File System (Entries) API isn't in lib.dom. */
export async function walkEntry(entry: any, prefix: string, out: FolderEntry[]): Promise<void> {
  if (!entry) return;
  if (entry.isFile) {
    await new Promise<void>((resolve) => {
      entry.file(
        (f: File) => {
          out.push({ file: f, relPath: prefix ? `${prefix}/${f.name}` : f.name });
          resolve();
        },
        () => resolve(),
      );
    });
    return;
  }
  if (entry.isDirectory) {
    const dirPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const reader = entry.createReader();
    const readBatch = (): Promise<any[]> =>
      new Promise((resolve) => reader.readEntries((es: any[]) => resolve(es), () => resolve([])));
    // readEntries returns at most ~100 entries per call — loop until drained.
    let batch = await readBatch();
    while (batch.length) {
      for (const child of batch) {
        // eslint-disable-next-line no-await-in-loop
        await walkEntry(child, dirPath, out);
      }
      // eslint-disable-next-line no-await-in-loop
      batch = await readBatch();
    }
  }
}
