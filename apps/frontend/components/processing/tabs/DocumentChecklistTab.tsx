'use client';
// Document Checklist Tab — wired to /processing/cases/:id/documents.
// Shows all document items with criticality + status. Officers can:
//   - View the uploaded file (signed URL → opens in new tab)
//   - Request the doc from the client
//   - Waive a doc with a reason
//   - Accept / Reject the latest upload
//
// File upload itself is initiated by the client via the portal; the
// upload endpoint on the backend exists and can be wired into an admin
// upload modal in a follow-up commit.

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileX2,
  Loader2,
  MailQuestion,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import {
  GlassCard,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  fmtRelative,
} from '@/components/processing/mockData';
import {
  fetchCaseDocuments,
  getDocumentSignedUrl,
  waiveDocumentItem,
  requestDocumentFromClient,
  reviewDocumentItem,
  type ApiCaseDocumentItem,
  type DocumentItemStatus,
  type DocumentCriticality,
} from '@/lib/processing';

const STATUS_TONE: Record<DocumentItemStatus, BadgeTone> = {
  NOT_SUBMITTED: 'neutral',
  REQUESTED: 'info',
  AWAITING_UPLOAD: 'info',
  UPLOADED: 'cyan',
  UNDER_REVIEW: 'accent',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  WAIVED: 'neutral',
  NOT_APPLICABLE: 'neutral',
  EXPIRED: 'danger',
};

const STATUS_LABEL: Record<DocumentItemStatus, string> = {
  NOT_SUBMITTED: 'Not submitted',
  REQUESTED: 'Requested',
  AWAITING_UPLOAD: 'Awaiting upload',
  UPLOADED: 'Uploaded',
  UNDER_REVIEW: 'Under review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  WAIVED: 'Waived',
  NOT_APPLICABLE: 'N/A',
  EXPIRED: 'Expired',
};

const CRIT_TONE: Record<DocumentCriticality, BadgeTone> = {
  CRITICAL: 'danger',
  REQUIRED: 'warning',
  CONDITIONAL: 'info',
  SUPPORTING: 'neutral',
  OPTIONAL: 'neutral',
};

