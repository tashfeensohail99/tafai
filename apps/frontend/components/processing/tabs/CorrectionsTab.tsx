'use client';
// Corrections Tab — Phase 1E.
// Lists all correction requests for a case.
// Provides inline Resolve and Escalate actions (mock).

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardEdit,
  Clock,
  TrendingUp,
  X,
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
  type MockCorrectionRequest,
  type CorrectionRequestStatus,
  CORRECTION_STATUS_LABEL,
  REQUIRED_ACTION_LABEL,
  REJECTION_REASON_LABEL,
  MOCK_CORRECTIONS,
  fmtRelative,
  fmtDate,
} from '@/components/processing/mockData';
import { CorrectionRequestModal } from '../CorrectionRequestModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function correctionStatusTone(status: CorrectionRequestStatus): BadgeTone {
  switch (status) {
    case 'SENT':        return 'info';
    case 'IN_PROGRESS': return 'warm';
    case 'RESOLVED':    return 'success';
    case 'ESCALATED':   return 'danger';
  }
}

function slaLabel(slaDueAt: string): { label: string; overdue: boolean } {
  const base = new Date('2026-05-11T12:00:00.000Z');
  const due = new Date(slaDueAt);
  const diff = due.getTime() - base.getTime();
  if (diff <= 0) return { label: 'Overdue', overdue: true };
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return { label: `${hours}h remaining`, overdue: false };
  const days = Math.floor(hours / 24);
  return { label: `${days}d remaining`, overdue: false };
}

// ---------------------------------------------------------------------------
// Resolve inline mini-form
// ---------------------------------------------------------------------------

interface ResolvePanelProps {
  onResolve: (note: string) => void;
  onCancel: () => void;
}

function ResolvePanel({ onResolve, onCancel }: ResolvePanelProps) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  function handleSubmit() {
    setLoading(true);
    // Replace with real API: PATCH /processing/cases/:caseId/corrections/:id/resolve
    setTimeout(() => { onResolve(note); }, 700);
  }

  return (
    <div style={{ marginTop: '12px', padding: '14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-success-soft)', border: '1px solid var(--sos-status-success-border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-status-success)' }}>Mark as resolved</div>
      <textarea
        placeholder="Optional resolution note (internal only)…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        rows={2}
        style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--sos-radius-sm)', border: '1px solid var(--sos-status-success-border)', background: 'var(--sos-bg-surface)', color: 'var(--sos-text-primary)', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
      />
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <SecondaryButton onClick={onCancel} disabled={loading}>Cancel</SecondaryButton>
        <PrimaryButton onClick={handleSubmit} disabled={loading}>
          {loading ? 'Saving…' : 'Confirm resolve'}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Escalate inline mini-form
// ---------------------------------------------------------------------------

interface EscalatePanelProps {
  onEscalate: (reason: string) => void;
  onCancel: () => void;
}

