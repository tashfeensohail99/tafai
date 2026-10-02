# Databank P3-3 — Trash + Version-history UI (frontend)

Wire the ALREADY-MERGED P3-1 trash and P3-2 versions backends into the rebuilt
explorer `DatabankExplorerV2`. Backend is done and tested; this is frontend only.
Both portals (processing + JR) share the `DatabankApi` adapter — add once, both get it.

Flag: the explorer is already behind `NEXT_PUBLIC_DATABANK_EXPLORER_V2` (pilot). No new flag.

## Backend contract (exact — all under the portal base `{base}` = `/processing/databank` or `/jr/databank`)

### Trash
- `GET  {base}/trash?clientId=<uuid>`  OR  `GET {base}/trash?personal=true`
  → `TrashItem[]` ordered deletedAt desc. `TrashItem = { id, kind: 'folder'|'file', name, originalParentName: string|null, deletedAt: string } & (kind==='file' ? { sizeBytes: number|null } : {})`.
- `POST   {base}/folders/:folderId/restore`  → `{ id, name, parentFolderId, updatedAt }`
- `POST   {base}/files/:fileId/restore`       → file row
- `DELETE {base}/folders/:folderId/purge`     → `{ purgedFolders, purgedFiles }`
- `DELETE {base}/files/:fileId/purge`         → `{ id, purged: true }`

