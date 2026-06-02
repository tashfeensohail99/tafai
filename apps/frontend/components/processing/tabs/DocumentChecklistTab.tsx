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

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileX2,
  Inbox,
  Loader2,
  MailQuestion,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
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
  fetchInboundDocuments,
  fileInboundDocument,
  discardInboundDocument,
  requestMissingDocuments,
  updateDocumentAttestation,
  type ApiCaseDocumentItem,
  type ApiDocumentAiAssessment,
  type ApiInboundDocument,
  type DocumentItemStatus,
  type DocumentCriticality,
} from '@/lib/processing';
import { SplitReviewerModal } from '@/components/processing/SplitReviewerModal';
import { IdentityReconciliationPanel } from '@/components/processing/IdentityReconciliationPanel';
import { AttestationPlanPanel } from '@/components/processing/AttestationPlanPanel';

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

// Short human labels for the parser's check codes (falls back to the raw code).
const CHECK_LABEL: Record<string, string> = {
  DOC_TYPE_MATCH: 'Type',
  NAME_MATCH: 'Name',
  DOB_MATCH: 'DOB',
  PASSPORT_NO_MATCH: 'Passport #',
  ID_NO_MATCH: 'ID #',
  NOT_EXPIRED: 'Validity',
  VALID_FOR_PERIOD: 'Validity',
  EXPIRY_FOUND: 'Expiry',
  RECENT_STATEMENT: 'Recency',
  FRONT_AND_BACK: 'Front + back',
  PASSPORT_COMPLETE: 'Complete',
  STATEMENT_COMPLETE: 'Complete',
  DOCUMENT_COMPLETE: 'Complete',
  NOT_BLURRY: 'Sharp',
  ASPECT_RATIO: 'Size',
  BACKGROUND: 'Background',
  SINGLE_FACE: 'Face',
  PHOTO_UNREADABLE: 'Readable',
};

const DECISION_TONE: Record<string, BadgeTone> = {
  APPROVE: 'success',
  REJECT: 'danger',
  NEEDS_REVIEW: 'warning',
};
const DECISION_LABEL: Record<string, string> = {
  APPROVE: 'AI suggests approve',
  REJECT: 'AI suggests reject',
  NEEDS_REVIEW: 'AI: needs review',
};

