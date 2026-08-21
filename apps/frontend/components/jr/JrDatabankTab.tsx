'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder,
  FolderPlus,
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
  fetchJrDatabankTree,
  createJrDatabankFolder,
  renameJrDatabankFolder,
  moveJrDatabankFolder,
  deleteJrDatabankFolder,
  uploadJrDatabankFile,
  jrDatabankFileSignedUrl,
  renameJrDatabankFile,
  moveJrDatabankFile,
  copyJrDatabankFile,
  deleteJrDatabankFile,
  type ApiDatabankFolder,
  type ApiDatabankFile,
} from '@/lib/jr-databank';

/**
 * The per-client Databank — a Drive-like document repository. Folder tree via
 * breadcrumb navigation, file grid, upload (button + drag-drop + clipboard
 * paste), new-folder / rename / move / copy / delete, and inline preview.
 *
 * This is the JR view onto the SAME shared per-client store the Processing team
 * uses (an escalated client's application docs surface for the JR associate).
 * Access is enforced server-side — this component just calls the API for
 * whatever client the matter belongs to.
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

export function JrDatabankTab({ clientId }: { clientId: string; clientName?: string }) {
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const tree = await fetchJrDatabankTree(clientId);
      setFolders(tree.folders);
      setFiles(tree.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the databank');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

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
      const arr = Array.from(list);
      if (arr.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        for (const f of arr) {
          // eslint-disable-next-line no-await-in-loop
          await uploadJrDatabankFile(clientId, f, currentFolderId, source);
        }
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [clientId, currentFolderId, reload],
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
    if (!name) return;
    setBusy(true);
    try {
      await createJrDatabankFolder(clientId, name, currentFolderId);
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
    if (!value) return;
    setBusy(true);
    try {
      if (kind === 'folder') await renameJrDatabankFolder(id, value);
      else await renameJrDatabankFile(id, value);
      setRenamingId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      if (confirmDelete.kind === 'folder') await deleteJrDatabankFolder(confirmDelete.id);
      else await deleteJrDatabankFile(confirmDelete.id);
      setConfirmDelete(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const doMove = async (destFolderId: string | null) => {
    if (!moveTarget) return;
    setBusy(true);
    try {
      if (moveTarget.kind === 'folder') await moveJrDatabankFolder(moveTarget.id, destFolderId);
      else await moveJrDatabankFile(moveTarget.id, destFolderId);
      setMoveTarget(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed');
    } finally {
      setBusy(false);
    }
  };

  const duplicateHere = async (file: ApiDatabankFile) => {
    setBusy(true);
    try {
      await copyJrDatabankFile(file.id, { targetFolderId: currentFolderId });
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
      const { url } = await jrDatabankFileSignedUrl(file.id);
      setPreview({ file, url });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the file');
    } finally {
      setPreviewLoading(false);
    }
  };

  const download = async (file: ApiDatabankFile) => {
    try {
      const { url } = await jrDatabankFileSignedUrl(file.id);
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
            <Home size={14} /> Databank
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => setCreatingFolder((v) => !v)} disabled={busy} style={btn(false)}>
            <FolderPlus size={15} /> New folder
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
        </div>
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
          if (e.dataTransfer.files) void doUpload(e.dataTransfer.files, 'UPLOAD');
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
            <div style={{ fontSize: 12.5 }}>Drag files here, click Upload, or paste a screenshot.</div>
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
                <RowActions
                  onRename={() => {
                    setRenamingId(f.id);
                    setRenameValue(f.name);
                  }}
                  onMove={() => setMoveTarget({ kind: 'folder', id: f.id, name: f.name })}
                  onDelete={() => setConfirmDelete({ kind: 'folder', id: f.id })}
                />
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
                  onRename={() => {
                    setRenamingId(file.id);
                    setRenameValue(file.fileName);
                  }}
                  onCopy={() => void duplicateHere(file)}
                  onMove={() => setMoveTarget({ kind: 'file', id: file.id, name: file.fileName })}
                  onDelete={() => setConfirmDelete({ kind: 'file', id: file.id })}
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
