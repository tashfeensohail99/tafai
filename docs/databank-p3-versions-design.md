# Databank P3-2 — File Versioning (backend design, PR-1)

Synthesised from a judge-panel design workflow (2 judges both ranked the
"explicit / lazy-materialization / deduped-Set lifecycle" design first), with the
grafts both judges agreed on. This is the implementation contract for PR-1.

Per-file **activity timeline** is a SEPARATE later PR — not in scope here.
Resumable (>2 GB) new-version uploads are **PR-2** — not in scope here.

## Guiding invariant

**Every stored object is owned by exactly ONE `DatabankFileVersion` row.**
`DatabankFile.storageKey` (and mimeType/fileSizeBytes/sha256) is a *denormalised
mirror* of the current version — a read-cache so tree/search/download need no
join — never an independent owner. Therefore:

> Freeing a file's storage = free the **deduped set** `{file.storageKey} ∪ {every version's storageKey}`, survivor-checked.

The dedupe makes the current object (which appears in both the file mirror and its
current version row once materialised) free **exactly once** → double-free is
structurally impossible, and every historical object is freed exactly once.

## Lazy materialisation (why there is NO data backfill)

`DatabankFile.currentVersionId = NULL` means **"implicit v1"**: the current bytes
are the file's own mirror columns and there is no version row yet. This is the
state of all existing rows and every future single-upload file.

- Create paths (resumable `commit()`, `commitDirectUpload`, `uploadFile`,
  `uploadPersonalFile`, `copyFile`) stay **byte-for-byte unchanged** — they never
  write a version row. This is the design's biggest risk-reducer.
- The deduped-Set free rule is correct in BOTH the NULL state (free `{file.storageKey}`)
  and the materialised state (free `{file.storageKey} ∪ {version keys}` → deduped).
- The FIRST `commitNewVersion` **materialises v1** (a version row copied from the
  file's mirror) then creates v2, inside the per-file lock.

Migration is therefore **pure additive DDL, no data transform** — trivially safe
and idempotent on the ~5-row prod table.

## Schema (`apps/backend/prisma/schema.prisma`, schema `processing`)

New model:

```prisma
model DatabankFileVersion {
  id              String             @id @default(uuid())
  fileId          String
  versionNumber   Int                // 1-based, monotonic per file; v1 = original
  storageKey      String             @unique  // this version's OWN object key
  mimeType        String?
  fileSizeBytes   BigInt?            // bigint-json serialised like DatabankFile
  sha256          String?
  source          DatabankFileSource @default(UPLOAD)  // reuse existing enum
  name            String?            // optional human label ("Signed final")
  uploadSessionId String?            @unique  // home for PR-2 resumable-version idempotency; null in PR-1
  createdByUserId String?
  createdAt       DateTime           @default(now())

  file DatabankFile @relation("DatabankFileVersions", fields: [fileId], references: [id], onDelete: Cascade)

  @@unique([fileId, versionNumber])  // serialised numbering; P2002 => re-read max+1, retry
  @@index([fileId])
  @@index([storageKey])
  @@index([sha256])
  @@map("databank_file_versions")
  @@schema("processing")
}
```

Changes to `DatabankFile` (ALL additive/nullable → safe on the small prod table):

```prisma
  // PLAIN id, NO FK relation (matches copiedFromFileId / ownerUserId convention) —
  // this deliberately avoids a file<->version cyclic FK. Lifecycle never trusts it
  // for freeing. NULL = implicit v1 (current bytes = this row's mirror columns).
  currentVersionId String?
  // Optimistic-concurrency token for version ops. Bumped in the SAME txn as every
  // version-list mutation (new version / restore / delete / rename). ETag basis.
  versionSeq       Int    @default(1)
  versions         DatabankFileVersion[] @relation("DatabankFileVersions")