### Versions (fileId = a DatabankFile id)
- `GET  {base}/files/:fileId/versions`
  → `{ etag: 'W/"<n>"', versions: Version[] }`, also sends an `ETag` response header.
  `Version = { id: string|null, versionNumber: number, name: string|null, fileSizeBytes: number|null, mimeType: string|null, sha256: string|null, createdByUserId: string|null, createdAt: string, isCurrent: boolean }`.
  NOTE: the `id:null` synthetic entry appears ONLY in the implicit-v1 state (a file with no history yet); it is always `isCurrent:true`. The UI must treat an `id===null` version as **non-restorable, non-deletable, non-renamable** (only downloadable — via the file's normal signed-url, since it IS the current bytes).
- `GET  {base}/files/:fileId/versions/:versionId/signed-url` → `{ url, fileName, mimeType }`
- `POST {base}/files/:fileId/versions/presign` body `{ mimeType: string, fileSizeBytes: number, fileName?: string }`
  → `{ strategy, storageKey, url, headers, maxBytes }` (a presigned PUT; `maxBytes` ≈ 2 GB direct cap).
- `POST {base}/files/:fileId/versions/commit` body `{ storageKey, mimeType, fileSizeBytes, sha256 }`, optional `If-Match` header → file row (the new current).
- `POST {base}/files/:fileId/versions/:versionId/restore`  optional `If-Match` → file row
- `PATCH  {base}/files/:fileId/versions/:versionId` body `{ name }` optional `If-Match` → `{ etag, versions }` (same shape as GET)
- `DELETE {base}/files/:fileId/versions/:versionId` optional `If-Match` → `{ id, deleted: true }`

Concurrency: send `If-Match: <etag>` (the `etag` from the last `GET versions`) on restore / rename / delete so a stale client gets a **412**; show "This file's version history changed — reloading" and refetch. The "upload new version" commit may omit If-Match (it is an additive append). A **409** on delete = "can't delete the current version."

## 1) API client functions — `apps/frontend/lib/processing.ts` AND `apps/frontend/lib/jr-databank.ts`

Match the EXISTING style in those files (same `apiFetch`/request helper, same error handling, same export shape as `searchDatabankFiles` / `getDatabankFileSignedUrl` / `directUploadDatabankFile`). Add (processing names; JR = `Jr` variants, same as the existing pairs):

Trash: `fetchDatabankTrash(scope: {clientId: string} | {personal: true}): Promise<TrashItem[]>`,
`restoreDatabankFolder(id)`, `restoreDatabankFile(id)`, `purgeDatabankFolder(id)`, `purgeDatabankFile(id)`.

Versions (low-level): `fetchDatabankFileVersions(fileId): Promise<{etag, versions: Version[]}>`,
`databankVersionSignedUrl(fileId, versionId): Promise<{url, fileName, mimeType}>`,
`presignDatabankVersion(fileId, body)`, `commitDatabankVersion(fileId, body, ifMatch?)`,
`restoreDatabankVersion(fileId, versionId, ifMatch?)`, `renameDatabankVersion(fileId, versionId, name, ifMatch?)`,
`deleteDatabankVersion(fileId, versionId, ifMatch?)`.

Versions (high-level upload helper): `uploadDatabankFileVersion(fileId, file: File, onProgress?: (fraction:number)=>void): Promise<ApiDatabankFile>` that:
1. `presignDatabankVersion(fileId, { mimeType: file.type || 'application/octet-stream', fileSizeBytes: file.size, fileName: file.name })`.
2. reject up front if `file.size > maxBytes` with a clear message ("Files larger than N GB can't be uploaded as a version here yet — use the main upload"). 
3. compute the whole-file **sha256 hex** with the EXISTING browser hasher in `lib/databank-upload/` (reuse `sha256.ts` / `hash.ts` — do NOT hand-roll crypto).
4. `PUT` the bytes to the presigned `url` with its `headers` (reuse the existing direct-PUT helper that `directUploadDatabankFile` uses, with `onProgress`).
5. `commitDatabankVersion(fileId, { storageKey, mimeType, fileSizeBytes: file.size, sha256 }, /* no If-Match */)` → return the file row.

Export a shared `Version` + `TrashItem` type from `lib/processing.ts` and re-use in `lib/jr-databank.ts` (import the types; JR only needs its own base-path request fns).

## 2) DatabankApi adapter — `apps/frontend/lib/databank-api.ts`

Add to the `DatabankApi` interface + BOTH impls (`processingDatabankApi`, `jrDatabankApi`), delegating to the matching portal client fns:
`fetchTrash(scope)`, `restoreFolder2(id)`/`restoreFileFromTrash(id)` (pick clear non-colliding names — `restoreFolder` the method name is free; there is already `renameFolder/moveFolder/deleteFolder` but no restore), `purgeFolder(id)`, `purgeFile(id)`,
`listFileVersions(fileId)`, `versionSignedUrl(fileId, versionId)`, `uploadFileVersion(fileId, file, onProgress?)`, `restoreFileVersion(fileId, versionId, ifMatch?)`, `renameFileVersion(fileId, versionId, name, ifMatch?)`, `deleteFileVersion(fileId, versionId, ifMatch?)`.
Keep names distinct from the existing file/folder ops (e.g. trash restore = `restoreTrashedFolder` / `restoreTrashedFile`; permanent delete = `purgeTrashedFolder` / `purgeTrashedFile`) so nothing clashes with the soft-delete `deleteFile`/`deleteFolder` already on the interface.

## 3) Explorer UI — `apps/frontend/components/databank/explorer/DatabankExplorerV2.tsx`

Reuse the component's EXISTING patterns (Radix `ContextMenu` + `Dialog`, the scoped-CSS block, the `reload()` refresh, `busy`/`error` state, `fmtDate`, `FileGlyph`, `runLimited`). Everything WRITE is hidden when `!canWrite` (read-only scope), exactly like the current rename/move/delete actions.

### 3a) Trash view
- A **"Trash"** button in the toolbar (next to Upload / New folder). Opens a Radix Dialog "Trash" (`data-sos-modal`), scrolded list.
- On open: `api.fetchTrash(scope)` for the current scope (client id, or personal). Show each item: folder/file glyph, name, "was in {originalParentName ?? 'root'}", deleted date, and for files the size.
- Per row: **Restore** (→ `restoreTrashedFolder/File`, then close-or-refresh the dialog list AND `reload()` the tree) and **Delete forever** (opens a small confirm — "Permanently delete '{name}'? This frees its storage and cannot be undone." → `purgeTrashed…`, then refresh list + `reload()`). Folder purge confirm notes it removes the whole subtree.
- Empty state: "Trash is empty." Loading + error states like the rest of the explorer.

### 3b) Version history
- File **context-menu** item **"Version history"** (and a button in the details panel for the selected file). Opens a Radix Dialog "Versions — {fileName}".
- On open: `api.listFileVersions(fileId)` → hold `{etag, versions}`. Render newest-first: `v{versionNumber}` + optional label, size, date, a **Current** badge on `isCurrent`.
- Toolbar in the dialog: **Upload new version** (hidden if `!canWrite`) → file picker → `api.uploadFileVersion(fileId, file, setPct)` with a small progress bar → on success refetch the version list AND patch the file row in the table (`patchFile`) / details so its size/mime update.
- Per NON-current, materialised (`id !== null`) version (all hidden if `!canWrite` except Download):
  - **Download** → `api.versionSignedUrl(fileId, id)` then open `url` in a new tab.
  - **Restore** → `api.restoreFileVersion(fileId, id, etag)` → refetch list + patch the file row. On 412 show the stale-history notice and refetch.
  - **Rename** (label) → inline/dialog input → `api.renameFileVersion(fileId, id, name, etag)` → refetch (the PATCH returns the new list).
  - **Delete** → confirm "Permanently delete version v{n}? Its bytes are freed and it can't be recovered." → `api.deleteFileVersion(fileId, id, etag)` → refetch. A 409 (current) should not be offered (never show Delete on the current), but still handle it gracefully.
- The current version row: **Download** via the file's normal `api.signedUrl(fileId)`; no restore/delete.
- The synthetic `id===null` entry (implicit v1): render as the single current version, Download via `api.signedUrl`, no other actions.

## Constraints
- Plain CSS `.sos-*` + headless Radix (match the file). No Tailwind. Light + dark both legible.
- NO new npm deps (reuse @radix-ui/react-dialog + react-context-menu already imported; reuse the existing hasher + direct-PUT).
- `tsc --noEmit` from apps/frontend must be clean; `next build` must pass with `NEXT_PUBLIC_DATABANK_EXPLORER_V2` both unset and `on`.
- Do NOT touch the backend. Do NOT change the legacy `DatabankTab`.
- Keep the diff cohesive; mirror existing component idioms. Mobile/narrow width must not horizontally scroll (the component already has a `narrow` state).

## Out of scope
Resumable (>2 GB) version uploads (a later backend PR). Per-file activity timeline.