function DocumentRow({
  d,
  caseId,
  onChange,
}: {
  d: ApiCaseDocumentItem;
  caseId: string;
  onChange: (updated: ApiCaseDocumentItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [showWaive, setShowWaive] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function handleViewFile() {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await getDocumentSignedUrl(caseId, d.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to get file URL');
    } finally {
      setBusy(false);
    }
  }

  async function handleRequest() {
    setBusy(true);
    setErr(null);
    try {
      const updated = await requestDocumentFromClient(caseId, d.id);
      onChange(updated);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to request');
    } finally {
      setBusy(false);
    }
  }

  async function handleWaive() {
    if (waiveReason.trim().length < 5) return;
    setBusy(true);
    setErr(null);
    try {
      const updated = await waiveDocumentItem(caseId, d.id, { waiveReason: waiveReason.trim() });
      onChange(updated);
      setShowWaive(false);
      setWaiveReason('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to waive');
    } finally {
      setBusy(false);
    }
  }

  async function handleReview(decision: 'ACCEPT' | 'REJECT') {
    setBusy(true);
    setErr(null);
    try {
      const updated = await reviewDocumentItem(caseId, d.id, {
        decision,
        rejectionNote: decision === 'REJECT' ? (reviewNote.trim() || undefined) : undefined,
      });
      onChange(updated);
      setShowReview(false);
      setReviewNote('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save review');
    } finally {
      setBusy(false);
    }
  }

  const hasFile = !!d.latestVersion;
  const canReview = hasFile && (d.status === 'UPLOADED' || d.status === 'UNDER_REVIEW');
  const canRequest = !hasFile && (d.status === 'NOT_SUBMITTED' || d.status === 'AWAITING_UPLOAD');
  const canWaive = d.status !== 'ACCEPTED' && d.status !== 'WAIVED' && d.status !== 'NOT_APPLICABLE';

  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ marginTop: 2, color: d.status === 'ACCEPTED' ? 'var(--sos-status-success)' : d.status === 'REJECTED' ? 'var(--sos-status-danger)' : 'var(--sos-text-muted)' }}>
          {d.status === 'ACCEPTED' ? <CheckCircle2 size={14} /> :
            d.status === 'REJECTED' ? <XCircle size={14} /> :
              d.status === 'WAIVED' ? <ShieldAlert size={14} /> :
                <FileCheck2 size={14} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{d.documentName}</span>
            <StatusBadge tone={CRIT_TONE[d.criticality]} size="sm">{d.criticality}</StatusBadge>
            <StatusBadge tone={STATUS_TONE[d.status]} size="sm">{STATUS_LABEL[d.status]}</StatusBadge>
            {d.latestVersion ? (
              <span style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>
                v{d.latestVersion.versionNumber} · {d.latestVersion.fileName}
              </span>
            ) : null}
          </div>
          {d.description ? (
            <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginBottom: 6, lineHeight: 1.5 }}>{d.description}</div>
          ) : null}
          <div style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>
            {d.expectedFormats.length > 0 ? `Accepted: ${d.expectedFormats.join(', ')} · ` : ''}
            {d.validityExpiryDate ? `Expires ${fmtRelative(d.validityExpiryDate)} · ` : ''}
            Updated {fmtRelative(d.updatedAt)}
          </div>

          {err ? (
            <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12 }}>{err}</div>
          ) : null}

          {showReview ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                rows={2}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Rejection note (required for REJECT)…"
                style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13, fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => { setShowReview(false); setReviewNote(''); }} style={{ padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
                <SecondaryButton iconLeft={<XCircle size={13} />} onClick={() => handleReview('REJECT')} disabled={busy || !reviewNote.trim()}>Reject</SecondaryButton>
                <PrimaryButton onClick={() => handleReview('ACCEPT')} disabled={busy}>{busy ? 'Saving…' : 'Accept'}</PrimaryButton>
              </div>
            </div>
          ) : showWaive ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                rows={2}
                value={waiveReason}
                onChange={(e) => setWaiveReason(e.target.value)}
                placeholder="Why is this doc waived? (min 5 chars)"
                style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13, fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => { setShowWaive(false); setWaiveReason(''); }} style={{ padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
                <PrimaryButton onClick={handleWaive} disabled={busy || waiveReason.trim().length < 5}>{busy ? 'Saving…' : 'Waive'}</PrimaryButton>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {hasFile ? (
                <SecondaryButton iconLeft={<ExternalLink size={13} />} onClick={handleViewFile} disabled={busy}>View file</SecondaryButton>
              ) : null}
              {canReview ? (
                <PrimaryButton onClick={() => { setShowReview(true); setReviewNote(''); }} disabled={busy}>Review</PrimaryButton>
              ) : null}
              {canRequest ? (
                <SecondaryButton iconLeft={<MailQuestion size={13} />} onClick={handleRequest} disabled={busy}>Request</SecondaryButton>
              ) : null}
              {canWaive ? (
                <SecondaryButton iconLeft={<ShieldAlert size={13} />} onClick={() => { setShowWaive(true); setWaiveReason(''); }} disabled={busy}>Waive</SecondaryButton>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

export function DocumentChecklistTab({ c }: { c: MockProcessingCase }) {
  const [items, setItems] = useState<ApiCaseDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCaseDocuments(c.id)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load documents'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [c.id]);

  function handleChange(updated: ApiCaseDocumentItem) {
    setItems((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }

  // Progress: count CRITICAL + REQUIRED items that are settled
  // (ACCEPTED / WAIVED / NOT_APPLICABLE).
  const core = items.filter((i) => i.criticality === 'CRITICAL' || i.criticality === 'REQUIRED');
  const settled = core.filter((i) => i.status === 'ACCEPTED' || i.status === 'WAIVED' || i.status === 'NOT_APPLICABLE');
  const pct = core.length > 0 ? Math.round((settled.length / core.length) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" />
            <span>Loading documents…</span>
          </div>
        </GlassCard>
      ) : err ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>
        </GlassCard>
      ) : items.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={FileX2}
            title="No documents on the checklist yet"
            description="Documents auto-populate from the service-type template when the case is acknowledged. If you're seeing this, the acknowledge step may not have completed."
          />
        </GlassCard>
      ) : (
        <>
          {/* Progress strip */}
          <GlassCard variant="panel" padded="md">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                  <span style={{ color: 'var(--sos-text-secondary)', fontWeight: 600 }}>
                    Core documents progress
                  </span>
                  <span style={{ color: 'var(--sos-text-muted)' }}>
                    {settled.length}/{core.length} ({pct}%)
                  </span>
                </div>
                <div style={{ height: 7, background: 'var(--sos-surface-hover)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--sos-status-success)' : 'var(--sos-brand-gradient)', borderRadius: 999, transition: 'width 400ms' }} />
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((d) => (
              <DocumentRow key={d.id} d={d} caseId={c.id} onChange={handleChange} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
