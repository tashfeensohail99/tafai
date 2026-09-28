> **Status:** plan of record for Databank Phase 1 (resumable large uploads), produced by a 3-design judge panel on 2026-09-28 and checked against the code. Phase 0 (#412 checksum hotfix, #413 backend fixes, #414 one-Databank UI) precedes it. Product decisions so far: build order Phase 0 → big uploads; external share links built OFF by default; virus scanning skipped for now; Office previews via Microsoft's viewer. The open questions at the end use the defaults stated unless the product owner says otherwise.

# Databank Phase 1: resumable large uploads (judged final design)

I checked the three designs against the worktree code (`storage.service.ts`, `databank.service.ts`, `jr-databank.controller.ts`, `schema.prisma:3640-3705`, `main.ts`, `DatabankTab.tsx`, `lib/processing.ts`, `package.json` files, `docker-compose.yml`). What the code shows:

- **Size column and JSON.** `DatabankFile.fileSizeBytes Int?`. There is no BigInt column anywhere, and the only JSON setting in `main.ts` is `json({limit:'2mb'})`.
- **PR #412 is not in this worktree.** `presignPutUrl` signs `Content-Type` (plus SSE when set). `S3Client` has no `requestChecksumCalculation` yet, so Phase 1 depends on #412 landing.
- **Existing helpers.** Signed upload URLs already last 6 h (`uploadUrlExpires` = 21600). Storage keys are `databank/clients/<id>/…` and `databank/users/<id>/…` (`resolveWriteScope`). `uniqueFolderName` adds "(2)" to a repeated folder name, so re-dropping a folder forks the tree.
- **Libraries and test tools.** Prisma is 5.22, so `createManyAndReturn` is available. MinIO is in `docker-compose.yml`. Node is v24.11. The frontend has no test runner and no `hash-wasm`.
- **Background jobs.** Periodic jobs are `setInterval` sweepers (`document-expiry-sweeper.service.ts`, `reception-sweeper.service.ts`).
- **Not caught by any design:** `copyFile` calls `CopyObject`, which is capped at 5 GiB on S3-compatible stores. "Copy" on a 10 GB file will fail, so this design adds a guard.

## Scores (1-5, higher is better)

| | Correctness / integrity | Live-system risk | Code size | Officer UX | Cost | Fit with R2 facts and repo |
|---|---|---|---|---|---|---|
| robust | **5** | 3 | 2 | 4 | 4 | 3 (relies on part ETag = MD5, which is not verified on R2) |
| simple | 4 | **5** | **5** | 3 | 4 | **5** |
| ux | 4 | 3 | 2 | **5** | 4 | 4 (adds a permanent second size column it doesn't need) |

**Base: simple.** Grafted in:
- from robust and ux: a COMPLETING state that the sweeper finishes, relocation when the target folder is deleted, batched init/complete, and a single `folders/ensure-paths` call;
- from ux: a dock mounted in the portal layouts, adaptive concurrency, a test that part URLs carry no checksum parameters, and vitest;
- from robust: a "possible duplicate" warning for older files, Drive stub filtering, and a Wake Lock.

## 1. Data model

**PR-1 migration `databank_bigint_sha256`**
```sql
ALTER TABLE processing.databank_files ALTER COLUMN "fileSizeBytes" TYPE BIGINT;
ALTER TABLE processing.databank_files ADD COLUMN "sha256" TEXT, ADD COLUMN "uploadSessionId" TEXT;
CREATE UNIQUE INDEX databank_files_uploadSessionId_key ON processing.databank_files("uploadSessionId");
CREATE INDEX databank_files_sha256_idx ON processing.databank_files("sha256");
```

**Choice: change the column type in place (simple and robust), not add a second column (ux).**
- Why: the table is small today, before the Drive migration fills it, so a rewrite under a brief exclusive lock costs milliseconds. Two size columns kept in sync would be a permanent source of drift.
- Gate: run `SELECT count(*)` before merging. If it is over about 500k rows, switch to ux's add-column approach.

**BigInt in JSON.** Choice: a process-wide `BigInt.prototype.toJSON = function(){return Number(this)}` in `src/common/bigint-json.ts`, imported first in `main.ts` and in the jest setup.
- Why this and not a per-site mapper: about 8 `fileSelect` return sites could miss a mapper and turn into a 500. `Number()` is exact up to 9 PB, and the frontend type stays `number`.
- Where tsc forces changes: `copyFile` needs `Number(source.fileSizeBytes ?? 0)`. Prisma accepts `number` when writing a BigInt, so `migrate-drive-databank.ts:207` doesn't change.

**PR-3 migration `databank_uploads`**
```prisma
enum DatabankUploadStatus   { UPLOADING COMPLETING COMPLETED ABORTED FAILED @@schema("processing") }
enum DatabankUploadStrategy { SINGLE MULTIPART @@schema("processing") }
model DatabankUpload {
  id String @id @default(uuid())
  createdByUserId String
  clientId String?  ownerUserId String?  folderId String?  relativePath String?
  fileName String  mimeType String  sizeBytes BigInt  fileLastModified DateTime?
  sha256 String
  strategy DatabankUploadStrategy
  storageKey String @unique
  r2UploadId String?  partSize Int?  partCount Int?
  status DatabankUploadStatus @default(UPLOADING)
  completingAt DateTime?  failureReason String?  r2CleanedAt DateTime?
  fileId String? @unique
  expiresAt DateTime            // createdAt + 6 d (inside R2's 7-day auto-abort, which counts from initiation)
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  @@index([createdByUserId, status])
  @@index([status, expiresAt])
  @@index([status, completingAt])
  @@map("databank_uploads") @@schema("processing")
}
```

**Invariant:** a `DatabankFile` row exists only for an object the server has verified. Existing reads (tree, copy, signed-url) therefore need no status filter. There are no per-part rows; R2 `ListParts` is the record of which parts arrived.

**Disagreements resolved:**
- **COMPLETING is included** (simple had no such state). Without it, a complete that dies after R2 finishes but before the DB write leaves the session UPLOADING, and simple's sweeper would delete a fully uploaded 10 GB object.
- **No PENDING status** (ux). The server calls CreateMultipartUpload first and inserts the row second. A crash in between leaves an upload R2 knows about and the DB doesn't; the daily reconciler aborts it.
- **No `clientRef` and no lease token** (robust).
  - Idempotency comes from init's resume lookup, which matches on the file's SHA-256.
  - Two tabs pushing the same part number write identical bytes, which R2 simply replaces, so a lease adds code without adding safety.

## 2. Endpoints

`DatabankUploadService` (new) injects `DatabankService`; `resolveWriteScope`, `assertFolderInScope` and `assertSafeFileName` become public. Identical thin routes go on both controllers:
- `P=/processing/databank` requires `processing.document.upload` and keeps `?userId=`.
- `P=/jr/databank` requires `jr.artifact.author`.

Every session route also requires `createdByUserId === user.id`.

| Route | Request → Response |
|---|---|
| `POST P/uploads/init` | `{clientId?\|personal?, folderId?, files[≤50]{fileName, mimeType, sizeBytes, lastModified, relativePath?, sha256, allowDuplicate?}}` → `{mode:'proxy'}` in dev storage, else `results[]`, one per file: `upload{uploadId, strategy, partSize, partCount, doneParts[], urls[≤64]{partNumber,url,headers?}, resumed}` \| `duplicate{existing}` \| `possible-duplicate{existing}` \| `already-uploaded{existing}` \| `rejected{reason}` |
| `POST P/uploads/:id/parts` | `{partNumbers[≤100]}` → `{parts[{partNumber,url}], expiresAt}`. One DB read (owner, UPLOADING, `partNumber ≤ partCount`). Signing is local; URLs last 6 h. |
| `GET P/uploads?open=1` | Caller's UPLOADING, COMPLETING and FAILED sessions, for the resume banner. |
| `POST P/uploads/complete` | `{ids[≤50]}` → `results[]` per id: `completed{file, relocated?}` \| `in-progress` \| `missing-parts{missingParts}` \| `failed{reason}` \| `expired` |
| `DELETE P/uploads/:id` | Compare-and-set UPLOADING→ABORTED, then AbortMultipartUpload (or DeleteObject for SINGLE). NoSuchUpload counts as success. Returns 409 once completion has started. |
| `POST P/folders/ensure-paths` | `{clientId?\|personal?, parentFolderId?, paths[≤2000]}` → `{[path]: folderId}`. Get-or-create in one transaction under `pg_advisory_xact_lock(hash(scope))`: one read of the scope's folders, then `createManyAndReturn` per depth. It reuses same-name folders and never adds "(2)". |

**How init handles each file.** One auth check per batch, then:
1. The size cap from `DATABANK_MAX_FILE_BYTES` and `BLOCKED_EXT`.
2. One query covering all resume matches: the caller's UPLOADING session with the same scope, folder, name, size and sha256. If found, `ListParts` gives `doneParts`. If R2 answers NoSuchUpload, the session is marked ABORTED and the file is treated as new.
3. One duplicate query on `(scope, sha256, deletedAt null)`:
   - same folder and same name gives `already-uploaded` (the client skips it silently);
   - otherwise it gives `duplicate`, unless `allowDuplicate` is set.
4. The fallback for older rows with no hash: same folder, same name, same size and `sha256 IS NULL` gives `possible-duplicate`.
5. For new uploads: CreateMultipartUpload with up to 8 running at once, then one `createManyAndReturn` inserts the sessions.

**`finalize(session)` is shared by the complete route and the sweeper. All R2 calls happen outside the transaction**, following the pool-starvation lesson:
1. **Claim.** `updateMany {id, status:UPLOADING}` → COMPLETING with `completingAt=now`. The sweeper may also reclaim a COMPLETING claim older than 15 minutes. If nothing updates, reload the session:
   - COMPLETED returns its file;
   - COMPLETING returns `in-progress`;
   - ABORTED returns `expired`.
2. **Re-check access.**
   - The complete route re-runs `resolveWriteScope`; if access was revoked, return 403 and abort.
   - If the target folder was deleted meanwhile, file into the scope root and return `relocated:true`. A 10 GB upload is never discarded over a deleted folder.
3. **Verify and complete (MULTIPART).**
   - First, HeadObject. If the object already exists at the right size, an earlier complete died after R2 finished: skip to step 5.
   - Otherwise run `ListParts` over all pages, then the pure `verifyParts` check: parts exactly 1..N, each equal to `partSize` except the last, which equals `size − (N−1)·partSize`.
   - If that fails, set the session back to UPLOADING and return `missing-parts`.
   - Call `CompleteMultipartUpload` with **ListParts' own quoted ETags**, sorted by part number. This removes any dependence on CORS `ExposeHeaders` and on the client's quoting.
   - NoSuchUpload goes to the HEAD in step 4. A 429 is retried with backoff.
4. **HEAD.** ContentLength must equal `sizeBytes`. If it doesn't: DeleteObject, mark FAILED, return `failed`. SINGLE uploads run only this step.
5. **Commit.** One `$transaction` creates the `DatabankFile` (BigInt size, sha256, `uploadSessionId`) and marks the session COMPLETED with its `fileId`. A P2002 conflict on `uploadSessionId` means another finalizer won; return its row.

The complete route runs up to 6 finalizes at once per request.

## 3. Client algorithm

- **Part plan** (pure `upload-plan.ts`, shared by backend and frontend):
  - SINGLE if `size ≤ 32 MiB`.
  - Otherwise `partSize = max(8 MiB, ceilMiB(size/9000))` and `partCount = ceil(size/partSize)`. A 10 GiB file is 1,280 × 8 MiB; 100 GiB is 8,534 × 12 MiB. The server decides, stores the plan, and resume reuses it.
  - Choice: an 8 MiB minimum, not ux's 16 MiB. A stall loses less and progress is finer; the extra Class A operations cost about $0.003 per 10 GB.
- **Scheduler:**
  - At most 3 files active at once. One global pool of 4 PUT slots, oldest file first; small files share the same slots.
  - Adaptive (from ux): after 3 errors or stalls within 60 s, drop to 2 slots, and go back to 4 after 2 clean minutes.
  - Each PUT is `xhr.send(file.slice(a,b))`, which streams from disk and buffers nothing. Part PUTs send no headers; SINGLE PUTs send the signed Content-Type (and SSE when configured).
- **Signing:** init returns up to 64 URLs. The client tops up with 64 more when fewer than 16 are unused. A 403 triggers one re-sign. A 10 GB file needs about 20 backend calls in total.
- **Retry:**
  - Up to 8 attempts with full jitter, `rand(0, min(60 s, 2ⁿ s))`, on network errors, 408, 429, 5xx, and stalls (no `onprogress` for 60 s, then the XHR is aborted).
  - `offline` freezes the pool without using up attempts. On `online`, the next complete call's `missing-parts` answer, or the in-memory part set, reconciles what still needs sending.
  - When attempts run out, the file is marked Failed and keeps its session. Retry sends only the missing parts; other files keep going.
- **Speed and ETA:**
  - Bytes sent = finished parts + in-flight `loaded`, with a failed part's partial bytes subtracted.
  - Speed is measured over a 10-second sliding window of 1 Hz samples. ETA = remaining bytes / speed.
  - ETA is hidden for the first 5 s and while paused. Resumed parts count as done but not toward speed.
- **Pause and cancel:** pause aborts the in-flight XHRs and keeps the session (at most 4 × 8 MiB is lost). Cancel is pause plus `DELETE`.
- **Resume after a reload** (choice: no IndexedDB, taken from simple).
  - `uploads?open=1` drives a banner: "2 unfinished uploads (10.2 GB) — drop the same files/folder again to resume · Discard".
  - The re-dropped file is re-hashed, and init's resume lookup returns `doneParts`. Only the missing parts upload.
  - The server stores `relativePath`, so re-dropping a folder maps each file back to its session.
  - Why no IndexedDB: the server-side SHA-256 match is stronger than robust's sampleHash and ux's fingerprint, and it removes client-state bugs.
  - Deferred: ux's `FileSystemFileHandle` one-click resume (Chromium only) goes in a follow-up PR.
- **Changed-file guard:** size and `lastModified` are recorded at queue time and checked again before complete. A Chromium `NotReadableError` fails the file with "changed on disk".
- **Also:** a `beforeunload` warning and a Screen Wake Lock while uploads are active.

## 4. Checksums and duplicate detection

- **Hashing:**
  - `hash-wasm` (MIT; a new dependency) with incremental `createSHA256()`, in `lib/databank-upload/sha256.worker.ts`, loaded via `new Worker(new URL(…, import.meta.url))`.
  - The `File` is posted to the worker without copying bytes and read as `slice(o, o+8 MiB).arrayBuffer()`, so memory stays at about 16 MiB.
  - `crypto.subtle.digest` can't hash incrementally, so it isn't used.
  - Speed is disk-bound, about 30-100 s for 10 GB. One worker hashes ahead of the uploader, so only the first large file in a batch waits; the rows show "Checking 43%".
- **Choice: full hash before init (simple), not size-gated hashing (ux) or sampleHash plus part MD5 (robust).**
  - A 30-100 s wait is about 1% of a 2-hour 10 GB upload.
  - In exchange, the duplicate answer is exact and arrives before any byte is sent, and the same hash is the resume identity.
- **Duplicate UX:**
  - Duplicate rows park as "Already in databank (Passport/scan.pdf, 12 Sep) — Skip / Upload anyway", and the rest of the queue keeps moving.
  - There is a "Skip all duplicates" button.
  - `already-uploaded` items are skipped silently, which makes re-dropping a folder safe.
  - Duplicates within the same drop are caught in the browser with a hash map.
  - Checks are limited to the same scope (client, or personal owner), so private files never leak.
- **What the server verifies:**
  - ListParts part sizes and the total, R2's own Complete, and HEAD ContentLength, all before the row exists. The stored SHA-256 is computed by the client and used for identity and audit.
  - Robust's per-part MD5 and composite-ETag check is deferred to Phase 2, together with CRC-64/NVME FULL_OBJECT. It depends on the unverified assumption that R2 part ETags are MD5s, and it forces buffered reads.

## 5. Orphan cleanup

`DatabankUploadSweeperService` goes in `ProcessingModule`, copying `document-expiry-sweeper.service.ts`: `setInterval` + `unref`, a `running` flag, atomic `updateMany` claims (safe with more than one instance), and the `DATABANK_UPLOAD_SWEEPER_ENABLED` kill-switch. Choice: no BullMQ, since there is no fan-out. Every 30 minutes it:
1. Moves UPLOADING sessions past `expiresAt` to ABORTED(`expired`), then AbortMultipartUpload. For SINGLE sessions it deletes the object only if no `DatabankFile` references the key.
2. Runs `finalize` on sessions stuck in COMPLETING for more than 15 minutes, so a closed tab or a deploy still lands the file.
3. Retries R2 cleanup for ABORTED or FAILED rows where `r2CleanedAt` is null.
4. Once a day, runs `ListMultipartUploads(prefix 'databank/')` and aborts any uploadId the DB doesn't know (or has marked ABORTED) that is older than 24 h.

R2's 7-day lifecycle rule is the backstop. Uncommitted objects from the legacy single-PUT path get a report-only `scripts/databank-orphans.ts`, which is a dry run unless `--commit` is passed.

## 6. Upload queue in the explorer

- **Engine.** A module-level store (`lib/databank-upload/queue.ts`, read with `useSyncExternalStore`, at most 4 notifications a second). Uploads survive in-app navigation.
- **Where the dock lives.** `UploadDock` is mounted in `app/(processing)/layout.tsx` and `app/(jr)/layout.tsx` (from ux), so it stays visible outside the explorer.
- **API adapter.** The Phase 0 adapter gains `initUploads`, `signParts`, `completeUploads`, `abortUpload`, `listOpen` and `ensurePaths`, from one `makeUploadApi(basePath, userId?)`.
- **Dock layout:**
  - Header: "7 files — 3 completed · 2 uploading · 2 waiting · 1 failed — 4.1 of 20.3 GB · 6.2 MB/s · ~48 min", with Pause all / Cancel all / Retry failed.
  - Rows are grouped by dropped folder ("Passport/ — 120 files, 118 done"). Only active and failed rows plus the first 50 waiting ones are rendered ("+1,940 more").
  - Row chips: Waiting · Checking % · Uploading % · speed · Paused · Finalizing · Done · Failed [Retry] · Duplicate [Skip / Upload anyway] · Skipped (reason).
  - Banners: offline ("will continue automatically"), interrupted-resume, keep this tab open.
- **Explorer changes.** `doUpload` and `doUploadFolder` (`DatabankTab.tsx:248-347`) and the `progress` state (`:163`) are replaced by `queue.enqueue(files, target)`. The tree reloads, debounced to 1.5 s, when items finish in the scope being viewed.

## 7. Folder uploads

1. Walk the folder with the existing `walkEntry` / `webkitdirectory` code.
2. Filter before queueing, showing a reason for each skip:
   - `.DS_Store`, `Thumbs.db`, `desktop.ini`, `~$*`;
   - `BLOCKED_EXT`;
   - Drive stubs `.gdoc`, `.gsheet`, `.gslides`, shown as "export from Drive as PDF/DOCX".
3. Make one `folders/ensure-paths` call (empty directories included). It replaces N sequential POSTs of about 540 ms each, and an existing root merges.
4. Hash the files, then init in batches of 50 as hashes finish.
5. Re-dropping a half-finished folder: finished files are `already-uploaded`, open sessions resume, and the rest upload.

## 8. Small files

- **Choice: SINGLE PUT for files ≤ 32 MiB, on the same session table and the same init/complete routes** (robust and ux; simple always used multipart).
- Why:
  - A Drive migration is mostly thousands of small PDFs. SINGLE complete is 1 R2 call (HEAD) instead of 3 (ListParts, Complete, HEAD) from Singapore.
  - Together with 50-item init and complete batches, per-file backend overhead drops from about 1.2 s to tens of milliseconds.
  - The client difference is just a signed Content-Type header.
- Zero-byte files, clipboard pastes and `mode:'proxy'` keep the existing streaming route.
- The legacy `uploads/presign` and `uploads/commit` routes stay for one release so stale tabs keep working.

## 9. PRs in merge order

| # | Change | Size |
|---|---|---|
| 1 | BigInt column + `sha256` + `uploadSessionId`, `bigint-json.ts`, `copyFile` `Number()`, **copy guard: reject files over 5 GiB with a clear message** (UploadPartCopy later) | S (~80) |
| 2 | StorageService multipart primitives (`create`, `presignUploadPart`, `listAllParts`, `complete`, `abort`, `listMultipartUploads`, `headObjectMeta` + ETag), `upload-plan.ts` (`planParts`, `verifyParts`), jest. **Requires #412 merged.** | M (~250) |
| 3 | `DatabankUpload` model; init / parts / open / complete / abort + `finalize` on both controllers | L (~500) |
| 4 | `folders/ensure-paths` | S (~150) |
| 5 | Sweeper + daily reconciler + orphan report script | S-M (~200) |
| 6 | Frontend: vitest devDependency, pure engine (planner, scheduler with injected transport, speed, reducer), hash worker, `makeUploadApi`; not wired in | L (~600) |
| 7 | Dock + layouts + explorer wiring behind `NEXT_PUBLIC_DATABANK_UPLOAD_V2`, falling back to the legacy path; `formatBytes` GB; remove the int4 cap | M (~500) |
| 8 | Folder filters, merge, resume banner, duplicate UX | M (~300) |
| 9 | Remove the legacy presign/commit routes, `putToStorage` and the JR copy | S (−150) |
| 10 (optional) | `FileSystemFileHandle` one-click resume on Chromium | S-M |

PRs 7 and 8 need the merged Phase 0 explorer.

## 10. Risks and test plan

**Risks**

| Risk | Mitigation |
|---|---|
| Table rewrite in PR 1 | Count rows first; fall back to ux's add-column approach if the table is large. |
| Global BigInt `toJSON` | Only turns something that throws today into a number. |
| R2's 1-write-per-second-per-key limit vs parallel UploadPart | 429 backoff. Probe in prod first; the fallback is 1 part at a time per file with files in parallel. |
| Complete fails after R2 finished | HEAD-first recovery + COMPLETING sweeper. |
| `copyFile` over 5 GiB | Guard in PR 1. |
| Signed download URLs expire in 5 min, so a browser can't resume a multi-GB download after that | Pass a longer TTL to `getSignedUrl` for files over 1 GB. |
| Drive "streamed" files | Hashing and uploading each download the file again; advise marking folders "Available offline". |
| Laptop sleep | Wake Lock; resume covers the rest. |
| Resume window is 6 days | Shown in the banner. |
| Stored SHA-256 comes from the client | Accepted; CRC-64/NVME in Phase 2. |

**Offline tests (no R2 credentials)**
- **Jest:**
  - `upload-plan`: 0 B, 1 B, 32 MiB, 32 MiB+1, 10 GiB, 100 GiB, cap+1; `verifyParts` with a missing part, a short middle part, a wrong last part, extra parts, and pagination.
  - `bigint-json`: `JSON.stringify` of a tree with a 12 GB file.
  - `presignUploadPart` with dummy credentials: `partNumber` and `uploadId` present, **no `x-amz-checksum-*` or `x-amz-sdk-checksum-algorithm`**.
  - Service with mocked Prisma and `jest.fn` storage: double complete, claim race, NoSuchUpload followed by a good HEAD, HEAD size mismatch → FAILED, `missing-parts` → back to UPLOADING, relocation, revoked access, init order (resume, then duplicate, then possible-duplicate, then new), `ensure-paths` idempotency, sweeper claims.
  - `tsc --noEmit`.
- **Vitest:**
  - A scheduler with a fake transport injecting 403s, stalls, going offline and 5xx errors: every part succeeds exactly once.
  - Resume with fake `doneParts` 1-400: only 401-1280 are sent.
  - Speed/ETA and the queue reducer.
- **MinIO** (`STORAGE_ENDPOINT=http://localhost:9000`):
  - a 6 GB file with DevTools going offline;
  - a reload followed by re-dropping the file (no PUTs for finished parts);
  - killing the backend during complete (the sweeper finishes it);
  - cancel, then `mc ls --incomplete` is empty;
  - a 200-file nested folder dropped twice (no "(2)" folders, all already uploaded);
  - the sweeper with `expiresAt` set to 1 minute;
  - local storage mode still goes through the proxy path.

**Manual prod checks, with the flag on for one admin**
1. CORS allows PUT from tashfeengroup.com, and the 7-day multipart lifecycle rule exists.
2. A 12 GB upload from an officer's laptop:
   - Wi-Fi off for 2 minutes at 40%;
   - tab closed at 60%, then re-dropped;
   - backend redeployed mid-upload.
3. The stored `fileSizeBytes` is exact, and `certutil -hashfile <f> SHA256` equals the stored `sha256` and the hash of the downloaded copy.
4. A 2,000-file Drive folder dropped twice.
5. Cancel leaves ListMultipartUploads on `databank/` empty.
6. Repeat on the JR portal.
7. Check `pg_stat_statements` for the new routes.

## Open questions for the product owner

1. **Maximum file size:** the default is 50 GiB; the env setting goes up to about 5 TiB. Is there a real need above 50 GiB?
2. **Exact duplicate in a different folder:** keep the default "Skip / Upload anyway" prompt, or always skip?
3. **Dropped folder that already exists at the target:** always merge silently (the default, which is what makes resume work), or ask "Merge / Keep both"?
4. **Resume window:** 6 days after the upload starts. Is that acceptable, or do officers need a longer window (that means changing the bucket lifecycle rule and paying storage for abandoned parts)?
5. **Uploads to be finished within the week:** should officers be told that mid-way uploads must be finished within the week, and that Drive folders must be set to "Available offline" first? This is a process note for the Drive migration.
6. **Copying files over 5 GiB:** blocked in Phase 1. Is that acceptable until server-side multipart copy lands?