```

Migration also adds a **partial unique** index on `databank_files(currentVersionId) WHERE currentVersionId IS NOT NULL`
(integrity belt-and-braces; one version is current for at most one file).

`fileSelect` gains `currentVersionId` and `versionSeq` (additive) so the UI knows
history exists and holds the ETag. Tree/search selects are otherwise unchanged.

**Why plain-id currentVersionId (not an FK):** eliminates the cyclic FK
(`currentVersionId→version SET NULL` vs `version.fileId→file CASCADE`) and its
cascade-ordering risk. It can never dangle because `deleteVersion` refuses to
delete the current version, and purging a file deletes the file row (taking
`currentVersionId` with it) and cascades its version rows together.

## Per-file advisory lock

`pg_advisory_xact_lock(1145194037, hashtext(fileId))` — a NEW two-key namespace,
**distinct** from `1145194033` (folders), `1145194035` (upload init-race) and the
single-key `hashtext()` space used by the resumable commit. Document it beside
`lockFolderScope`. Every version-list mutation (commit/restore/delete/rename)
takes it so version numbering and the `currentVersionId` repoint are race-free.
It serialises version ops against each other **and** against a concurrent
`deleteFile`/purge via `SELECT … FOR UPDATE` on the file row inside the txn.

## Service methods (`databank.service.ts`)

Factor shared helpers out of `commitDirectUpload` WITHOUT changing it:
`assertCommittableKey(storageKey, scope)` (keyShape regex + "not a DatabankUpload
session key") and a HEAD-within-cap helper.

### `presignNewVersion(fileId, dto, user)`  (WRITE)
`loadFile` → `authorizeRow 'write'` (404 if trashed → can't version a trashed file).
Assert safe name + size ≤ `DIRECT_MAX_BYTES`. Presign a PUT into the file's OWN
scope folder (`databank/clients/:clientId` or `databank/users/:ownerUserId`).
Return `{ uploadUrl, storageKey, maxBytes }`.

### `commitNewVersion(fileId, dto, user, ifMatch?)`  (WRITE)
1. `loadFile` → authorize 'write'. `assertCommittableKey(dto.storageKey, scope)`.
2. **Version-aware idempotency FIRST:** if `dto.storageKey` is already a
   `DatabankFileVersion` row **of this file** → return the file unchanged (no free;
   it is referenced). If it is any other file's/version's key, or any DatabankFile's
   key → `400`.
3. HEAD the object: absent → `400` retry; over cap → free + `400`.
4. `$transaction` under the per-file advisory lock:
   - `SELECT … FOR UPDATE` on the file; if gone or `deletedAt` set → free the new
     object, throw (mirrors commit()'s "destination no longer exists"). Serialises
     against `deleteFile`/purge.
   - **If-Match:** if `ifMatch` given and `≠ versionSeq` → free new object, `412`.
   - **sha256 gating** (holding the lock + FOR UPDATE, so current can't move
     between compare and delete): if `dto.sha256` (verified by the HEAD) equals the
     file's CURRENT `sha256` mirror → NO new version; `storage.delete(dto.storageKey)`
     best-effort; return the file unchanged as a successful no-op. (A null current
     sha256 never matches, so a first version always lands. Gating is vs the CURRENT
     version only — re-uploading an OLD version's bytes still makes a new current.)
   - **Materialise implicit v1** if `currentVersionId IS NULL`: INSERT a version
     `{versionNumber:1, storageKey:file.storageKey, mime/size/sha from mirror,
     createdByUserId:file.uploadedByUserId, createdAt:file.createdAt}`.
   - `nextNumber = max(versionNumber WHERE fileId)+1`. INSERT the new version
     `{versionNumber:nextNumber, storageKey:dto.storageKey, mime/size/sha from
     dto+HEAD, createdByUserId:user.id, source:UPLOAD}`. On `@@unique` P2002 →
     re-read max, retry.
   - `UPDATE file SET currentVersionId=new.id, storageKey=dto.storageKey, mimeType,
     fileSizeBytes, sha256, versionSeq=versionSeq+1` guarded `WHERE id=? AND versionSeq=<expected>`
     (expected = the value read under the lock; If-Match already checked). 0 rows → `412`.
5. Frees nothing on success (new object owned by new version; prior current now
   owned by its materialised history row). **No folder lock / lockLiveDestinationFolder**
   — a version attaches to an EXISTING live file, never creates/reparents a file row,
   so the P3 "no live file stranded under a trashed folder" invariant can't be hit.

### `restoreVersion(fileId, versionId, user, ifMatch?)`  (WRITE) — REPOINT only
Txn under the per-file lock: `SELECT file FOR UPDATE` (live only); verify versionId
belongs to fileId (else 404); If-Match. If `versionId == currentVersionId` →
idempotent no-op. Else `UPDATE file SET currentVersionId=versionId`, mirror that
version's byte columns onto the file, `versionSeq+1` (guarded compare-and-set →
412). **Creates/moves/frees ZERO objects** — every version object already exists
and stays referenced by its row; history is intact and reversible.

### `deleteVersion(fileId, versionId, user, ifMatch?)`  (WRITE) — storage reclaim
Txn under the per-file lock: `SELECT file FOR UPDATE` (live); If-Match;
`DELETE FROM databank_file_versions WHERE id=? AND fileId=? AND id <> file.currentVersionId`
(**cannot delete the current version**; also implicitly refuses when currentVersionId
is NULL since an implicit v1 has no deletable row); if 0 deleted → 404/409;
`versionSeq+1`. After commit, `freeStorage([that version.storageKey])` — the deleted
row was the SOLE reference to that unique key → no double-free, no freeing a
referenced object. (Gives operators a reclaim path so re-uploads don't grow storage
forever.)

### `renameVersion(fileId, versionId, name, user, ifMatch?)`  (WRITE)
Set the version's `name` label; `versionSeq+1`; If-Match. (Trivial; included.)

### `listVersions(fileId, user)`  (READ)
`loadFileForRead`. Return `{ etag: 'W/"'+versionSeq+'"', versions: [...] }` ordered
`versionNumber DESC`: `{id, versionNumber, name, fileSizeBytes, mimeType, sha256,
createdByUserId, createdAt, isCurrent}`.
- Materialised state: the row with `id == currentVersionId` has `isCurrent:true`.
- Implicit-v1 state (`currentVersionId NULL`, zero rows): return a single synthetic
  current entry from the file's mirror `{id:null, versionNumber:1, isCurrent:true, …}`.
  `id:null` ⇒ the UI offers neither restore nor delete on it (both only apply to
  non-current, always-materialised rows); its bytes download via the existing file
  `getSignedUrl` (current = file.storageKey).

### `getVersionSignedUrl(fileId, versionId, user)`  (READ, `@AuditDocumentAccess`)
Authorize read; resolve that version's storageKey; signed URL + file.fileName +
version.mimeType.

## Lifecycle changes (the #1 risk — extend, test each)

Free the **deduped set** `{file.storageKey} ∪ {version keys}`, survivor-checked,
capturing version keys **BEFORE** the cascade delete (FK `version.fileId→file`
onDelete:Cascade removes version rows without freeing objects).

- **`purgeFile`**: inside the txn, `SELECT storageKey FROM databank_file_versions WHERE fileId`;
  the file-row delete cascades version rows; after commit free the deduped union.
- **`purgeFolder`**: capture version keys for the TRASHED files in the subtree
  (`fileId IN` captured file ids); delete files (cascades versions) + folders under
  the per-scope lock; free the deduped union after commit. Keep the stray-live-file
  relocate-to-root safeguard.
- **`purgeAgedFiles`** (sweeper): per batch capture version keys for the batch file
  ids before the guarded compare-and-set deleteMany; survivor-check at the FILE level
  (a file is wholly gone or wholly restored — versions never age independently); for
  each truly-removed file free `{its storageKey} ∪ {its version keys}`, deduped.
- **`purgeAgedFolders`** (sweeper): in the recursive cascade-reach capture, also
  capture version keys for the trashed files in reach; after deleting roots + survivor
  check, free the deduped union for files truly gone.

**Soft-delete / restore of the FILE is UNCHANGED.** `deleteFile` only stamps
`file.deletedAt`; version rows have no `deletedAt` and ride with the file as a unit.
`restoreFile` only clears it; versions come back intact.

## Endpoints (both controllers — `databank.controller.ts` + `jr-databank.controller.ts`)

Shared `DatabankService` → JR parity is just controller wiring.
- `GET    files/:fileId/versions`                      READ  → listVersions (sets `ETag`)
- `GET    files/:fileId/versions/:versionId/signed-url` READ (`@AuditDocumentAccess`)
- `POST   files/:fileId/versions/presign`              WRITE → PresignVersionDto
- `POST   files/:fileId/versions/commit`               WRITE (`@Audit DATABANK_FILE_VERSION_ADDED`) + If-Match
- `POST   files/:fileId/versions/:versionId/restore`   WRITE (`@Audit DATABANK_FILE_VERSION_RESTORED`) + If-Match
- `PATCH  files/:fileId/versions/:versionId`           WRITE (rename label) + If-Match
- `DELETE files/:fileId/versions/:versionId`           WRITE (`@Audit DATABANK_FILE_VERSION_PURGED`, HIGH) + If-Match

New DTOs in `databank.dto.ts`: `PresignVersionDto {mimeType, fileSizeBytes, fileName?}`,
`CommitVersionDto {storageKey, mimeType, fileSizeBytes, sha256}`, `RenameVersionDto {name}`.
Add the three `AuditAction` enum values if the audit decorator requires enum membership.

## Edge cases precluded

- Double-free of the current object → deduped Set frees it once.
- FK cascade hard-deletes version rows without freeing → capture version keys before
  the delete in purgeFile/purgeFolder/both sweeper methods.
- Freeing a referenced object → survivor-check skips ALL keys of a surviving file;
  copyFile mints its own key; restore is repoint-only → no two rows share a key.
- version-commit races purge/deleteFile → both FOR UPDATE on the file; commit
  requires live, purge requires trashed → exclusive; commit re-reads deletedAt and
  frees its own object + aborts if trashed meanwhile.
- Two concurrent version uploads → per-file lock serialises; distinct versionNumbers
  via max+1 + `@@unique([fileId,versionNumber])` backstop (P2002 → retry).
- materialise-v1 double-run → guarded by `currentVersionId IS NULL` under the lock.
- lost-response retry of commit → version-aware idempotency returns the file.
- sha256 no-op → redundant object deleted under the lock before returning success.
- restoreVersion → creates/frees nothing; cannot lose/orphan bytes.
- deleteVersion → targets a non-current, sole-referenced key; no double-free/orphan.
- **E6 (known, accepted):** a RAW FK cascade from a client/folder HARD-delete removes
  version rows without freeing objects — the same pre-existing gap as the file's own
  key, now multiplied per version. Clients soft-delete in practice; the opt-in orphan
  reconcile / retention sweeper reclaims. Document; not a blocker.

## Tests (mirror databank-trash.spec.ts / databank-commit.spec.ts)

commitNewVersion (materialise-v1-then-v2; version-aware idempotent retry; foreign-key
400), sha256 no-op (deletes redundant object, returns file), restoreVersion (repoint,
no free, idempotent-when-current), deleteVersion (refuses current, frees sole key),
If-Match 412 on each mutator, listVersions (materialised + synthetic-implicit states),
and lifecycle: purgeFile / purgeFolder / purgeAgedFiles / purgeAgedFolders free the
deduped union of version keys + never double-free + survivor skips a restored file.

## PR split

- **PR-1 (this doc):** everything above — one cohesive feature; zero change to
  `databank-upload.service.ts` commit()/twin-dedup.
- **PR-2 (later):** resumable (>2 GB) new versions — add `DatabankUpload.targetFileId`
  + one guarded early-return at the top of `commit()` routing version sessions to an
  `attachVersion` helper (extracted from commitNewVersion) BEFORE the twin-dedup block;
  idempotency keyed on `DatabankFileVersion.uploadSessionId` (already in the schema).
