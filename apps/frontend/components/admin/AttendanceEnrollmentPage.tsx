'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, ScanFace, X } from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  Field,
  FormInput,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useAdminSession } from '../layout/AdminShell';
import {
  approveEnrollment,
  fetchEnrollmentRequests,
  fetchEnrollmentSettings,
  fetchRoles,
  rejectEnrollment,
  setEnrollmentEnabled,
  type EnrollmentRequest,
  type EnrollmentStatus,
  type RoleOption,
} from '@/lib/attendance';

const STATUS_TONE: Record<EnrollmentStatus, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  DUPLICATE: 'info',
};
const STATUS_LABEL: Record<EnrollmentStatus, string> = {
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  DUPLICATE: 'Already in system',
};

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
}

export function AttendanceEnrollmentPage() {
  const { user } = useAdminSession();
  const canView = user.permissions.includes('employees.view_all');
  const canManage = user.permissions.includes('employees.create');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [requests, setRequests] = useState<EnrollmentRequest[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);

  // Approve modal
  const [approveFor, setApproveFor] = useState<EnrollmentRequest | null>(null);
  const [aFirst, setAFirst] = useState('');
  const [aLast, setALast] = useState('');
  const [aEmail, setAEmail] = useState('');
  const [aRole, setARole] = useState('');
  const [aBusy, setABusy] = useState(false);
  const [aErr, setAErr] = useState<string | null>(null);

  // Reject modal
  const [rejectFor, setRejectFor] = useState<EnrollmentRequest | null>(null);
  const [rReason, setRReason] = useState('');
  const [rBusy, setRBusy] = useState(false);

  const load = useCallback(() => {
    if (!canView) return;
    setError(null);
    Promise.all([fetchEnrollmentSettings(), fetchEnrollmentRequests(), fetchRoles()])
      .then(([s, reqs, rl]) => {
        setEnabled(s.enabled);
        setRequests(reqs);
        setRoles(rl);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [canView]);

  useEffect(() => { load(); }, [load]);

  async function toggle() {
    setToggleBusy(true);
    try {
      const r = await setEnrollmentEnabled(!enabled);
      setEnabled(r.enabled);
    } catch {
      /* keep prior */
    } finally {
      setToggleBusy(false);
    }
  }

  function openApprove(req: EnrollmentRequest) {
    setApproveFor(req);
    setAFirst(req.firstName);
    setALast(req.lastName);
    setAEmail(req.email ?? '');
    setARole(roles[0]?.name ?? '');
    setAErr(null);
  }

  async function submitApprove() {
    if (!approveFor) return;
    if (!aEmail.trim() || !aRole) { setAErr('Email and role are required.'); return; }
    setABusy(true); setAErr(null);
    try {
      await approveEnrollment(approveFor.id, {
        email: aEmail.trim(),
        roleName: aRole,
        firstName: aFirst.trim() || undefined,
        lastName: aLast.trim() || undefined,
      });
      setApproveFor(null);
      setLoading(true);
      load();
    } catch (e: unknown) {
      setAErr(e instanceof Error ? e.message : 'Approval failed');
    } finally {
      setABusy(false);
    }
  }

  async function submitReject() {
    if (!rejectFor) return;
    setRBusy(true);
    try {
      await rejectEnrollment(rejectFor.id, rReason.trim() || undefined);
      setRejectFor(null);
      setRReason('');
      setLoading(true);
      load();
    } catch {
      /* keep */
    } finally {
      setRBusy(false);
    }
  }

  if (!canView) return <PermissionDeniedState />;
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); load(); }} />;

  const pending = requests.filter((r) => r.status === 'PENDING');
  const resolved = requests.filter((r) => r.status !== 'PENDING');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Camera attendance"
        title={<>Camera Enrollments</>}
        description={
          <>Walk-ins enrolled at the camera land here as requests. Approve to create the employee (and link them for payroll); reject to discard. Nothing becomes a real employee without your approval.</>
        }
        actions={<SecondaryButton iconLeft={<RefreshCw size={15} />} onClick={() => { setLoading(true); load(); }}>Refresh</SecondaryButton>}
      />

      {/* Master on/off switch */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <ScanFace size={20} style={{ color: 'var(--sos-text-secondary)' }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
              Allow enrollment from the camera
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginTop: 2 }}>
              {enabled
                ? 'ON — the camera can submit enrollment requests for your review.'
                : 'OFF — the camera cannot enroll new people; its requests are rejected with a "disabled" message.'}
            </div>
          </div>
          <StatusBadge tone={enabled ? 'success' : 'neutral'} size="sm">{enabled ? 'Enabled' : 'Disabled'}</StatusBadge>
          {canManage ? (
            <button
              type="button"
              onClick={toggle}
              disabled={toggleBusy}
              aria-pressed={enabled}
              title={enabled ? 'Turn off' : 'Turn on'}
              style={{
                position: 'relative', width: 52, height: 30, borderRadius: 999, cursor: toggleBusy ? 'wait' : 'pointer',
                border: '1px solid var(--sos-border-subtle)',
                background: enabled ? 'var(--sos-status-success)' : 'var(--sos-surface-hover)',
                transition: 'background 150ms', flexShrink: 0,
              }}
            >
              <span style={{ position: 'absolute', top: 3, left: enabled ? 25 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left 150ms' }} />
            </button>
          ) : null}
        </div>
      </GlassCard>

      {/* Pending queue */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 2px 10px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--sos-text-secondary)' }}>Pending review</span>
          <StatusBadge tone={pending.length ? 'warning' : 'neutral'} size="sm">{pending.length}</StatusBadge>
        </div>
        {pending.length === 0 ? (
          <GlassCard variant="panel" padded="md">
            <div style={{ fontSize: 13, color: 'var(--sos-text-muted)' }}>No requests waiting. New camera enrollments will appear here.</div>
          </GlassCard>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {pending.map((r) => (
              <RequestCard key={r.id} r={r} canManage={canManage} onApprove={() => openApprove(r)} onReject={() => { setRejectFor(r); setRReason(''); }} />
            ))}
          </div>
        )}
      </div>

      {/* Resolved history */}
      {resolved.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--sos-text-secondary)', margin: '2px 2px 10px' }}>History</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {resolved.map((r) => (
              <RequestCard key={r.id} r={r} canManage={false} onApprove={() => {}} onReject={() => {}} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Approve modal */}
      {approveFor ? (
        <Modal title="Approve enrollment → create employee" onClose={() => setApproveFor(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
              This creates a real employee + login account and links them to the camera for attendance/payroll. Set the email and role.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="First name"><FormInput value={aFirst} onChange={(e) => setAFirst(e.target.value)} /></Field>
              <Field label="Last name"><FormInput value={aLast} onChange={(e) => setALast(e.target.value)} /></Field>
            </div>
            <Field label="Email (required — used as the login)">
              <FormInput type="email" value={aEmail} onChange={(e) => setAEmail(e.target.value)} placeholder="person@tashfeenimmigrationsolutions.com" />
            </Field>
            <Field label="Role (required)">
              <select
                value={aRole}
                onChange={(e) => setARole(e.target.value)}
                style={{ width: '100%', padding: '9px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-bg-input)', color: 'var(--sos-text-primary)', fontSize: 13 }}
              >
                <option value="">Choose a role…</option>
                {roles.map((rl) => (<option key={rl.id} value={rl.name}>{rl.displayName || rl.name}</option>))}
              </select>
            </Field>
            {approveFor.phone ? <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>Camera captured phone: {approveFor.phone}{approveFor.cnic ? ` · CNIC ${approveFor.cnic}` : ''}</div> : null}
            {aErr ? <div style={{ fontSize: 12.5, color: 'var(--sos-status-danger)' }}>{aErr}</div> : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <SecondaryButton onClick={() => setApproveFor(null)}>Cancel</SecondaryButton>
              <PrimaryButton iconLeft={aBusy ? <Loader2 size={14} className="sos-spin" /> : <Check size={15} />} onClick={submitApprove} disabled={aBusy}>
                {aBusy ? 'Creating…' : 'Approve & create'}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Reject modal */}
      {rejectFor ? (
        <Modal title="Reject enrollment request" onClose={() => setRejectFor(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
              Discard {rejectFor.firstName} {rejectFor.lastName}. No employee is created. Optionally add a reason.
            </div>
            <textarea
              rows={3}
              value={rReason}
              onChange={(e) => setRReason(e.target.value)}
              placeholder="Reason (optional)…"
              style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-bg-input)', color: 'var(--sos-text-primary)', fontSize: 13, fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <SecondaryButton onClick={() => setRejectFor(null)}>Cancel</SecondaryButton>
              <PrimaryButton iconLeft={rBusy ? <Loader2 size={14} className="sos-spin" /> : <X size={15} />} onClick={submitReject} disabled={rBusy}>
                {rBusy ? 'Rejecting…' : 'Reject'}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function RequestCard({
  r,
  canManage,
  onApprove,
  onReject,
}: {
  r: EnrollmentRequest;
  canManage: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{`${r.firstName} ${r.lastName}`.trim() || '—'}</span>
          <StatusBadge tone={STATUS_TONE[r.status]} size="sm">{STATUS_LABEL[r.status]}</StatusBadge>
        </div>
        <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', lineHeight: 1.6 }}>
          {r.phone ? <>📞 {r.phone}<br /></> : null}
          {r.email ? <>✉ {r.email}<br /></> : null}
          {r.department ? <>🏢 {r.department}<br /></> : null}
          {r.cnic ? <>🪪 {r.cnic}<br /></> : null}
          {r.cameraEmpCode ? <>cam id: {r.cameraEmpCode}<br /></> : null}
          <span style={{ color: 'var(--sos-text-faint)' }}>captured {fmt(r.createdAt)}</span>
        </div>
        {r.status === 'DUPLICATE' ? (
          <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>Already matches an existing employee — the camera was told to link, not duplicate.</div>
        ) : null}
        {r.status === 'APPROVED' ? (
          <div style={{ fontSize: 11.5, color: 'var(--sos-status-success)' }}>Employee created · {fmt(r.reviewedAt ?? r.updatedAt)}</div>
        ) : null}
        {r.status === 'REJECTED' ? (
          <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>Rejected{r.rejectionReason ? ` — ${r.rejectionReason}` : ''}</div>
        ) : null}
        {r.status === 'PENDING' && canManage ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <PrimaryButton iconLeft={<Check size={14} />} onClick={onApprove}>Approve</PrimaryButton>
            <SecondaryButton iconLeft={<X size={14} />} onClick={onReject}>Reject</SecondaryButton>
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(2, 6, 23, 0.62)', backdropFilter: 'blur(2px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 96vw)', maxHeight: '88vh', overflowY: 'auto', borderRadius: 'var(--sos-radius-lg)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{title}</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', padding: 6, borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}
