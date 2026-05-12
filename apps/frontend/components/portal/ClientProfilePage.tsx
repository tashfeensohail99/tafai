'use client';

import { useEffect, useState } from 'react';
import { Edit3, Mail, Phone, ShieldCheck } from 'lucide-react';
import {
  Field,
  GlassCard,
  GhostButton,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import {
  fmtDate,
  getProfile,
  requestProfileUpdate,
  type PortalProfile,
} from '@/lib/portal';

function ProfileRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid var(--sos-border-subtle)',
      }}
    >
      <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--sos-text-primary)', textAlign: 'right' }}>
        {value ?? <em style={{ color: 'var(--sos-text-muted)', fontStyle: 'normal' }}>—</em>}
      </span>
    </div>
  );
}

function RequestUpdateModal({
  open,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [subject, setSubject] = useState('Profile update request');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject('Profile update request');
    setContent('');
    setError(null);
    setDone(false);
    setSubmitting(false);
  }, [open]);

  if (!open) return null;

  async function handleSubmit() {
    if (!content.trim()) {
      setError('Please describe what should be updated');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await requestProfileUpdate({ subject, content: content.trim() });
      setDone(true);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send update request');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 16px',
        zIndex: 1000,
        overflowY: 'auto',
      }}
    >
      <div
        className="sos-glass sos-glass--strong"
        style={{ width: '100%', maxWidth: 520, padding: 0, borderRadius: 'var(--sos-radius-panel)' }}
      >
        <header
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--sos-border-subtle)',
          }}
        >
          <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)' }}>
            Request a profile update
          </div>
          <div className="sos-text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            Your officer will review and apply the change.
          </div>
        </header>
        <div style={{ padding: 18 }}>
          {done ? (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <ShieldCheck size={32} style={{ color: 'var(--sos-status-success)', marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Request sent</div>
              <div className="sos-text-muted" style={{ fontSize: 13, marginBottom: 16 }}>
                Your officer has been notified.
              </div>
              <PrimaryButton onClick={onClose}>Done</PrimaryButton>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Subject">
                <input
                  className="sos-input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </Field>
              <Field label="What should be updated?" required>
                <textarea
                  className="sos-textarea"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  placeholder="e.g. My current address has changed to…"
                />
              </Field>
              {error ? (
                <div className="sos-banner sos-banner--danger">{error}</div>
              ) : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <GhostButton onClick={onClose}>Cancel</GhostButton>
                <PrimaryButton onClick={handleSubmit} disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send request'}
                </PrimaryButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ClientProfilePage() {
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useEffect(() => {
    getProfile()
      .then((p) => setProfile(p))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load profile'));
  }, []);

  if (error) {
    return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error}</div>;
  }
  if (!profile) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--sos-text-muted)' }}>Loading profile…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sos-text-primary)', margin: 0, marginBottom: 4 }}>
            Profile
          </h1>
          <div style={{ fontSize: 13.5, color: 'var(--sos-text-muted)' }}>
            Read-only. Send an update request if anything needs to change.
          </div>
        </div>
        <PrimaryButton iconLeft={<Edit3 size={14} />} onClick={() => setModalOpen(true)}>
          Request update
        </PrimaryButton>
      </div>

      {confirmation ? (
        <div className="sos-banner sos-banner--success">{confirmation}</div>
      ) : null}

      <GlassCard variant="strong" padded="lg">
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Personal information
        </div>
        <ProfileRow
          label="Name"
          value={`${profile.firstName} ${profile.lastName}`.trim()}
        />
        <ProfileRow
          label="Email"
          value={profile.email ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Mail size={12} /> {profile.email}
            </span>
          ) : null}
        />
        <ProfileRow
          label="Phone"
          value={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Phone size={12} /> {profile.phone}
            </span>
          }
        />
        <ProfileRow label="Alternate phone" value={profile.alternatePhone} />
        <ProfileRow label="Nationality" value={profile.nationality} />
        <ProfileRow label="Date of birth" value={profile.dateOfBirth ? fmtDate(profile.dateOfBirth) : null} />
        <ProfileRow label="CNIC" value={profile.cnicMasked} />
        <ProfileRow label="Passport" value={profile.passportNumberMasked} />
        <ProfileRow label="Address" value={profile.address} />
      </GlassCard>

      <GlassCard variant="panel" padded="lg">
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Your case
        </div>
        <ProfileRow label="Service" value={profile.serviceType} />
        <ProfileRow label="Target country" value={profile.targetCountry} />
        <ProfileRow label="Status" value={profile.status.replace(/_/g, ' ').toLowerCase()} />
        <ProfileRow label="Assigned sales person" value={profile.assignedSalesPersonName} />
      </GlassCard>

      <div
        style={{
          padding: '12px 14px',
          background: 'var(--sos-status-info-soft)',
          border: '1px solid var(--sos-status-info-border)',
          borderRadius: 'var(--sos-radius-md)',
          fontSize: 12.5,
          color: 'var(--sos-text-primary)',
        }}
      >
        <strong>Why is some data masked?</strong> Identifiers like your CNIC and passport are
        masked for safety. Your officer can see the full details from the secure admin panel.
      </div>

      <RequestUpdateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmitted={() => setConfirmation('Update request sent. Your officer will follow up shortly.')}
      />
    </div>
  );
}
