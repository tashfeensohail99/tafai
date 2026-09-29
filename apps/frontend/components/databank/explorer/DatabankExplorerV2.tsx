'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist';
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
} from 'lucide-react';
import type { ApiDatabankFolder, ApiDatabankFile, DatabankSearchFacets } from '@/lib/processing';
import { processingDatabankApi, type DatabankApi } from '@/lib/databank-api';
import { formatBytes as fmtSize } from '@/lib/databank-upload/summary';

/**
 * Databank explorer, rebuilt (Databank Phase 2, PR-2) — behind
 * NEXT_PUBLIC_DATABANK_EXPLORER_V2. A LEFT folder tree (react-arborist:
 * expand/collapse, inline rename, drag-to-move) plus a MAIN pane with
 * breadcrumbs and a basic file list for the selected folder.
 *
 * Same props and the same portal-agnostic `DatabankApi` as the legacy
 * DatabankTab, so Processing and JR both pick it up unchanged. This is the
 * deliberately-basic first cut — PR-3 replaces the file list with a TanStack
 * table + the search endpoint + context menu + bulk actions + a details panel.
 */

// Match the legacy tab's palette (CSS vars, with light-mode fallbacks).
const border = '1px solid var(--sos-border, rgba(148,163,184,0.25))';
const muted = 'var(--sos-text-muted, #64748b)';
const primary = 'var(--sos-text-primary, #0f172a)';
const surface = 'var(--sos-surface, rgba(255,255,255,0.6))';
const accent = 'var(--sos-accent, #b8860b)';
const accentSoft = 'var(--sos-accent-soft, rgba(184,134,11,0.10))';

function FileGlyph({ mime }: { mime: string | null }) {
  if (mime && /pdf/i.test(mime)) return <FileText size={20} />;
  if (mime && /^image\//i.test(mime)) return <ImageIcon size={20} />;
  return <FileIcon size={20} />;
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

/** Nested tree node built from the flat folder list. */
type FolderNode = { id: string; name: string; children: FolderNode[] };

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

  // react-arborist (react-dnd) touches the DOM on mount — only render the Tree
  // in the browser so SSR / static prerender never trips over it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Scope-aware load — a client's databank or the caller's own personal area.
  const load = useCallback(
    () => (personal ? api.fetchPersonalTree() : api.fetchTree(clientId!)),
    [api, personal, clientId],
  );
  // Only the latest load applies (a stale scope's reply is dropped).
  const loadSeq = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const tree = await load();
      if (seq !== loadSeq.current) return;
      setFolders(tree.folders);
      setFiles(tree.files);
      setCanWrite(tree.canWrite !== false);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : 'Could not load the databank');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    setSelectedFolderId(null);
    void reload();
  }, [reload]);

  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

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
                background: 'var(--sos-surface-solid, #fff)',
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
      );
    },
    [selectedFolderId, readOnly],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error ? (
        <div
          style={{
            fontSize: 13,
            color: 'var(--sos-danger, #dc2626)',
            border,
            borderColor: 'var(--sos-danger, #dc2626)',
            borderRadius: 10,
            padding: '8px 12px',
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', minHeight: 460 }}>
        {/* LEFT — folder tree */}
        <div
          style={{
            width: 280,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            border,
            borderRadius: 12,
            background: surface,
            overflow: 'hidden',
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

        {/* MAIN — search + breadcrumbs + file list (or search results) */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                  background: 'var(--sos-surface-solid, #fff)',
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

          {/* PR-3b: this basic list (folder view AND search results) still needs
              the TanStack table (sort/columns) + a right-click context menu +
              multi-select bulk actions + a file-details side panel — those
              replace this list in a follow-up. */}
          <div style={{ border, borderRadius: 12, background: surface, minHeight: 300, padding: 6 }}>
            {isSearching ? (
              searchError ? (
                <div style={{ color: 'var(--sos-danger, #dc2626)', fontSize: 13, padding: '32px 12px', textAlign: 'center' }}>
                  {searchError}
                </div>
              ) : searchLoading && searchResults.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, fontSize: 13, padding: 16 }}>
                  <Loader2 size={14} className="animate-spin" /> Searching…
                </div>
              ) : searchResults.length === 0 ? (
                <div style={{ color: muted, fontSize: 13, padding: '32px 12px', textAlign: 'center' }}>
                  No files match your search.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {searchResults.map((file) => (
                    <div
                      key={file.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, minWidth: 0 }}
                    >
                      <span style={{ color: muted, flexShrink: 0 }}>
                        <FileGlyph mime={file.mimeType} />
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{ fontSize: 13.5, color: primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={file.fileName}
                        >
                          {file.fileName}
                        </div>
                        <div
                          style={{ fontSize: 11.5, color: muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={folderPathOf(file.folderId)}
                        >
                          {folderPathOf(file.folderId)}
                          {file.fileSizeBytes == null ? '' : ` · ${fmtSize(file.fileSizeBytes)}`}
                        </div>
                      </div>
                      <button
                        type="button"
                        title="Download"
                        onClick={() => void download(file)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, padding: 6, borderRadius: 7, display: 'inline-flex', flexShrink: 0 }}
                      >
                        <Download size={15} />
                      </button>
                    </div>
                  ))}
                  {searchResults.length < searchTotal ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
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
              )
            ) : loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, fontSize: 13, padding: 16 }}>
                <Loader2 size={14} className="animate-spin" /> Loading databank…
              </div>
            ) : currentFiles.length === 0 ? (
              <div style={{ color: muted, fontSize: 13, padding: '32px 12px', textAlign: 'center' }}>
                No files in this folder.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {currentFiles.map((file) => (
                  <div
                    key={file.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 10px',
                      borderRadius: 8,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ color: muted, flexShrink: 0 }}>
                      <FileGlyph mime={file.mimeType} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{ fontSize: 13.5, color: primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={file.fileName}
                      >
                        {file.fileName}
                      </div>
                      <div style={{ fontSize: 11.5, color: muted, marginTop: 2 }}>
                        {file.fileSizeBytes == null ? '' : fmtSize(file.fileSizeBytes)}
                      </div>
                    </div>
                    <button
                      type="button"
                      title="Download"
                      onClick={() => void download(file)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: muted,
                        padding: 6,
                        borderRadius: 7,
                        display: 'inline-flex',
                        flexShrink: 0,
                      }}
                    >
                      <Download size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
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

export default DatabankExplorerV2;
