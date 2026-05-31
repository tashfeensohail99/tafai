'use client';
// Split Reviewer — a dedicated, preview-first triage surface for inbound
// documents (WhatsApp / portal / officer bundle splits). One un-triaged segment
// at a time: see the actual pages on the left, confirm the doc type + file it
// into the right checklist slot (or discard) on the right, then step to the
// next. Reuses the existing inbound endpoints; the only new call is the
// per-segment signed preview URL.

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  Inbox,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  fetchInboundDocuments,
  getInboundDocumentSignedUrl,
  fileInboundDocument,
  discardInboundDocument,
  type ApiInboundDocument,
  type ApiCaseDocumentItem,
} from '@/lib/processing';

function confidenceBadge(c: number | null): { tone: BadgeTone; label: string } {
  if (c == null) return { tone: 'neutral', label: 'unclassified' };
  const pct = Math.round(c * 100);
  if (c >= 0.8) return { tone: 'success', label: `${pct}% · high` };
  if (c >= 0.62) return { tone: 'warning', label: `${pct}% · check` };
  return { tone: 'danger', label: `${pct}% · needs review` };
}

// Segment file names look like "<base> — PASSPORT (pp 2-7).pdf"; pull the range.
function pageLabel(fileName: string): string | null {
  const m = fileName.match(/\((pp?\s*[\d–-]+)\)/i);
  return m ? m[1].replace(/\s+/, ' ') : null;
}

const isPdf = (mime: string | null) => !!mime && /pdf/i.test(mime);
const isViewableImage = (mime: string | null) =>
  !!mime && /^image\//i.test(mime) && !/heic|heif/i.test(mime);

