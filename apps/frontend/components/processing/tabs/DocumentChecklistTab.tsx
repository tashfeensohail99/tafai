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
import { useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  FileX2,
  Inbox,
  Loader2,
  MailQuestion,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  X,
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
  uploadOfficerDocument,
  uploadAdditionalDocument,
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
  SUBMITTED: 'cyan',
  REQUESTED: 'info',
  AWAITING_UPLOAD: 'info',
  UPLOADED: 'cyan',
  UNDER_REVIEW: 'accent',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  WAIVED: 'neutral',
  NOT_APPLICABLE: 'neutral',
  EXPIRED: 'danger',
  EXPIRING_SOON: 'warning',
};

const STATUS_LABEL: Record<DocumentItemStatus, string> = {
  NOT_SUBMITTED: 'Not submitted',
  SUBMITTED: 'Uploaded — pending review',
  REQUESTED: 'Requested',
  AWAITING_UPLOAD: 'Awaiting upload',
  UPLOADED: 'Uploaded',
  UNDER_REVIEW: 'Under review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  WAIVED: 'Waived',
  NOT_APPLICABLE: 'N/A',
  EXPIRED: 'Expired',
  EXPIRING_SOON: 'Expiring soon',
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
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Inbound documents — needs filing</span>
        <StatusBadge tone="cyan" size="sm">{inbound.length}</StatusBadge>
        <span style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginLeft: 12 }}>
          Files received via WhatsApp / email / unmatched upload — pick the checklist slot each belongs to (or discard)
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

// ── Shared per-document helpers (used by both the compact card and the modal) ──

function docFlags(d: ApiCaseDocumentItem) {
  const hasFile = !!d.latestVersion;
  // Backend emits SUBMITTED when a doc is uploaded (client or officer); keep
  // UPLOADED as a legacy alias. This is what gates the Accept/Reject control.
  const canReview = hasFile && (d.status === 'SUBMITTED' || d.status === 'UPLOADED' || d.status === 'UNDER_REVIEW');
  const canRequest = !hasFile && (d.status === 'NOT_SUBMITTED' || d.status === 'AWAITING_UPLOAD');
  const canWaive = d.status !== 'ACCEPTED' && d.status !== 'WAIVED' && d.status !== 'NOT_APPLICABLE';
  // Officer upload-on-behalf: allowed whenever the slot still needs a (better)
  // file — i.e. not already accepted/waived/N-A. Lets the team upload for the
  // client or replace a rejected/expired doc.
  const canUpload = d.status !== 'ACCEPTED' && d.status !== 'WAIVED' && d.status !== 'NOT_APPLICABLE';
  return { hasFile, canReview, canRequest, canWaive, canUpload };
}

function StatusIcon({ status, size = 15 }: { status: DocumentItemStatus; size?: number }) {
  if (status === 'ACCEPTED') return <CheckCircle2 size={size} style={{ color: 'var(--sos-status-success)' }} />;
  if (status === 'REJECTED' || status === 'EXPIRED') return <XCircle size={size} style={{ color: 'var(--sos-status-danger)' }} />;
  if (status === 'WAIVED') return <ShieldAlert size={size} style={{ color: 'var(--sos-text-muted)' }} />;
  return <FileCheck2 size={size} style={{ color: 'var(--sos-text-muted)' }} />;
}

// Phase 4b — live expiry emphasis from validityExpiryDate (warns even before
// the 6-hourly sweep flips an accepted doc to EXPIRED).
function ExpiryBadge({ d }: { d: ApiCaseDocumentItem }) {
  if (!d.validityExpiryDate) return null;
  const days = Math.floor((new Date(d.validityExpiryDate).getTime() - Date.now()) / 86_400_000);
  if (days < 0 && d.status !== 'EXPIRED') return <StatusBadge tone="danger" size="sm">Expired</StatusBadge>;
  if (days >= 0 && days <= 30) return <StatusBadge tone="warning" size="sm">Expires in {days}d</StatusBadge>;
  return null;
}

// Left-border accent that tells you what a card needs at a glance.
function cardAccent(d: ApiCaseDocumentItem): string {
  const { canReview, canRequest } = docFlags(d);
  if (d.status === 'REJECTED' || d.status === 'EXPIRED') return 'var(--sos-status-danger)';
  if (canReview) return 'var(--sos-brand-primary)';
  if (d.status === 'ACCEPTED') return 'var(--sos-status-success)';
  if (canRequest || d.status === 'REQUESTED') return 'var(--sos-status-warning)';
  return 'var(--sos-border-subtle)';
}

