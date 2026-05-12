'use client';

import { useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  MapPin,
  Video,
  XCircle,
} from 'lucide-react';
import { GlassCard, StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';
import {
  fmtDate,
  getAppointments,
  type PortalAppointment,
} from '@/lib/portal';

const TYPE_LABEL: Record<string, string> = {
  CONSULTATION: 'Consultation',
  DOCUMENT_REVIEW: 'Document review',
  FOLLOW_UP: 'Follow-up',
  VISA_FILING: 'Visa filing',
  IN_PERSON: 'In-person meeting',
  BIOMETRICS: 'Biometrics',
  MEDICAL: 'Medical exam',
  INTERVIEW: 'Interview',
  OFFICE_VISIT: 'Office visit',
};

const STATUS_TONE: Record<PortalAppointment['status'], BadgeTone> = {
  SCHEDULED: 'info',
  CONFIRMED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
  RESCHEDULED: 'warning',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AppointmentCard({ appt }: { appt: PortalAppointment }) {
  const typeLabel = TYPE_LABEL[appt.appointmentType] ?? appt.appointmentType;
  const tone = STATUS_TONE[appt.status] ?? 'neutral';
  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div
          style={{
            flexShrink: 0,
            width: 42,
            height: 42,
            borderRadius: 12,
            background: 'var(--sos-brand-primary-soft)',
            color: 'var(--sos-brand-primary-strong)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <CalendarClock size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <strong style={{ fontSize: 14, color: 'var(--sos-text-primary)' }}>{appt.title}</strong>
            <StatusBadge tone={tone} size="sm">{appt.status.toLowerCase()}</StatusBadge>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginBottom: 6 }}>
            {typeLabel} · {formatDateTime(appt.scheduledAt)} · {appt.durationMinutes} min
          </div>
          {appt.location ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--sos-text-secondary)', marginBottom: 4 }}>
              <MapPin size={13} /> {appt.location}
            </div>
          ) : null}
          {appt.meetingLink ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--sos-text-secondary)', marginBottom: 4 }}>
              <Video size={13} />{' '}
              <a
                href={appt.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--sos-brand-primary-strong)', textDecoration: 'underline' }}
              >
                Join meeting
              </a>
            </div>
          ) : null}
          {appt.instructions ? (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                fontSize: 12.5,
                color: 'var(--sos-text-primary)',
                background: 'var(--sos-surface-1)',
                borderRadius: 'var(--sos-radius-sm)',
                border: '1px solid var(--sos-border-subtle)',
              }}
            >
              <strong style={{ fontSize: 11, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Instructions
              </strong>
              <div style={{ marginTop: 4 }}>{appt.instructions}</div>
            </div>
          ) : null}
          {appt.cancellationReason ? (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--sos-status-danger)' }}>
              <XCircle size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Cancelled: {appt.cancellationReason}
            </div>
          ) : null}
          {appt.reminderSent ? (
            <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--sos-status-success)' }}>
              <CheckCircle2 size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Reminder sent
            </div>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}

export function ClientAppointmentsPage() {
  const [appts, setAppts] = useState<PortalAppointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAppointments()
      .then((rows) => setAppts(rows))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load appointments'));
  }, []);

  if (error) {
    return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error}</div>;
  }
  if (!appts) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--sos-text-muted)' }}>Loading appointments…</div>;
  }

  const now = Date.now();
  const upcoming = appts.filter((a) => new Date(a.scheduledAt).getTime() >= now);
  const past = appts.filter((a) => new Date(a.scheduledAt).getTime() < now);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sos-text-primary)', margin: 0, marginBottom: 4 }}>
          Appointments
        </h1>
        <div style={{ fontSize: 13.5, color: 'var(--sos-text-muted)' }}>
          Biometrics, medical, interview, and office-visit appointments for your case
        </div>
      </div>

      {upcoming.length > 0 ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Upcoming ({upcoming.length})
          </div>
          {upcoming.map((a) => <AppointmentCard key={a.id} appt={a} />)}
        </section>
      ) : (
        <GlassCard variant="panel" padded="lg">
          <div className="sos-text-muted" style={{ textAlign: 'center', padding: 16, fontSize: 13.5 }}>
            No upcoming appointments. Your officer will let you know when one is scheduled.
          </div>
        </GlassCard>
      )}

      {past.length > 0 ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Past ({past.length})
          </div>
          {past.map((a) => <AppointmentCard key={a.id} appt={a} />)}
        </section>
      ) : null}
    </div>
  );
}