export function SplitReviewerModal({
  caseId,
  items,
  onClose,
  onChanged,
}: {
  caseId: string;
  items: ApiCaseDocumentItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [queue, setQueue] = useState<ApiInboundDocument[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});

  // Preview state for the current segment.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const fileable = items.filter(
    (i) => i.status !== 'WAIVED' && i.status !== 'ACCEPTED' && i.status !== 'NOT_APPLICABLE',
  );

  const current: ApiInboundDocument | undefined = queue[idx];

  useEffect(() => {
    let cancelled = false;
    fetchInboundDocuments(caseId)
      .then((rows) => { if (!cancelled) setQueue(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [caseId]);

  // Fetch a fresh signed preview URL whenever the current segment changes.
  useEffect(() => {
    if (!current) { setPreviewUrl(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewErr(null);
    setPreviewUrl(null);
    getInboundDocumentSignedUrl(caseId, current.id)
      .then((r) => {
        if (cancelled) return;
        setPreviewUrl(r.url);
        setPreviewMime(r.mimeType ?? current.mimeType ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setPreviewErr(e instanceof Error ? e.message : 'Could not load preview');
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [caseId, current]);

  const advanceAfterRemoval = useCallback((removedId: string) => {
    setQueue((prev) => {
      const next = prev.filter((x) => x.id !== removedId);
      if (next.length === 0) {
        // Nothing left — sync the checklist and close.
        onChanged();
        onClose();
      } else {
        setIdx((i) => Math.min(i, next.length - 1));
      }
      return next;
    });
  }, [onChanged, onClose]);

  async function handleFile() {
    if (!current) return;
    const itemId = picks[current.id] ?? current.suggestedItemId ?? '';
    if (!itemId) { setErr('Pick a checklist slot first.'); return; }
    setBusy(true); setErr(null);
    try {
      await fileInboundDocument(caseId, current.id, itemId);
      onChanged();
      advanceAfterRemoval(current.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to file document');
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    if (!current) return;
    setBusy(true); setErr(null);
    try {
      await discardInboundDocument(caseId, current.id);
      advanceAfterRemoval(current.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to discard');
    } finally {
      setBusy(false);
    }
  }

  const conf = current ? confidenceBadge(current.classifyConfidence) : null;
  const pages = current ? pageLabel(current.fileName) : null;
  const selectedSlot = current ? (picks[current.id] ?? current.suggestedItemId ?? '') : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 24,
        background: 'rgba(2, 6, 23, 0.62)', backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1120px, 96vw)', height: 'min(86vh, 820px)', display: 'flex',
          flexDirection: 'column', borderRadius: 'var(--sos-radius-lg)', overflow: 'hidden',
          border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <Inbox size={16} style={{ color: 'var(--sos-text-secondary)' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Split Reviewer</span>
          {!loading && queue.length > 0 ? (
            <StatusBadge tone="cyan" size="sm">{idx + 1} of {queue.length}</StatusBadge>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', padding: 6, borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--sos-text-muted)' }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : queue.length === 0 ? (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--sos-text-muted)', gap: 8, padding: 24 }}>
            <FileCheck2 size={28} style={{ color: 'var(--sos-status-success)' }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>Nothing to review</div>
            <div style={{ fontSize: 12.5 }}>All received documents have been sorted into the checklist.</div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Preview pane */}
            <div style={{ flex: '1 1 64%', minWidth: 0, background: 'var(--sos-surface-hover)', borderRight: '1px solid var(--sos-border-subtle)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {previewLoading ? (
                <Loader2 size={20} className="animate-spin" style={{ color: 'var(--sos-text-muted)' }} />
              ) : previewErr ? (
                <div style={{ textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 12.5, padding: 24 }}>
                  <AlertTriangle size={22} style={{ color: 'var(--sos-status-warning)' }} />
                  <div style={{ marginTop: 8 }}>{previewErr}</div>
                </div>
              ) : previewUrl && isPdf(previewMime) ? (
                <iframe title="document preview" src={previewUrl} style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
              ) : previewUrl && isViewableImage(previewMime) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="document preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : previewUrl ? (
                <div style={{ textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 12.5, padding: 24 }}>
                  <div>Inline preview not available for this file type.</div>
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, color: 'var(--sos-accent-primary)', fontWeight: 600 }}>
                    <ExternalLink size={13} /> Open in new tab
                  </a>
                </div>
              ) : null}
              {previewUrl ? (
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" title="Open full size" style={{ position: 'absolute', top: 10, right: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface)', color: 'var(--sos-text-secondary)', fontSize: 11.5, textDecoration: 'none' }}>
                  <ExternalLink size={12} /> Full size
                </a>
              ) : null}
            </div>

            {/* Detail / actions pane */}
            <div style={{ flex: '1 1 36%', minWidth: 300, display: 'flex', flexDirection: 'column', padding: 16, gap: 14, overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {current ? <StatusBadge tone="info" size="sm">{current.source}</StatusBadge> : null}
                {pages ? <StatusBadge tone="neutral" size="sm">{pages}</StatusBadge> : null}
              </div>

              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)', wordBreak: 'break-word' }}>
                {current?.fileName}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Sparkles size={14} style={{ color: 'var(--sos-accent-primary)' }} />
                <span style={{ fontSize: 12.5, color: 'var(--sos-text-secondary)' }}>
                  {current?.detectedDocType ? `Detected: ${current.detectedDocType}` : 'No confident classification'}
                </span>
                {conf ? <StatusBadge tone={conf.tone} size="sm">{conf.label}</StatusBadge> : null}
              </div>

              {current && current.classifyConfidence != null && current.classifyConfidence < 0.62 ? (
                <div style={{ fontSize: 11.5, color: 'var(--sos-status-warning)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                  Low confidence — confirm the type from the preview before filing.
                </div>
              ) : null}

              <div style={{ height: 1, background: 'var(--sos-border-subtle)' }} />

              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-secondary)' }}>File into checklist slot</label>
              <select
                value={selectedSlot}
                onChange={(e) => current && setPicks((p) => ({ ...p, [current.id]: e.target.value }))}
                style={{ padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface)', color: 'var(--sos-text-primary)', fontSize: 13 }}
              >
                <option value="">Choose slot…</option>
                {fileable.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.documentName}{current?.suggestedItemId === it.id ? ' (suggested)' : ''}
                  </option>
                ))}
              </select>

              {err ? <div style={{ fontSize: 12, color: 'var(--sos-status-danger)' }}>{err}</div> : null}

              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                <PrimaryButton iconLeft={<FileCheck2 size={14} />} onClick={handleFile} disabled={busy || !current}>
                  File into slot
                </PrimaryButton>
                <SecondaryButton iconLeft={<Trash2 size={13} />} onClick={handleDiscard} disabled={busy || !current}>
                  Discard
                </SecondaryButton>
              </div>

              <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12 }}>
                <SecondaryButton iconLeft={<ChevronLeft size={14} />} onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={busy || idx === 0}>
                  Prev
                </SecondaryButton>
                <SecondaryButton iconLeft={<ChevronRight size={14} />} onClick={() => setIdx((i) => Math.min(queue.length - 1, i + 1))} disabled={busy || idx >= queue.length - 1}>
                  Next
                </SecondaryButton>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
                  Filing only proposes — you confirm each one.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
