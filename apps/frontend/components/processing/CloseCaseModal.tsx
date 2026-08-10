'use client';
// Close Case Modal -- 2026-08-10.
//
// The processing team's own vocabulary (Wajiha, 2026-08-10):
//   CLOSE  = submitted and decision done (success OR rejected-no-appeal)
//   CANCEL = client didn't proceed, moving to refund
//   JUNK   = mistake / duplicate / test data
//
// So Close is the natural, non-destructive "we're done here" action for a case
// whose authority decision is final. Distinct from Cancel (destructive,
// refund-flavoured, manager-only, uses cancellationReason) and from Junk
// (removes from history). Reachable from APPROVED, REJECTED, or an
// APPEAL_IN_PROGRESS whose appeal has resolved.
//
// Wire: PATCH /processing/cases/:id/stage with { toStage: 'COMPLETED',
// completionNotes }. Server requires completionNotes (see processing.service
// changeCaseStage) and stamps completedAt.

import { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import {
  GlassCard,
  SecondaryButton,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  STAGE_LABEL,
} from '@/components/processing/mockData';
import { changeCaseStage } from '@/lib/processing';

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

interface CloseCaseModalProps {
  caseRecord: MockProcessingCase;
  onClose: () => void;
  /** Called after a successful close so the parent can refetch. */
  onClosed?: () => void;
}

export function CloseCaseModal({ caseRecord: c, onClose, onClosed }: CloseCaseModalProps) {
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server enforces completionNotes required + <= 2000 chars. Match the
  // Cancel modal's ~10-char floor so a one-word entry doesn't get through and
  // reduce the audit trail to noise.
  const canSubmit = notes.trim().length >= 10 && !loading;

  async function handleClose() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await changeCaseStage(c.id, {
        toStage: 'COMPLETED',
        completionNotes: notes.trim(),
      });
      setDone(true);
      onClosed?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to close case');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div style={overlayStyle}>
        <div
          className="sos-glass sos-glass--strong"
          style={{ width: '100%', maxWidth: '460px', padding: '28px', borderRadius: 'var(--sos-radius-lg)', textAlign: 'center' }}
        >
          <CheckCircle2 size={40} style={{ color: 'var(--sos-status-success)', marginBottom: '12px' }} />
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '8px' }}>
            Case Closed
          </div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>
            {c.clientName}&apos;s case has been closed. It moves to the completed set and won&apos;t appear in active queues.
          </div>
          <SecondaryButton onClick={onClose}>Done</SecondaryButton>
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
              color: 'var(--sos-status-success)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <CheckCircle2 size={13} /> Close case
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
            {c.clientName}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginTop: '3px' }}>
            {c.service} · {c.targetCountry} · Currently:{' '}
            <strong>{STAGE_LABEL[c.stage]}</strong>
          </div>
        </div>

        {/* Explanation banner (non-destructive tone) */}
        <GlassCard variant="panel" padded="md" style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-primary)', lineHeight: '1.55' }}>
            Use <strong>Close</strong> when the case has been submitted, the authority decision
            has been received, and no further work is planned. The case moves to the completed
            set and stops appearing in active queues -- you can still view it in history.
            <br />
            <br />
            If the client withdrew and a refund is owed, use <strong>Cancel case</strong>
            {' '}instead. If this is spam or a duplicate, use <strong>Mark as junk</strong>.
          </div>
        </GlassCard>

        {/* Notes field */}
        <div style={{ marginBottom: '20px' }}>
          <label
            htmlFor="closeNotes"
            style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}
          >
            Closing notes <span style={{ color: 'var(--sos-status-danger)' }}>*</span>
          </label>
          <textarea
            id="closeNotes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Outcome + any handover context (e.g. Visa approved and collected, client notified. No further action.)"
            rows={3}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 'var(--sos-radius-md)',
              border: `1px solid ${notes.trim().length > 0 && notes.trim().length < 10 ? 'var(--sos-status-danger-border)' : 'var(--sos-border-subtle)'}`,
              background: 'var(--sos-surface-input)',
              color: 'var(--sos-text-primary)',
              fontSize: '13.5px',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          {notes.trim().length > 0 && notes.trim().length < 10 ? (
            <div style={{ fontSize: '11.5px', color: 'var(--sos-status-danger)', marginTop: '4px' }}>
              Notes must be at least 10 characters.
            </div>
          ) : null}
        </div>

        {error ? (
          <div style={{ marginBottom: '14px', padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: '12.5px' }}>
            {error}
          </div>
        ) : null}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={onClose} disabled={loading}>
            Not yet
          </SecondaryButton>
          <button
            type="button"
            onClick={handleClose}
            disabled={!canSubmit}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              padding: '9px 20px',
              borderRadius: 'var(--sos-radius-md)',
              border: '1px solid var(--sos-status-success-border)',
              background: canSubmit
                ? 'var(--sos-status-success)'
                : 'var(--sos-surface-hover)',
              color: canSubmit ? '#fff' : 'var(--sos-text-muted)',
              fontSize: '13.5px',
              fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'all 150ms',
              opacity: loading ? 0.7 : 1,
            }}
          >
            <CheckCircle2 size={14} />
            {loading ? 'Closing…' : 'Close case'}
          </button>
        </div>
      </div>
    </div>
  );
}
