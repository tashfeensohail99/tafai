'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Folder,
  ChevronRight,
  ChevronDown,
  Download,
  Home,
  Loader2,
  Pencil,
  Search,
  X,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  FolderInput,
  FolderPlus,
  FolderUp,
  Upload,
  Trash2,
  History,
  RotateCcw,
  Copy,
  Scissors,
  ClipboardPaste,
} from 'lucide-react';
import type {
  ApiDatabankFolder,
  ApiDatabankFile,
  DatabankSearchFacets,
  DatabankUploadTarget,
  TrashItem,
  Version,
} from '@/lib/processing';
import { ApiClientError } from '@/lib/api-client';
import { processingDatabankApi, type DatabankApi } from '@/lib/databank-api';
import { formatBytes as fmtSize } from '@/lib/databank-upload/summary';
// Uploads + new folder (Databank P2, PR-4) — mirrors the legacy DatabankTab.
import { isUploadV2Enabled } from '@/lib/databank-upload/flag';
import { createLandingReloader, mergeLandedFiles } from '@/lib/databank-upload/landing';
import { isQueuePresent, subscribePresence } from '@/lib/databank-upload/presence';
import { dataScopeOf } from '@/lib/databank-upload/keys';
import { settlePaste, type PasteJob } from '@/lib/databank-explorer/settle-paste';
import { canPasteInto } from '@/lib/databank-explorer/paste-target';
import { MAX_FILE_BYTES, fmtMB, walkEntry, type FolderEntry } from '@/lib/databank-upload/folder-walk';
import type { UploadDest } from '@/lib/databank-upload-browser';
import { UploadResumeBanner } from '@/components/databank/UploadResumeBanner';

/**
 * Databank explorer, rebuilt (Databank Phase 2) — behind
 * NEXT_PUBLIC_DATABANK_EXPLORER_V2. A LEFT folder tree (react-arborist:
 * expand/collapse, inline rename, drag-to-move) plus a MAIN pane with a search
 * box, type facets and a TanStack-table (PR-3b) file grid that drives:
 *   - sortable, virtualized columns (Name / Size / Type / Modified),
 *   - a right-click context menu (Open, Rename, Move, Delete),
 *   - multi-select + a bulk-action bar,
 *   - a file-details side panel (description + tags, editable).
 * The same table serves both the folder-file view and the search-results view.
 *
 * Same props and the same portal-agnostic `DatabankApi` as the legacy
 * DatabankTab, so Processing and JR both pick it up unchanged.
 */

// Match the legacy tab's palette (CSS vars, with light-mode fallbacks).
const border = '1px solid var(--sos-border, rgba(148,163,184,0.25))';
const muted = 'var(--sos-text-muted, #64748b)';
const primary = 'var(--sos-text-primary, #0f172a)';
const surface = 'var(--sos-surface, rgba(255,255,255,0.6))';
const surfaceSolid = 'var(--sos-surface-solid, #fff)';
const accent = 'var(--sos-accent, #b8860b)';
const accentSoft = 'var(--sos-accent-soft, rgba(184,134,11,0.10))';
const danger = 'var(--sos-danger, #dc2626)';

