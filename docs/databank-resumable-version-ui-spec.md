# Databank — resumable (>2 GB) new-version uploads, FRONTEND wiring

The backend for resumable version uploads shipped (#442: `POST {base}/files/:fileId/versions/upload/init`
→ `initVersion`; then the SHARED `POST {base}/uploads/:id/parts` + `POST {base}/uploads/complete`;
`commit()` attaches the finished object as a new version). The UI does NOT use it yet — the version
dialog's "Upload new version" (`uploadDatabankFileVersion`) only does the DIRECT presign→PUT→commit
path and HARD-BLOCKS files over ~2 GB with "…use the main upload". This wires the UI to the resumable
engine for big versions. Frontend only.

## New module: `apps/frontend/lib/databank-upload/version-resumable.ts`

```ts
export interface VersionResumableDeps {
  // POST {base}/files/{fileId}/versions/upload/init (+ ?userId= for a processing manager targeting
  // another associate). Returns the single-file init response.
  initVersion(fileId: string, body: { fileName: string; mimeType: string; sizeBytes: number; sha256: string })
    : Promise<{ mode: 'proxy' } | { mode: 'direct'; maxBytes: number; result: InitResult }>;
  // The SHARED session transport (makeUploadTransport(base, {})): only .signParts / .complete / .put are
  // used — they are session-id based and do NOT depend on the target scope (only init does, which we
  // replace with initVersion). put = xhrPut (straight-to-storage with progress).
  transport: Pick<UploadTransport, 'signParts' | 'complete' | 'put'>;
  hashFile(file: File, onProgress: (f: number) => void, signal: AbortSignal): Promise<string>;
}

export async function uploadVersionResumable(
  deps: VersionResumableDeps,
  fileId: string,
  file: File,
  opts?: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
): Promise<ApiDatabankFile>
```

Flow (reuse the api-types `InitResult` / `CompleteResult` shapes; the client NEVER tracks ETags — the
backend completes from storage `ListParts`, so a part upload is just a PUT of the slice):

1. `const sha256 = await deps.hashFile(file, () => {}, signal)`.
2. `const res = await deps.initVersion(fileId, { fileName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, sha256 })`.
   - `mode: 'proxy'` → throw `new Error('Uploading a new version is not available in this storage mode.')`.
   - `result.status === 'rejected'` → throw `new Error(result.reason)`.
   - `result.status === 'retry'` → short wait (≈1 s), re-init; cap at ~5 attempts then throw.
   - `result.status === 'in-progress'` → skip to step 4 (complete-poll) with that `uploadId`; no parts to push.
   - `result.status === 'upload'` → step 3. (`already-uploaded` / `duplicate` / `possible-duplicate` are
     new-file-only and never returned by `initVersion`; treat defensively as an error if seen.)
