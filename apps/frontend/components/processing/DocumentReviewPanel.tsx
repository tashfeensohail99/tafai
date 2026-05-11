'use client';
// Document Review Panel — Phase 1B.
// Officer views a "document" (simulated with a placeholder viewer), then
// accepts or rejects it. Rejection requires selecting at least one reason code.

import { useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Download,
  FileText,
  Info,
  XCircle,
} from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  type MockDocumentItem,
  DOC_STATUS_LABEL,
  REJECTION_REASON_LABEL,
  fmtDate,
} from '@/components/processing/mockData';

type DocumentItemStatus = MockDocumentItem['status'];

function docStatusTone(status: DocumentItemStatus): BadgeTone {
  switch (status) {
    case 'ACCEPTED': return 'success';
    case 'REJECTED': return 'danger';
    case 'UNDER_REVIEW': return 'accent';
    case 'SUBMITTED': return 'info';
    default: return 'neutral';
  }
}

interface DocumentReviewPanelProps {
  item: MockDocumentItem;
  caseId: string;
  onBack: () => void;
}

export function DocumentReviewPanel({ item, caseId, onBack }: DocumentReviewPanelProps) {
  const [decision, setDecision] = useState<'ACCEPT' | 'REJECT' | null>(null);
  const [selectedReasons, setSelectedReasons] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const reasonCodes = Object.keys(REJECTION_REASON_LABEL);

  function toggleReason(code: string) {
    setSelectedReasons((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function handleSubmit() {
    if (!decision) return;
    if (decision === 'REJECT' && selectedReasons.size === 0) return;
    setLoading(true);
    // Replace with real API call: POST /processing/cases/:caseId/documents/:itemId/review
    setTimeout(() => {
      setSubmitted(true);
      setLoading(false);
    }, 800);
  }

  if (submitted) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          {decision === 'ACCEPT' ? (
            <>
              <CheckCircle2 size={40} style={{ color: 'var(--sos-status-success)', marginBottom: '12px' }} />
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '6px' }}>Document accepted</div>
              <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>{item.documentName} has been marked as accepted.</div>
            </>
          ) : (
            <>
              <XCircle size={40} style={{ color: 'var(--sos-status-danger)', marginBottom: '12px' }} />
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '6px' }}>Document rejected</div>
              <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>The client has been notified to resubmit {item.documentName}.</div>
            </>
          )}
          <SecondaryButton onClick={onBack} iconLeft={<ArrowLeft size={14} />}>
            Back to checklist
          </SecondaryButton>
        </div>
      </GlassCard>
    );
  }

  const canSubmit =
    decision === 'ACCEPT' ||
    (decision === 'REJECT' && selectedReasons.size > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          type="button"
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: 'var(--sos-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0' }}
        >
          <ArrowLeft size={14} /> Back to checklist
        </button>
      </div>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        {/* Document viewer (simulated) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <GlassCard variant="panel" padded={false} style={{ minHeight: '420px', display: 'flex', flexDirection: 'column' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
              <FileText size={15} style={{ color: 'var(--sos-text-muted)' }} />
              <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{item.documentName}</span>
              {item.versionNumber ? (
                <StatusBadge tone="neutral" size="sm" dot={false}>v{item.versionNumber}</StatusBadge>
              ) : null}
              <StatusBadge tone={docStatusTone(item.status)} size="sm">{DOC_STATUS_LABEL[item.status]}</StatusBadge>
              <button
                type="button"
                title="Download"
                style={{ background: 'transparent', border: '1px solid var(--sos-border-subtle)', borderRadius: 'var(--sos-radius-sm)', padding: '5px 8px', color: 'var(--sos-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
              >
                <Download size={13} /> Download
              </button>
            </div>

            {/* Viewer placeholder */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--sos-text-muted)', textAlign: 'center' }}>
              <FileText size={52} style={{ marginBottom: '16px', opacity: 0.35 }} />
              <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: 'var(--sos-text-primary)' }}>
                Document viewer
              </div>
              <div style={{ fontSize: '13px', marginBottom: '16px' }}>
                Secure signed URL will load the actual document here.<br />
                (Virus-scanned · Signed for 15 min · CLEAN gate enforced by backend)
              </div>
              <div style={{ padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-info-soft)', border: '1px solid var(--sos-status-info-border)', fontSize: '12.5px', color: 'var(--sos-status-info)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Info size={13} /> API: GET /processing/cases/{caseId}/documents/{item.id}/signed-url
              </div>
            </div>

            {/* Meta row */}
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--sos-border-subtle)', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
              {item.uploadedAt ? <span>Uploaded: {fmtDate(item.uploadedAt)}</span> : null}
              {item.validityExpiryDate ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Calendar size={11} /> Expires: {fmtDate(item.validityExpiryDate)}
                </span>
              ) : null}
              <span>Formats: {item.expectedFormats.join(' / ')}</span>
            </div>
          </GlassCard>
        </div>

        {/* Review form */}
        <div style={{ width: '280px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Decision selector */}
          <GlassCard variant="panel" padded="md">
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Review decision
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', border: `1px solid ${decision === 'ACCEPT' ? 'var(--sos-status-success-border)' : 'var(--sos-border-subtle)'}`, background: decision === 'ACCEPT' ? 'var(--sos-status-success-soft)' : 'transparent', cursor: 'pointer', transition: 'all 150ms' }}
              >
                <input
                  type="radio"
                  name="decision"
                  value="ACCEPT"
                  checked={decision === 'ACCEPT'}
                  onChange={() => setDecision('ACCEPT')}
                  style={{ accentColor: 'var(--sos-status-success)' }}
                />
                <CheckCircle2 size={15} style={{ color: 'var(--sos-status-success)' }} />
                <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>Accept</span>
              </label>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', border: `1px solid ${decision === 'REJECT' ? 'var(--sos-status-danger-border)' : 'var(--sos-border-subtle)'}`, background: decision === 'REJECT' ? 'var(--sos-status-danger-soft)' : 'transparent', cursor: 'pointer', transition: 'all 150ms' }}
              >
                <input
                  type="radio"
                  name="decision"
                  value="REJECT"
                  checked={decision === 'REJECT'}
                  onChange={() => setDecision('REJECT')}
                  style={{ accentColor: 'var(--sos-status-danger)' }}
                />
                <XCircle size={15} style={{ color: 'var(--sos-status-danger)' }} />
                <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>Reject</span>
              </label>
            </div>
          </GlassCard>

          {/* Rejection reasons (only when REJECT selected) */}
          {decision === 'REJECT' ? (
            <GlassCard variant="panel" padded="md">
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-status-danger)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
                Reason codes *
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {reasonCodes.map((code) => (
                  <label
                    key={code}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 0' }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedReasons.has(code)}
                      onChange={() => toggleReason(code)}
                      style={{ accentColor: 'var(--sos-status-danger)', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: '12.5px', color: 'var(--sos-text-primary)' }}>{REJECTION_REASON_LABEL[code]}</span>
                  </label>
                ))}
              </div>
              {selectedReasons.size === 0 ? (
                <div style={{ marginTop: '8px', fontSize: '11.5px', color: 'var(--sos-status-danger)' }}>
                  Select at least one reason
                </div>
              ) : null}
            </GlassCard>
          ) : null}

          {/* Optional note */}
          <GlassCard variant="panel" padded="md">
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Note to client (optional)
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional context for the client…"
              rows={3}
              style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </GlassCard>

          {/* Submit */}
          <PrimaryButton
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
            fullWidth
            iconLeft={decision === 'ACCEPT' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          >
            {loading ? 'Submitting…' : decision === 'ACCEPT' ? 'Confirm: Accept' : decision === 'REJECT' ? 'Confirm: Reject' : 'Select a decision'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
