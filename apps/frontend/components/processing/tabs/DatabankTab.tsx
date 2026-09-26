'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder,
  FolderPlus,
  FolderUp,
  Upload,
  Download,
  Trash2,
  Pencil,
  Copy,
  FolderInput,
  ChevronRight,
  X,
  Loader2,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  Home,
} from 'lucide-react';
import {
  fetchDatabankTree,
  createDatabankFolder,
  fetchPersonalDatabankTree,
  createPersonalDatabankFolder,
  uploadPersonalDatabankFile,
  renameDatabankFolder,
  moveDatabankFolder,
  deleteDatabankFolder,
  uploadDatabankFile,
  getDatabankFileSignedUrl,
  renameDatabankFile,
  moveDatabankFile,
  copyDatabankFile,
  deleteDatabankFile,
  type ApiDatabankFolder,
  type ApiDatabankFile,
} from '@/lib/processing';

/** Per-file upload cap — mirrors the backend Multer limit. A single file over
 *  this (e.g. a big .zip) is rejected by the server, so we skip it up front with
 *  a clear message instead of a failed request. */
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const fmtMB = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/** One file picked for a folder upload, carrying its path relative to the
 *  dropped/selected folder (e.g. "Passport/scan.pdf") so we can recreate the
 *  subfolder tree. */
type FolderEntry = { file: File; relPath: string };

/** Recursively walk a drag-and-dropped FileSystemEntry into FolderEntry[],
 *  preserving the relative path. `webkitGetAsEntry()` is the only cross-browser
 *  way to read a dropped DIRECTORY (dataTransfer.files is empty for folders).
 *  Typed loosely — the File System (Entries) API isn't in lib.dom. */