3. **Upload parts.** `uploadId = result.uploadId`. Progress = (bytes already in storage + bytes PUT so far)/file.size.
   - Seed `uploadedBytes` from `doneParts` (each done part = its expected byte length; last part may be short).
   - `SINGLE`: one PUT of the whole `file` to `result.urls[0]` via `deps.transport.put(partUrl, file, loaded => report(...), signal)`.
   - `MULTIPART`: the parts to send = `[1..partCount]` minus `doneParts`. Have `result.urls` (the first
     batch, ≤ the server's INIT_URL_BATCH). For any to-send part whose signed URL you don't hold, request
     more in chunks of ≤ `MAX_SIGN_PARTS` via `deps.transport.signParts(uploadId, numbers, signal)`.
     For each part `n`: `body = file.slice((n-1)*partSize, Math.min(n*partSize, file.size))`; `await
     deps.transport.put(url, body, loaded => report partial, signal)`. Upload with a small concurrency
     (e.g. 3–4 at a time) OR sequentially (sequential is acceptable and simplest; pick sequential unless
     trivial to parallelise with the existing helpers). Aggregate `onProgress`.
4. **Complete-poll.** Loop (bounded, e.g. ≤ ~40 tries with ≈1.5 s between):
   `const r = (await deps.transport.complete([uploadId], signal)).results[0]`.
   - `'completed'` → return `r.file as ApiDatabankFile`. Report `onProgress(1)`.
   - `'missing-parts'` → sign + PUT exactly `r.missingParts` (same slicing as step 3), then re-complete.
   - `'in-progress'` / `'retry'` → wait ≈1.5 s, re-complete (the server may be assembling / finalize parked).
   - `'failed'` / `'expired'` → throw `new Error(r.reason ?? 'Upload failed.')`.
   - `'not-found'` → throw `new Error('Upload session not found.')`.
   Exceeding the cap → throw a clear timeout error.
5. Honour `opts.signal` throughout (the transport calls already take it; abort rejects cleanly).

Keep it ~120 lines, dependency-injected (so it unit-tests with fakes, no real network).

## Routing in `lib/processing.ts` + `lib/jr-databank.ts`

In `uploadDatabankFileVersion` (processing) and `uploadJrDatabankFileVersion` (jr):

- Add a shared const `DIRECT_VERSION_MAX_BYTES = 2_147_483_647` (= the backend `DIRECT_MAX_BYTES`; comment
  that it mirrors it). Export it from `lib/processing.ts` and reuse in jr.
- Route by size at the TOP:
  - `file.size <= DIRECT_VERSION_MAX_BYTES` → the EXISTING direct path (presign → PUT → commit), UNCHANGED
    except: the `if (file.size > presigned.maxBytes) throw …` guard can stay as a belt-and-braces (it won't
    trigger for a correctly-routed small file) OR be simplified — do not REMOVE error handling, just ensure
    a >cap file no longer reaches it.
  - else → `return uploadVersionResumable(deps, fileId, file, { onProgress })` with `deps` built from the
    real `initVersion` fetch (`apiFetch` POST to `{base}/files/{fileId}/versions/upload/init{?userId}`),
    `makeUploadTransport(base, {})`, and `hashFile`.
- The processing variant threads a `userId` into the init query when a manager targets another associate
  (mirror how `presignDatabankVersion` / the other processing version fns handle scope — check the existing
  signatures; if `uploadDatabankFileVersion` has no userId param today, keep it that way and omit userId).

The `DatabankApi.uploadFileVersion(fileId, file, onProgress?)` adapter signature and the version dialog's
call site do NOT change — the routing is internal to the client fns. The dialog's existing progress bar
(0..1) works for both paths.

## Tests (`lib/databank-upload/version-resumable.test.ts`, node:test style like the sibling tests)

Inject fakes for `initVersion` / `transport` / `hashFile`:
- MULTIPART happy path: init 'upload' (2 parts, 1 url + sign the 2nd) → put×2 → complete 'completed' → returns file; onProgress reaches 1.
- resume: `doneParts:[1]` → only part 2 is PUT; initial progress reflects part 1.
- missing-parts: complete 'missing-parts':[2] → re-sign+PUT part 2 → complete 'completed'.
- in-progress/retry then completed: complete returns 'retry' then 'completed' (use an injected sleep/no-op).
- rejected / failed / proxy → throw with the right message.
Keep the real `lib/processing.ts` routing covered by a small assertion if feasible (size-based branch), else
rely on the module test + the browser smoke of the ≤2 GB path.

## Constraints
- Frontend only; NO backend change; NO new npm deps (reuse apiFetch, makeUploadTransport/xhrPut, hashFile).
  If `xhrPut` must be reused, use it via `makeUploadTransport(base, {}).put` (do NOT duplicate XHR logic);
  only export a symbol from transport.ts if strictly necessary.
- `tsc --noEmit` (apps/frontend) clean; `npm run build` passes with `NEXT_PUBLIC_DATABANK_EXPLORER_V2` both
  unset and `on`. `npm test` (node --test) for the new module passes.
- Do NOT touch the resumable ENGINE (engine.ts) / queue.ts / the dock — this is a standalone uploader for
  the version dialog's inline progress.

## Out of scope
Changing the version dialog UI (its progress bar already handles both). The direct ≤2 GB path's internals.
