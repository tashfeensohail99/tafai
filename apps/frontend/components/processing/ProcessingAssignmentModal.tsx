'use client';
// Case Assignment Modal — Phase 1B.
// Lets a senior/manager reassign a case to a different officer.
// Officers without processing.case.assign see a read-only state.

import { useState } from 'react';
import { CheckCircle2, ShieldAlert, User, UserCheck, X } from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  type MockOfficer,
  MOCK_PROCESSING_OFFICER,
  MOCK_SENIOR_OFFICER,
  MOCK_MANAGER,
} from '@/components/processing/mockData';

// ---------- Available officers (would come from API in production) ----------

const ALL_OFFICERS: MockOfficer[] = [
  MOCK_PROCESSING_OFFICER,
  MOCK_SENIOR_OFFICER,
  MOCK_MANAGER,
];

// ---------- Avatar chip ----------------------------------------------------

function OfficerAvatar({ officer }: { officer: MockOfficer }) {
  return (
    <div
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        background: 'var(--sos-brand-primary-soft)',
        border: '1px solid var(--sos-brand-primary-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: 700,
        color: 'var(--sos-brand-primary-strong)',
        flexShrink: 0,
      }}
    >
      {officer.initials}
    </div>
  );
}

// ---------- Officer row -----------------------------------------------------

interface OfficerRowProps {
  officer: MockOfficer;
  selected: boolean;
  onSelect: () => void;
  isCurrentlyAssigned: boolean;
}

function OfficerRow({ officer, selected, onSelect, isCurrentlyAssigned }: OfficerRowProps) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 14px',
        borderRadius: 'var(--sos-radius-md)',
        border: `1px solid ${selected ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
        background: selected ? 'var(--sos-brand-primary-soft)' : 'transparent',
        cursor: 'pointer',
        transition: 'all 150ms',
      }}
    >
      <input
        type="radio"
        name="assignOfficer"
        value={officer.id}
        checked={selected}
        onChange={onSelect}
        style={{ accentColor: 'var(--sos-brand-primary-strong)' }}
      />
      <OfficerAvatar officer={officer} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {officer.name}
          {isCurrentlyAssigned ? (
            <StatusBadge tone="info" size="sm" dot={false}>Current</StatusBadge>
          ) : null}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{officer.role}</div>
      </div>
      {selected ? <UserCheck size={16} style={{ color: 'var(--sos-brand-primary-strong)', flexShrink: 0 }} /> : null}
    </label>
  );
}

// ---------- Assignment modal -----------------------------------------------

interface ProcessingAssignmentModalProps {
  caseRecord: MockProcessingCase;
  /** The current logged-in user's permissions. */
  currentUserPermissions: string[];
  onClose: () => void;
}

export function ProcessingAssignmentModal({
  caseRecord: c,
  currentUserPermissions,
  onClose,
}: ProcessingAssignmentModalProps) {
  const canAssign = currentUserPermissions.includes('processing.case.assign');
  const currentOfficerId = c.assignedOfficer?.id ?? null;
  const [selectedId, setSelectedId] = useState<string>(currentOfficerId ?? MOCK_PROCESSING_OFFICER.id);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function handleConfirm() {
    if (!canAssign || selectedId === currentOfficerId) return;
    setLoading(true);
    // Replace with real API: POST /processing/cases/:id/assign
    setTimeout(() => {
      setDone(true);
      setLoading(false);
    }, 800);
  }

  const selectedOfficer = ALL_OFFICERS.find((o) => o.id === selectedId);

  /* ---- Done state ---- */
  if (done) {
    return (
      <div style={overlayStyle}>
        <div className="sos-glass sos-glass--strong" style={panelStyle}>
          <CheckCircle2 size={38} style={{ color: 'var(--sos-status-success)', marginBottom: '12px' }} />
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '6px' }}>Reassigned</div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>
            {c.clientName} is now assigned to {selectedOfficer?.name ?? 'the selected officer'}.
          </div>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="sos-glass sos-glass--strong"
        style={{ ...panelStyle, maxWidth: '500px', textAlign: 'left', padding: '28px' }}
      >
        {/* Close */}
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
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <User size={13} /> Assign officer
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>{c.clientName}</div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginTop: '3px' }}>{c.service} · {c.targetCountry}</div>
        </div>

        {/* RBAC gate: read-only if no permission */}
        {!canAssign ? (
          <GlassCard variant="panel" padded="md">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <ShieldAlert size={20} style={{ color: 'var(--sos-status-warning)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '4px' }}>
                  You do not have permission to reassign cases
                </div>
                <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '12px' }}>
                  Only Senior Officers and Managers can reassign cases. Contact your manager to change the assignment for this case.
                </div>
                {c.assignedOfficer ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', border: '1px solid var(--sos-border-subtle)' }}>
                    <OfficerAvatar officer={c.assignedOfficer} />
                    <div>
                      <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{c.assignedOfficer.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{c.assignedOfficer.role}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: 'var(--sos-status-warning)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ShieldAlert size={14} /> This case is currently unassigned.
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
              <SecondaryButton onClick={onClose}>Close</SecondaryButton>
            </div>
          </GlassCard>
        ) : (
          <>
            {/* Current assignment info */}
            {c.assignedOfficer ? (
              <div style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', border: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--sos-text-muted)' }}>
                <UserCheck size={14} style={{ color: 'var(--sos-status-info)', flexShrink: 0 }} />
                Currently assigned to{' '}
                <strong style={{ color: 'var(--sos-text-primary)' }}>{c.assignedOfficer.name}</strong>
              </div>
            ) : (
              <div style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-warning-soft)', border: '1px solid var(--sos-status-warning-border)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--sos-status-warning)', fontWeight: 500 }}>
                <ShieldAlert size={14} /> Case is unassigned
              </div>
            )}

            {/* Officer list */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                Select officer
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {ALL_OFFICERS.map((o) => (
                  <OfficerRow
                    key={o.id}
                    officer={o}
                    selected={selectedId === o.id}
                    onSelect={() => setSelectedId(o.id)}
                    isCurrentlyAssigned={o.id === currentOfficerId}
                  />
                ))}
              </div>
            </div>

            {/* Reassignment note */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '5px' }}>
                Reason / note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Briefly explain the reason for reassignment…"
                rows={2}
                style={{ width: '100%', resize: 'vertical', padding: '8px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: '13.5px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <SecondaryButton onClick={onClose} disabled={loading}>Cancel</SecondaryButton>
              <PrimaryButton
                onClick={handleConfirm}
                disabled={selectedId === currentOfficerId || loading}
                iconLeft={<UserCheck size={14} />}
              >
                {loading ? 'Saving…' : 'Confirm assignment'}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Shared style helpers ------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
};

const panelStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 'var(--sos-radius-lg)',
  position: 'relative',
  maxHeight: '90vh',
  overflowY: 'auto',
  textAlign: 'center',
  padding: '32px 28px',
};