function AiAssessmentBlock({ a }: { a: ApiDocumentAiAssessment }) {
  const conf = a.confidence != null ? `${Math.round(a.confidence * 100)}%` : null;
  return (
    <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--sos-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <Sparkles size={12} /> AI check
        </span>
        <StatusBadge tone={DECISION_TONE[a.suggestedDecision] ?? 'neutral'} size="sm">
          {DECISION_LABEL[a.suggestedDecision] ?? a.suggestedDecision}
        </StatusBadge>
        {conf ? <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{conf} confidence</span> : null}
        {a.autoApproved ? <StatusBadge tone="success" size="sm">Auto-approved</StatusBadge> : null}
        {/* P4f: translation-needed hint */}
        {a.detectedLanguage ? (
          <span
            title={`AI detected non-Latin script (${a.detectedLanguage}) in this document — it may need certified translation. Suggestion only; confirm with associate.`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
              fontSize: 11, fontWeight: 600,
              background: 'var(--sos-status-warning-soft)', color: 'var(--sos-status-warning)',
              border: '1px solid var(--sos-status-warning-border)',
            }}
          >
            ⚠ translation needed · {a.detectedLanguage}
          </span>
        ) : null}
        {a.detectedDocType ? (
          <span style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>detected: {a.detectedDocType}</span>
        ) : null}
      </div>
      {a.errorMessage ? (
        <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--sos-text-muted)' }}>AI couldn’t assess: {a.errorMessage}</div>
      ) : null}
      {a.checks && a.checks.length > 0 ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {a.checks.map((ck) => (
            <span
              key={ck.code}
              title={ck.detail}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
                fontSize: 11, fontWeight: 600,
                background: ck.pass ? 'var(--sos-status-success-soft)' : 'var(--sos-status-danger-soft)',
                color: ck.pass ? 'var(--sos-status-success)' : 'var(--sos-status-danger)',
                border: `1px solid ${ck.pass ? 'var(--sos-status-success-border)' : 'var(--sos-status-danger-border)'}`,
              }}
            >
              {ck.pass ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
              {CHECK_LABEL[ck.code] ?? ck.code}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// WhatsApp/email/portal documents that arrived without a slot, awaiting triage.
function InboundTray({
  caseId,
  items,
  onFiled,
}: {
  caseId: string;
  items: ApiCaseDocumentItem[];
  onFiled: () => void;
}) {
  const [inbound, setInbound] = useState<ApiInboundDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [showReviewer, setShowReviewer] = useState(false);

  const load = useCallback(() => {
    fetchInboundDocuments(caseId)
      .then((rows) => setInbound(rows))
      .catch(() => { /* tray is best-effort */ })
      .finally(() => setLoading(false));
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  async function handleFile(d: ApiInboundDocument) {
    const itemId = picks[d.id] ?? d.suggestedItemId ?? '';
    if (!itemId) { setErr('Pick a document slot first'); return; }
    setBusyId(d.id); setErr(null);
    try {
      await fileInboundDocument(caseId, d.id, itemId);
      setInbound((prev) => prev.filter((x) => x.id !== d.id));
      onFiled();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to file document');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDiscard(d: ApiInboundDocument) {
    setBusyId(d.id); setErr(null);
    try {
      await discardInboundDocument(caseId, d.id);
      setInbound((prev) => prev.filter((x) => x.id !== d.id));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to discard');
    } finally {
      setBusyId(null);
    }
  }

  if (loading || inbound.length === 0) return null;

  const fileable = items.filter(
    (i) => i.status !== 'WAIVED' && i.status !== 'ACCEPTED' && i.status !== 'NOT_APPLICABLE',
  );

  return (
    <>
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Inbox size={15} style={{ color: 'var(--sos-text-secondary)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Inbound documents</span>
        <StatusBadge tone="cyan" size="sm">{inbound.length}</StatusBadge>
        <span style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginLeft: 12 }}>
          Sent by the client — review with previews, or file inline
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <PrimaryButton iconLeft={<Sparkles size={13} />} onClick={() => setShowReviewer(true)}>
            Review with previews
          </PrimaryButton>
        </div>
      </div>
      {err ? <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--sos-status-danger)' }}>{err}</div> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {inbound.map((d) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)' }}>
            <StatusBadge tone="success" size="sm">{d.source}</StatusBadge>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sos-text-primary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.fileName}</span>
            {d.detectedDocType ? (
              <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>
                AI: {d.detectedDocType}{d.classifyConfidence != null ? ` (${Math.round(d.classifyConfidence * 100)}%)` : ''}
              </span>
            ) : null}
            <select
              value={picks[d.id] ?? d.suggestedItemId ?? ''}
              onChange={(e) => setPicks((p) => ({ ...p, [d.id]: e.target.value }))}
              style={{ marginLeft: 'auto', maxWidth: 200, padding: '5px 8px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface)', color: 'var(--sos-text-primary)', fontSize: 12 }}
            >
              <option value="">Choose slot…</option>
              {fileable.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.documentName}{d.suggestedItemId === it.id ? ' (suggested)' : ''}
                </option>
              ))}
            </select>
            <SecondaryButton iconLeft={<FileCheck2 size={13} />} onClick={() => handleFile(d)} disabled={busyId === d.id}>File</SecondaryButton>
            <button type="button" onClick={() => handleDiscard(d)} disabled={busyId === d.id} title="Discard" style={{ padding: '6px 8px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', cursor: 'pointer' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </GlassCard>
    {showReviewer ? (
      <SplitReviewerModal
        caseId={caseId}
        items={items}
        onClose={() => { setShowReviewer(false); load(); }}
        onChanged={onFiled}
      />
    ) : null}
    </>
  );
}

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
            {(() => {
              // Phase 4b — live expiry emphasis from validityExpiryDate (warns
              // even before the 6-hourly sweep flips an accepted doc to EXPIRED).
              if (!d.validityExpiryDate) return null;
              const days = Math.floor(
                (new Date(d.validityExpiryDate).getTime() - Date.now()) / 86_400_000,
              );
              if (days < 0 && d.status !== 'EXPIRED') {
                return <StatusBadge tone="danger" size="sm">Expired</StatusBadge>;
              }
              if (days >= 0 && days <= 30) {
                return <StatusBadge tone="warning" size="sm">Expires in {days}d</StatusBadge>;
              }
              return null;
            })()}
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

          {d.aiAssessments && d.aiAssessments.length > 0 ? (
            <AiAssessmentBlock a={d.aiAssessments[0]} />
          ) : null}

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
  const [reqMsg, setReqMsg] = useState<string | null>(null);
  const [reqBusy, setReqBusy] = useState(false);

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

  // Re-pull the checklist (e.g. after filing an inbound doc into a slot).
  function reload() {
    fetchCaseDocuments(c.id).then(setItems).catch(() => { /* keep prior state */ });
  }

  async function handleRequestMissing() {
    setReqBusy(true);
    setReqMsg(null);
    try {
      const r = await requestMissingDocuments(c.id);
      setReqMsg(
        r.missingCount === 0
          ? 'All documents submitted — nothing to request.'
          : `Requested ${r.missingCount} document(s) via WhatsApp${r.warning ? ` — ${r.warning}` : ''}.`,
      );
    } catch (e: unknown) {
      setReqMsg(e instanceof Error ? e.message : 'Failed to send request');
    } finally {
      setReqBusy(false);
    }
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
              <SecondaryButton iconLeft={<Send size={13} />} onClick={handleRequestMissing} disabled={reqBusy}>
                {reqBusy ? 'Sending…' : 'Request missing'}
              </SecondaryButton>
            </div>
            {reqMsg ? (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--sos-text-secondary)' }}>{reqMsg}</div>
            ) : null}
          </GlassCard>

          {/* Attestation plan (Phase 4c) — what needs MOFA/HEC/etc., up front */}
          <AttestationPlanPanel
            audience="associate"
            items={items.map((i) => ({
              id: i.id,
              documentName: i.documentName,
              attestationStatus: i.attestationStatus ?? 'NOT_REQUIRED',
              attestationChain: i.attestationChain ?? null,
              detectedAuthorities: i.aiAssessments?.[0]?.detectedAuthorities ?? [],
            }))}
            onUpdate={async (itemId, status) => {
              await updateDocumentAttestation(c.id, itemId, { status });
              reload();
            }}
          />

          {/* Cross-document identity reconciliation (Phase 4) */}
          <IdentityReconciliationPanel caseId={c.id} />

          {/* Inbound triage tray (WhatsApp/email/portal) */}
          <InboundTray caseId={c.id} items={items} onFiled={reload} />

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
