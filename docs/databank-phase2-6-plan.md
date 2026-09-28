# Databank Phase 2–6 plan: borrow-vs-build

> Turning the Databank from an upload store into a real Google-Drive replacement.
> Phase 1 (resumable multi-GB uploads) is shipped and piloting. This plan covers
> P2 (find & organise), P3 (safety), P4 (collab & access), P5 (preview & delivery),
> P6 (admin). Produced from a 5-lens OSS research pass + our own stack audit
> (2026-09-29).

## The one big finding
There is **no single MIT/Apache "Drive-in-a-box"** for our stack. The big
self-hostable drives (Nextcloud, Seafile, Immich, Docmost) are **AGPL** — we can
read their data models and UX for reference but must never embed their code. The
win is **assembling small, permissively-licensed, headless libraries on top of
systems we already run** (Prisma/Postgres, Supabase Storage S3, BullMQ, our
AuditLog / ActivityTimeline / document-versioning patterns, bell+email
notifications, puppeteer) and hand-building only the glue.

## License policy (we are a proprietary product)
- **Embed freely:** MIT / Apache-2.0 / BSD / ISC / PostgreSQL license.
- **With care (separate file / dynamic link):** MPL, LGPL (e.g. libvips under sharp — fine).
- **Never embed — separate process/service or architecture reference only:** GPL / AGPL. This is how we use ffmpeg, ClamAV's daemon, LibreOffice-via-Gotenberg, and any of the big drives.

## Our-stack facts this plan leans on
- Frontend Next 15.5 / **React 19.2** / TypeScript. Tailwind v4 *is* installed, but the Databank/processing UI is plain-CSS `.sos-*` — for consistency we prefer **headless libs styled with our own CSS**.
- Backend NestJS + Prisma 5 + Postgres (Supabase). **pg_trgm is already enabled and used** (WhatsApp thread search, migration `20260705130000`) — copy that guarded-DO-block pattern for file search.
- **Custom permissions/scopes** (no CASL/Casbin in the repo) — P4 extends these.
- **BullMQ** (Redis on Railway), **puppeteer** and **pdf-lib** already present. **No** sharp / ffmpeg / archiver / ClamAV / chart lib yet — those are net-new in P5/P6.
- **Supabase Storage has no object versioning and no lifecycle rules** — versioning and retention/expiry must be **app-level** (rows + BullMQ jobs).
- `DatabankFile.fileSizeBytes` is `Int?` (int4) — overflows ~2 GB (a known issue) and will overflow size rollups; **migrate to BigInt before P6 aggregation.**

## What to adopt (the shortlist, all embeddable)
| Lib / service | License | Area | What we take |
|---|---|---|---|
| **@tanstack/react-table v8 + @tanstack/react-virtual v3** | MIT | P2 | Headless list/grid state + virtualization: sort, filter, pagination, row-selection (=bulk). Style ourselves. **Pin table to v8** — v9 (latest) is a ground-up rewrite (`useTable`/feature-based) with far fewer docs. |
| **react-arborist** | MIT | P2 | Folder-tree sidebar with drag-to-move, inline rename, virtualization. |
| **@radix-ui/react-* (context-menu, dropdown-menu, dialog, popover, tooltip)** | MIT | P2, P4 | Right-click menu, sort/filter menus, rename/move/new-folder dialogs, details panel, share/permission dialogs. (Radix directly — NOT shadcn.) |
| **@atlaskit/pragmatic-drag-and-drop** | Apache-2.0 | P2 | Drag-to-move in the main file pane (arborist covers the tree). |
| **cmdk** *(optional)* | MIT | P2 | Command palette for star/recent quick-nav. |
| **Postgres tsvector + pg_trgm** | PostgreSQL | P2 | Full-text + fuzzy file search via `$queryRaw` + `COUNT(*) FILTER` facets. Zero new infra. |
| **react-mentions** (or Tiptap Mention) | MIT | P4 | `@mention` comment input → our existing notification fan-out. |
| **Gotenberg** *(Railway Docker service)* | MIT | P5 | Office (docx/xlsx/pptx) → PDF for preview + page-1 thumbnails, via a BullMQ job. |
| **pdf.js + react-pdf (wojtekmaj)** | Apache/MIT | P5 | In-browser PDF preview over a signed URL. |
| **docx-preview + SheetJS (Community)** | Apache-2.0 | P5 | Zero-service .docx/.xlsx/.csv preview for the common case. |
| **sharp** (+ **ffmpeg** as subprocess) | Apache-2.0 / (GPL subprocess) | P5, P6 | Image thumbnails; video posters in a BullMQ worker. |
| **archiver** (yazl as lean fallback) | MIT | P5 | Streamed folder-as-ZIP from S3 bodies (Zip64 for >4 GB). |
| **ClamAV daemon + clamscan (kylefarris)** | GPL daemon (separate) / MIT wrapper | P5 | Scan-on-upload over TCP from a BullMQ job. |
| **Recharts** | MIT | P6 | Storage-usage dashboard charts (first chart lib we standardize on). |
| **In-house** ActivityTimeline / AuditLog / ClientDocumentVersion patterns | ours | P3 | Per-file activity feed + app-level versioning blueprint — add ~zero libs. |

