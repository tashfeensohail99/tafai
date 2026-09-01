'use client';
// Internal Notes Tab — full management surface for the processing team.
// Create / pin / edit / soft-delete notes, filter by type + search, and
// @mention teammates (who get an in-app notification + email). Pinned first.
// Edit/delete are limited to the author (or a manager) — enforced server-side.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Pin,
  PinOff,
  PlusCircle,
  StickyNote,
  Search,
  Pencil,
  Trash2,
  AtSign,
  X,
  Mic,
  Square,
  Paperclip,
  ImageIcon,
  FileText,
  Download,
} from 'lucide-react';
import {
  GlassCard,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { type MockProcessingCase, fmtRelative } from '@/components/processing/mockData';
import { useProcessingSession } from '@/components/layout/ProcessingShell';
import {
  fetchCaseNotes,
  createCaseNote,
  updateCaseNote,
  deleteCaseNote,
  pinCaseNote,
  fetchNoteMentionCandidates,
  fetchNoteAttachmentUrl,
  type ApiProcessingNote,
  type ApiNoteAttachment,
  type ProcessingNoteType,
  type ApiProcessingOfficer,
} from '@/lib/processing';

function noteTypeTone(type: ProcessingNoteType): BadgeTone {
  switch (type) {
    case 'ESCALATION': return 'danger';
    case 'STRATEGY': return 'violet';
    case 'CLIENT_INSIGHT': return 'cyan';
    case 'AUTHORITY_NOTE': return 'info';
    case 'MANAGER_ONLY': return 'warm';
    default: return 'neutral';
  }
}
function noteTypeLabel(type: ProcessingNoteType): string {
  switch (type) {
    case 'GENERAL': return 'General';
    case 'ESCALATION': return 'Escalation';
    case 'STRATEGY': return 'Strategy';
    case 'CLIENT_INSIGHT': return 'Client insight';
    case 'AUTHORITY_NOTE': return 'Authority note';
    case 'MANAGER_ONLY': return 'Manager only';
    default: return type;
  }
}

const NOTE_TYPES: Array<{ value: ProcessingNoteType; label: string }> = [
  { value: 'GENERAL', label: 'General' },
  { value: 'STRATEGY', label: 'Strategy' },
  { value: 'CLIENT_INSIGHT', label: 'Client insight' },
  { value: 'AUTHORITY_NOTE', label: 'Authority note' },
  { value: 'ESCALATION', label: 'Escalation' },
  { value: 'MANAGER_ONLY', label: 'Manager only' },
];

function shortName(email?: string | null): string {
  return email ? email.split('@')[0] : 'Officer';
}

// Toggleable roster of teammates to @mention.
function MentionPicker({
  officers,
  selected,
  onToggle,
}: {
  officers: ApiProcessingOfficer[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (officers.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
        <AtSign size={12} /> Mention teammates
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {officers.map((o) => {
          const on = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onToggle(o.id)}
              style={{ padding: '4px 10px', borderRadius: 999, fontSize: '12px', fontWeight: 500, border: `1px solid ${on ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`, background: on ? 'var(--sos-brand-primary-soft)' : 'transparent', color: on ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)', cursor: 'pointer', transition: 'all 150ms' }}
            >
              {on ? '✓ ' : '@'}{o.name || shortName(o.email)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Shared editor for both "add" and inline "edit".
// ── Attachments ────────────────────────────────────────────────────────────
// Voice notes, screenshots, images and files on a case note. Composer records
// audio (MediaRecorder), accepts file picks, and captures pasted screenshots;
// the card renders images (thumbnail → lightbox), voice (audio player) and
// files (download chip). Bytes live in object storage; the client fetches a
// short-lived signed URL per attachment when it renders.

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/** Inline record button → produces a File and hands it to the composer. */
function VoiceRecorderButton({ onRecorded }: { onRecorded: (f: File) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);

  // Unmount mid-record (Cancel the editor, navigate away): stop the timer AND
  // release the mic/stream — otherwise the recording light stays on.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    try { mrRef.current?.stop(); } catch { /* already stopped */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  async function start() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const mimeType = candidates.find((c) => MediaRecorder.isTypeSupported(c));
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      streamRef.current = stream;
      chunksRef.current = [];
      discardRef.current = false;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (discardRef.current) return;
        const type = mr.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size > 0) onRecorded(new File([blob], `voice-note.${ext}`, { type }));
      };
      mr.start();
      mrRef.current = mr;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setErr('Microphone unavailable — allow mic access and try again.');
    }
  }
  function stop(discard: boolean) {
    discardRef.current = discard;
    mrRef.current?.stop();
    mrRef.current = null;
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  if (recording) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--sos-status-danger)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--sos-status-danger)', animation: 'pulse 1s infinite' }} />
          {`${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`}
        </span>
        <SecondaryButton iconLeft={<Square size={13} />} onClick={() => stop(false)}>Stop</SecondaryButton>
        <button type="button" onClick={() => stop(true)} style={{ padding: '6px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 12.5, cursor: 'pointer' }}>Discard</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <SecondaryButton iconLeft={<Mic size={13} />} onClick={start}>Record voice</SecondaryButton>
      {err ? <span style={{ fontSize: 11.5, color: 'var(--sos-status-danger)' }}>{err}</span> : null}
    </div>
  );
}

/** Pending-attachment chips + the attach/record/paste controls for the composer. */
function AttachmentComposer({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const add = (f: File[]) => onChange([...files, ...f].slice(0, 10));
  const removeAt = (i: number) => onChange(files.filter((_, idx) => idx !== i));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <SecondaryButton
          iconLeft={<Paperclip size={13} />}
          onClick={() => fileInputRef.current?.click()}
        >
          Attach image / file
        </SecondaryButton>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length) add(picked);
            e.target.value = ''; // allow re-picking the same file
          }}
        />
        <VoiceRecorderButton onRecorded={(f) => add([f])} />
        <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>or paste a screenshot ⌘/Ctrl+V</span>
      </div>
      {files.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {files.map((f, i) => {
            const isImg = f.type.startsWith('image/');
            const isAudio = f.type.startsWith('audio/') || f.name.startsWith('voice-note');
            return (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 8px', borderRadius: 999, background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', color: 'var(--sos-text-primary)' }}>
                {isImg ? <ImageIcon size={12} /> : isAudio ? <Mic size={12} /> : <FileText size={12} />}
                <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {isAudio ? 'Voice note' : f.name}
                </span>
                <span style={{ color: 'var(--sos-text-muted)' }}>{fmtBytes(f.size)}</span>
                <button type="button" onClick={() => removeAt(i)} aria-label="Remove" style={{ display: 'inline-flex', border: 'none', background: 'transparent', color: 'var(--sos-text-muted)', cursor: 'pointer', padding: 0 }}>
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** One rendered attachment on a saved note. Fetches its signed URL on mount
 *  (image/voice) or on click (file). */
function NoteAttachmentView({ caseId, att, onLightbox }: { caseId: string; att: ApiNoteAttachment; onLightbox: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const ensureUrl = async (force = false): Promise<string | null> => {
    if (url && !force) return url;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetchNoteAttachmentUrl(caseId, att.id);
      setUrl(res.url);
      return res.url;
    } catch {
      setFailed(true);
      return null;
    } finally {
      setLoading(false);
    }
  };
  // The signed URL can expire (1h TTL) on a long-open tab — a failed <img>/
  // <audio> load re-fetches a fresh one instead of showing a dead element.
  const refetch = () => { void ensureUrl(true); };

  // Auto-load image + voice so they render inline; files load on click.
  useEffect(() => {
    if (att.kind === 'IMAGE' || att.kind === 'VOICE') void ensureUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [att.id]);

  if (att.kind === 'IMAGE') {
    return (
      <button
        type="button"
        onClick={async () => { const u = await ensureUrl(); if (u) onLightbox(u); }}
        style={{ padding: 0, border: '1px solid var(--sos-border-subtle)', borderRadius: 8, overflow: 'hidden', background: 'var(--sos-surface-2)', cursor: 'pointer', width: 132, height: 100, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        title={att.originalName ?? 'Screenshot'}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={att.originalName ?? 'attachment'} onError={refetch} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : failed ? (
          <span style={{ fontSize: 11, color: 'var(--sos-status-danger)' }}>Unavailable</span>
        ) : (
          <Loader2 size={16} className="animate-spin" style={{ color: 'var(--sos-text-muted)' }} />
        )}
      </button>
    );
  }

  if (att.kind === 'VOICE') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)' }}>
        <Mic size={13} style={{ color: 'var(--sos-brand-primary-strong)', flexShrink: 0 }} />
        {url ? (
          <audio controls src={url} onError={refetch} style={{ height: 32, maxWidth: 240 }} />
        ) : failed ? (
          <span style={{ fontSize: 12, color: 'var(--sos-status-danger)' }}>Voice note unavailable</span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>Loading…</span>
        )}
        {att.durationMs ? <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{fmtDuration(att.durationMs)}</span> : null}
      </div>
    );
  }

  // FILE
  return (
    <button
      type="button"
      onClick={async () => { const u = await ensureUrl(); if (u) window.open(u, '_blank', 'noopener'); }}
      disabled={loading}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '6px 10px', borderRadius: 8, background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', color: 'var(--sos-text-primary)', cursor: 'pointer' }}
    >
      <FileText size={13} />
      <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.originalName ?? 'File'}</span>
      <span style={{ color: 'var(--sos-text-muted)' }}>{fmtBytes(att.sizeBytes)}</span>
      <Download size={12} style={{ color: 'var(--sos-text-muted)' }} />
    </button>
  );
}

function NoteAttachments({ caseId, atts, onLightbox }: { caseId: string; atts: ApiNoteAttachment[]; onLightbox: (url: string) => void }) {
  if (!atts.length) return null;
  return (
    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {atts.map((a) => <NoteAttachmentView key={a.id} caseId={caseId} att={a} onLightbox={onLightbox} />)}
    </div>
  );
}

/** Full-screen image preview. */
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // lock the background scroll
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="attachment" style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain', borderRadius: 8 }} />
    </div>
  );
}

function NoteEditor({
  officers,
  initialContent = '',
  initialType = 'GENERAL',
  initialMentions = [],
  saving,
  err,
  submitLabel,
  onSubmit,
  onCancel,
  allowAttachments = false,
  hasExistingAttachments = false,
}: {
  officers: ApiProcessingOfficer[];
  initialContent?: string;
  initialType?: ProcessingNoteType;
  initialMentions?: string[];
  saving: boolean;
  err: string | null;
  submitLabel: string;
  onSubmit: (v: { content: string; noteType: ProcessingNoteType; mentions: string[]; files?: File[] }) => void;
  onCancel: () => void;
  /** Attachments (voice/image/file) are offered only on NEW notes, not edits. */
  allowAttachments?: boolean;
  /** Edit path: the note already has attachments, so empty text is still a
   *  valid save (changing type / mentions on an attachment-only note). */
  hasExistingAttachments?: boolean;
}) {
  const [content, setContent] = useState(initialContent);
  const [type, setType] = useState<ProcessingNoteType>(initialType);
  const [mentions, setMentions] = useState<string[]>(initialMentions);
  const [files, setFiles] = useState<File[]>([]);
  const canSubmit =
    content.trim().length > 0 ||
    (allowAttachments && files.length > 0) ||
    hasExistingAttachments;

  return (
    <GlassCard variant="strong" padded="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Note type</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {NOTE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                style={{ padding: '4px 12px', borderRadius: 'var(--sos-radius-md)', fontSize: '12.5px', fontWeight: 500, border: `1px solid ${type === t.value ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`, background: type === t.value ? 'var(--sos-brand-primary-soft)' : 'transparent', color: type === t.value ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)', cursor: 'pointer', transition: 'all 150ms' }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={allowAttachments ? (e) => {
            // Capture pasted screenshots / images straight into the note.
            const imgs: File[] = [];
            for (const item of Array.from(e.clipboardData.items)) {
              if (item.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) imgs.push(new File([f], f.name || `screenshot-${Date.now()}.png`, { type: f.type }));
              }
            }
            if (imgs.length) { e.preventDefault(); setFiles((prev) => [...prev, ...imgs].slice(0, 10)); }
          } : undefined}
          placeholder={allowAttachments ? 'Type your note… or paste a screenshot, attach an image, or record a voice note.' : 'Type your note here…'}
          rows={4}
          style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
        {allowAttachments ? <AttachmentComposer files={files} onChange={setFiles} /> : null}
        <MentionPicker officers={officers} selected={mentions} onToggle={(id) => setMentions((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))} />
        {err ? (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>{err}</div>
        ) : null}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
          <PrimaryButton onClick={() => onSubmit({ content: content.trim(), noteType: type, mentions, files: allowAttachments ? files : undefined })} disabled={saving || !canSubmit}>
            {saving ? 'Saving…' : submitLabel}
          </PrimaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

function NoteCard({
  note,
  officers,
  canManage,
  onPin,
  onEdit,
  onDelete,
  onLightbox,
}: {
  note: ApiProcessingNote;
  officers: ApiProcessingOfficer[];
  canManage: boolean;
  onPin: (n: ApiProcessingNote) => void;
  onEdit: (id: string, v: { content: string; noteType: ProcessingNoteType; mentions: string[] }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLightbox: (url: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const author = shortName(note.createdBy?.email);
  const mentionNames = (note.mentions ?? [])
    .map((id) => officers.find((o) => o.id === id)?.name || null)
    .filter((n): n is string => !!n);

  if (editing) {
    return (
      <NoteEditor
        officers={officers}
        initialContent={note.content}
        initialType={note.noteType}
        initialMentions={note.mentions ?? []}
        hasExistingAttachments={(note.attachments?.length ?? 0) > 0}
        saving={busy}
        err={err}
        submitLabel="Save changes"
        onCancel={() => { setEditing(false); setErr(null); }}
        onSubmit={async (v) => {
          setBusy(true); setErr(null);
          try { await onEdit(note.id, v); setEditing(false); }
          catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed to save'); }
          finally { setBusy(false); }
        }}
      />
    );
  }

  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        {note.isPinned ? (
          <Pin size={14} style={{ color: 'var(--sos-brand-accent)', flexShrink: 0, marginTop: '2px' }} />
        ) : (
          <StickyNote size={14} style={{ color: 'var(--sos-text-muted)', flexShrink: 0, marginTop: '2px' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <StatusBadge tone={noteTypeTone(note.noteType)} size="sm" dot={false}>{noteTypeLabel(note.noteType)}</StatusBadge>
            {note.isPinned ? <StatusBadge tone="warm" size="sm" dot={false}>Pinned</StatusBadge> : null}
            <span style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>
              {author} · {fmtRelative(note.createdAt)}{note.editedAt ? ' · edited' : ''}
            </span>
          </div>
          {note.content ? (
            <div style={{ fontSize: '13.5px', color: 'var(--sos-text-primary)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
              {note.content}
            </div>
          ) : null}
          <NoteAttachments caseId={note.caseId} atts={note.attachments ?? []} onLightbox={onLightbox} />
          {mentionNames.length > 0 ? (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {mentionNames.map((n, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 600, color: 'var(--sos-brand-primary-strong)', background: 'var(--sos-brand-primary-soft)', padding: '1px 7px', borderRadius: 999 }}>
                  <AtSign size={10} />{n}
                </span>
              ))}
            </div>
          ) : null}

          {/* Actions */}
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <SecondaryButton iconLeft={note.isPinned ? <PinOff size={13} /> : <Pin size={13} />} onClick={() => onPin(note)}>
              {note.isPinned ? 'Unpin' : 'Pin'}
            </SecondaryButton>
            {canManage ? (
              <>
                <SecondaryButton iconLeft={<Pencil size={13} />} onClick={() => { setEditing(true); setErr(null); }}>Edit</SecondaryButton>
                {confirmDel ? (
                  <>
                    <PrimaryButton onClick={async () => { setBusy(true); try { await onDelete(note.id); } finally { setBusy(false); } }} disabled={busy}>
                      {busy ? 'Deleting…' : 'Confirm delete'}
                    </PrimaryButton>
                    <button type="button" onClick={() => setConfirmDel(false)} style={{ padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
                  </>
                ) : (
                  <SecondaryButton iconLeft={<Trash2 size={13} />} onClick={() => setConfirmDel(true)}>Delete</SecondaryButton>
                )}
              </>
            ) : null}
          </div>
          {err ? <div style={{ marginTop: 6, fontSize: 12, color: 'var(--sos-status-danger)' }}>{err}</div> : null}
        </div>
      </div>
    </GlassCard>
  );
}

function AddNote({ officers, onSaved, caseId }: { officers: ApiProcessingOfficer[]; onSaved: (n: ApiProcessingNote) => void; caseId: string }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <PrimaryButton iconLeft={<PlusCircle size={14} />} onClick={() => setOpen(true)}>Add note</PrimaryButton>
    );
  }
  return (
    <NoteEditor
      officers={officers}
      saving={saving}
      err={err}
      submitLabel="Save note"
      allowAttachments
      onCancel={() => { setOpen(false); setErr(null); }}
      onSubmit={async (v) => {
        setSaving(true); setErr(null);
        try {
          const saved = await createCaseNote(caseId, v);
          onSaved(saved);
          setOpen(false);
        } catch (e: unknown) {
          setErr(e instanceof Error ? e.message : 'Failed to save note');
        } finally {
          setSaving(false);
        }
      }}
    />
  );
}

export function InternalNotesTab({ c }: { c: MockProcessingCase }) {
  const { user } = useProcessingSession();
  const isManager = user.permissions.includes('processing.note.view_all') || user.permissions.includes('processing.case.view_all');

  const [notes, setNotes] = useState<ApiProcessingNote[]>([]);
  const [officers, setOfficers] = useState<ApiProcessingOfficer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | ProcessingNoteType>('ALL');
  const [search, setSearch] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCaseNotes(c.id)
      .then((rows) => { if (!cancelled) setNotes(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load notes'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    // Mention candidates — best-effort; the feature degrades gracefully if absent.
    fetchNoteMentionCandidates()
      .then((rows) => { if (!cancelled) setOfficers(rows); })
      .catch(() => { /* mentions just won't be offered */ });
    return () => { cancelled = true; };
  }, [c.id]);

  function canManage(n: ApiProcessingNote): boolean {
    return (n.createdBy?.id ?? n.createdByUserId) === user.id || isManager;
  }

  async function handlePin(n: ApiProcessingNote) {
    // optimistic flip
    setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, isPinned: !x.isPinned } : x)));
    try {
      const updated = await pinCaseNote(c.id, n.id, { isPinned: !n.isPinned });
      // Preserve attachments — the pin/update responses don't include them.
      setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, ...updated, attachments: x.attachments } : x)));
    } catch {
      setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, isPinned: n.isPinned } : x))); // revert
    }
  }
  async function handleEdit(id: string, v: { content: string; noteType: ProcessingNoteType; mentions: string[] }) {
    const updated = await updateCaseNote(c.id, id, v);
    setNotes((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated, attachments: x.attachments } : x)));
  }
  async function handleDelete(id: string) {
    await deleteCaseNote(c.id, id);
    setNotes((prev) => prev.filter((x) => x.id !== id));
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (filterType !== 'ALL' && n.noteType !== filterType) return false;
      if (q && !n.content.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [notes, filterType, search]);

  const pinned = visible.filter((n) => n.isPinned);
  const rest = visible.filter((n) => !n.isPinned);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <AddNote caseId={c.id} officers={officers} onSaved={(n) => setNotes((prev) => [n, ...prev])} />
      </div>

      {/* Filter + search */}
      {notes.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {(['ALL', ...NOTE_TYPES.map((t) => t.value)] as Array<'ALL' | ProcessingNoteType>).map((t) => {
              const on = filterType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilterType(t)}
                  style={{ padding: '3px 10px', borderRadius: 999, fontSize: '11.5px', fontWeight: 500, border: `1px solid ${on ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`, background: on ? 'var(--sos-brand-primary-soft)' : 'transparent', color: on ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)', cursor: 'pointer' }}
                >
                  {t === 'ALL' ? 'All' : noteTypeLabel(t)}
                </button>
              );
            })}
          </div>
          <div style={{ marginLeft: 'auto', position: 'relative', minWidth: 180 }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes…"
              style={{ width: '100%', padding: '6px 10px 6px 28px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
            {search ? (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer', display: 'flex' }}>
                <X size={13} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" />
            <span>Loading notes…</span>
          </div>
        </GlassCard>
      ) : err ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>
        </GlassCard>
      ) : notes.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState Icon={StickyNote} title="No notes yet" description="Add internal notes visible only to processing staff. @mention a teammate to loop them in." />
        </GlassCard>
      ) : visible.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState Icon={Search} title="No matching notes" description="No notes match the current filter or search." />
        </GlassCard>
      ) : (
        <>
          {pinned.length > 0 ? (
            <div>
              <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Pin size={12} /> Pinned
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {pinned.map((n) => <NoteCard key={n.id} note={n} officers={officers} canManage={canManage(n)} onPin={handlePin} onEdit={handleEdit} onDelete={handleDelete} onLightbox={setLightbox} />)}
              </div>
            </div>
          ) : null}
          {rest.length > 0 ? (
            <div>
              {pinned.length > 0 ? (
                <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>All notes</div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {rest.map((n) => <NoteCard key={n.id} note={n} officers={officers} canManage={canManage(n)} onPin={handlePin} onEdit={handleEdit} onDelete={handleDelete} onLightbox={setLightbox} />)}
              </div>
            </div>
          ) : null}
        </>
      )}
      {lightbox ? <Lightbox url={lightbox} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}
