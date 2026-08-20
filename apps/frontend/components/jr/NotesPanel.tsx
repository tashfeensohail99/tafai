'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NotebookPen,
  Loader2,
  Mic,
  Square,
  X,
  Trash2,
  Pin,
  PinOff,
  Type as TypeIcon,
  Image as ImageIcon,
  Send,
} from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  EmptyState,
  FormInput,
  FormTextarea,
} from '@/components/sales-v2/ui';
import { ApiClientError } from '@/lib/api-client';
import {
  fetchJrNotes,
  createJrTextNote,
  createJrVoiceNote,
  createJrImageNote,
  updateJrNote,
  deleteJrNote,
  jrFmtDate,
  type JrNote,
} from '@/lib/jr';

type ComposerTab = 'text' | 'voice' | 'image';

function errMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function fmtDuration(ms: number | null): string {
  if (ms == null || Number.isNaN(ms)) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** blob mime → a file extension the backend can read. */
function extForMime(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'mp4';
  return 'webm';
}

// ---------------------------------------------------------------------------
// Segmented tab control
// ---------------------------------------------------------------------------
function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 'var(--sos-radius-sm, 8px)',
        fontSize: 12.5,
        fontWeight: 600,
        color: active ? '#fff' : 'var(--sos-text-muted)',
        background: active ? 'var(--sos-brand-primary-strong)' : 'transparent',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Text composer
// ---------------------------------------------------------------------------
function TextComposer({ matterId, onCreated }: { matterId: string; onCreated: () => void }) {
  const [content, setContent] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = content.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createJrTextNote(matterId, { content: trimmed, isPinned });
      setContent('');
      setIsPinned(false);
      onCreated();
    } catch (e: unknown) {
      setError(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FormTextarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        maxLength={5000}
        placeholder="Record work on this matter…"
      />
      {error ? <div style={{ fontSize: 11.5, color: 'var(--sos-status-danger)' }}>{error}</div> : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12.5,
            color: 'var(--sos-text-muted)',
            cursor: 'pointer',
          }}
        >
          <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
          Pin to top
        </label>
        <PrimaryButton
          type="button"
          onClick={submit}
          disabled={saving || !content.trim()}
          iconLeft={saving ? <Loader2 size={14} className="sos-spin" /> : <Send size={14} />}
        >
          {saving ? 'Adding…' : 'Add note'}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice composer — mirrors the WhatsApp VoiceRecorder
// ---------------------------------------------------------------------------
function VoiceComposer({ matterId, onCreated }: { matterId: string; onCreated: () => void }) {
  const [recording, setRecording] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setBlob(null);
    setElapsedSecs(0);
    setCaption('');
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    clearPreview();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/webm',
        'audio/aac',
        'audio/mpeg',
      ];
      const mimeType = candidates.find((c) => MediaRecorder.isTypeSupported(c));
      if (!mimeType) {
        stream.getTracks().forEach((t) => t.stop());
        setError('Your browser cannot record audio. Try Chrome, Firefox, or Safari.');
        return;
      }
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const recorded = new Blob(chunksRef.current, { type: mr.mimeType });
        const url = URL.createObjectURL(recorded);
        previewUrlRef.current = url;
        setBlob(recorded);
        setPreviewUrl(url);
        setRecording(false);
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setRecording(true);
      setRecordingSecs(0);
      setElapsedSecs(0);
      timerRef.current = setInterval(() => {
        setRecordingSecs((s) => {
          const next = s + 1;
          setElapsedSecs(next);
          if (next >= 120) stopRecording();
          return next;
        });
      }, 1000);
    } catch {
      setError('Microphone access denied. Allow microphone in your browser settings.');
    }
  }, [clearPreview, stopRecording]);

  const cancelRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const mr = mediaRecorderRef.current;
    if (mr) {
      mr.onstop = null;
      mr.stream?.getTracks().forEach((t) => t.stop());
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
      mediaRecorderRef.current = null;
    }
    setRecording(false);
    setRecordingSecs(0);
    setElapsedSecs(0);
  }, []);

  // Clean up any live recording + preview URL on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      const mr = mediaRecorderRef.current;
      if (mr) {
        mr.onstop = null;
        mr.stream?.getTracks().forEach((t) => t.stop());
        try {
          mr.stop();
        } catch {
          /* ignore */
        }
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  async function save() {
    if (!blob || saving) return;
    setSaving(true);
    setError(null);
    try {
      const ext = extForMime(blob.type);
      await createJrVoiceNote(matterId, blob, {
        fileName: `voice-note.${ext}`,
        durationMs: elapsedSecs * 1000,
        content: caption.trim() || undefined,
      });
      clearPreview();
      onCreated();
    } catch (e: unknown) {
      setError(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {recording ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#e53e3e',
              animation: 'pulse 1s ease-in-out infinite',
            }}
          />
          <span style={{ fontSize: 14, color: 'var(--sos-text-primary)' }}>{fmtTime(recordingSecs)}</span>
          <span style={{ fontSize: 12, color: 'var(--sos-text-muted)', flex: 1 }}>Recording…</span>
          <SecondaryButton type="button" onClick={cancelRecording} iconLeft={<X size={14} />}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="button" onClick={stopRecording} iconLeft={<Square size={13} />}>
            Stop
          </PrimaryButton>
        </div>
      ) : blob && previewUrl ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={previewUrl} style={{ width: '100%' }} />
          <FormInput
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={5000}
            placeholder="Add a caption (optional)"
          />
          {error ? (
            <div style={{ fontSize: 11.5, color: 'var(--sos-status-danger)' }}>{error}</div>
          ) : null}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <SecondaryButton type="button" onClick={clearPreview} disabled={saving} iconLeft={<Trash2 size={14} />}>
              Discard
            </SecondaryButton>
            <PrimaryButton
              type="button"
              onClick={save}
              disabled={saving}
              iconLeft={saving ? <Loader2 size={14} className="sos-spin" /> : <Send size={14} />}
            >
              {saving ? 'Saving…' : 'Save voice note'}
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <PrimaryButton type="button" onClick={startRecording} iconLeft={<Mic size={14} />}>
              Record voice note
            </PrimaryButton>
          </div>
          {error ? (
            <div style={{ fontSize: 11.5, color: 'var(--sos-status-danger)' }}>{error}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image composer — file picker + clipboard paste
// ---------------------------------------------------------------------------
interface PendingImage {
  file: File;
  url: string;
}

function ImageComposer({ matterId, onCreated }: { matterId: string; onCreated: () => void }) {
  const [images, setImages] = useState<PendingImage[]>([]);
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imagesRef = useRef<PendingImage[]>([]);
  imagesRef.current = images;

  const addFiles = useCallback((files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    setImages((prev) => [...prev, ...imgs.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }, []);

  // Paste handler — only mounted while this (Image) composer is active.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith('image/'),
      );
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const clearImages = useCallback(() => {
    imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url));
    setImages([]);
    setCaption('');
  }, []);

  // Revoke all preview URLs on unmount.
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url));
    };
  }, []);

  function removeAt(idx: number) {
    setImages((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function save() {
    if (!images.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      for (const img of images) {
        // eslint-disable-next-line no-await-in-loop
        await createJrImageNote(matterId, img.file, {
          fileName: img.file.name || 'image.png',
          content: caption.trim() || undefined,
        });
      }
      clearImages();
      onCreated();
    } catch (e: unknown) {
      setError(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label className="sos-label">Image</label>
        <input
          type="file"
          className="sos-input"
          accept="image/*"
          multiple
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
          style={{ paddingTop: 7 }}
        />
        <div className="sos-help">You can also paste an image from the clipboard.</div>
      </div>

      {images.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {images.map((img, idx) => (
            <div key={img.url} style={{ position: 'relative' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.file.name}
                style={{
                  width: 96,
                  height: 96,
                  objectFit: 'cover',
                  borderRadius: 'var(--sos-radius-md)',
                  border: '1px solid var(--sos-border-subtle)',
                }}
              />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                aria-label="Remove image"
                style={{
                  all: 'unset',
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: 'var(--sos-status-danger)',
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {images.length ? (
        <FormInput
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={5000}
          placeholder="Add a caption (optional)"
        />
      ) : null}

      {error ? <div style={{ fontSize: 11.5, color: 'var(--sos-status-danger)' }}>{error}</div> : null}

      {images.length ? (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <SecondaryButton type="button" onClick={clearImages} disabled={saving} iconLeft={<Trash2 size={14} />}>
            Clear
          </SecondaryButton>
          <PrimaryButton
            type="button"
            onClick={save}
            disabled={saving}
            iconLeft={saving ? <Loader2 size={14} className="sos-spin" /> : <Send size={14} />}
          >
            {saving ? 'Saving…' : images.length > 1 ? `Save ${images.length} image notes` : 'Save image note'}
          </PrimaryButton>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A single note in the feed
// ---------------------------------------------------------------------------
function NoteCard({
  note,
  canManage,
  onChanged,
}: {
  note: JrNote;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audio = note.attachments.find((a) => a.kind === 'AUDIO');
  const images = note.attachments.filter((a) => a.kind === 'IMAGE');

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e: unknown) {
      setError(errMessage(e));
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 'var(--sos-radius-md)',
        background: 'var(--sos-surface-2)',
        border: note.isPinned ? '1px solid var(--sos-brand-primary-border)' : '1px solid var(--sos-border-subtle)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          {note.isPinned ? (
            <Pin size={12} style={{ color: 'var(--sos-brand-primary-strong)', flexShrink: 0 }} />
          ) : (
            <NotebookPen size={12} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
          )}
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
            {note.authorName || 'Unknown'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>
            · {jrFmtDate(note.createdAt)}
            {note.editedAt ? ' · edited' : ''}
          </span>
        </div>
        {canManage ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => updateJrNote(note.id, { isPinned: !note.isPinned }))}
              aria-label={note.isPinned ? 'Unpin note' : 'Pin note'}
              title={note.isPinned ? 'Unpin' : 'Pin'}
              style={{ all: 'unset', cursor: busy ? 'default' : 'pointer', color: 'var(--sos-text-muted)', padding: 4 }}
            >
              {note.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => deleteJrNote(note.id))}
              aria-label="Delete note"
              title="Delete"
              style={{ all: 'unset', cursor: busy ? 'default' : 'pointer', color: 'var(--sos-status-danger)', padding: 4 }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ) : null}
      </div>

      {/* Body */}
      {audio ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {note.content ? (
            <div style={{ fontSize: 13, color: 'var(--sos-text-primary)', whiteSpace: 'pre-wrap' }}>
              {note.content}
            </div>
          ) : null}
          {audio.url ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio controls src={audio.url} style={{ width: '100%' }} />
          ) : (
            <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', fontStyle: 'italic' }}>
              Audio unavailable
            </div>
          )}
          {audio.durationMs ? (
            <div style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{fmtDuration(audio.durationMs)}</div>
          ) : null}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--sos-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 2,
              }}
            >
              Roman-Urdu transcript
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
              {audio.transcript ?? 'Transcript unavailable'}
            </div>
          </div>
        </div>
      ) : images.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {images.map((img) =>
              img.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.id}
                  src={img.url}
                  alt={img.fileName}
                  onClick={() => img.url && window.open(img.url, '_blank', 'noopener')}
                  style={{
                    maxWidth: 120,
                    maxHeight: 120,
                    objectFit: 'cover',
                    borderRadius: 'var(--sos-radius-md)',
                    border: '1px solid var(--sos-border-subtle)',
                    cursor: 'pointer',
                  }}
                />
              ) : (
                <div
                  key={img.id}
                  style={{ fontSize: 12, color: 'var(--sos-text-muted)', fontStyle: 'italic' }}
                >
                  Image unavailable
                </div>
              ),
            )}
          </div>
          {note.content ? (
            <div style={{ fontSize: 13, color: 'var(--sos-text-primary)', whiteSpace: 'pre-wrap' }}>
              {note.content}
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--sos-text-primary)', whiteSpace: 'pre-wrap' }}>
          {note.content}
        </div>
      )}

      {error ? <div style={{ fontSize: 11, color: 'var(--sos-status-danger)' }}>{error}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes panel
// ---------------------------------------------------------------------------
export function NotesPanel({
  matterId,
  canCreate,
  canModerate,
  currentUserId,
}: {
  matterId: string;
  canCreate: boolean;
  canModerate: boolean;
  currentUserId: string;
}) {
  const [notes, setNotes] = useState<JrNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<ComposerTab>('text');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJrNotes(matterId)
      .then((res) => {
        if (cancelled) return;
        setNotes(res.notes);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errMessage(e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [matterId, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <NotebookPen size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Notes</div>
      </div>

      {canCreate ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 14,
            borderRadius: 'var(--sos-radius-md)',
            background: 'var(--sos-surface-2)',
            border: '1px solid var(--sos-border-subtle)',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              gap: 4,
              padding: 4,
              borderRadius: 'var(--sos-radius-md)',
              background: 'var(--sos-surface-1, rgba(0,0,0,0.15))',
              alignSelf: 'flex-start',
            }}
          >
            <TabButton
              active={tab === 'text'}
              onClick={() => setTab('text')}
              icon={<TypeIcon size={13} />}
              label="Text"
            />
            <TabButton
              active={tab === 'voice'}
              onClick={() => setTab('voice')}
              icon={<Mic size={13} />}
              label="Voice"
            />
            <TabButton
              active={tab === 'image'}
              onClick={() => setTab('image')}
              icon={<ImageIcon size={13} />}
              label="Image"
            />
          </div>

          {tab === 'text' ? <TextComposer matterId={matterId} onCreated={reload} /> : null}
          {tab === 'voice' ? <VoiceComposer matterId={matterId} onCreated={reload} /> : null}
          {tab === 'image' ? <ImageComposer matterId={matterId} onCreated={reload} /> : null}
        </div>
      ) : null}

      {loading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: 32,
            color: 'var(--sos-text-muted)',
          }}
        >
          <Loader2 size={16} className="sos-spin" /> Loading notes…
        </div>
      ) : error ? (
        <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{error}</div>
      ) : notes.length === 0 ? (
        <EmptyState
          Icon={NotebookPen}
          title="No notes yet"
          description="Add a text, voice, or image note to record work on this matter."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              canManage={note.authorUserId === currentUserId || canModerate}
              onChanged={reload}
            />
          ))}
        </div>
      )}
    </GlassCard>
  );
}