async function walkEntry(entry: any, prefix: string, out: FolderEntry[]): Promise<void> {
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

/**
 * The per-client Databank — a Drive-like document repository. Folder tree via
 * breadcrumb navigation, file grid, upload (button + drag-drop + clipboard
 * paste), new-folder / rename / move / copy / delete, and inline preview.
 *
 * Access is enforced server-side (manager sees all; officer sees clients they
 * have an assigned case for) — this component just calls the API for whatever
 * client the case belongs to.
 */

const border = '1px solid var(--sos-border, rgba(148,163,184,0.25))';
const muted = 'var(--sos-text-muted, #64748b)';
const primary = 'var(--sos-text-primary, #0f172a)';
const surface = 'var(--sos-surface, rgba(255,255,255,0.6))';
const accent = 'var(--sos-accent, #b8860b)';

function formatBytes(n: number | null): string {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FileGlyph({ mime }: { mime: string | null }) {
  if (mime && /pdf/i.test(mime)) return <FileText size={22} />;
  if (mime && /^image\//i.test(mime)) return <ImageIcon size={22} />;
  return <FileIcon size={22} />;
}

const isPdf = (m: string | null) => !!m && /pdf/i.test(m);
const isImage = (m: string | null) => !!m && /^image\//i.test(m);

/**
 * The databank file explorer. Two scopes:
 *  - a client's databank: pass `clientId`.
 *  - the caller's OWN personal area (their private folders): pass `personal`.
 * Folder/file rename/move/copy/delete/download are id-based, so they work the
 * same in either scope; only the tree fetch, folder-create and upload differ.
 */
export function DatabankTab({
  clientId,
  personal,
  rootLabel = 'Databank',
}: {
  clientId?: string;
  clientName?: string;
  personal?: boolean;
  rootLabel?: string;
}) {
  const [folders, setFolders] = useState<ApiDatabankFolder[]>([]);
  const [files, setFiles] = useState<ApiDatabankFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'file' | 'folder'; id: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null);
  const [preview, setPreview] = useState<{ file: ApiDatabankFile; url: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // Read-only when the client is assigned to another officer: the whole team
  // can view/download any client's databank, but only the assigned officer (or
  // a manager) may modify it. The backend enforces this; here we just hide the
  // controls. Default writable until the tree tells us otherwise.
  const [canWrite, setCanWrite] = useState(true);
  const readOnly = !canWrite;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // Scope-aware API calls — a client databank or the caller's own personal
  // area. Everything else (rename/move/copy/delete/download) is id-based and
  // identical across scopes.
  const loadTree = useCallback(
    () => (personal ? fetchPersonalDatabankTree() : fetchDatabankTree(clientId!)),
    [personal, clientId],
  );
  const makeFolder = useCallback(
    (name: string, parent: string | null) =>
      personal ? createPersonalDatabankFolder(name, parent) : createDatabankFolder(clientId!, name, parent),
    [personal, clientId],
  );
  const putFile = useCallback(
    (file: File, folder: string | null, src: 'UPLOAD' | 'CLIPBOARD') =>
      personal
        ? uploadPersonalDatabankFile(file, folder, src)
        : uploadDatabankFile(clientId!, file, folder, src),
    [personal, clientId],
  );

  const reload = useCallback(async () => {
    setError(null);
    try {
      const tree = await loadTree();
      setFolders(tree.folders);
      setFiles(tree.files);
      setCanWrite(tree.canWrite !== false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the databank');
    } finally {
      setLoading(false);
    }
  }, [loadTree]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  // Breadcrumb: walk up from the current folder to the root.
  const breadcrumb = useMemo(() => {
    const path: ApiDatabankFolder[] = [];
    let cursor = currentFolderId;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const f = folderById.get(cursor);
      if (!f) break;
      path.unshift(f);
      cursor = f.parentFolderId;
    }
    return path;
  }, [currentFolderId, folderById]);

  const childFolders = useMemo(
    () => folders.filter((f) => f.parentFolderId === currentFolderId).sort((a, b) => a.name.localeCompare(b.name)),
    [folders, currentFolderId],
  );
  const childFiles = useMemo(
    () => files.filter((f) => f.folderId === currentFolderId),
    [files, currentFolderId],
  );

  // ---- Uploads (button, drag-drop, clipboard paste) ----
  const doUpload = useCallback(
    async (list: FileList | File[], source: 'UPLOAD' | 'CLIPBOARD') => {
      if (readOnly) return;
      const arr = Array.from(list);
      if (arr.length === 0) return;
      const ok = arr.filter((f) => f.size <= MAX_FILE_BYTES);
      const tooBig = arr.filter((f) => f.size > MAX_FILE_BYTES);
      setBusy(true);
      setError(null);
      try {
        for (const f of ok) {
          // eslint-disable-next-line no-await-in-loop
          await putFile(f, currentFolderId, source);
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
      }
    },
    [putFile, currentFolderId, reload, readOnly],
  );

  // Upload a whole folder (from the "Upload folder" button or a dropped
  // directory), recreating its subfolder tree under the current folder.
  const doUploadFolder = useCallback(
    async (entries: FolderEntry[]) => {
      if (readOnly || entries.length === 0) return;
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
          const parentId = parentPath ? pathToId.get(parentPath) ?? currentFolderId : currentFolderId;
          const name = segs[segs.length - 1];
          // eslint-disable-next-line no-await-in-loop
          const created = await makeFolder(name, parentId);
          pathToId.set(d, created.id);
        }
        // 3. Upload each file into the folder its path resolves to.
        for (const { file, relPath } of ok) {
          const parts = relPath.split('/');
          parts.pop();
          const dirPath = parts.join('/');
          const target = dirPath ? pathToId.get(dirPath) ?? currentFolderId : currentFolderId;
          // eslint-disable-next-line no-await-in-loop
          await putFile(file, target, 'UPLOAD');
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
      }
    },
    [makeFolder, putFile, currentFolderId, reload, readOnly],
  );

  // Clipboard paste of an image while the tab is mounted.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (imgs.length) {
        e.preventDefault();
        void doUpload(imgs, 'CLIPBOARD');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [doUpload]);

  // ---- Folder / file operations ----
  const submitNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name || readOnly) return;
    setBusy(true);
    try {
      await makeFolder(name, currentFolderId);
      setNewFolderName('');
      setCreatingFolder(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the folder');
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async (kind: 'file' | 'folder', id: string) => {
    const value = renameValue.trim();
    if (!value || readOnly) return;
    setBusy(true);
    try {
      if (kind === 'folder') await renameDatabankFolder(id, value);
      else await renameDatabankFile(id, value);
      setRenamingId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete || readOnly) return;
    setBusy(true);
    try {
      if (confirmDelete.kind === 'folder') await deleteDatabankFolder(confirmDelete.id);
      else await deleteDatabankFile(confirmDelete.id);
      setConfirmDelete(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const doMove = async (destFolderId: string | null) => {
    if (!moveTarget || readOnly) return;
    setBusy(true);
    try {
      if (moveTarget.kind === 'folder') await moveDatabankFolder(moveTarget.id, destFolderId);
      else await moveDatabankFile(moveTarget.id, destFolderId);
      setMoveTarget(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed');
    } finally {
      setBusy(false);
    }
  };

  const duplicateHere = async (file: ApiDatabankFile) => {
    if (readOnly) return;
    setBusy(true);
    try {
      await copyDatabankFile(file.id, { targetFolderId: currentFolderId });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Copy failed');
    } finally {
      setBusy(false);
    }
  };

  const openPreview = async (file: ApiDatabankFile) => {
    setPreviewLoading(true);
    try {
      const { url } = await getDatabankFileSignedUrl(file.id);
      setPreview({ file, url });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the file');
    } finally {
      setPreviewLoading(false);
    }
  };

  const download = async (file: ApiDatabankFile) => {
    try {
      const { url } = await getDatabankFileSignedUrl(file.id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download the file');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted, padding: '24px 0' }}>
        <Loader2 size={16} className="animate-spin" /> Loading databank…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Toolbar: breadcrumb + actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: muted, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setCurrentFolderId(null)} style={crumbBtn(currentFolderId === null)}>
            <Home size={14} /> {rootLabel}
          </button>
          {breadcrumb.map((f) => (
            <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ChevronRight size={13} style={{ opacity: 0.5 }} />
              <button type="button" onClick={() => setCurrentFolderId(f.id)} style={crumbBtn(currentFolderId === f.id)}>
                {f.name}
              </button>
            </span>
          ))}
        </div>
        {readOnly ? (
          <span
            title="This client is assigned to another officer — you can view and download, but not edit."
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: muted, border, borderRadius: 999, padding: '5px 12px', whiteSpace: 'nowrap' }}
          >
            View only — assigned to another officer
          </span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setCreatingFolder((v) => !v)} disabled={busy} style={btn(false)}>
              <FolderPlus size={15} /> New folder
            </button>
            <button type="button" onClick={() => folderInputRef.current?.click()} disabled={busy} style={btn(false)}>
              <FolderUp size={15} /> Upload folder
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} style={btn(true)}>
              <Upload size={15} /> Upload
            </button>
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
        )}
      </div>

      {creatingFolder ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewFolder();
              if (e.key === 'Escape') setCreatingFolder(false);
            }}
            placeholder="Folder name"
            style={input}
          />
          <button type="button" onClick={() => void submitNewFolder()} disabled={busy} style={btn(true)}>
            Create
          </button>
          <button type="button" onClick={() => setCreatingFolder(false)} style={btn(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      {error ? (
        <div style={{ fontSize: 13, color: 'var(--sos-danger, #dc2626)', border, borderColor: 'var(--sos-danger, #dc2626)', borderRadius: 10, padding: '8px 12px' }}>
          {error}
        </div>
      ) : null}

      {/* Drop zone + grid */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (readOnly) return;
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
        }}
        style={{
          border: dragActive ? `2px dashed ${accent}` : `2px dashed transparent`,
          borderRadius: 14,
          transition: 'border-color 0.15s',
          minHeight: 160,
          background: dragActive ? 'var(--sos-accent-soft, rgba(184,134,11,0.06))' : 'transparent',
          padding: dragActive ? 6 : 0,
        }}
      >
        {childFolders.length === 0 && childFiles.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '40px 0', color: muted, textAlign: 'center' }}>
            <Upload size={22} />
            <div style={{ fontSize: 14 }}>This folder is empty.</div>
            {!readOnly ? (
              <div style={{ fontSize: 12.5 }}>
                Drag files or a whole folder here, use Upload / Upload folder, or paste a screenshot.
                <br />Up to {fmtMB(MAX_FILE_BYTES)} per file.
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
            {childFolders.map((f) => (
              <div key={f.id} style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Folder size={22} style={{ color: accent, flexShrink: 0 }} />
                  {renamingId === f.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitRename('folder', f.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      style={{ ...input, padding: '4px 8px', fontSize: 13 }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCurrentFolderId(f.id)}
                      title={f.name}
                      style={{ ...linkText, fontWeight: 600 }}
                    >
                      {f.name}
                    </button>
                  )}
                </div>
                {!readOnly ? (
                  <RowActions
                    onRename={() => {
                      setRenamingId(f.id);
                      setRenameValue(f.name);
                    }}
                    onMove={() => setMoveTarget({ kind: 'folder', id: f.id, name: f.name })}
                    onDelete={() => setConfirmDelete({ kind: 'folder', id: f.id })}
                  />
                ) : null}
              </div>
            ))}

            {childFiles.map((file) => (
              <div key={file.id} style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ color: muted, flexShrink: 0 }}>
                    <FileGlyph mime={file.mimeType} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    {renamingId === file.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void submitRename('file', file.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        style={{ ...input, padding: '4px 8px', fontSize: 13 }}
                      />
                    ) : (
                      <button type="button" onClick={() => void openPreview(file)} title={file.fileName} style={linkText}>
                        {file.fileName}
                      </button>
                    )}
                    <div style={{ fontSize: 11.5, color: muted, marginTop: 2 }}>
                      {formatBytes(file.fileSizeBytes)}
                      {file.source === 'CLIPBOARD' ? ' · pasted' : file.source === 'COPIED' ? ' · copy' : ''}
                    </div>
                  </div>
                </div>
                <RowActions
                  onOpen={() => void openPreview(file)}
                  onDownload={() => void download(file)}
                  onRename={readOnly ? undefined : () => {
                    setRenamingId(file.id);
                    setRenameValue(file.fileName);
                  }}
                  onCopy={readOnly ? undefined : () => void duplicateHere(file)}
                  onMove={readOnly ? undefined : () => setMoveTarget({ kind: 'file', id: file.id, name: file.fileName })}
                  onDelete={readOnly ? undefined : () => setConfirmDelete({ kind: 'file', id: file.id })}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {busy ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: muted }}>
          <Loader2 size={13} className="animate-spin" /> Working…
        </div>
      ) : null}

      {/* Delete confirm */}
      {confirmDelete ? (
        <Overlay onClose={() => setConfirmDelete(null)}>
          <div style={{ fontWeight: 600, color: primary, marginBottom: 8 }}>
            {confirmDelete.kind === 'folder' ? 'Delete this folder?' : 'Delete this file?'}
          </div>
          <div style={{ fontSize: 13, color: muted, marginBottom: 16 }}>
            {confirmDelete.kind === 'folder'
              ? 'Everything inside the folder is removed too. This can be restored by an admin.'
              : 'The file is removed from the databank. This can be restored by an admin.'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={() => setConfirmDelete(null)} style={btn(false)}>
              Cancel
            </button>
            <button type="button" onClick={() => void doDelete()} disabled={busy} style={dangerBtn}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </Overlay>
      ) : null}

      {/* Move picker */}
      {moveTarget ? (
        <Overlay onClose={() => setMoveTarget(null)}>
          <div style={{ fontWeight: 600, color: primary, marginBottom: 4 }}>Move “{moveTarget.name}” to…</div>
          <div style={{ fontSize: 12.5, color: muted, marginBottom: 12 }}>Pick a destination folder.</div>
          <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button type="button" onClick={() => void doMove(null)} style={pickRow}>
              <Home size={15} /> Databank (root)
            </button>
            {folders
              // Can't move a folder into itself (its own children are still
              // shown; the server rejects a true cycle as a safety net).
              .filter((f) => !(moveTarget.kind === 'folder' && f.id === moveTarget.id))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((f) => (
                <button key={f.id} type="button" onClick={() => void doMove(f.id)} style={pickRow}>
                  <Folder size={15} style={{ color: accent }} /> {f.name}
                </button>
              ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" onClick={() => setMoveTarget(null)} style={btn(false)}>
              Cancel
            </button>
          </div>
        </Overlay>
      ) : null}

      {/* Preview */}
      {previewLoading ? (
        <Overlay onClose={() => setPreviewLoading(false)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: muted }}>
            <Loader2 size={16} className="animate-spin" /> Opening…
          </div>
        </Overlay>
      ) : null}
      {preview ? (
        <Overlay wide onClose={() => setPreview(null)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, color: primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {preview.file.fileName}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => void download(preview.file)} style={btn(false)}>
                <Download size={14} /> Download
              </button>
              <button type="button" onClick={() => setPreview(null)} style={btn(false)}>
                <X size={14} />
              </button>
            </div>
          </div>
          <div style={{ height: '70vh', background: '#fff', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isPdf(preview.file.mimeType) ? (
              <iframe title="preview" src={preview.url} style={{ width: '100%', height: '100%', border: 'none' }} />
            ) : isImage(preview.file.mimeType) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.file.fileName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : (
              <div style={{ textAlign: 'center', color: muted, padding: 24 }}>
                <FileIcon size={30} />
                <div style={{ marginTop: 8, fontSize: 13 }}>Preview isn’t available for this file type.</div>
                <button type="button" onClick={() => void download(preview.file)} style={{ ...btn(true), marginTop: 12 }}>
                  <Download size={14} /> Download to open
                </button>
              </div>
            )}
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}

// ---- Small presentational helpers -----------------------------------------

function RowActions(props: {
  onOpen?: () => void;
  onDownload?: () => void;
  onRename?: () => void;
  onCopy?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
}) {
  const item = (title: string, onClick: (() => void) | undefined, icon: React.ReactNode) =>
    onClick ? (
      <button type="button" title={title} onClick={onClick} style={iconBtn}>
        {icon}
      </button>
    ) : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 8, flexWrap: 'wrap' }}>
      {item('Download', props.onDownload, <Download size={14} />)}
      {item('Rename', props.onRename, <Pencil size={14} />)}
      {item('Duplicate', props.onCopy, <Copy size={14} />)}
      {item('Move', props.onMove, <FolderInput size={14} />)}
      {item('Delete', props.onDelete, <Trash2 size={14} />)}
    </div>
  );
}

function Overlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--sos-surface-solid, #ffffff)',
          color: primary,
          border,
          borderRadius: 14,
          padding: 18,
          width: '100%',
          maxWidth: wide ? 900 : 420,
          boxShadow: '0 24px 60px -24px rgba(15,23,42,0.4)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  border,
  borderRadius: 12,
  padding: 12,
  background: surface,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
};

const linkText: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: primary,
  fontSize: 13.5,
  textAlign: 'left',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
  display: 'block',
};

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--sos-text-muted, #64748b)',
  padding: 5,
  borderRadius: 7,
  display: 'inline-flex',
};

const input: React.CSSProperties = {
  border,
  borderRadius: 9,
  padding: '8px 12px',
  fontSize: 13.5,
  background: 'var(--sos-surface-solid, #fff)',
  color: 'var(--sos-text-primary, #0f172a)',
  outline: 'none',
  minWidth: 200,
};

const pickRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '9px 10px',
  borderRadius: 8,
  fontSize: 13.5,
  color: 'var(--sos-text-primary, #0f172a)',
};

function btn(filled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 12px',
    borderRadius: 9,
    cursor: 'pointer',
    border,
    background: filled ? 'var(--sos-accent, #b8860b)' : 'transparent',
    color: filled ? '#fff' : 'var(--sos-text-primary, #0f172a)',
    borderColor: filled ? 'var(--sos-accent, #b8860b)' : undefined,
  };
}

const dangerBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 12px',
  borderRadius: 9,
  cursor: 'pointer',
  border: '1px solid var(--sos-danger, #dc2626)',
  background: 'var(--sos-danger, #dc2626)',
  color: '#fff',
};

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
