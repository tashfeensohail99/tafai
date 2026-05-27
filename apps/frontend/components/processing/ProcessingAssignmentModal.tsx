'use client';
// Case Reassignment Modal — wired to real backend in P5.5.
//
// Manager picks a new Processing Associate to take over the case. Backend
// validates the assignee holds a processing-side role and records the
// change as a `case_reassigned` audit-log entry (vs `case_assigned` for
// the initial acknowledge). Same modal handles "case is currently
// unassigned" recovery — the button label flips to "Assign".

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  User,
  UserCheck,
  X,
} from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import { type MockProcessingCase } from '@/components/processing/mockData';
import {
  assignProcessingCase,
  fetchProcessingOfficers,
  type ApiProcessingOfficer,
} from '@/lib/processing';

function OfficerAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((p) => p.charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'U';
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: 'var(--sos-brand-primary-soft)',
        border: '1px solid var(--sos-brand-primary-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
        color: 'var(--sos-brand-primary-strong)',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function OfficerRow({
  officer,
  selected,
  onSelect,
  isCurrentlyAssigned,
}: {
  officer: ApiProcessingOfficer;
  selected: boolean;
  onSelect: () => void;
  isCurrentlyAssigned: boolean;
}) {
  const roleLabel = officer.primaryRole === 'processing_manager'
    ? 'Manager'
    : officer.primaryRole === 'processing'
      ? 'Associate'
      : officer.primaryRole;
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
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
      <OfficerAvatar name={officer.name} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {officer.name}
          {isCurrentlyAssigned ? (
            <StatusBadge tone="info" size="sm" dot={false}>Current</StatusBadge>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{roleLabel} · {officer.email}</div>
      </div>
      {selected ? <UserCheck size={16} style={{ color: 'var(--sos-brand-primary-strong)', flexShrink: 0 }} /> : null}
    </label>
  );
}

interface ProcessingAssignmentModalProps {
  caseRecord: MockProcessingCase;
  currentUserPermissions: string[];
  onClose: () => void;
  /** Called after a successful assignment so the parent can refetch. */
  onAssigned?: () => void;
}

export function ProcessingAssignmentModal({
  caseRecord: c,
  currentUserPermissions,
  onClose,
  onAssigned,
}: ProcessingAssignmentModalProps) {
  const canAssign = currentUserPermissions.includes('processing.case.assign');
  const currentOfficerId = c.assignedOfficer?.id ?? null;
  const [officers, setOfficers] = useState<ApiProcessingOfficer[]>([]);
  const [officersLoading, setOfficersLoading] = useState(true);
  const [officersError, setOfficersError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(currentOfficerId ?? '');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAssign) {
      setOfficersLoading(false);
      return;
    }
    let cancelled = false;
    fetchProcessingOfficers()
      .then((o) => { if (!cancelled) setOfficers(o); })
      .catch((e: unknown) => {
        if (!cancelled) setOfficersError(e instanceof Error ? e.message : 'Failed to load officers');
      })
      .finally(() => { if (!cancelled) setOfficersLoading(false); });
    return () => { cancelled = true; };
  }, [canAssign]);

  const selectedOfficer = useMemo(
    () => officers.find((o) => o.id === selectedId),
    [officers, selectedId],
  );

  async function handleConfirm() {
    if (!canAssign || !selectedId || selectedId === currentOfficerId) return;
    setLoading(true);
    setError(null);
    try {
      await assignProcessingCase(c.id, { officerId: selectedId });
      setDone(true);
      onAssigned?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to reassign');
    } finally {
      setLoading(false);
    }
  }

  /* ---- Done state ---- */
  if (done) {
    return (
      <div style={overlayStyle}>
        <div className="sos-glass sos-glass--strong" style={panelStyle}>
          <CheckCircle2 size={38} style={{ color: 'var(--sos-status-success)', marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: 6 }}>
            {currentOfficerId ? 'Case reassigned' : 'Case assigned'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginBottom: 20 }}>
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
        style={{ ...panelStyle, maxWidth: 520, textAlign: 'left', padding: 28 }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer', padding: 6 }}
        >
          <X size={16} />
        </button>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
            <User size={13} /> {currentOfficerId ? 'Reassign case' : 'Assign case'}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{c.clientName}</div>
          <div style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginTop: 3 }}>{c.service} · {c.targetCountry}</div>
        </div>

        {!canAssign ? (
          <GlassCard variant="panel" padded="md">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <ShieldAlert size={20} style={{ color: 'var(--sos-status-warning)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: 4 }}>
                  Manager permission required
                </div>
                <div style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginBottom: 12 }}>
                  Only Processing Managers can reassign cases. Ask your manager to change the assignment for this case.
                </div>
                {c.assignedOfficer ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', border: '1px solid var(--sos-border-subtle)' }}>
                    <OfficerAvatar name={c.assignedOfficer.name} />
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{c.assignedOfficer.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{c.assignedOfficer.email}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--sos-status-warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ShieldAlert size={14} /> This case is currently unassigned.
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <SecondaryButton onClick={onClose}>Close</SecondaryButton>
            </div>
          </GlassCard>
        ) : (
          <>
            {c.assignedOfficer ? (
              <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', border: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sos-text-muted)' }}>
                <UserCheck size={14} style={{ color: 'var(--sos-status-info)', flexShrink: 0 }} />
                Currently assigned to <strong style={{ color: 'var(--sos-text-primary)' }}>{c.assignedOfficer.name}</strong>
              </div>
            ) : (
              <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-warning-soft)', border: '1px solid var(--sos-status-warning-border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sos-status-warning)', fontWeight: 500 }}>
                <ShieldAlert size={14} /> Case is unassigned
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Select officer
              </div>
              {officersLoading ? (
                <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--sos-text-muted)', fontSize: 13 }}>
                  <Loader2 size={14} className="sos-spin" /> Loading roster…
                </div>
              ) : officersError ? (
                <div style={{ padding: 12, fontSize: 12.5, color: 'var(--sos-status-danger)' }}>
                  Failed to load officer list: {officersError}
                </div>
              ) : officers.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
                  No processing officers configured. Add one via Admin → Users.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                  {officers.map((o) => (
                    <OfficerRow
                      key={o.id}
                      officer={o}
                      selected={selectedId === o.id}
                      onSelect={() => setSelectedId(o.id)}
                      isCurrentlyAssigned={o.id === currentOfficerId}
                    />
                  ))}
                </div>
              )}
            </div>

            {error ? (
              <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>
                {error}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <SecondaryButton onClick={onClose} disabled={loading}>Cancel</SecondaryButton>
              <PrimaryButton
                onClick={handleConfirm}
                disabled={!selectedId || selectedId === currentOfficerId || loading}
                iconLeft={<UserCheck size={14} />}
              >
                {loading
                  ? 'Saving…'
                  : !currentOfficerId
                    ? 'Assign'
                    : 'Reassign'}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
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
