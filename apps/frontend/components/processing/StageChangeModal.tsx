'use client';
// Stage Change Modal — Phase 1B.
// Shows allowed next stages for the current stage, stage-specific required
// fields, and a GateCheckResult component if documents must pass a hard gate.

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Layers,
  X,
  XCircle,
} from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  type ProcessingStage,
  STAGE_LABEL,
  getDocumentProgress,
} from '@/components/processing/mockData';
import { stageTone } from './ProcessingDashboardPage';

// ---------- Allowed transitions (mirrors backend ALLOWED_TRANSITIONS) ------

const ALLOWED_TRANSITIONS: Record<ProcessingStage, ProcessingStage[]> = {
  INTAKE_PENDING: ['DOCUMENTS_COLLECTION'],
  DOCUMENTS_COLLECTION: ['DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_INCOMPLETE'],
  DOCUMENTS_UNDER_REVIEW: ['DOCUMENTS_COMPLETE', 'DOCUMENTS_INCOMPLETE'],
  DOCUMENTS_INCOMPLETE: ['DOCUMENTS_COLLECTION'],
  DOCUMENTS_COMPLETE: ['READY_FOR_SUBMISSION'],
  READY_FOR_SUBMISSION: ['SUBMITTED'],
  SUBMITTED: ['UNDER_AUTHORITY_REVIEW', 'ADDITIONAL_INFO_REQUESTED'],
  UNDER_AUTHORITY_REVIEW: ['DECISION_RECEIVED', 'ADDITIONAL_INFO_REQUESTED'],
  ADDITIONAL_INFO_REQUESTED: ['UNDER_AUTHORITY_REVIEW', 'DOCUMENTS_COLLECTION'],
  DECISION_RECEIVED: ['APPROVED', 'REJECTED'],
  APPROVED: ['COMPLETED'],
  REJECTED: ['APPEAL_IN_PROGRESS', 'CANCELLED'],
  APPEAL_IN_PROGRESS: ['SUBMITTED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

// Stages that require all CRITICAL+REQUIRED docs to be accepted
const DOC_GATE_STAGES: ProcessingStage[] = ['READY_FOR_SUBMISSION', 'DOCUMENTS_COMPLETE'];

// Stage-specific required fields
type ExtraField = { key: string; label: string; placeholder: string; required: boolean };
const STAGE_FIELDS: Partial<Record<ProcessingStage, ExtraField[]>> = {
  SUBMITTED: [
    { key: 'submissionReference', label: 'Submission reference', placeholder: 'Authority portal reference / tracking ID', required: true },
  ],
  UNDER_AUTHORITY_REVIEW: [
    { key: 'authorityTrackingRef', label: 'Authority tracking reference', placeholder: 'Tracking number from authority portal', required: true },
  ],
  CANCELLED: [
    { key: 'cancellationReason', label: 'Cancellation reason', placeholder: 'Why is this case being cancelled?', required: true },
  ],
  COMPLETED: [
    { key: 'completionNotes', label: 'Completion notes', placeholder: 'Summary of outcome and any follow-up required', required: true },
  ],
  REJECTED: [
    { key: 'notes', label: 'Rejection notes', placeholder: 'Describe the rejection reason and client guidance', required: true },
  ],
};

// ---------- Gate check component ------------------------------------------

function GateCheckResult({ c, toStage }: { c: MockProcessingCase; toStage: ProcessingStage }) {
  const needsGate = DOC_GATE_STAGES.includes(toStage);
  if (!needsGate) return null;

  const progress = getDocumentProgress(c.documentItems);
  const blockers = c.documentItems.filter(
    (i) =>
      (i.criticality === 'CRITICAL' || i.criticality === 'REQUIRED') &&
      i.status !== 'ACCEPTED' &&
      i.status !== 'WAIVED' &&
      i.status !== 'NOT_APPLICABLE',
  );

  if (blockers.length === 0) {
    return (
      <div style={{ padding: '12px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-success-soft)', border: '1px solid var(--sos-status-success-border)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--sos-status-success)', fontWeight: 500 }}>
        <CheckCircle2 size={16} />
        Document gate passed — all {progress.total} required documents accepted
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--sos-status-danger)', fontWeight: 600, marginBottom: '10px' }}>
        <AlertTriangle size={16} />
        Document gate blocked — {blockers.length} document{blockers.length !== 1 ? 's' : ''} not ready
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {blockers.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--sos-text-primary)' }}>
            <XCircle size={13} style={{ color: 'var(--sos-status-danger)', flexShrink: 0 }} />
            <span style={{ fontWeight: 500 }}>{b.documentName}</span>
            <StatusBadge tone="danger" size="sm">{b.status.replace(/_/g, ' ')}</StatusBadge>
          </div>
        ))}
      </div>
      <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--sos-status-danger)' }}>
        Resolve these before moving to this stage.
      </div>
    </div>
  );
}

// ---------- Stage change modal --------------------------------------------