const AI_DECISION_COLOR: Record<string, string> = {
  APPROVE: 'var(--sos-status-success)',
  REJECT: 'var(--sos-status-danger)',
  NEEDS_REVIEW: 'var(--sos-status-warning)',
};

// Compact, clickable card for the document grid. Everything actionable lives in
// the detail modal (opened on click) so many docs stay scannable side-by-side.
function DocCard({ d, onOpen }: { d: ApiCaseDocumentItem; onOpen: () => void }) {
  const { canReview, canRequest } = docFlags(d);
  const ai = d.aiAssessments && d.aiAssessments.length > 0 ? d.aiAssessments[0] : null;
  const cta = canReview ? 'Review' : d.status === 'REJECTED' ? 'Re-upload' : canRequest ? 'Request' : 'Details';
  const ctaColor = canReview
    ? 'var(--sos-brand-primary)'
    : d.status === 'REJECTED'
      ? 'var(--sos-status-danger)'
      : 'var(--sos-text-muted)';
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${d.documentName}`}
      style={{
        textAlign: 'left', cursor: 'pointer', font: 'inherit', width: '100%',
        display: 'flex', flexDirection: 'column', gap: 8, minHeight: 138,
        padding: '12px 14px', borderRadius: 'var(--sos-radius-md)',
        border: '1px solid var(--sos-border-subtle)', borderLeft: `3px solid ${cardAccent(d)}`,
        background: 'var(--sos-surface)', transition: 'background 150ms, box-shadow 150ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sos-surface-hover)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.18)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--sos-surface)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ marginTop: 1, flexShrink: 0, display: 'inline-flex' }}><StatusIcon status={d.status} /></span>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {d.documentName}
        </span>
      </div>
      {/* Criticality + status + expiry */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <StatusBadge tone={CRIT_TONE[d.criticality]} size="sm">{d.criticality}</StatusBadge>
        <StatusBadge tone={STATUS_TONE[d.status]} size="sm">{STATUS_LABEL[d.status]}</StatusBadge>
        <ExpiryBadge d={d} />
      </div>
      {/* Compact AI verdict */}
      {ai ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, color: AI_DECISION_COLOR[ai.suggestedDecision] ?? 'var(--sos-text-muted)' }}>
            <Sparkles size={11} />
            {DECISION_LABEL[ai.suggestedDecision] ?? ai.suggestedDecision}
            {ai.confidence != null ? ` · ${Math.round(ai.confidence * 100)}%` : ''}
          </span>
          {ai.detectedLanguage ? (
            <span style={{ color: 'var(--sos-status-warning)', fontWeight: 600 }}>⚠ translation</span>
          ) : null}
        </div>
      ) : null}
      {/* Footer: version/updated + open affordance */}
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, fontSize: 11, color: 'var(--sos-text-muted)' }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.latestVersion ? `v${d.latestVersion.versionNumber} · ` : ''}Updated {fmtRelative(d.updatedAt)}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: 700, color: ctaColor, flexShrink: 0 }}>
          {cta} <ChevronRight size={12} />
        </span>
      </div>
    </button>
  );
}

// Full detail + all actions for a single document, in a modal. Reuses the exact
// review/waive/upload/request logic the old inline row had — just relocated so
// the grid stays compact.
function DocDetailModal({
  d,
  caseId,
  onClose,
  onChange,
  onReload,
}: {
  d: ApiCaseDocumentItem;
  caseId: string;
  onClose: () => void;
  onChange: (updated: ApiCaseDocumentItem) => void;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [showWaive, setShowWaive] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      await uploadOfficerDocument(caseId, d.id, file);
      onReload(); // full refetch — picks up new version, SUBMITTED status, async AI assessment
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

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

  const { hasFile, canReview, canRequest, canWaive, canUpload } = docFlags(d);

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
          width: 'min(640px, 96vw)', maxHeight: '88vh', display: 'flex',
          flexDirection: 'column', borderRadius: 'var(--sos-radius-lg)', overflow: 'hidden',
          border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <StatusIcon status={d.status} size={16} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.documentName}</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', padding: 6, borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', cursor: 'pointer', flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <StatusBadge tone={CRIT_TONE[d.criticality]} size="sm">{d.criticality}</StatusBadge>
            <StatusBadge tone={STATUS_TONE[d.status]} size="sm">{STATUS_LABEL[d.status]}</StatusBadge>
            <ExpiryBadge d={d} />
            {d.isAdditional ? <StatusBadge tone="cyan" size="sm">Additional</StatusBadge> : null}
            {d.latestVersion ? (
              <span style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>
                v{d.latestVersion.versionNumber} · {d.latestVersion.fileName}
              </span>
            ) : null}
          </div>

          {d.description ? (
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-secondary)', marginBottom: 6, lineHeight: 1.5 }}>{d.description}</div>
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
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                rows={3}
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
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                rows={3}
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
            <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {hasFile ? (
                <SecondaryButton iconLeft={<ExternalLink size={13} />} onClick={handleViewFile} disabled={busy}>View file</SecondaryButton>
              ) : null}
              {canReview ? (
                <PrimaryButton onClick={() => { setShowReview(true); setReviewNote(''); }} disabled={busy}>Review</PrimaryButton>
              ) : null}
              {canUpload ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    onChange={(e) => handleUpload(e.target.files?.[0])}
                  />
                  <SecondaryButton iconLeft={busy ? <Loader2 size={13} /> : <Upload size={13} />} onClick={() => fileInputRef.current?.click()} disabled={busy}>
                    {hasFile ? 'Replace' : 'Upload for client'}
                  </SecondaryButton>
                </>
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
    </div>
  );
}

export function DocumentChecklistTab({ c }: { c: MockProcessingCase }) {
  const [items, setItems] = useState<ApiCaseDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [reqMsg, setReqMsg] = useState<string | null>(null);
  const [reqBusy, setReqBusy] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const addFileRef = useRef<HTMLInputElement | null>(null);
  // Which document's detail modal is open (compact-card grid → modal pattern).
  const [activeId, setActiveId] = useState<string | null>(null);

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

  async function handleAddAdditional(file: File | undefined) {
    if (!file) return;
    setAddBusy(true);
    setErr(null);
    try {
      await uploadAdditionalDocument(c.id, file);
      reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setAddBusy(false);
      if (addFileRef.current) addFileRef.current.value = '';
    }
  }

  // Template checklist vs the extra "Additional Documents" (client/officer-added,
  // AI-classified). Kept separate so they don't mix with the required slots.
  const checklistItems = items.filter((i) => !i.isAdditional);
  const additionalItems = items.filter((i) => i.isAdditional);
  // Resolve the open doc from live state so the modal always reflects the latest
  // version/status after an action (and auto-closes if the item disappears).
  const activeDoc = activeId ? (items.find((i) => i.id === activeId) ?? null) : null;

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

          {/* Required-checklist items — compact card grid. Open a card for full
              details + actions (replaces the old long vertical list). */}
          {checklistItems.length > 0 ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 2px 8px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--sos-text-secondary)' }}>Checklist documents</span>
                <StatusBadge tone="neutral" size="sm">{checklistItems.length}</StatusBadge>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 }}>
                {checklistItems.map((d) => (
                  <DocCard key={d.id} d={d} onOpen={() => setActiveId(d.id)} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Additional Documents — extra files not on the template checklist
              (client- or team-uploaded). AI-classified; review like any doc. */}
          <GlassCard variant="panel" padded="md">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: additionalItems.length ? 10 : 0 }}>
              <Sparkles size={15} style={{ color: 'var(--sos-text-secondary)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Additional Documents</span>
              {additionalItems.length ? <StatusBadge tone="cyan" size="sm">{additionalItems.length}</StatusBadge> : null}
              <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>
                Extra files outside the checklist — the AI labels each; review and accept or reject.
              </span>
              <div style={{ marginLeft: 'auto' }}>
                <input
                  ref={addFileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  style={{ display: 'none' }}
                  onChange={(e) => handleAddAdditional(e.target.files?.[0])}
                />
                <SecondaryButton
                  iconLeft={addBusy ? <Loader2 size={13} /> : <Plus size={13} />}
                  onClick={() => addFileRef.current?.click()}
                  disabled={addBusy}
                >
                  {addBusy ? 'Uploading…' : 'Add document'}
                </SecondaryButton>
              </div>
            </div>
            {additionalItems.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                None yet — anything the client or team adds outside the checklist shows up here.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 }}>
                {additionalItems.map((d) => (
                  <DocCard key={d.id} d={d} onOpen={() => setActiveId(d.id)} />
                ))}
              </div>
            )}
          </GlassCard>
        </>
      )}

      {/* Detail modal for the clicked card — full info + all actions */}
      {activeDoc ? (
        <DocDetailModal
          d={activeDoc}
          caseId={c.id}
          onClose={() => setActiveId(null)}
          onChange={handleChange}
          onReload={reload}
        />
      ) : null}
    </div>
  );
}
