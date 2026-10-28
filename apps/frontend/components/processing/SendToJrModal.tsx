'use client';
// Send to JR Modal — moves a mis-routed Judicial-Review case (service
// JR_RESUBMISSION) out of Processing and into the JR department.
//
// Context: before the finance→JR route existed, a paid JR agreement could be
// handed to Processing by mistake. This button corrects that: it opens the JR
// matter the file should have been, and retires THIS case from Processing
// (stage CANCELLED — kept in history, never deleted). The JR team completes
// intake afterwards, so every field here is OPTIONAL.
//
// Wire: POST /jr/matters/transfer-from-processing/:caseId (requires
// jr.matter.create). Mirrors CloseCaseModal's confirm-dialog idioms.

import { useState } from 'react';
import { Scale, X } from 'lucide-react';
import { GlassCard, SecondaryButton } from '@/components/sales-v2/ui';
import { type MockProcessingCase, STAGE_LABEL } from '@/components/processing/mockData';
import { transferCaseToJr } from '@/lib/processing';

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
};

// JrDecisionMaker enum (schema `legal`) — label-humanised for the optional picker.
const DECISION_MAKER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'VISA_OFFICER', label: 'Visa officer' },
  { value: 'IRCC_IN_CANADA', label: 'IRCC (in Canada)' },
  { value: 'CPC', label: 'CPC' },
  { value: 'CBSA', label: 'CBSA' },
  { value: 'ID', label: 'Immigration Division (ID)' },
  { value: 'IAD', label: 'Immigration Appeal Division (IAD)' },
  { value: 'RAD', label: 'Refugee Appeal Division (RAD)' },
  { value: 'RPD', label: 'Refugee Protection Division (RPD)' },
  { value: 'OTHER', label: 'Other' },
];

interface SendToJrModalProps {
  caseRecord: MockProcessingCase;
  onClose: () => void;
  /** Called after a successful transfer so the parent can refetch. */
  onTransferred?: () => void;
}

export function SendToJrModal({ caseRecord: c, onClose, onTransferred }: SendToJrModalProps) {
  const [decisionMaker, setDecisionMaker] = useState('');
  const [applicationType, setApplicationType] = useState('');
  const [decisionCommunicatedAt, setDecisionCommunicatedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [matterNumber, setMatterNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A case whose service isn't already JR_RESUBMISSION is being RECLASSIFIED as
  // Judicial Review (a sales mis-label) on the way to JR — reflect that in the copy.
  const reclassifying = c.service !== 'JR_RESUBMISSION';

  async function handleTransfer() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const matter = await transferCaseToJr(c.id, {
        decisionMaker: decisionMaker || undefined,
        applicationType: applicationType.trim() || undefined,
        // <input type="date"> gives YYYY-MM-DD; send as a date-only ISO string.
        decisionCommunicatedAt: decisionCommunicatedAt || undefined,
      });
      setMatterNumber(matter.matterNumber);
      setDone(true);
      onTransferred?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send this case to JR');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div data-sos-modal="" style={overlayStyle}>
        <div
          className="sos-glass sos-glass--strong"
          style={{ width: '100%', maxWidth: '460px', padding: '28px', borderRadius: 'var(--sos-radius-lg)', textAlign: 'center' }}
        >
          <Scale size={40} style={{ color: 'var(--sos-brand-primary-strong)', marginBottom: '12px' }} />
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '8px' }}>
            Sent to JR
          </div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>
            {c.clientName}&apos;s case is now JR matter{' '}
            <strong style={{ color: 'var(--sos-text-primary)' }}>{matterNumber}</strong>. It has been
            closed in Processing (kept in history) — the JR team completes intake from here.
          </div>
          <SecondaryButton onClick={onClose}>Done</SecondaryButton>
        </div>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 'var(--sos-radius-md)',
    border: '1px solid var(--sos-border-subtle)',
    background: 'var(--sos-surface-input)',
    color: 'var(--sos-text-primary)',
    fontSize: '13.5px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--sos-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '6px',
  };

  return (
    <div
      data-sos-modal="" style={overlayStyle}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="sos-glass sos-glass--strong"
        style={{ width: '100%', maxWidth: '520px', padding: '28px', borderRadius: 'var(--sos-radius-lg)', position: 'relative' }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer', padding: '6px' }}
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Scale size={13} /> Send to JR
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>{c.clientName}</div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginTop: '3px' }}>
            {c.service} · {c.targetCountry} · Currently: <strong>{STAGE_LABEL[c.stage]}</strong>
          </div>
        </div>

        {/* Explanation banner */}
        <GlassCard variant="panel" padded="md" style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-primary)', lineHeight: '1.55' }}>
            {reclassifying ? (
              <>
                This case is currently filed as <strong>{c.service}</strong>, but it is a Judicial
                Review matter. Sending it to JR <strong>reclassifies it as Judicial Review</strong>,{' '}
                <strong>moves it to the JR department</strong> as a new matter, and{' '}
                <strong>closes it here in Processing</strong> (it stays visible in history). The JR
                team completes the legal intake — the fields below are optional and can be set later.
              </>
            ) : (
              <>
                This is a Judicial Review case that was routed into Processing by mistake. Sending it
                to JR <strong>moves it to the Judicial Review department</strong> as a new matter and{' '}
                <strong>closes it here in Processing</strong> (it stays visible in history). The JR
                team completes the legal intake — the fields below are optional and can be set later.
              </>
            )}
          </div>
        </GlassCard>

        {/* Optional intake fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
          <div>
            <label htmlFor="jrDecisionMaker" style={labelStyle}>Decision maker (optional)</label>
            <select
              id="jrDecisionMaker"
              value={decisionMaker}
              onChange={(e) => setDecisionMaker(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">— JR team will set —</option>
              {DECISION_MAKER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="jrApplicationType" style={labelStyle}>Application type (optional)</label>
            <input
              id="jrApplicationType"
              type="text"
              value={applicationType}
              maxLength={80}
              placeholder="e.g. Judicial Review"
              onChange={(e) => setApplicationType(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="jrDecisionDate" style={labelStyle}>Decision communicated date (optional)</label>
            <input
              id="jrDecisionDate"
              type="date"
              value={decisionCommunicatedAt}
              onChange={(e) => setDecisionCommunicatedAt(e.target.value)}
              style={inputStyle}
            />
            <div style={{ fontSize: '11.5px', color: 'var(--sos-text-faint)', marginTop: '4px' }}>
              The day the client was notified of the refusal — starts the filing clock. Leave blank
              if unsure; the JR team verifies and sets it.
            </div>
          </div>
        </div>

        {error ? (
          <div style={{ marginBottom: '14px', padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: '12.5px' }}>
            {error}
          </div>
        ) : null}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={onClose} disabled={loading}>Cancel</SecondaryButton>
          <button
            type="button"
            onClick={handleTransfer}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              padding: '9px 20px',
              borderRadius: 'var(--sos-radius-md)',
              border: '1px solid var(--sos-brand-primary-border, var(--sos-border-default))',
              background: loading ? 'var(--sos-surface-hover)' : 'var(--sos-brand-primary-strong)',
              color: loading ? 'var(--sos-text-muted)' : '#fff',
              fontSize: '13.5px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 150ms',
            }}
          >
            <Scale size={14} />
            {loading ? 'Sending…' : 'Send to JR'}
          </button>
        </div>
      </div>
    </div>
  );
}