function EscalatePanel({ onEscalate, onCancel }: EscalatePanelProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  function handleSubmit() {
    if (!reason.trim()) return;
    setLoading(true);
    // Replace with real API: PATCH /processing/cases/:caseId/corrections/:id/escalate
    setTimeout(() => { onEscalate(reason); }, 700);
  }

  return (
    <div style={{ marginTop: '12px', padding: '14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-status-danger)' }}>Escalate to manager</div>
      <textarea
        placeholder="Escalation reason — required…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={2000}
        rows={2}
        style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--sos-radius-sm)', border: '1px solid var(--sos-status-danger-border)', background: 'var(--sos-bg-surface)', color: 'var(--sos-text-primary)', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
      />
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <SecondaryButton onClick={onCancel} disabled={loading}>Cancel</SecondaryButton>
        <PrimaryButton onClick={handleSubmit} disabled={!reason.trim() || loading}>
          {loading ? 'Escalating…' : 'Confirm escalate'}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single correction card
// ---------------------------------------------------------------------------

interface CorrectionCardProps {
  cr: MockCorrectionRequest;
  onResolved: (id: string) => void;
  onEscalated: (id: string) => void;
}

function CorrectionCard({ cr, onResolved, onEscalated }: CorrectionCardProps) {
  const [action, setAction] = useState<'resolve' | 'escalate' | null>(null);
  const sla = slaLabel(cr.slaDueAt);
  const isTerminal = cr.status === 'RESOLVED' || cr.status === 'ESCALATED';

  return (
    <GlassCard variant="default" padded="md">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{cr.subject}</span>
            <StatusBadge tone={correctionStatusTone(cr.status)} size="sm">
              {CORRECTION_STATUS_LABEL[cr.status]}
            </StatusBadge>
            <StatusBadge tone="neutral" size="sm" dot={false}>
              {cr.correctionType === 'DOCUMENT' ? 'Document' : 'Information'}
            </StatusBadge>
          </div>

          {cr.documentName ? (
            <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginBottom: '4px' }}>
              Document: <strong style={{ color: 'var(--sos-text-primary)' }}>{cr.documentName}</strong>
            </div>
          ) : null}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
            {cr.reasonCodes.map((code) => (
              <span
                key={code}
                style={{ padding: '2px 8px', borderRadius: 'var(--sos-radius-full)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', fontSize: '11.5px', color: 'var(--sos-text-secondary)' }}
              >
                {REJECTION_REASON_LABEL[code] ?? code}
              </span>
            ))}
          </div>
        </div>

        <div style={{ flexShrink: 0, textAlign: 'right', fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>
          <div>{fmtRelative(cr.createdAt)}</div>
          <div style={{ marginTop: '2px' }}>by {cr.raisedByName}</div>
        </div>
      </div>

      {/* Client message preview */}
      <div style={{ padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', fontSize: '13px', color: 'var(--sos-text-primary)', lineHeight: 1.5, marginBottom: '10px' }}>
        {cr.clientMessage.length > 200 ? cr.clientMessage.slice(0, 200) + '…' : cr.clientMessage}
      </div>

      {/* Footer row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
          <Clock size={12} />
          <span>Action: <strong style={{ color: 'var(--sos-text-primary)' }}>{REQUIRED_ACTION_LABEL[cr.requiredAction]}</strong></span>
        </div>

        {!isTerminal && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: sla.overdue ? 'var(--sos-status-danger)' : 'var(--sos-text-muted)' }}>
            {sla.overdue ? <AlertTriangle size={12} /> : <Clock size={12} />}
            SLA: {sla.label}
          </div>
        )}

        {cr.resolvedAt ? (
          <div style={{ fontSize: '12px', color: 'var(--sos-status-success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={12} />
            Resolved {fmtDate(cr.resolvedAt)} by {cr.resolvedByName}
          </div>
        ) : null}

        {/* Actions */}
        {!isTerminal && action === null && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <SecondaryButton onClick={() => setAction('escalate')}>
              <TrendingUp size={13} style={{ marginRight: '5px' }} /> Escalate
            </SecondaryButton>
            <PrimaryButton onClick={() => setAction('resolve')}>
              <CheckCircle2 size={13} style={{ marginRight: '5px' }} /> Resolve
            </PrimaryButton>
          </div>
        )}
      </div>

      {/* Inline action panels */}
      {action === 'resolve' && (
        <ResolvePanel
          onResolve={() => { onResolved(cr.id); setAction(null); }}
          onCancel={() => setAction(null)}
        />
      )}
      {action === 'escalate' && (
        <EscalatePanel
          onEscalate={() => { onEscalated(cr.id); setAction(null); }}
          onCancel={() => setAction(null)}
        />
      )}
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

export function CorrectionsTab({ c }: { c: MockProcessingCase }) {
  const [showModal, setShowModal] = useState(false);
  const [corrections, setCorrections] = useState<MockCorrectionRequest[]>(
    MOCK_CORRECTIONS.filter((cr) => cr.caseId === c.id),
  );

  function handleResolved(id: string) {
    setCorrections((prev) =>
      prev.map((cr) =>
        cr.id === id
          ? { ...cr, status: 'RESOLVED' as const, resolvedAt: '2026-05-11T12:05:00.000Z', resolvedByName: 'Sara Malik' }
          : cr,
      ),
    );
  }

  function handleEscalated(id: string) {
    setCorrections((prev) =>
      prev.map((cr) =>
        cr.id === id ? { ...cr, status: 'ESCALATED' as const } : cr,
      ),
    );
  }

  const open = corrections.filter((cr) => cr.status === 'SENT' || cr.status === 'IN_PROGRESS');
  const closed = corrections.filter((cr) => cr.status === 'RESOLVED' || cr.status === 'ESCALATED');

  return (
    <>
      {showModal ? (
        <CorrectionRequestModal caseRecord={c} onClose={() => setShowModal(false)} />
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)' }}>
            {open.length} open · {closed.length} closed
          </div>
          <PrimaryButton iconLeft={<ClipboardEdit size={14} />} onClick={() => setShowModal(true)}>
            New correction request
          </PrimaryButton>
        </div>

        {/* Open requests */}
        {open.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--sos-status-warning)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Open ({open.length})
            </div>
            {open.map((cr) => (
              <CorrectionCard key={cr.id} cr={cr} onResolved={handleResolved} onEscalated={handleEscalated} />
            ))}
          </div>
        )}

        {/* Closed requests */}
        {closed.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Closed ({closed.length})
            </div>
            {closed.map((cr) => (
              <CorrectionCard key={cr.id} cr={cr} onResolved={handleResolved} onEscalated={handleEscalated} />
            ))}
          </div>
        )}

        {/* Empty */}
        {corrections.length === 0 && (
          <GlassCard variant="panel" padded="lg">
            <EmptyState
              Icon={ClipboardEdit}
              title="No correction requests"
              description="Raise a correction request when the client needs to re-upload a document or update information."
            />
          </GlassCard>
        )}
      </div>
    </>
  );
}
