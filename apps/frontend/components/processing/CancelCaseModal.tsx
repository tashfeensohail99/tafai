'use client';
// Cancel Case Modal — Phase 2C-1.
// Manager-only action. Calls PATCH /processing/cases/:id/stage
// with { toStage: 'CANCELLED', cancellationReason }.
// Backend already enforces processing.case.view_all + reason required.

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  STAGE_LABEL,
} from '@/components/processing/mockData';
import { changeCaseStage } from '@/lib/processing';

// ---------- Overlay styles (shared pattern with StageChangeModal) ----------

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

// ---------- Component -------------------------------------------------------

interface CancelCaseModalProps {
  caseRecord: MockProcessingCase;
  onClose: () => void;
  /** Called after a successful cancel so the parent can refetch. */
  onCancelled?: () => void;
}

export function CancelCaseModal({ caseRecord: c, onClose, onCancelled }: CancelCaseModalProps) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = reason.trim().length >= 10 && confirmed && !loading;

  async function handleCancel() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      // Backend ChangeCaseStageDto: when toStage=CANCELLED the
      // cancellationReason field is required (server returns 400 otherwise).
      // The reason textarea here is the source of truth.
      await changeCaseStage(c.id, {
        toStage: 'CANCELLED',
        cancellationReason: reason.trim(),
      });
      setDone(true);
      onCancelled?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to cancel case');
    } finally {
      setLoading(false);
    }
  }

  /* ---- Done state ---- */
  if (done) {
    return (
      <div style={overlayStyle}>
        <div
          className="sos-glass sos-glass--strong"
          style={{ width: '100%', maxWidth: '460px', padding: '28px', borderRadius: 'var(--sos-radius-lg)', textAlign: 'center' }}
        >
          <CheckCircle2 size={40} style={{ color: 'var(--sos-status-success)', marginBottom: '12px' }} />
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '8px' }}>
            Case Cancelled
          </div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>
            {c.clientName}&apos;s case has been cancelled and locked. No further actions can be taken.
          </div>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    );
  }

  return (
    <div
      style={overlayStyle}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="sos-glass sos-glass--strong"
        style={{
          width: '100%',
          maxWidth: '500px',
          padding: '28px',
          borderRadius: 'var(--sos-radius-lg)',
          position: 'relative',
        }}
      >
        {/* Close button */}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'transparent',
            border: 'none',
            color: 'var(--sos-text-muted)',
            cursor: 'pointer',
            padding: '6px',
          }}
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--sos-status-danger)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <XCircle size={13} /> Cancel case
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
            {c.clientName}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginTop: '3px' }}>
            {c.service} · {c.targetCountry} · Currently:{' '}
            <strong>{STAGE_LABEL[c.stage]}</strong>
          </div>
        </div>

        {/* Warning banner */}
        <GlassCard variant="panel" padded="md" style={{ marginBottom: '18px', border: '1px solid var(--sos-status-danger-border)', background: 'var(--sos-status-danger-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <AlertTriangle size={18} style={{ color: 'var(--sos-status-danger)', flexShrink: 0, marginTop: '1px' }} />
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-status-danger)', marginBottom: '4px' }}>
                This action is irreversible
              </div>
              <div style={{ fontSize: '13px', color: 'var(--sos-text-primary)', lineHeight: '1.5' }}>
                Cancelling this case will lock it permanently. All assigned documents, tasks, and submissions will be archived. The client will need a new case to proceed.
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Reason field */}
        <div style={{ marginBottom: '16px' }}>
          <label
            htmlFor="cancelReason"
            style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}
          >
            Cancellation reason <span style={{ color: 'var(--sos-status-danger)' }}>*</span>
          </label>
          <textarea
            id="cancelReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe why this case is being cancelled (min 10 characters)…"
            rows={3}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 'var(--sos-radius-md)',
              border: `1px solid ${reason.trim().length > 0 && reason.trim().length < 10 ? 'var(--sos-status-danger-border)' : 'var(--sos-border-subtle)'}`,
              background: 'var(--sos-surface-input)',
              color: 'var(--sos-text-primary)',
              fontSize: '13.5px',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          {reason.trim().length > 0 && reason.trim().length < 10 ? (
            <div style={{ fontSize: '11.5px', color: 'var(--sos-status-danger)', marginTop: '4px' }}>
              Reason must be at least 10 characters.
            </div>
          ) : null}
        </div>

        {/* Confirmation checkbox */}
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            marginBottom: '20px',
            cursor: 'pointer',
            padding: '12px 14px',
            borderRadius: 'var(--sos-radius-md)',
            border: `1px solid ${confirmed ? 'var(--sos-status-danger-border)' : 'var(--sos-border-subtle)'}`,
            background: confirmed ? 'var(--sos-status-danger-soft)' : 'var(--sos-surface-hover)',
            transition: 'all 150ms',
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ marginTop: '2px', accentColor: 'var(--sos-status-danger)', flexShrink: 0 }}
          />
          <span style={{ fontSize: '13px', color: 'var(--sos-text-primary)', lineHeight: '1.5' }}>
            I confirm that this cancellation has been reviewed and cannot be undone. I take responsibility for this action.
          </span>
        </label>

        {error ? (
          <div style={{ marginBottom: '14px', padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: '12.5px' }}>
            {error}
          </div>
        ) : null}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={onClose} disabled={loading}>
            Keep case
          </SecondaryButton>
          <button
            type="button"
            onClick={handleCancel}
            disabled={!canSubmit}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              padding: '9px 20px',
              borderRadius: 'var(--sos-radius-md)',
              border: '1px solid var(--sos-status-danger-border)',
              background: canSubmit
                ? 'var(--sos-status-danger)'
                : 'var(--sos-surface-hover)',
              color: canSubmit ? '#fff' : 'var(--sos-text-muted)',
              fontSize: '13.5px',
              fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'all 150ms',
              opacity: loading ? 0.7 : 1,
            }}
          >
            <XCircle size={14} />
            {loading ? 'Cancelling…' : 'Cancel case'}
          </button>
        </div>
      </div>
    </div>
  );
}