interface StageChangeModalProps {
  caseRecord: MockProcessingCase;
  onClose: () => void;
}

export function StageChangeModal({ caseRecord: c, onClose }: StageChangeModalProps) {
  const allowed = ALLOWED_TRANSITIONS[c.stage] ?? [];
  const [toStage, setToStage] = useState<ProcessingStage | null>(allowed[0] ?? null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const extraFields = toStage ? (STAGE_FIELDS[toStage] ?? []) : [];
  const needsDocGate = toStage ? DOC_GATE_STAGES.includes(toStage) : false;
  const docBlockers = needsDocGate
    ? c.documentItems.filter(
        (i) =>
          (i.criticality === 'CRITICAL' || i.criticality === 'REQUIRED') &&
          i.status !== 'ACCEPTED' &&
          i.status !== 'WAIVED' &&
          i.status !== 'NOT_APPLICABLE',
      )
    : [];

  const canSubmit =
    !!toStage &&
    (needsDocGate ? docBlockers.length === 0 : true) &&
    extraFields.every((f) => !f.required || !!fields[f.key]?.trim());

  function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    // Replace with real API: PATCH /processing/cases/:id/stage
    setTimeout(() => {
      setDone(true);
      setLoading(false);
    }, 800);
  }

  if (allowed.length === 0) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="sos-glass sos-glass--strong" style={{ width: '100%', maxWidth: '460px', padding: '28px', borderRadius: 'var(--sos-radius-lg)' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '8px' }}>No transitions available</div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>This case is in a terminal stage: <strong>{STAGE_LABEL[c.stage]}</strong>.</div>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div className="sos-glass sos-glass--strong" style={{ width: '100%', maxWidth: '460px', padding: '28px', borderRadius: 'var(--sos-radius-lg)', textAlign: 'center' }}>
          <CheckCircle2 size={40} style={{ color: 'var(--sos-status-success)', marginBottom: '12px' }} />
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '8px' }}>Stage updated</div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>
            {STAGE_LABEL[c.stage]} → {toStage ? STAGE_LABEL[toStage] : ''}
          </div>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="sos-glass sos-glass--strong"
        style={{ width: '100%', maxWidth: '520px', padding: '28px', borderRadius: 'var(--sos-radius-lg)', position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}
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
            <Layers size={13} /> Change stage
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>{c.clientName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', fontSize: '13px' }}>
            <StatusBadge tone={stageTone(c.stage)}>{STAGE_LABEL[c.stage]}</StatusBadge>
            <ArrowRight size={14} style={{ color: 'var(--sos-text-muted)' }} />
            {toStage ? <StatusBadge tone={stageTone(toStage)}>{STAGE_LABEL[toStage]}</StatusBadge> : <span style={{ color: 'var(--sos-text-muted)' }}>Select target…</span>}
          </div>
        </div>

        {/* Stage selector */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Target stage</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {allowed.map((s) => (
              <label
                key={s}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', border: `1px solid ${toStage === s ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`, background: toStage === s ? 'var(--sos-brand-primary-soft)' : 'transparent', cursor: 'pointer', transition: 'all 150ms' }}
              >
                <input
                  type="radio"
                  name="toStage"
                  value={s}
                  checked={toStage === s}
                  onChange={() => { setToStage(s); setFields({}); }}
                  style={{ accentColor: 'var(--sos-brand-primary-strong)' }}
                />
                <ChevronRight size={13} style={{ color: 'var(--sos-text-muted)' }} />
                <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{STAGE_LABEL[s]}</span>
                <StatusBadge tone={stageTone(s)} size="sm" dot={false} style={{ marginLeft: 'auto' }}>{s.replace(/_/g, ' ')}</StatusBadge>
              </label>
            ))}
          </div>
        </div>

        {/* Document gate check */}
        {toStage ? <GateCheckResult c={c} toStage={toStage} /> : null}

        {/* Stage-specific fields */}
        {extraFields.length > 0 ? (
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {extraFields.map((f) => (
              <div key={f.key}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '5px' }}>
                  {f.label} {f.required ? <span style={{ color: 'var(--sos-status-danger)' }}>*</span> : null}
                </label>
                <input
                  type="text"
                  value={fields[f.key] ?? ''}
                  onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--sos-radius-md)', border: `1px solid ${!fields[f.key] && f.required ? 'var(--sos-status-danger-border)' : 'var(--sos-border-subtle)'}`, background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: '13.5px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            ))}
          </div>
        ) : null}

        {/* Optional reason */}
        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '5px' }}>
            Reason / note (optional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Brief note explaining this stage change…"
            rows={2}
            style={{ width: '100%', resize: 'vertical', padding: '8px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: '13.5px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Actions */}
        <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={onClose} disabled={loading}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
            iconLeft={loading ? undefined : <ArrowRight size={14} />}
          >
            {loading ? 'Updating…' : 'Confirm stage change'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