function FileGlyph({ mime, size = 20 }: { mime: string | null; size?: number }) {
  if (mime && /pdf/i.test(mime)) return <FileText size={size} />;
  if (mime && /^image\//i.test(mime)) return <ImageIcon size={size} />;
  return <FileIcon size={size} />;
}

/** Short label for the Type column, derived from the mime type. */
function typeLabel(mime: string | null): string {
  if (!mime) return 'File';
  if (/pdf/i.test(mime)) return 'PDF';
  if (/^image\//i.test(mime)) return 'Image';
  if (/^video\//i.test(mime)) return 'Video';
  if (/^audio\//i.test(mime)) return 'Audio';
  if (/word|excel|powerpoint|officedocument|msword|ms-excel|ms-powerpoint|opendocument|spreadsheet|presentation|text\/|rtf|csv/i.test(mime))
    return 'Doc';
  return 'File';
}

/** Short "12 Aug 2026"-style date for the Modified column. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice();
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      await fn(next);
    }
  });
  await Promise.all(workers);
}

// The six facet buckets the search endpoint returns, in display order.
const TYPE_BUCKETS = ['image', 'pdf', 'video', 'audio', 'office', 'other'] as const;
type TypeBucket = (typeof TYPE_BUCKETS)[number];
const TYPE_LABEL: Record<TypeBucket, string> = {
  image: 'Images',
  pdf: 'PDFs',
  video: 'Video',
  audio: 'Audio',
  office: 'Docs',
  other: 'Other',
};
const SEARCH_PAGE_SIZE = 50;

// Table geometry.
const TABLE_H = 440;
const ROW_H = 44;
const ROW_H_SEARCH = 54;

/** Scoped CSS for the headless Radix menus + dialogs (plain CSS, no Tailwind). */
const EXPLORER_CSS = `
.dbx-menu { min-width: 190px; background: ${surfaceSolid}; border: ${border}; border-radius: 10px; padding: 6px; box-shadow: 0 12px 32px rgba(15,23,42,0.18); z-index: 60; }
.dbx-item { display: flex; align-items: center; gap: 9px; font-size: 13px; color: ${primary}; padding: 7px 10px; border-radius: 7px; cursor: pointer; outline: none; user-select: none; }
.dbx-item[data-highlighted] { background: ${accentSoft}; }
.dbx-item[data-danger] { color: ${danger}; }
.dbx-item[data-danger][data-highlighted] { background: rgba(220,38,38,0.10); }
.dbx-sep { height: 1px; margin: 5px 4px; background: var(--sos-border, rgba(148,163,184,0.25)); }
.dbx-item[data-disabled] { opacity: 0.45; cursor: default; }
@keyframes sos-databank-sweep { 0% { transform: translateX(-120%); } 100% { transform: translateX(340%); } }
.dbx-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.38); z-index: 70; }
.dbx-dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; background: ${surfaceSolid}; border: ${border}; border-radius: 14px; padding: 18px; z-index: 71; box-shadow: 0 24px 60px rgba(15,23,42,0.28); }
`;

/** Nested tree node built from the flat folder list. */
type FolderNode = { id: string; name: string; children: FolderNode[] };

/** One "Databank root" + indented-path option for a move picker. */
type FolderOption = { id: string | null; label: string; depth: number };

/** The explorer's OWN clipboard (distinct from the OS image-paste). A copy
 *  persists for repeat pastes; a cut clears once it pastes successfully. Each
 *  entry holds EITHER files OR a single folder, never mixed. */
type Clip = { op: 'copy' | 'cut'; files: ApiDatabankFile[]; folder: { id: string; name: string } | null };

export function DatabankExplorerV2({
  clientId,
  clientName,
  personal,
  rootLabel = 'Databank',
  api = processingDatabankApi,
}: {
  clientId?: string;
  clientName?: string;
  personal?: boolean;
  rootLabel?: string;
  api?: DatabankApi;
}) {
  const [folders, setFolders] = useState<ApiDatabankFolder[]>([]);
  const [files, setFiles] = useState<ApiDatabankFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(true);
  const readOnly = !canWrite;
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // ---- Upload / new-folder state (Databank P2, PR-4) ----
  const [busy, setBusy] = useState(false);
  // Direct-path (non-V2) byte progress: which file of `total`, its name + pct.
  const [progress, setProgress] = useState<{ done: number; total: number; name: string; pct: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  // Resumable uploads (the dock), behind NEXT_PUBLIC_DATABANK_UPLOAD_V2 — read
  // after mount (localStorage + URL); false during SSR.
  const [v2, setV2] = useState(false);
  useEffect(() => setV2(isUploadV2Enabled()), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // react-arborist (react-dnd) touches the DOM on mount — only render the Tree
  // in the browser so SSR / static prerender never trips over it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Stack the tree above the pane / the details panel below the table on
  // narrow (phone) widths so nothing forces a horizontal page scroll.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 860);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Scope-aware load — a client's databank or the caller's own personal area.
  const load = useCallback(
    () => (personal ? api.fetchPersonalTree() : api.fetchTree(clientId!)),
    [api, personal, clientId],
  );

  // Reloads can overlap (a background landing refresh + a folder move): only the
  // LATEST applies, and files that landed while it was in flight are merged back
  // in (the tree was read before they committed). Mirrors the legacy DatabankTab.
  const reloadSeq = useRef(0);
  const appliedSeq = useRef(0);
  const landedLog = useRef<Array<{ at: number; files: unknown[] }>>([]);
  /** A good tree that a newer reload superseded — used if that newer one fails. */
  const spare = useRef<{ seq: number; startedAt: number; tree: Awaited<ReturnType<typeof load>> } | null>(null);
  const reload = useCallback(async () => {
    setError(null);
    const seq = ++reloadSeq.current;
    const startedAt = Date.now();
    const apply = (tree: Awaited<ReturnType<typeof load>>, since: number, applied: number) => {
      const late = landedLog.current.filter((x) => x.at >= since);
      landedLog.current = late;
      setFolders(tree.folders);
      setFiles(late.length ? mergeLandedFiles(tree.files, late.flatMap((x) => x.files)) : tree.files);
      setCanWrite(tree.canWrite !== false);
      appliedSeq.current = applied;
    };
    try {
      const tree = await load();
      if (seq !== reloadSeq.current) {
        if (seq > appliedSeq.current && (!spare.current || spare.current.seq < seq)) spare.current = { seq, startedAt, tree };
        return;
      }
      spare.current = null;
      apply(tree, startedAt, seq);
    } catch (e) {
      if (seq !== reloadSeq.current) return;
      // The newest reload failed: show the newest good tree we got instead of nothing.
      const s = spare.current;
      spare.current = null;
      if (s && s.seq > appliedSeq.current) apply(s.tree, s.startedAt, s.seq);
      setError(e instanceof Error ? e.message : 'Could not load the databank');
    } finally {
      if (seq === reloadSeq.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    setLoading(true);
    setSelectedFolderId(null);
    void reload();
  }, [reload]);

  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  // For the paste cycle-guard (canPasteInto) and the folder Move picker.
  const parentOf = useMemo(
    () => new Map<string, string | null>(folders.map((f) => [f.id, f.parentFolderId])),
    [folders],
  );
  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, string[]>();
    for (const f of folders) {
      const a = m.get(f.parentFolderId);
      if (a) a.push(f.id);
      else m.set(f.parentFolderId, [f.id]);
    }
    return m;
  }, [folders]);
  // A folder can't be moved/pasted into itself or any of its descendants.
  const descendantsWithSelf = useCallback(
    (rootId: string): Set<string> => {
      const out = new Set<string>([rootId]);
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop()!;
        for (const c of childrenByParent.get(id) ?? []) {
          if (!out.has(c)) {
            out.add(c);
            stack.push(c);
          }
        }
      }
      return out;
    },
    [childrenByParent],
  );

  // Flat folders (parentFolderId) → nested tree data for react-arborist.
  const treeData = useMemo<FolderNode[]>(() => {
    const byParent = new Map<string | null, ApiDatabankFolder[]>();
    for (const f of folders) {
      const arr = byParent.get(f.parentFolderId);
      if (arr) arr.push(f);
      else byParent.set(f.parentFolderId, [f]);
    }
    const build = (parentId: string | null): FolderNode[] =>
      (byParent.get(parentId) ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ id: f.id, name: f.name, children: build(f.id) }));
    return build(null);
  }, [folders]);

  // Depth-first list of folders, for the "Move to…" picker (indented paths).
  const folderOptions = useMemo<FolderOption[]>(() => {
    const byParent = new Map<string | null, ApiDatabankFolder[]>();
    for (const f of folders) {
      const arr = byParent.get(f.parentFolderId);
      if (arr) arr.push(f);
      else byParent.set(f.parentFolderId, [f]);
    }
    const out: FolderOption[] = [];
    const walk = (parentId: string | null, depth: number) => {
      const kids = (byParent.get(parentId) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
      for (const f of kids) {
        out.push({ id: f.id, label: f.name, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders]);

  // Breadcrumb: walk up from the selected folder to the root.
  const breadcrumb = useMemo(() => {
    const path: ApiDatabankFolder[] = [];
    let cursor = selectedFolderId;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const f = folderById.get(cursor);
      if (!f) break;
      path.unshift(f);
      cursor = f.parentFolderId;
    }
    return path;
  }, [selectedFolderId, folderById]);

  const currentFiles = useMemo(
    () => files.filter((f) => f.folderId === selectedFolderId),
    [files, selectedFolderId],
  );

  // ---- Uploads + new folder (Databank P2, PR-4) — mirrors the legacy tab -----
  // UPLOAD goes STRAIGHT to R2 (presigned PUT, with byte progress); CLIPBOARD
  // (small pasted screenshots) stays on the simple multipart path so its origin
  // is recorded as CLIPBOARD. Both target the SELECTED folder (root when none).
  const putFile = useCallback(
    (file: File, folder: string | null, src: 'UPLOAD' | 'CLIPBOARD', onProgress?: (f: number) => void) => {
      if (src === 'CLIPBOARD') {
        return personal
          ? api.uploadPersonalFile(file, folder, 'CLIPBOARD')
          : api.uploadFile(clientId!, file, folder, 'CLIPBOARD');
      }
      const target: DatabankUploadTarget = personal ? { personal: true } : { clientId: clientId! };
      return api.directUpload(target, file, folder, onProgress);
    },
    [api, personal, clientId],
  );
  const makeFolder = useCallback(
    (name: string, parent: string | null) =>
      personal ? api.createPersonalFolder(name, parent) : api.createFolder(clientId!, name, parent),
    [api, personal, clientId],
  );
  // Where a resumable upload goes, as the upload dock names it.
  const dest = useMemo(
    () => ({
      base: api.uploadBase,
      target: (personal ? { personal: true } : { clientId: clientId! }) as DatabankUploadTarget,
      label: personal ? rootLabel : clientName || 'Client databank',
      href: personal ? undefined : api.clientHref(clientId!, clientName ?? ''),
    }),
    [api, personal, clientId, clientName, rootLabel],
  );
  const dataScope = dataScopeOf(dest.target);
  const uploadDest = useMemo<UploadDest>(
    () => ({ ...dest, parentLabel: [rootLabel, ...breadcrumb.map((f) => f.name)].join(' › ') }),
    [dest, rootLabel, breadcrumb],
  );

  // Loose files (button, drag-drop, clipboard paste).
  const doUpload = useCallback(
    async (list: FileList | File[], source: 'UPLOAD' | 'CLIPBOARD') => {
      if (readOnly) return;
      const arr = Array.from(list);
      if (arr.length === 0) return;
      if (v2 && source === 'UPLOAD') {
        // Resumable: queued in the background (any size, survives a dropped
        // connection); the dock shows progress. If the chunk can't load, fall
        // through to the standard upload.
        const m = await import('@/lib/databank-upload-browser').catch(() => null);
        if (m) {
          setError(null);
          try {
            m.enqueueFiles(uploadDest, selectedFolderId, arr);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not start the upload');
          }
          return;
        }
      }
      const ok = arr.filter((f) => f.size <= MAX_FILE_BYTES);
      const tooBig = arr.filter((f) => f.size > MAX_FILE_BYTES);
      setBusy(true);
      setError(null);
      try {
        for (let i = 0; i < ok.length; i++) {
          const f = ok[i];
          setProgress({ done: i, total: ok.length, name: f.name, pct: 0 });
          // eslint-disable-next-line no-await-in-loop
          await putFile(f, selectedFolderId, source, (frac) =>
            setProgress({ done: i, total: ok.length, name: f.name, pct: Math.round(frac * 100) }),
          );
        }
        await reload();
        if (tooBig.length) {
          setError(
            `Skipped ${tooBig.length} file(s) over the ${fmtMB(MAX_FILE_BYTES)} limit: ${tooBig
              .slice(0, 5)
              .map((f) => f.name)
              .join(', ')}${tooBig.length > 5 ? '…' : ''}`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [putFile, selectedFolderId, reload, readOnly, v2, uploadDest],
  );

  // Upload a whole folder (from the "Upload folder" button or a dropped
  // directory), recreating its subfolder tree under the selected folder.
  const doUploadFolder = useCallback(
    async (entries: FolderEntry[]) => {
      if (readOnly || entries.length === 0) return;
      if (v2) {
        // Resumable: the server creates the whole folder tree in one call
        // (merging into same-named folders, so a re-drop resumes instead of
        // making "Passport (2)"), then the files upload in the background.
        const m = await import('@/lib/databank-upload-browser').catch(() => null);
        if (m) {
          setError(null);
          try {
            m.enqueueFolder(uploadDest, selectedFolderId, entries);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not start the upload');
          }
          return;
        }
      }
      const ok = entries.filter((e) => e.file.size <= MAX_FILE_BYTES);
      const tooBig = entries.filter((e) => e.file.size > MAX_FILE_BYTES);
      setBusy(true);
      setError(null);
      try {
        // 1. Every distinct directory path in the selection, shallowest first.
        const dirSet = new Set<string>();
        for (const { relPath } of ok) {
          const parts = relPath.split('/');
          parts.pop(); // drop the filename
          let acc = '';
          for (const seg of parts) {
            acc = acc ? `${acc}/${seg}` : seg;
            dirSet.add(acc);
          }
        }
        const dirs = [...dirSet].sort(
          (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
        );
        // 2. Create the folders top-down, mapping each path to its new id.
        const pathToId = new Map<string, string>();
        for (const d of dirs) {
          const segs = d.split('/');
          const parentPath = segs.slice(0, -1).join('/');
          const parentId = parentPath ? pathToId.get(parentPath) ?? selectedFolderId : selectedFolderId;
          const name = segs[segs.length - 1];
          // eslint-disable-next-line no-await-in-loop
          const created = await makeFolder(name, parentId);
          pathToId.set(d, created.id);
        }
        // 3. Upload each file into the folder its path resolves to.
        for (let i = 0; i < ok.length; i++) {
          const { file, relPath } = ok[i];
          const parts = relPath.split('/');
          parts.pop();
          const dirPath = parts.join('/');
          const target = dirPath ? pathToId.get(dirPath) ?? selectedFolderId : selectedFolderId;
          setProgress({ done: i, total: ok.length, name: file.name, pct: 0 });
          // eslint-disable-next-line no-await-in-loop
          await putFile(file, target, 'UPLOAD', (frac) =>
            setProgress({ done: i, total: ok.length, name: file.name, pct: Math.round(frac * 100) }),
          );
        }
        await reload();
        if (tooBig.length) {
          setError(
            `Uploaded the folder, but skipped ${tooBig.length} file(s) over the ${fmtMB(MAX_FILE_BYTES)} limit.`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Folder upload failed');
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [makeFolder, putFile, selectedFolderId, reload, readOnly, v2, uploadDest],
  );

  // Clipboard paste of an image while the explorer is mounted.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // canWrite defaults to true until the tree loads — don't upload into a
      // databank we haven't confirmed we may write to.
      if (loading || readOnly) return;
      const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (imgs.length) {
        e.preventDefault();
        void doUpload(imgs, 'CLIPBOARD');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [doUpload, loading, readOnly]);

  // Resumable uploads land in the background (the dock tracks them): merge each
  // recorded file into the list as it lands, and refetch the tree when a folder
  // drop created folders (debounced) and once when the drop finishes. Nothing is
  // loaded until an upload queue exists in this tab.
  useEffect(() => {
    if (!v2) return;
    let cancelled = false;
    let attached = false;
    let off: (() => void) | undefined;
    const reloader = createLandingReloader({
      timers: { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) },
      now: () => Date.now(),
      reload,
    });
    const attach = () => {
      if (attached || cancelled || !isQueuePresent()) return;
      attached = true;
      import('@/lib/databank-upload-browser')
        .then((m) => {
          if (cancelled) return;
          off = m.onLanded(dataScope, (e) => {
            if (e.files.length) {
              landedLog.current.push({ at: Date.now(), files: e.files });
              setFiles((f) => mergeLandedFiles(f, e.files));
            }
            if (e.foldersChanged) reloader.request();
            if (e.idle) reloader.flush();
          });
        })
        .catch(() => {
          attached = false;
        });
    };
    const unsubscribe = subscribePresence(attach);
    attach();
    return () => {
      cancelled = true;
      unsubscribe();
      off?.();
      reloader.dispose();
    };
  }, [v2, dataScope, reload]);

  // Create a folder under the selected folder, then reload + select it.
  const submitNewFolder = useCallback(
    async (name: string) => {
      const value = name.trim();
      if (!value || readOnly) return;
      const created = await makeFolder(value, selectedFolderId);
      await reload();
      setSelectedFolderId(created.id);
    },
    [makeFolder, selectedFolderId, reload, readOnly],
  );

  // ---- Tree handlers (id-based, identical across scopes) ----
  const onRename = useCallback(
    async ({ id, name }: { id: string; name: string }) => {
      const value = name.trim();
      if (readOnly || !value) return;
      try {
        await api.renameFolder(id, value);
        setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: value } : f)));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Rename failed');
      }
    },
    [api, readOnly],
  );

  const onMove = useCallback(
    async ({ dragIds, parentId }: { dragIds: string[]; parentId: string | null }) => {
      if (readOnly) return;
      const dragId = dragIds[0];
      if (!dragId) return;
      try {
        await api.moveFolder(dragId, parentId);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Move failed');
      }
    },
    [api, readOnly, reload],
  );

  // Never allow dropping a folder into itself or one of its own descendants.
  const disableDrop = useCallback(
    ({ parentNode, dragNodes }: { parentNode: NodeApi<FolderNode>; dragNodes: NodeApi<FolderNode>[] }) =>
      dragNodes.some((dn) => !!parentNode && (parentNode.id === dn.id || dn.isAncestorOf(parentNode))),
    [],
  );

  const download = useCallback(
    async (file: ApiDatabankFile) => {
      try {
        const { url } = await api.signedUrl(file.id);
        window.open(url, '_blank', 'noopener');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not download the file');
      }
    },
    [api],
  );

  // ---- Search (Databank P2) -----------------------------------------------
  // A non-empty query flips the MAIN pane from the selected folder's file list
  // to server-side search RESULTS across the whole scope, with type facets +
  // "Load more" paging. Clearing the box returns to the folder view.
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<TypeBucket[]>([]);
  const [searchResults, setSearchResults] = useState<ApiDatabankFile[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchFacets, setSearchFacets] = useState<DatabankSearchFacets | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const trimmedQuery = debouncedQuery.trim();
  const isSearching = trimmedQuery.length > 0;

  // Debounce the raw input ~300ms into the query that actually fires a request.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Only the latest search applies (a stale query/type/scope reply is dropped).
  const searchSeq = useRef(0);
  const runSearch = useCallback(
    async (page: number, replace: boolean) => {
      const q = debouncedQuery.trim();
      if (!q) return;
      const seq = ++searchSeq.current;
      setSearchLoading(true);
      setSearchError(null);
      try {
        const scope = personal ? { personal: true } : { clientId };
        const res = await api.search({ ...scope, q, types: selectedTypes, page, pageSize: SEARCH_PAGE_SIZE });
        if (seq !== searchSeq.current) return;
        setSearchResults((prev) => (replace ? res.results : [...prev, ...res.results]));
        setSearchTotal(res.total);
        setSearchFacets(res.facets);
        setSearchPage(page);
      } catch (e) {
        if (seq !== searchSeq.current) return;
        setSearchError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        if (seq === searchSeq.current) setSearchLoading(false);
      }
    },
    [api, personal, clientId, debouncedQuery, selectedTypes],
  );

  // Query / type-filter / scope change → fetch page 1 (replace). Empty query
  // resets to the folder view and drops any in-flight search.
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      searchSeq.current++;
      setSearchResults([]);
      setSearchTotal(0);
      setSearchFacets(null);
      setSearchError(null);
      setSearchLoading(false);
      setSearchPage(1);
      return;
    }
    void runSearch(1, true);
  }, [runSearch, debouncedQuery]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setSelectedTypes([]);
  }, []);

  const toggleType = useCallback((t: TypeBucket) => {
    setSelectedTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }, []);

  // "Client / Folder / Sub-folder" hint for a search result row (root → scope name).
  const scopeRootLabel = personal ? rootLabel : clientName || rootLabel;
  const folderPathOf = useCallback(
    (fid: string | null) => {
      if (!fid) return scopeRootLabel;
      const parts: string[] = [];
      let cursor: string | null = fid;
      const guard = new Set<string>();
      while (cursor && !guard.has(cursor)) {
        guard.add(cursor);
        const f = folderById.get(cursor);
        if (!f) break;
        parts.unshift(f.name);
        cursor = f.parentFolderId;
      }
      return parts.length ? parts.join(' / ') : scopeRootLabel;
    },
    [folderById, scopeRootLabel],
  );

  // ---- Local-state mutation helpers (keep the UI in sync without a reload) --
  const patchFile = useCallback((id: string, patch: Partial<ApiDatabankFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setSearchResults((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setDetailsFile((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }, []);

  const removeFilesByIds = useCallback((ids: Set<string>) => {
    setFiles((prev) => prev.filter((f) => !ids.has(f.id)));
    setSearchResults((prev) => {
      const removedInResults = prev.filter((f) => ids.has(f.id)).length;
      if (removedInResults) setSearchTotal((t) => Math.max(0, t - removedInResults));
      return prev.filter((f) => !ids.has(f.id));
    });
    setDetailsFile((prev) => (prev && ids.has(prev.id) ? null : prev));
  }, []);

  // ---- Table (TanStack v8) — shared by folder view AND search results -------
  const tableData = isSearching ? searchResults : currentFiles;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [detailsFile, setDetailsFile] = useState<ApiDatabankFile | null>(null);

  // Switching folder or flipping between folder/search view clears selection.
  useEffect(() => {
    setRowSelection({});
  }, [selectedFolderId, trimmedQuery, personal, clientId]);

  const columns = useMemo<ColumnDef<ApiDatabankFile>[]>(() => {
    const cols: ColumnDef<ApiDatabankFile>[] = [];
    if (!readOnly) cols.push({ id: 'select', enableSorting: false });
    cols.push({ id: 'name', header: 'Name', accessorFn: (r) => r.fileName, sortingFn: 'text' });
    cols.push({ id: 'size', header: 'Size', accessorFn: (r) => r.fileSizeBytes ?? -1 });
    cols.push({ id: 'type', header: 'Type', accessorFn: (r) => typeLabel(r.mimeType), sortingFn: 'text' });
    cols.push({ id: 'modified', header: 'Modified', accessorFn: (r) => Date.parse(r.updatedAt) || 0 });
    return cols;
  }, [readOnly]);

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const selectedFiles = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectionCount = selectedFiles.length;

  const gridCols = readOnly
    ? 'minmax(0,1fr) 96px 78px 118px'
    : '38px minmax(0,1fr) 96px 78px 118px';
  const tableMinWidth = readOnly ? 430 : 468;
  const rowHeight = isSearching ? ROW_H_SEARCH : ROW_H;

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });
  // Row-height changes with the mode; re-measure so positions stay correct.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  // ---- Mutations (context menu + bulk share these) -------------------------
  const [renameTarget, setRenameTarget] = useState<ApiDatabankFile | null>(null);
  const [moveTargets, setMoveTargets] = useState<ApiDatabankFile[] | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<ApiDatabankFile[] | null>(null);
  // ---- Clipboard + right-click Copy/Cut/Paste (files + folders) ----
  const [clipboard, setClipboard] = useState<Clip | null>(null);
  // A short verb for the busy overlay ("Copying…"/"Moving…") on the new ops.
  const [activity, setActivity] = useState<string | null>(null);
  // Folder Move…/Delete go through the (generalized) dialogs, like files.
  const [folderMove, setFolderMove] = useState<{ id: string; name: string } | null>(null);
  const [folderDelete, setFolderDelete] = useState<{ id: string; name: string } | null>(null);
  // Trash view (P3-1) + per-file version history (P3-2).
  const [trashOpen, setTrashOpen] = useState(false);
  const [versionsTarget, setVersionsTarget] = useState<ApiDatabankFile | null>(null);
  const trashScope = useMemo<{ clientId: string } | { personal: true }>(
    () => (personal ? { personal: true } : { clientId: clientId! }),
    [personal, clientId],
  );

  const doRename = useCallback(
    async (file: ApiDatabankFile, name: string) => {
      const updated = await api.renameFile(file.id, name);
      patchFile(file.id, { fileName: updated?.fileName ?? name });
    },
    [api, patchFile],
  );

  const doMove = useCallback(
    async (targets: ApiDatabankFile[], folderId: string | null) => {
      await runLimited(targets, 4, async (f) => {
        await api.moveFile(f.id, folderId);
      });
      const ids = new Set(targets.map((t) => t.id));
      setFiles((prev) => prev.map((f) => (ids.has(f.id) ? { ...f, folderId } : f)));
      setSearchResults((prev) => prev.map((f) => (ids.has(f.id) ? { ...f, folderId } : f)));
      setDetailsFile((prev) => (prev && ids.has(prev.id) ? { ...prev, folderId } : prev));
      setRowSelection({});
    },
    [api],
  );

  const doDelete = useCallback(
    async (targets: ApiDatabankFile[]) => {
      await runLimited(targets, 4, async (f) => {
        await api.deleteFile(f.id);
      });
      removeFilesByIds(new Set(targets.map((t) => t.id)));
      setRowSelection({});
    },
    [api, removeFilesByIds],
  );

  // ---- Paste the clipboard into a destination folder (null = root) ----------
  // Copy → copyFile / copyFolder; cut → moveFile / moveFolder. settlePaste never
  // rejects, so reload() in the finally always runs; a stale (gone) source is
  // pruned from the clipboard rather than aborting the paste.
  const doPaste = useCallback(
    async (destFolderId: string | null) => {
      if (readOnly || !clipboard) return;
      const { op, files: clipFiles, folder: clipFolder } = clipboard;
      if (clipFolder && !canPasteInto(destFolderId, clipFolder.id, parentOf)) {
        setError("A folder can't be moved into itself or one of its own subfolders");
        return;
      }
      setBusy(true);
      setActivity(op === 'cut' ? 'Moving…' : 'Copying…');
      setError(null);
      const skipped: Array<{ fileName: string; reason: string }> = [];
      const dest = destFolderId;
      const jobs: PasteJob[] =
        op === 'copy'
          ? [
              ...clipFiles.map((f) => ({ id: f.id, name: f.fileName, go: () => api.copyFile(f.id, { targetFolderId: dest }).then(() => {}) })),
              ...(clipFolder
                ? [{ id: clipFolder.id, name: clipFolder.name, go: () => api.copyFolder(clipFolder.id, { targetFolderId: dest }).then((r) => { if (r.skipped?.length) skipped.push(...r.skipped); }) }]
                : []),
            ]
          : [
              ...clipFiles.map((f) => ({ id: f.id, name: f.fileName, go: () => api.moveFile(f.id, dest).then(() => {}) })),
              ...(clipFolder ? [{ id: clipFolder.id, name: clipFolder.name, go: () => api.moveFolder(clipFolder.id, dest).then(() => {}) }] : []),
            ];
      try {
        const res = await settlePaste(jobs, (j) => j.go());
        const goneIds = new Set(res.failed.filter((f) => f.gone).map((f) => f.id));
        if (op === 'cut') {
          setClipboard(null);
        } else if (goneIds.size) {
          setClipboard((prev) =>
            prev
              ? {
                  ...prev,
                  files: prev.files.filter((f) => !goneIds.has(f.id)),
                  folder: prev.folder && !goneIds.has(prev.folder.id) ? prev.folder : null,
                }
              : prev,
          );
        }
        setClipboard((prev) => (prev && !prev.files.length && !prev.folder ? null : prev));
        setRowSelection({});
        const goneN = res.failed.filter((f) => f.gone).length;
        const otherN = res.failed.length - goneN;
        if (goneN) {
          setError(`${goneN} item(s) no longer exist — they may have been moved or deleted, and were removed from your clipboard.`);
        } else if (otherN) {
          setError(`${otherN} item(s) could not be ${op === 'cut' ? 'moved' : 'copied'}.`);
        } else if (skipped.length) {
          const tooLarge = skipped.filter((s) => s.reason === 'TOO_LARGE');
          setError(
            tooLarge.length
              ? `${tooLarge.length} file(s) over 5 GB were skipped and not copied: ${tooLarge.map((s) => s.fileName).join(', ')}`
              : `${skipped.length} file(s) were skipped.`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Paste failed');
      } finally {
        await reload();
        setBusy(false);
        setActivity(null);
      }
    },
    [readOnly, clipboard, parentOf, api, reload],
  );

  const doFolderMove = useCallback(
    async (folderId: string, destId: string | null) => {
      await api.moveFolder(folderId, destId);
      await reload();
    },
    [api, reload],
  );

  const doFolderDelete = useCallback(
    async (folderId: string) => {
      await api.deleteFolder(folderId);
      await reload();
    },
    [api, reload],
  );

  // Whether a "Paste here" into `dest` is allowed given the current clipboard.
  const canPasteHere = useCallback(
    (dest: string | null) => !!clipboard && (!clipboard.folder || canPasteInto(dest, clipboard.folder.id, parentOf)),
    [clipboard, parentOf],
  );

  // Keyboard: Ctrl/Cmd+C/X copy/cut the selected files, +V pastes into the
  // selected folder, F2 renames a single selection, Del trashes the selection.
  // A sibling of the image-paste effect; ignores typing in inputs/search/rename.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (loading || readOnly) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'c') {
        if (selectedFiles.length) setClipboard({ op: 'copy', files: selectedFiles, folder: null });
      } else if (mod && k === 'x') {
        if (selectedFiles.length) setClipboard({ op: 'cut', files: selectedFiles, folder: null });
      } else if (mod && k === 'v') {
        if (clipboard) {
          e.preventDefault();
          void doPaste(selectedFolderId);
        }
      } else if (e.key === 'F2') {
        if (selectedFiles.length === 1) {
          e.preventDefault();
          setRenameTarget(selectedFiles[0]);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFiles.length) {
          e.preventDefault();
          setDeleteTargets(selectedFiles);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, readOnly, selectedFiles, selectedFolderId, clipboard, doPaste]);

  const saveDetails = useCallback(
    async (file: ApiDatabankFile, patch: { description: string | null; tags: string[] }) => {
      const updated = await api.updateFile(file.id, patch);
      patchFile(file.id, {
        description: updated?.description ?? patch.description,
        tags: updated?.tags ?? patch.tags,
      });
    },
    [api, patchFile],
  );

  const downloadAll = useCallback(
    async (targets: ApiDatabankFile[]) => {
      await runLimited(targets, 3, (f) => download(f));
    },
    [download],
  );

  // Measure the tree box — react-arborist (react-window) needs numeric sizes.
  const treeBoxRef = useRef<HTMLDivElement>(null);
  const [treeSize, setTreeSize] = useState({ width: 258, height: 420 });
  useEffect(() => {
    const el = treeBoxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setTreeSize({ width: Math.max(180, Math.floor(width)), height: Math.max(200, Math.floor(height)) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The tree node row (closes over selection + readOnly).
  const NodeRow = useCallback(
    ({ node, style, dragHandle }: NodeRendererProps<FolderNode>) => {
      const selected = node.id === selectedFolderId;
      return (
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
        <div
          ref={dragHandle}
          style={{
            ...style,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingRight: 6,
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            color: selected ? primary : 'var(--sos-text-secondary, #334155)',
            fontWeight: selected ? 600 : 500,
            background: selected ? accentSoft : node.willReceiveDrop ? accentSoft : 'transparent',
            outline: node.willReceiveDrop ? `1px solid ${accent}` : 'none',
          }}
        >
          <span
            onClick={(e) => {
              e.stopPropagation();
              node.toggle();
            }}
            style={{ display: 'inline-flex', width: 16, flexShrink: 0, color: muted }}
          >
            {node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <Folder size={16} style={{ color: accent, flexShrink: 0 }} />
          {node.isEditing ? (
            <input
              autoFocus
              defaultValue={node.data.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => node.reset()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') node.submit((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') node.reset();
              }}
              style={{
                flex: 1,
                minWidth: 0,
                border,
                borderRadius: 6,
                padding: '2px 6px',
                fontSize: 13,
                background: surfaceSolid,
                color: primary,
                outline: 'none',
              }}
            />
          ) : (
            <span
              style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={node.data.name}
            >
              {node.data.name}
            </span>
          )}
          {!readOnly && !node.isEditing ? (
            <button
              type="button"
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                node.edit();
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: muted,
                padding: 3,
                borderRadius: 6,
                display: 'inline-flex',
                flexShrink: 0,
              }}
            >
              <Pencil size={12} />
            </button>
          ) : null}
        </div>
          </ContextMenu.Trigger>
          {!readOnly ? (
            <ContextMenu.Portal>
              <ContextMenu.Content className="dbx-menu" collisionPadding={8}>
                <ContextMenu.Item
                  className="dbx-item"
                  onSelect={() => setClipboard({ op: 'copy', files: [], folder: { id: node.id, name: node.data.name } })}
                >
                  <Copy size={15} /> Copy
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="dbx-item"
                  onSelect={() => setClipboard({ op: 'cut', files: [], folder: { id: node.id, name: node.data.name } })}
                >
                  <Scissors size={15} /> Cut
                </ContextMenu.Item>
                <ContextMenu.Item className="dbx-item" disabled={!canPasteHere(node.id)} onSelect={() => void doPaste(node.id)}>
                  <ClipboardPaste size={15} /> Paste here
                </ContextMenu.Item>
                <ContextMenu.Separator className="dbx-sep" />
                <ContextMenu.Item
                  className="dbx-item"
                  onSelect={() => {
                    setSelectedFolderId(node.id);
                    setNewFolderOpen(true);
                  }}
                >
                  <FolderPlus size={15} /> New subfolder…
                </ContextMenu.Item>
                <ContextMenu.Item className="dbx-item" onSelect={() => node.edit()}>
                  <Pencil size={15} /> Rename…
                </ContextMenu.Item>
                <ContextMenu.Item className="dbx-item" onSelect={() => setFolderMove({ id: node.id, name: node.data.name })}>
                  <FolderInput size={15} /> Move to…
                </ContextMenu.Item>
                <ContextMenu.Separator className="dbx-sep" />
                <ContextMenu.Item
                  className="dbx-item"
                  data-danger=""
                  onSelect={() => setFolderDelete({ id: node.id, name: node.data.name })}
                >
                  <Trash2 size={15} /> Delete
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          ) : null}
        </ContextMenu.Root>
      );
    },
    [selectedFolderId, readOnly, canPasteHere, doPaste],
  );

  const showTable = rows.length > 0 && !(isSearching ? searchError : loading);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{EXPLORER_CSS}</style>
      {error ? (
        <div
          style={{
            fontSize: 13,
            color: danger,
            border,
            borderColor: danger,
            borderRadius: 10,
            padding: '8px 12px',
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Resume interrupted uploads after a reload (resumable path only). */}
      {v2 ? <UploadResumeBanner dest={uploadDest} readOnly={readOnly} /> : null}

      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'stretch',
          minHeight: 460,
          flexWrap: narrow ? 'wrap' : 'nowrap',
        }}
      >
        {/* LEFT — folder tree */}
        <div
          style={{
            width: narrow ? '100%' : 280,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            border,
            borderRadius: 12,
            background: surface,
            overflow: 'hidden',
            minHeight: narrow ? 240 : undefined,
          }}
        >
          {/* Synthetic root row — selects folderId = null */}
          <button
            type="button"
            onClick={() => setSelectedFolderId(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              textAlign: 'left',
              border: 'none',
              borderBottom: border,
              cursor: 'pointer',
              padding: '10px 12px',
              fontSize: 13,
              fontWeight: 700,
              color: selectedFolderId === null ? primary : 'var(--sos-text-secondary, #334155)',
              background: selectedFolderId === null ? accentSoft : 'transparent',
            }}
          >
            <Home size={15} style={{ color: accent, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {personal ? rootLabel : clientName || rootLabel}
            </span>
          </button>

          <div ref={treeBoxRef} style={{ flex: 1, minHeight: 0, padding: 6, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, fontSize: 13, padding: 8 }}>
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : treeData.length === 0 ? (
              <div style={{ color: muted, fontSize: 12.5, padding: 8 }}>No folders yet.</div>
            ) : mounted ? (
              <Tree<FolderNode>
                data={treeData}
                idAccessor="id"
                childrenAccessor="children"
                openByDefault={false}
                width={treeSize.width}
                height={treeSize.height}
                rowHeight={30}
                indent={16}
                disableEdit={readOnly}
                disableDrag={readOnly}
                disableDrop={disableDrop}
                disableMultiSelection
                onActivate={(node) => setSelectedFolderId(node.id)}
                onRename={onRename}
                onMove={onMove}
              >
                {NodeRow}
              </Tree>
            ) : null}
          </div>
        </div>

        {/* MAIN — toolbar + search + breadcrumbs + table (or search results) + details */}
        <div
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}
          onDragOver={
            readOnly
              ? undefined
              : (e) => {
                  e.preventDefault();
                  setDragActive(true);
                }
          }
          onDragLeave={readOnly ? undefined : () => setDragActive(false)}
          onDrop={
            readOnly
              ? undefined
              : (e) => {
                  e.preventDefault();
                  setDragActive(false);
                  // Capture entries synchronously (the DataTransfer is cleared once the
                  // handler returns). If any dropped item is a directory, walk the tree;
                  // otherwise fall back to the flat file list.
                  const items = e.dataTransfer.items;
                  const entries =
                    items && items.length && typeof items[0]?.webkitGetAsEntry === 'function'
                      ? Array.from(items)
                          .map((it) => it.webkitGetAsEntry())
                          .filter(Boolean)
                      : [];
                  if (entries.some((en) => (en as { isDirectory?: boolean } | null)?.isDirectory)) {
                    void (async () => {
                      const collected: FolderEntry[] = [];
                      for (const en of entries) {
                        // eslint-disable-next-line no-await-in-loop
                        await walkEntry(en, '', collected);
                      }
                      await doUploadFolder(collected);
                    })();
                    return;
                  }
                  if (e.dataTransfer.files?.length) void doUpload(e.dataTransfer.files, 'UPLOAD');
                }
          }
        >
          {/* Toolbar — upload / new folder, targeting the selected folder (hidden when read-only). */}
          {!readOnly ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} style={toolbarBtn(true)}>
                <Upload size={15} /> Upload files
              </button>
              <button type="button" onClick={() => folderInputRef.current?.click()} disabled={busy} style={toolbarBtn(false)}>
                <FolderUp size={15} /> Upload folder
              </button>
              <button type="button" onClick={() => setNewFolderOpen(true)} disabled={busy} style={toolbarBtn(false)}>
                <FolderPlus size={15} /> New folder
              </button>
              <button type="button" onClick={() => setTrashOpen(true)} disabled={busy} style={toolbarBtn(false)}>
                <Trash2 size={15} /> Trash
              </button>
              <span style={{ fontSize: 12, color: muted, whiteSpace: 'nowrap' }}>
                into {selectedFolderId ? breadcrumb[breadcrumb.length - 1]?.name ?? rootLabel : rootLabel}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) void doUpload(e.target.files, 'UPLOAD');
                  e.target.value = '';
                }}
              />
              <input
                ref={(el) => {
                  folderInputRef.current = el;
                  // webkitdirectory/directory aren't standard React props — set them
                  // on the DOM node so the picker selects a whole folder tree.
                  if (el) {
                    el.setAttribute('webkitdirectory', '');
                    el.setAttribute('directory', '');
                  }
                }}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const picked = e.target.files ? Array.from(e.target.files) : [];
                  const entries: FolderEntry[] = picked.map((f) => ({
                    file: f,
                    relPath: (f as unknown as { webkitRelativePath?: string }).webkitRelativePath || f.name,
                  }));
                  if (entries.length) void doUploadFolder(entries);
                  e.target.value = '';
                }}
              />
            </div>
          ) : null}

          {/* Direct-path (non-V2) upload progress. */}
          {busy ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: muted }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={13} className="animate-spin" />
                {progress
                  ? `Uploading ${progress.done + 1} of ${progress.total} — ${progress.name} (${progress.pct}%)`
                  : activity ?? 'Working…'}
              </div>
              {progress ? (
                <div style={{ height: 4, borderRadius: 999, background: 'var(--sos-border, rgba(148,163,184,0.25))', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${progress.total ? Math.round(((progress.done + progress.pct / 100) / progress.total) * 100) : 0}%`,
                      background: accent,
                      transition: 'width 0.2s',
                    }}
                  />
                </div>
              ) : (
                // Indeterminate sweep for an op with no byte progress (paste / folder delete).
                <div style={{ height: 4, borderRadius: 999, background: 'var(--sos-border, rgba(148,163,184,0.25))', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '35%', background: accent, borderRadius: 999, animation: 'sos-databank-sweep 1.1s ease-in-out infinite' }} />
                </div>
              )}
            </div>
          ) : null}

          {/* Search box (debounced) — a non-empty query searches the whole scope. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, color: muted, pointerEvents: 'none' }} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${scopeRootLabel}…`}
                aria-label="Search files"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border,
                  borderRadius: 10,
                  padding: '8px 32px',
                  fontSize: 13,
                  background: surfaceSolid,
                  color: primary,
                  outline: 'none',
                }}
              />
              {query ? (
                <button
                  type="button"
                  title="Clear search"
                  onClick={clearSearch}
                  style={{
                    position: 'absolute',
                    right: 6,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: muted,
                    padding: 4,
                    borderRadius: 6,
                    display: 'inline-flex',
                  }}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            {isSearching && searchLoading ? (
              <Loader2 size={16} className="animate-spin" style={{ color: muted, flexShrink: 0 }} />
            ) : null}
          </div>

          {/* Type facets — toggle chips with counts (search mode only). */}
          {isSearching ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {TYPE_BUCKETS.map((t) => {
                const active = selectedTypes.includes(t);
                return (
                  <button key={t} type="button" onClick={() => toggleType(t)} style={chipStyle(active)}>
                    {TYPE_LABEL[t]}
                    <span style={{ opacity: 0.7 }}>{searchFacets?.byType[t] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            {isSearching ? (
              <div style={{ fontSize: 13, color: muted }}>
                {searchLoading && searchResults.length === 0
                  ? 'Searching…'
                  : `${searchTotal} ${searchTotal === 1 ? 'result' : 'results'} for “${trimmedQuery}”`}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: muted, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setSelectedFolderId(null)} style={crumbBtn(selectedFolderId === null)}>
                  <Home size={14} /> {rootLabel}
                </button>
                {breadcrumb.map((f) => (
                  <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <ChevronRight size={13} style={{ opacity: 0.5 }} />
                    <button type="button" onClick={() => setSelectedFolderId(f.id)} style={crumbBtn(selectedFolderId === f.id)}>
                      {f.name}
                    </button>
                  </span>
                ))}
              </div>
            )}
            {readOnly ? (
              <span
                title={api.readOnlyTitle}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12.5,
                  color: muted,
                  border,
                  borderRadius: 999,
                  padding: '5px 12px',
                  whiteSpace: 'nowrap',
                }}
              >
                {api.readOnlyLabel}
              </span>
            ) : null}
          </div>

          {/* Bulk-action bar (hidden when read-only). */}
          {!readOnly && selectionCount > 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                border,
                borderColor: accent,
                borderRadius: 10,
                background: accentSoft,
                padding: '8px 12px',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: primary }}>
                {selectionCount} selected
              </span>
              <button type="button" onClick={() => setRowSelection({})} style={linkBtn}>
                Clear
              </button>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={() => void downloadAll(selectedFiles)} style={barBtn}>
                <Download size={14} /> Download all
              </button>
              <button type="button" onClick={() => setClipboard({ op: 'copy', files: selectedFiles, folder: null })} style={barBtn}>
                <Copy size={14} /> Copy
              </button>
              <button type="button" onClick={() => setClipboard({ op: 'cut', files: selectedFiles, folder: null })} style={barBtn}>
                <Scissors size={14} /> Cut
              </button>
              <button type="button" onClick={() => setMoveTargets(selectedFiles)} style={barBtn}>
                <FolderInput size={14} /> Move…
              </button>
              <button type="button" onClick={() => setDeleteTargets(selectedFiles)} style={{ ...barBtn, color: danger, borderColor: danger }}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          ) : null}

          {/* Table + details panel row. */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              minWidth: 0,
              flexDirection: narrow ? 'column' : 'row',
              alignItems: 'stretch',
            }}
          >
            {/* Table (folder view AND search results — one component, two data sources). */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ContextMenu.Root>
                <ContextMenu.Trigger asChild>
              <div
                ref={scrollRef}
                style={{
                  border,
                  borderRadius: 12,
                  background: surface,
                  height: TABLE_H,
                  overflow: 'auto',
                  position: 'relative',
                }}
              >
                {isSearching && searchError ? (
                  <div style={{ color: danger, fontSize: 13, padding: '32px 12px', textAlign: 'center' }}>
                    {searchError}
                  </div>
                ) : (isSearching ? searchLoading && searchResults.length === 0 : loading) ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, fontSize: 13, padding: 16 }}>
                    <Loader2 size={14} className="animate-spin" /> {isSearching ? 'Searching…' : 'Loading databank…'}
                  </div>
                ) : rows.length === 0 ? (
                  <div style={{ color: muted, fontSize: 13, padding: '32px 12px', textAlign: 'center' }}>
                    {isSearching ? 'No files match your search.' : 'No files in this folder.'}
                  </div>
                ) : (
                  <div style={{ minWidth: tableMinWidth }}>
                    {/* Sticky, sortable header */}
                    <div
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        display: 'grid',
                        gridTemplateColumns: gridCols,
                        alignItems: 'center',
                        gap: 10,
                        padding: '0 12px',
                        height: 38,
                        background: surfaceSolid,
                        borderBottom: border,
                      }}
                    >
                      {table.getHeaderGroups()[0]?.headers.map((header) => {
                        const col = header.column;
                        if (col.id === 'select') {
                          return (
                            <IndeterminateCheckbox
                              key={header.id}
                              checked={table.getIsAllRowsSelected()}
                              indeterminate={table.getIsSomeRowsSelected()}
                              onChange={table.getToggleAllRowsSelectedHandler()}
                              ariaLabel="Select all files"
                            />
                          );
                        }
                        const dir = col.getIsSorted();
                        const label = String(col.columnDef.header ?? '');
                        const alignRight = col.id === 'size';
                        return (
                          <button
                            key={header.id}
                            type="button"
                            onClick={col.getToggleSortingHandler()}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              justifyContent: alignRight ? 'flex-end' : 'flex-start',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: 11.5,
                              fontWeight: 700,
                              letterSpacing: 0.3,
                              textTransform: 'uppercase',
                              color: dir ? primary : muted,
                              minWidth: 0,
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                            <span style={{ width: 10, flexShrink: 0 }}>{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Virtualized rows */}
                    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                      {rowVirtualizer.getVirtualItems().map((vi) => {
                        const row = rows[vi.index];
                        const file = row.original;
                        const isSelected = row.getIsSelected();
                        return (
                          <ContextMenu.Root key={row.id}>
                            <ContextMenu.Trigger asChild>
                              <div
                                onClick={() => setDetailsFile(file)}
                                onContextMenu={(e) => e.stopPropagation()}
                                style={{
                                  position: 'absolute',
                                  top: vi.start,
                                  left: 0,
                                  right: 0,
                                  height: vi.size,
                                  display: 'grid',
                                  gridTemplateColumns: gridCols,
                                  alignItems: 'center',
                                  gap: 10,
                                  padding: '0 12px',
                                  cursor: 'pointer',
                                  background:
                                    detailsFile?.id === file.id
                                      ? accentSoft
                                      : isSelected
                                        ? 'var(--sos-surface-hover, rgba(148,163,184,0.10))'
                                        : 'transparent',
                                  borderBottom: border,
                                  minWidth: 0,
                                }}
                              >
                                {!readOnly ? (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ display: 'inline-flex', alignItems: 'center' }}
                                  >
                                    <IndeterminateCheckbox
                                      checked={isSelected}
                                      indeterminate={false}
                                      onChange={row.getToggleSelectedHandler()}
                                      ariaLabel={`Select ${file.fileName}`}
                                    />
                                  </div>
                                ) : null}

                                {/* Name */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                  <span style={{ color: muted, flexShrink: 0, display: 'inline-flex' }}>
                                    <FileGlyph mime={file.mimeType} />
                                  </span>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div
                                      style={{ fontSize: 13.5, color: primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                      title={file.fileName}
                                    >
                                      {file.fileName}
                                    </div>
                                    {isSearching ? (
                                      <div
                                        style={{ fontSize: 11.5, color: muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        title={folderPathOf(file.folderId)}
                                      >
                                        {folderPathOf(file.folderId)}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>

                                {/* Size */}
                                <div style={{ fontSize: 12.5, color: muted, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  {file.fileSizeBytes == null ? '—' : fmtSize(file.fileSizeBytes)}
                                </div>

                                {/* Type */}
                                <div style={{ fontSize: 12.5, color: muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {typeLabel(file.mimeType)}
                                </div>

                                {/* Modified */}
                                <div style={{ fontSize: 12.5, color: muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {fmtDate(file.updatedAt)}
                                </div>
                              </div>
                            </ContextMenu.Trigger>
                            <ContextMenu.Portal>
                              <ContextMenu.Content className="dbx-menu" collisionPadding={8}>
                                <ContextMenu.Item className="dbx-item" onSelect={() => void download(file)}>
                                  <Download size={15} /> Open / Download
                                </ContextMenu.Item>
                                <ContextMenu.Item className="dbx-item" onSelect={() => setVersionsTarget(file)}>
                                  <History size={15} /> Version history
                                </ContextMenu.Item>
                                {!readOnly ? (
                                  <>
                                    <ContextMenu.Item
                                      className="dbx-item"
                                      onSelect={() => setClipboard({ op: 'copy', files: isSelected && selectionCount > 1 ? selectedFiles : [file], folder: null })}
                                    >
                                      <Copy size={15} /> Copy
                                    </ContextMenu.Item>
                                    <ContextMenu.Item
                                      className="dbx-item"
                                      onSelect={() => setClipboard({ op: 'cut', files: isSelected && selectionCount > 1 ? selectedFiles : [file], folder: null })}
                                    >
                                      <Scissors size={15} /> Cut
                                    </ContextMenu.Item>
                                    <ContextMenu.Separator className="dbx-sep" />
                                    <ContextMenu.Item className="dbx-item" onSelect={() => setRenameTarget(file)}>
                                      <Pencil size={15} /> Rename…
                                    </ContextMenu.Item>
                                    <ContextMenu.Item className="dbx-item" onSelect={() => setMoveTargets([file])}>
                                      <FolderInput size={15} /> Move to…
                                    </ContextMenu.Item>
                                    <ContextMenu.Separator className="dbx-sep" />
                                    <ContextMenu.Item className="dbx-item" data-danger="" onSelect={() => setDeleteTargets([file])}>
                                      <Trash2 size={15} /> Delete
                                    </ContextMenu.Item>
                                  </>
                                ) : null}
                              </ContextMenu.Content>
                            </ContextMenu.Portal>
                          </ContextMenu.Root>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
                </ContextMenu.Trigger>
                {!readOnly && !isSearching ? (
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="dbx-menu" collisionPadding={8}>
                      <ContextMenu.Item
                        className="dbx-item"
                        disabled={!canPasteHere(selectedFolderId)}
                        onSelect={() => void doPaste(selectedFolderId)}
                      >
                        <ClipboardPaste size={15} /> Paste here
                      </ContextMenu.Item>
                      <ContextMenu.Separator className="dbx-sep" />
                      <ContextMenu.Item className="dbx-item" onSelect={() => setNewFolderOpen(true)}>
                        <FolderPlus size={15} /> New folder…
                      </ContextMenu.Item>
                      <ContextMenu.Item className="dbx-item" onSelect={() => fileInputRef.current?.click()}>
                        <Upload size={15} /> Upload files…
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                ) : null}
              </ContextMenu.Root>

              {/* "Load more" (search mode) — appends the next page to the table. */}
              {isSearching && showTable && searchResults.length < searchTotal ? (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    type="button"
                    disabled={searchLoading}
                    onClick={() => void runSearch(searchPage + 1, false)}
                    style={{
                      border,
                      borderRadius: 8,
                      background: 'transparent',
                      color: primary,
                      cursor: searchLoading ? 'default' : 'pointer',
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: '7px 16px',
                      opacity: searchLoading ? 0.6 : 1,
                    }}
                  >
                    {searchLoading ? 'Loading…' : `Load more (${searchResults.length} of ${searchTotal})`}
                  </button>
                </div>
              ) : null}
            </div>

            {/* Details side panel (opens on row click). */}
            {detailsFile ? (
              <DetailsPanel
                key={detailsFile.id}
                file={detailsFile}
                readOnly={readOnly}
                narrow={narrow}
                pathLabel={folderPathOf(detailsFile.folderId)}
                onClose={() => setDetailsFile(null)}
                onDownload={() => void download(detailsFile)}
                onVersions={() => setVersionsTarget(detailsFile)}
                onSave={(patch) => saveDetails(detailsFile, patch)}
              />
            ) : null}
          </div>

          {/* Drag-and-drop overlay (shown while dragging over the main pane). */}
          {!readOnly && dragActive ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 5,
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                border: `2px dashed ${accent}`,
                borderRadius: 14,
                background: 'var(--sos-accent-soft, rgba(184,134,11,0.10))',
                color: primary,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              <Upload size={26} style={{ color: accent }} />
              Drop files here
              <span style={{ fontSize: 12, fontWeight: 500, color: muted }}>
                into {selectedFolderId ? breadcrumb[breadcrumb.length - 1]?.name ?? rootLabel : rootLabel}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Dialogs (Radix, our own CSS) */}
      {newFolderOpen ? (
        <NewFolderDialog onClose={() => setNewFolderOpen(false)} onSubmit={submitNewFolder} />
      ) : null}
      {renameTarget ? (
        <RenameDialog file={renameTarget} onClose={() => setRenameTarget(null)} onSubmit={doRename} />
      ) : null}
      {moveTargets ? (
        <MoveDialog
          noun={moveTargets.length === 1 ? `“${moveTargets[0].fileName}”` : `${moveTargets.length} files`}
          options={folderOptions}
          rootLabel={scopeRootLabel}
          onClose={() => setMoveTargets(null)}
          onSubmit={(folderId) => doMove(moveTargets, folderId)}
        />
      ) : null}
      {folderMove ? (
        <MoveDialog
          noun={`“${folderMove.name}”`}
          options={folderOptions}
          rootLabel={scopeRootLabel}
          disabledIds={descendantsWithSelf(folderMove.id)}
          onClose={() => setFolderMove(null)}
          onSubmit={(folderId) => doFolderMove(folderMove.id, folderId)}
        />
      ) : null}
      {deleteTargets ? (
        <DeleteDialog
          title={deleteTargets.length === 1 ? 'Delete file' : 'Delete files'}
          body={`Delete ${
            deleteTargets.length === 1 ? `“${deleteTargets[0].fileName}”` : `${deleteTargets.length} files`
          }? This moves ${deleteTargets.length === 1 ? 'it' : 'them'} to Trash, where you can restore ${
            deleteTargets.length === 1 ? 'it' : 'them'
          }.`}
          onClose={() => setDeleteTargets(null)}
          onConfirm={() => doDelete(deleteTargets)}
        />
      ) : null}
      {folderDelete ? (
        <DeleteDialog
          title="Delete folder"
          body={`Delete “${folderDelete.name}” and everything inside it? This moves it to Trash, where you can restore it.`}
          onClose={() => setFolderDelete(null)}
          onConfirm={() => doFolderDelete(folderDelete.id)}
        />
      ) : null}
      {trashOpen ? (
        <TrashDialog api={api} scope={trashScope} onClose={() => setTrashOpen(false)} reload={reload} />
      ) : null}
      {versionsTarget ? (
        <VersionsDialog
          api={api}
          file={versionsTarget}
          canWrite={canWrite}
          onClose={() => setVersionsTarget(null)}
          patchFile={patchFile}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details side panel
// ---------------------------------------------------------------------------
function DetailsPanel({
  file,
  readOnly,
  narrow,
  pathLabel,
  onClose,
  onDownload,
  onVersions,
  onSave,
}: {
  file: ApiDatabankFile;
  readOnly: boolean;
  narrow: boolean;
  pathLabel: string;
  onClose: () => void;
  onDownload: () => void;
  onVersions: () => void;
  onSave: (patch: { description: string | null; tags: string[] }) => Promise<void>;
}) {
  const [desc, setDesc] = useState(file.description ?? '');
  const [tagsText, setTagsText] = useState((file.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    setSavedAt(false);
    try {
      const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
      const description = desc.trim() ? desc.trim() : null;
      await onSave({ description, tags });
      setSavedAt(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        width: narrow ? '100%' : 300,
        flexShrink: 0,
        border,
        borderRadius: 12,
        background: surfaceSolid,
        height: narrow ? undefined : TABLE_H,
        maxHeight: narrow ? 420 : undefined,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 12px 8px', borderBottom: border }}>
        <span style={{ color: accent, flexShrink: 0, display: 'inline-flex', marginTop: 2 }}>
          <FileGlyph mime={file.mimeType} size={22} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: primary, wordBreak: 'break-word' }} title={file.fileName}>
            {file.fileName}
          </div>
          <div style={{ fontSize: 11.5, color: muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pathLabel}>
            {pathLabel}
          </div>
        </div>
        <button
          type="button"
          title="Close"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, padding: 4, borderRadius: 6, display: 'inline-flex', flexShrink: 0 }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 12.5 }}>
          <dt style={{ color: muted }}>Size</dt>
          <dd style={{ margin: 0, color: primary }}>{file.fileSizeBytes == null ? '—' : fmtSize(file.fileSizeBytes)}</dd>
          <dt style={{ color: muted }}>Type</dt>
          <dd style={{ margin: 0, color: primary }}>{typeLabel(file.mimeType)}</dd>
          <dt style={{ color: muted }}>Modified</dt>
          <dd style={{ margin: 0, color: primary }}>{fmtDate(file.updatedAt) || '—'}</dd>
        </dl>

        <button
          type="button"
          onClick={onDownload}
          style={{ ...barBtn, justifyContent: 'center', width: '100%' }}
        >
          <Download size={14} /> Download
        </button>

        <button
          type="button"
          onClick={onVersions}
          style={{ ...barBtn, justifyContent: 'center', width: '100%' }}
        >
          <History size={14} /> Version history
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Description
          </label>
          {readOnly ? (
            <div style={{ fontSize: 13, color: file.description ? primary : muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {file.description || 'No description.'}
            </div>
          ) : (
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={4}
              placeholder="Add a description…"
              style={{
                border,
                borderRadius: 8,
                padding: '7px 9px',
                fontSize: 13,
                color: primary,
                background: surfaceSolid,
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Tags
          </label>
          {readOnly ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(file.tags ?? []).length ? (
                (file.tags ?? []).map((t) => (
                  <span key={t} style={tagChip}>
                    {t}
                  </span>
                ))
              ) : (
                <span style={{ fontSize: 13, color: muted }}>No tags.</span>
              )}
            </div>
          ) : (
            <>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="comma, separated, tags"
                style={{
                  border,
                  borderRadius: 8,
                  padding: '7px 9px',
                  fontSize: 13,
                  color: primary,
                  background: surfaceSolid,
                  outline: 'none',
                }}
              />
              {tagsText.trim() ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                  {tagsText
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((t, i) => (
                      <span key={`${t}-${i}`} style={tagChip}>
                        {t}
                      </span>
                    ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        {!readOnly ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto' }}>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              style={{ ...primaryBtn, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedAt ? <span style={{ fontSize: 12, color: muted }}>Saved</span> : null}
            {err ? <span style={{ fontSize: 12, color: danger }}>{err}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
function DialogShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Dialog.Root open onOpenChange={(o: boolean) => (!o ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dbx-overlay" />
        <Dialog.Content className="dbx-dialog" aria-describedby={undefined}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <Dialog.Title style={{ margin: 0, fontSize: 15, fontWeight: 700, color: primary, flex: 1 }}>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, padding: 4, borderRadius: 6, display: 'inline-flex' }}
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          {children}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>{footer}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NewFolderDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(value);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the folder');
      setBusy(false);
    }
  };

  return (
    <DialogShell
      title="New folder"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} style={ghostBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
            style={{ ...primaryBtn, opacity: busy || !name.trim() ? 0.6 : 1 }}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        placeholder="Folder name"
        aria-label="Folder name"
        style={{ width: '100%', border, borderRadius: 8, padding: '9px 10px', fontSize: 13.5, color: primary, background: surfaceSolid, outline: 'none' }}
      />
      {err ? <div style={{ fontSize: 12.5, color: danger, marginTop: 8 }}>{err}</div> : null}
    </DialogShell>
  );
}

function RenameDialog({
  file,
  onClose,
  onSubmit,
}: {
  file: ApiDatabankFile;
  onClose: () => void;
  onSubmit: (file: ApiDatabankFile, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(file.fileName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(file, value);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Rename failed');
      setBusy(false);
    }
  };

  return (
    <DialogShell
      title="Rename file"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} style={ghostBtn}>
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy || !name.trim()} style={{ ...primaryBtn, opacity: busy || !name.trim() ? 0.6 : 1 }}>
            {busy ? 'Saving…' : 'Rename'}
          </button>
        </>
      }
    >
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        aria-label="File name"
        style={{ width: '100%', border, borderRadius: 8, padding: '9px 10px', fontSize: 13.5, color: primary, background: surfaceSolid, outline: 'none' }}
      />
      {err ? <div style={{ fontSize: 12.5, color: danger, marginTop: 8 }}>{err}</div> : null}
    </DialogShell>
  );
}

function MoveDialog({
  noun,
  options,
  rootLabel,
  disabledIds,
  onClose,
  onSubmit,
}: {
  noun: string;
  options: FolderOption[];
  rootLabel: string;
  /** Folder ids that can't be a destination (a folder's self + descendants). */
  disabledIds?: Set<string>;
  onClose: () => void;
  onSubmit: (folderId: string | null) => Promise<void>;
}) {
  // '' encodes the databank root (folderId = null).
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(value === '' ? null : value);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Move failed');
      setBusy(false);
    }
  };

  return (
    <DialogShell
      title="Move to…"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} style={ghostBtn}>
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Moving…' : 'Move'}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13, color: muted, marginBottom: 10 }}>Move {noun} to:</div>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Destination folder"
        style={{ width: '100%', border, borderRadius: 8, padding: '9px 10px', fontSize: 13.5, color: primary, background: surfaceSolid, outline: 'none' }}
      >
        <option value="">{rootLabel} (root)</option>
        {options.map((o) => (
          <option key={o.id ?? 'root'} value={o.id ?? ''} disabled={!!o.id && !!disabledIds?.has(o.id)}>
            {`${'   '.repeat(o.depth)}${o.depth ? '↳ ' : ''}${o.label}`}
          </option>
        ))}
      </select>
      {err ? <div style={{ fontSize: 12.5, color: danger, marginTop: 8 }}>{err}</div> : null}
    </DialogShell>
  );
}

function DeleteDialog({
  title,
  body,
  confirmLabel = 'Delete',
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
      setBusy(false);
    }
  };

  return (
    <DialogShell
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} style={ghostBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            style={{ ...primaryBtn, background: danger, borderColor: danger, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, color: primary }}>{body}</div>
      {err ? <div style={{ fontSize: 12.5, color: danger, marginTop: 8 }}>{err}</div> : null}
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Trash view (Databank P3-1) — restore / delete-forever the TOP-LEVEL trashed
// rows in this scope. Reached from the toolbar (write-only, so never shown to a
// read-only viewer). A folder purge removes its whole subtree.
// ---------------------------------------------------------------------------
function TrashDialog({
  api,
  scope,
  onClose,
  reload,
}: {
  api: DatabankApi;
  scope: { clientId: string } | { personal: true };
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<TrashItem | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.fetchTrash(scope));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the trash');
      setItems([]);
    }
  }, [api, scope]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const restore = useCallback(
    async (item: TrashItem) => {
      setBusyId(item.id);
      setError(null);
      try {
        if (item.kind === 'folder') await api.restoreTrashedFolder(item.id);
        else await api.restoreTrashedFile(item.id);
        setItems((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev));
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Restore failed');
      } finally {
        setBusyId(null);
      }
    },
    [api, reload],
  );

  const purge = useCallback(
    async (item: TrashItem) => {
      setBusyId(item.id);
      setError(null);
      try {
        if (item.kind === 'folder') await api.purgeTrashedFolder(item.id);
        else await api.purgeTrashedFile(item.id);
        setItems((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev));
        setConfirm(null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete failed');
      } finally {
        setBusyId(null);
      }
    },
    [api, reload],
  );

  return (
    <DialogShell
      title="Trash"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} style={ghostBtn}>
          Close
        </button>
      }
    >
      {error ? <div style={{ fontSize: 12.5, color: danger, marginBottom: 10 }}>{error}</div> : null}
      {confirm ? (
        <div style={{ border, borderColor: danger, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: primary }}>
            {confirm.kind === 'folder'
              ? `Permanently delete “${confirm.name}”? This removes the whole folder and everything inside it, frees their storage and cannot be undone.`
              : `Permanently delete “${confirm.name}”? This frees its storage and cannot be undone.`}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setConfirm(null)} disabled={busyId === confirm.id} style={ghostBtn}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void purge(confirm)}
              disabled={busyId === confirm.id}
              style={{ ...primaryBtn, background: danger, borderColor: danger, opacity: busyId === confirm.id ? 0.6 : 1 }}
            >
              {busyId === confirm.id ? 'Deleting…' : 'Delete forever'}
            </button>
          </div>
        </div>
      ) : items === null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, fontSize: 13, padding: '20px 4px' }}>
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div style={{ color: muted, fontSize: 13, padding: '28px 4px', textAlign: 'center' }}>Trash is empty.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border, borderRadius: 10, padding: '8px 10px' }}>
              <span style={{ color: item.kind === 'folder' ? accent : muted, flexShrink: 0, display: 'inline-flex' }}>
                {item.kind === 'folder' ? <Folder size={18} /> : <FileGlyph mime={null} size={18} />}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, color: primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
                  {item.name}
                </div>
                <div style={{ fontSize: 11.5, color: muted, marginTop: 2 }}>
                  was in {item.originalParentName ?? 'root'} · deleted {fmtDate(item.deletedAt)}
                  {item.kind === 'file' && item.sizeBytes != null ? ` · ${fmtSize(item.sizeBytes)}` : ''}
                </div>
              </div>
              <button
                type="button"
                title="Restore"
                onClick={() => void restore(item)}
                disabled={busyId === item.id}
                style={{ ...barBtn, opacity: busyId === item.id ? 0.6 : 1 }}
              >
                <RotateCcw size={14} /> Restore
              </button>
              <button
                type="button"
                title="Delete forever"
                onClick={() => setConfirm(item)}
                disabled={busyId === item.id}
                style={{ ...barBtn, color: danger, borderColor: danger, opacity: busyId === item.id ? 0.6 : 1 }}
              >
                <Trash2 size={14} /> Delete forever
              </button>
            </div>
          ))}
        </div>
      )}
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Version history (Databank P3-2) — list a file's versions, upload a new one,
// download / restore / rename / delete older ones. Every WRITE is hidden when
// !canWrite (only Download remains). Mutators send If-Match (the last-read etag);
// a 412 means the history moved under us → notice + refetch; a 409 on delete =
// "that's the current version" (never offered, but surfaced if it happens).
// ---------------------------------------------------------------------------
function VersionsDialog({
  api,
  file,
  canWrite,
  onClose,
  patchFile,
}: {
  api: DatabankApi;
  file: ApiDatabankFile;
  canWrite: boolean;
  onClose: () => void;
  patchFile: (id: string, patch: Partial<ApiDatabankFile>) => void;
}) {
  const [data, setData] = useState<{ etag: string; versions: Version[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Version | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await api.listFileVersions(file.id));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the version history');
    } finally {
      setLoading(false);
    }
  }, [api, file.id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Shared runner for the write actions. A 412 = stale history → notice + refetch;
  // a 409 = "current version" → surface its message; anything else → show it.
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setNotice(null);
      setActionError(null);
      try {
        await fn();
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 412) {
          setNotice('This file’s version history changed — reloading.');
          await refetch();
        } else if (e instanceof ApiClientError && e.status === 409) {
          setActionError(e.message || 'Cannot delete the current version.');
        } else {
          setActionError(e instanceof Error ? e.message : 'Action failed');
        }
      } finally {
        setBusy(false);
      }
    },
    [refetch],
  );

  // Current + synthetic-v1 download via the file's own signed URL (those bytes ARE
  // the current file); any materialised older version via its own signed URL.
  const downloadVersion = useCallback(
    (v: Version) =>
      run(async () => {
        const res =
          v.id === null || v.isCurrent ? await api.signedUrl(file.id) : await api.versionSignedUrl(file.id, v.id);
        window.open(res.url, '_blank', 'noopener');
      }),
    [api, file.id, run],
  );

  const doUploadVersion = useCallback(
    (f: File) =>
      run(async () => {
        setPct(0);
        try {
          const updated = await api.uploadFileVersion(file.id, f, (frac) => setPct(Math.round(frac * 100)));
          patchFile(file.id, updated);
          await refetch();
        } finally {
          setPct(null);
        }
      }),
    [api, file.id, patchFile, refetch, run],
  );

  const restoreVersion = useCallback(
    (v: Version) =>
      run(async () => {
        if (!data || v.id === null) return;
        const updated = await api.restoreFileVersion(file.id, v.id, data.etag);
        patchFile(file.id, updated);
        await refetch();
      }),
    [api, data, file.id, patchFile, refetch, run],
  );

  const saveRename = useCallback(
    (v: Version, name: string) =>
      run(async () => {
        if (!data || v.id === null || !name) return;
        const res = await api.renameFileVersion(file.id, v.id, name, data.etag);
        setData(res);
        setRenameId(null);
      }),
    [api, data, file.id, run],
  );

  const deleteVersion = useCallback(
    (v: Version) =>
      run(async () => {
        if (!data || v.id === null) return;
        await api.deleteFileVersion(file.id, v.id, data.etag);
        setConfirmDelete(null);
        await refetch();
      }),
    [api, data, file.id, refetch, run],
  );

  return (
    <DialogShell
      title={`Versions — ${file.fileName}`}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} style={ghostBtn}>
          Close
        </button>
      }
    >
      {canWrite ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            disabled={busy}
            style={{ ...toolbarBtn(true), opacity: busy ? 0.6 : 1 }}
          >
            <Upload size={15} /> Upload new version
          </button>
          <input
            ref={uploadRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doUploadVersion(f);
              e.target.value = '';
            }}
          />
          {pct !== null ? (
            <div style={{ height: 4, borderRadius: 999, background: 'var(--sos-border, rgba(148,163,184,0.25))', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: accent, transition: 'width 0.2s' }} />
            </div>
          ) : null}
        </div>
      ) : null}

      {notice ? <div style={{ fontSize: 12.5, color: muted, marginBottom: 10 }}>{notice}</div> : null}
      {actionError ? <div style={{ fontSize: 12.5, color: danger, marginBottom: 10 }}>{actionError}</div> : null}

      {confirmDelete ? (
        <div style={{ border, borderColor: danger, borderRadius: 10, padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: primary }}>
            Permanently delete version v{confirmDelete.versionNumber}? Its bytes are freed and it can’t be recovered.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setConfirmDelete(null)} disabled={busy} style={ghostBtn}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void deleteVersion(confirmDelete)}
              disabled={busy}
              style={{ ...primaryBtn, background: danger, borderColor: danger, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Deleting…' : 'Delete version'}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, fontSize: 13, padding: '20px 4px' }}>
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : loadError ? (
        <div style={{ color: danger, fontSize: 13, padding: '12px 4px' }}>{loadError}</div>
      ) : !data || data.versions.length === 0 ? (
        <div style={{ color: muted, fontSize: 13, padding: '20px 4px', textAlign: 'center' }}>No versions yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.versions.map((v) => {
            const materialised = v.id !== null;
            const actionable = canWrite && materialised && !v.isCurrent;
            const isRenaming = renameId !== null && renameId === v.id;
            return (
              <div key={v.id ?? `current-${v.versionNumber}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, border, borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: primary }}>v{v.versionNumber}</span>
                    {v.isCurrent ? (
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: 0.3,
                          textTransform: 'uppercase',
                          color: accent,
                          background: accentSoft,
                          border,
                          borderColor: accent,
                          borderRadius: 999,
                          padding: '1px 8px',
                        }}
                      >
                        Current
                      </span>
                    ) : null}
                    {v.name && !isRenaming ? <span style={{ fontSize: 12.5, color: muted }}>“{v.name}”</span> : null}
                  </div>
                  {isRenaming ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveRename(v, renameValue.trim());
                          if (e.key === 'Escape') setRenameId(null);
                        }}
                        placeholder="Version label"
                        aria-label="Version label"
                        style={{ flex: 1, minWidth: 0, border, borderRadius: 6, padding: '4px 8px', fontSize: 12.5, background: surfaceSolid, color: primary, outline: 'none' }}
                      />
                      <button type="button" onClick={() => void saveRename(v, renameValue.trim())} disabled={busy || !renameValue.trim()} style={{ ...barBtn, opacity: busy || !renameValue.trim() ? 0.6 : 1 }}>
                        Save
                      </button>
                      <button type="button" onClick={() => setRenameId(null)} style={barBtn}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, color: muted, marginTop: 2 }}>
                      {v.fileSizeBytes == null ? '—' : fmtSize(v.fileSizeBytes)} · {fmtDate(v.createdAt)}
                    </div>
                  )}
                </div>
                {!isRenaming ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button type="button" title="Download" onClick={() => void downloadVersion(v)} disabled={busy} style={iconBtn}>
                      <Download size={14} />
                    </button>
                    {actionable ? (
                      <>
                        <button type="button" title="Restore this version" onClick={() => void restoreVersion(v)} disabled={busy} style={iconBtn}>
                          <RotateCcw size={14} />
                        </button>
                        <button
                          type="button"
                          title="Rename"
                          onClick={() => {
                            setRenameId(v.id);
                            setRenameValue(v.name ?? '');
                          }}
                          disabled={busy}
                          style={iconBtn}
                        >
                          <Pencil size={14} />
                        </button>
                        <button type="button" title="Delete version" onClick={() => setConfirmDelete(v)} disabled={busy} style={{ ...iconBtn, color: danger }}>
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------
function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (e: unknown) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !checked && indeterminate;
  }, [checked, indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={ariaLabel}
      style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#b8860b' }}
    />
  );
}

function crumbBtn(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '3px 6px',
    borderRadius: 7,
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    color: active ? 'var(--sos-text-primary, #0f172a)' : 'var(--sos-text-muted, #64748b)',
  };
}

/** Toolbar button — filled = the primary "Upload files" action. */
function toolbarBtn(filled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    padding: '7px 12px',
    borderRadius: 9,
    cursor: 'pointer',
    border,
    background: filled ? accent : surfaceSolid,
    color: filled ? '#fff' : primary,
    borderColor: filled ? accent : undefined,
  };
}

/** A type-facet toggle chip. Active = the bucket is included in the search. */
function chipStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    border,
    borderColor: active ? accent : undefined,
    borderRadius: 999,
    padding: '4px 11px',
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    color: active ? primary : muted,
    background: active ? accentSoft : 'transparent',
  };
}

const barBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border,
  borderRadius: 8,
  background: surfaceSolid,
  color: primary,
  cursor: 'pointer',
  fontSize: 12.5,
  fontWeight: 600,
  padding: '6px 12px',
};

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: accent,
  fontSize: 12.5,
  fontWeight: 600,
  padding: 0,
};

/** Compact square icon button (per-version row actions in the Versions dialog). */
const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border,
  borderRadius: 8,
  background: surfaceSolid,
  color: primary,
  cursor: 'pointer',
  padding: '6px 8px',
};

const primaryBtn: React.CSSProperties = {
  border: `1px solid ${accent}`,
  borderRadius: 8,
  background: accent,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 16px',
};

const ghostBtn: React.CSSProperties = {
  border,
  borderRadius: 8,
  background: 'transparent',
  color: primary,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 16px',
};

const tagChip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: 11.5,
  color: primary,
  background: accentSoft,
  border,
  borderRadius: 999,
  padding: '2px 9px',
};

export default DatabankExplorerV2;