**Reference-only (do not embed):** Nextcloud/Seafile/ownCloud-OCIS (trash/quota/sharing models), Immich (derived-assets-via-queue), Docmost (NestJS module boundaries), `@cubone/react-file-manager` + Supabase Studio object explorer (P2 UX). Skip **Chonky** (archived/MUI), **Tremor** (Tailwind-coupled), **fluent-ffmpeg** (archived — invoke ffmpeg directly), **prisma-extension-soft-delete** (fights our hand-filtered `deletedAt`), and defer **OpenFGA/SpiceDB/Casbin** until sharing is genuinely graph-shaped.

## Per-phase approach
- **P2 Find & organise [L]:** hand-assemble the explorer from TanStack + arborist + Radix (a packaged file-manager's in-memory `files[]` fights our server-paginated per-client tree). Backend: migration for tags/description/custom-fields + a **stored generated `tsvector`** (name/description/tags) with GIN + a pg_trgm GIN on name; `$queryRaw` search + faceted `COUNT(*) FILTER` counts + real server pagination (today it's a flat `take: 200`).
- **P3 Safety [M]:** almost pure schema + BullMQ + in-house patterns. TrashService (soft-delete stamps `deletedAt` across the whole subtree via recursive-CTE UPDATE; restore with parent-deleted/name-clash handling; retention job hard-deletes + frees objects). `DatabankFileVersion` table + `currentVersionId` (new version gated on sha256 change; restore = repoint). ETag/If-Match optimistic concurrency on rename/move/replace. Per-file activity via the existing timeline.
- **P4 Collab & access [L]:** a plain `databank_acl(subjectType, subjectId, nodeType, nodeId, role)` table (owner/editor/viewer) resolved by a recursive-CTE ancestor walk, sitting **alongside** our custom scopes. `Comment` model + react-mentions → existing notifications. Ownership-transfer endpoint. `share_link` (token, nodeId, role, expiresAt, revokedAt) + public validate→signed-URL route **shipped behind a flag that is OFF**.
- **P5 Preview & delivery [XL]:** client-side viewers for the common case (pdf.js/react-pdf, docx-preview, SheetJS) + two Railway Docker services (Gotenberg, ClamAV) for the long tail and safety, all driven by **BullMQ** and served over **signed URLs** (never public object URLs). sharp/ffmpeg thumbnails to derived keys; archiver zip-download. LibreOffice/Gotenberg converts **one at a time** — bound the queue, never inline.
- **P6 Admin [M]:** our own recursive-CTE size rollups + BullMQ cold-archive/expiry jobs + a Recharts dashboard in the existing admin shell. **Migrate `fileSizeBytes` → BigInt first.**

## Build sequence (~12 PR-sized steps)
0. **Spike — ✅ DONE (2026-09-29):** react-arborist 3.16, @radix-ui context-menu/dialog/dropdown/popover, @tanstack/react-table **v8**.21 and @tanstack/react-virtual v3.14 install with no React-19 peer conflict, tsc clean, and `next build` (SSR) passes on Next 15.5 / React 19.2. Compatibility confirmed; TanStack Table pinned to v8 (v9 is a rewrite). Deps land with their first use in PR-2/PR-3.
1. **P2 backend:** migration (tags/description/custom-fields + stored `tsvector`+GIN + pg_trgm GIN); `$queryRaw` search + faceted counts + server pagination.
2. **P2 tree:** react-arborist sidebar (open/close, rename, drag-move via existing move endpoint, breadcrumbs).
3. **P2 main pane:** TanStack list + virtualized grid (sort/filter/paginate/select) + Radix context menu + bulk bar + dialogs + details panel + star/recent.
4. **P3 trash:** TrashService (recursive-CTE subtree soft-delete, restore, retention job).
5. **P3 versions + activity:** `DatabankFileVersion` + `currentVersionId`, sha256-gated versions, restore=repoint, ETag/If-Match, per-file activity feed.
6. **P4 ACL:** `databank_acl` + recursive-CTE resolver into guards; permission-matrix UI; ownership transfer. (CASL optional.)
7. **P4 comments + sharing:** Comment model + react-mentions → notifications; `share_link` table + public route **flag OFF**.
8. **P5 infra:** stand up Gotenberg + ClamAV Railway services; BullMQ convert/thumbnail/scan queues (LibreOffice concurrency = 1).
9. **P5 preview + thumbnails:** preview-router (pdf.js/docx-preview/SheetJS/Gotenberg) over signed URLs; sharp/ffmpeg thumbnails to derived keys; cache converted PDFs by fileId+version.
10. **P5 delivery + safety:** archiver streamed folder-ZIP (Zip64 + per-entry errors); scan-on-upload quarantine.
11. **P6:** `fileSizeBytes` → BigInt; storage-analytics endpoints; Recharts dashboard; cold-archive/expiry job.

## Key risks
- **React 19 compat** of react-arborist/Radix/TanStack — the PR-0 spike exists to settle this before committing to P2 UI.
- **Supabase Storage** has no versioning and no lifecycle — all handled app-level (versions table + BullMQ retention/expiry).
- **`fileSizeBytes` int4 overflow** — migrate to BigInt before any size rollups.
- **Gotenberg/ClamAV footprint** (~0.5–2 GB RAM each) — dedicated small Railway services; bound LibreOffice concurrency to 1.
- **Private files** — every viewer/thumbnail uses short-lived signed URLs or an auth'd proxy; never a public object URL.
