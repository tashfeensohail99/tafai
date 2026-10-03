'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Upload, FolderUp, X, Loader2 } from 'lucide-react';
import { fetchOpenUploads, type OpenUpload } from '@/lib/databank-api';
import { useSession } from '@/lib/session';
import type { UploadDest } from '@/lib/databank-upload-browser';

/**
 * "Resume your interrupted uploads" banner (Databank Phase 1, resumable).
 *
 * A browser cannot keep File handles across a page reload, so after a refresh the
 * in-memory upload queue is gone — even though the server-side session and the
 * parts already stored for it live on (a ~6-day window). This banner fetches the
 * caller's open sessions for THIS page's scope and, if any are unfinished, invites
 * the user to re-select the files. Re-enqueuing them through the SAME resumable
 * engine the explorer uses is enough: its `init` matches each file to an open
 * session by scope + folder + name + size + hash and CONTINUES from the parts
 * already uploaded (never re-sending what storage already holds); anything with no
 * match just uploads fresh. Rendered only when the resumable path is enabled.
 */

const border = '1px solid var(--sos-border, rgba(148,163,184,0.25))';
const muted = 'var(--sos-text-muted, #64748b)';
const primary = 'var(--sos-text-primary, #0f172a)';
const accent = 'var(--sos-accent, #b8860b)';
const accentSoft = 'var(--sos-accent-soft, rgba(184,134,11,0.10))';

/** Pair a File to its interrupted session by name + size. */
const keyOf = (fileName: string, sizeBytes: number) => `${fileName}\u0000${sizeBytes}`;

const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border,
  borderColor: accent,
  borderRadius: 8,
  background: 'var(--sos-surface-solid, #fff)',
  color: primary,
  fontSize: 12.5,
  fontWeight: 600,
  padding: '6px 11px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export function UploadResumeBanner({ dest, readOnly }: { dest: UploadDest; readOnly?: boolean }) {
  const clientId = dest.target.clientId;
  const personal = !!dest.target.personal;
  // A manager may upload into an associate's personal area (`userId`); otherwise
  // the personal area is the caller's own, so its owner is the logged-in user.
  const explicitOwner = dest.target.userId;

  const session = useSession();
  const me = session.status === 'authed' ? session.user.id : null;
  const expectedOwner = explicitOwner ?? me;

  const [raw, setRaw] = useState<OpenUpload[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // On mount / scope change (browser only): fetch this portal's open sessions.
  useEffect(() => {
    if (typeof window === 'undefined' || readOnly) return;
    let cancelled = false;
    setDismissed(false);
    fetchOpenUploads(dest.base)
      .then((r) => {
        if (!cancelled) setRaw(r.uploads);
      })
      .catch(() => {
        if (!cancelled) setRaw([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dest.base, clientId, personal, explicitOwner, readOnly]);

  // Keep only the unfinished sessions that belong to THIS page's scope.
  const relevant = useMemo(() => {
    return raw.filter((u) => {
      if (personal) {
        if (expectedOwner == null) return false; // wait until we know the owner
        return u.clientId === null && u.ownerUserId === expectedOwner;
      }
      return !!clientId && u.clientId === clientId;
    });
  }, [raw, personal, clientId, expectedOwner]);

  // Where each interrupted file was headed (name + size → its session's folder),
  // so a re-selected file resumes in the right place instead of starting over.
  const folderByKey = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const u of relevant) {
      const k = keyOf(u.fileName, u.sizeBytes);
      if (!m.has(k)) m.set(k, u.folderId);
    }
    return m;
  }, [relevant]);

  // Fallback folder for a picked file that matches no session: the one folder the
  // sessions share (null/root when they span several).
  const primaryFolderId = useMemo(() => {
    const folders = new Set(relevant.map((u) => u.folderId));
    return folders.size === 1 ? [...folders][0] : null;
  }, [relevant]);

  const hasFolderUploads = useMemo(() => relevant.some((u) => !!u.relativePath), [relevant]);

  const onPick = useCallback(
    async (fileList: FileList | null) => {
      const files = fileList ? Array.from(fileList) : [];
      if (!files.length) return;
      setBusy(true);
      try {
        const m = await import('@/lib/databank-upload-browser');
        // Group the chosen files by the folder their session targeted, then
        // enqueue each group. The engine resumes any file that matches an open
        // session (by hash) from its stored parts; the rest start fresh.
        const groups = new Map<string | null, File[]>();
        for (const f of files) {
          const match = folderByKey.get(keyOf(f.name, f.size));
          const folderId = match === undefined ? primaryFolderId : match;
          const arr = groups.get(folderId);
          if (arr) arr.push(f);
          else groups.set(folderId, [f]);
        }
        for (const [folderId, group] of groups) {
          m.enqueueFiles(dest, folderId, group);
        }
        // The live dock now owns the progress — stand down for this view.
        setDismissed(true);
      } catch {
        // The engine failed to load: keep the banner up so the user can retry.
      } finally {
        setBusy(false);
      }
    },
    [folderByKey, primaryFolderId, dest],
  );

  if (readOnly || dismissed || relevant.length === 0) return null;

  const n = relevant.length;
  const names = relevant.slice(0, 3).map((u) => u.relativePath || u.fileName);
  const extra = n - names.length;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        border,
        borderColor: accent,
        borderRadius: 10,
        background: accentSoft,
        padding: '10px 12px',
      }}
    >
      <RotateCcw size={16} style={{ color: accent, flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 13, color: primary, fontWeight: 600 }}>
          {n} upload{n === 1 ? '' : 's'} {n === 1 ? 'was' : 'were'} interrupted — re-select the file
          {n === 1 ? '' : 's'} to continue.
        </div>
        <div
          style={{ fontSize: 12, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={relevant.map((u) => u.relativePath || u.fileName).join('\n')}
        >
          {names.join(', ')}
          {extra > 0 ? ` and ${extra} more` : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} style={btnStyle}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Re-select files
          </button>
          {hasFolderUploads ? (
            <button type="button" onClick={() => folderInputRef.current?.click()} disabled={busy} style={btnStyle}>
              <FolderUp size={14} /> Re-select folder
            </button>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        title="Dismiss"
        onClick={() => setDismissed(true)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: muted,
          padding: 4,
          borderRadius: 6,
          display: 'inline-flex',
          flexShrink: 0,
        }}
      >
        <X size={15} />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void onPick(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={(el) => {
          folderInputRef.current = el;
          // webkitdirectory/directory aren't standard React props — set them on
          // the DOM node so the picker selects a whole folder tree.
          if (el) {
            el.setAttribute('webkitdirectory', '');
            el.setAttribute('directory', '');
          }
        }}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void onPick(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
