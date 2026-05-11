'use client';
// Sales OS — Appointments (premium dark glass redesign).
//
// Reps need: a fast booking form on the left, a live calendar of what's coming up
// on the right, KPIs at a glance, and a clean way to see what's already been done.

import { useMemo, useState, type FormEvent } from 'react';
import {
  Briefcase,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  Sparkles,
  StickyNote,
  Users,
  Video,
} from 'lucide-react';
import {
  type Appointment,
  type AppointmentStatus,
  type AppointmentType,
  APPT_TYPE_LABEL,
  MOCK_APPOINTMENTS,
  MOCK_LEADS,
  fmtDateTime,
  fmtRelative,
  fmtTimeOnly,
  initialsOf,
} from '@/components/sales-v2/mockData';
import {
  EmptyState,
  Field,
  FormInput,
  FormSelect,
  FormTextarea,
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';

const TYPES: AppointmentType[] = [
  'OFFICE_MEETING',
  'VIDEO_CALL',
  'PHONE_CONSULT',
  'OFFICE_VISIT',
];

const TYPE_META: Record<
  AppointmentType,
  { Icon: typeof Users; tone: string; caption: string }
> = {
  OFFICE_MEETING: {
    Icon: Users,
    tone: 'var(--sos-status-violet)',
    caption: 'In-office consultation',
  },
  VIDEO_CALL: {
    Icon: Video,
    tone: 'var(--sos-status-info)',
    caption: 'Zoom / Google Meet',
  },
  PHONE_CONSULT: {
    Icon: Phone,
    tone: 'var(--sos-status-cyan)',
    caption: 'Quick phone consult',
  },
  OFFICE_VISIT: {
    Icon: MapPin,
    tone: 'var(--sos-brand-accent)',
    caption: 'Walk-in / drop-off',
  },
};

function TypeIcon({
  type,
  size = 16,
}: {
  type: AppointmentType;
  size?: number;
}) {
  const { Icon } = TYPE_META[type];
  return <Icon size={size} />;
}

function statusTone(s: AppointmentStatus): BadgeTone {
  if (s === 'BOOKED') return 'success';
  if (s === 'PENDING') return 'warning';
  if (s === 'COMPLETED') return 'info';
  if (s === 'CANCELLED') return 'danger';
  if (s === 'NO_SHOW') return 'danger';
  return 'neutral';
}

const PRESET_LOCATIONS = [
  'Tafsheen HQ — Meeting Room 2',
  'Tafsheen HQ — Front Desk',
  'Client office',
  'Branch office — Lahore',
];

export function SalesAppointmentsPage() {
  const [clientId, setClientId] = useState(MOCK_LEADS[0]?.id ?? '');
  const [type, setType] = useState<AppointmentType>('OFFICE_MEETING');
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState('15:00');
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState('Tafsheen HQ — Meeting Room 2');
  const [note, setNote] = useState('Bring CNIC and academic transcripts.');
  const [confirmed, setConfirmed] = useState(false);

  const upcoming = useMemo(
    () =>
      [...MOCK_APPOINTMENTS]
        .filter((a) => a.status === 'BOOKED' || a.status === 'PENDING')
        .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt)),
    [],
  );
  const past = useMemo(
    () =>
      [...MOCK_APPOINTMENTS]
        .filter((a) =>
          ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(a.status),
        )
        .sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt)),
    [],
  );

  const todayCount = useMemo(() => {
    const today = new Date();
    return upcoming.filter((a) => {
      const d = new Date(a.scheduledAt);
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    }).length;
  }, [upcoming]);

  const completedCount = MOCK_APPOINTMENTS.filter(
    (a) => a.status === 'COMPLETED',
  ).length;
  const cancelledCount = MOCK_APPOINTMENTS.filter(
    (a) => a.status === 'CANCELLED' || a.status === 'NO_SHOW',
  ).length;

  const selectedLead = MOCK_LEADS.find((l) => l.id === clientId);
  const requiresLocation = type === 'OFFICE_MEETING' || type === 'OFFICE_VISIT';

  function handleBook(e: FormEvent) {
    e.preventDefault();
    setConfirmed(true);
    setTimeout(() => setConfirmed(false), 3000);
  }

  const scheduledDateTime =
    date && time ? new Date(`${date}T${time}:00`) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="Appointments"
        title={
          <>
            Lock down the meeting,<br />the lead does the rest.
          </>
        }
        description={
          <>
            {upcoming.length} upcoming · {todayCount} today · {completedCount}{' '}
            completed this week. Book a slot, choose the format, and the lead
            stage updates automatically.
          </>
        }
        actions={
          <>
            <PrimaryButton iconLeft={<CalendarPlus size={15} />}>
              Quick book
            </PrimaryButton>
            <SecondaryButton iconLeft={<CalendarClock size={15} />}>
              Sync calendar
            </SecondaryButton>
          </>
        }
      />

      <section
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <MetricCard
          label="Today"
          value={todayCount}
          hint="Meetings on the calendar today"
          tone="warm"
          Icon={CalendarClock}
          footer="Make sure the room and contact are ready"
        />
        <MetricCard
          label="Upcoming"
          value={upcoming.length}
          hint="Booked or awaiting confirmation"
          tone="accent"
          Icon={CalendarCheck}
          footer="Forward bookings still on the calendar"
        />
        <MetricCard
          label="Completed"
          value={completedCount}
          hint="Successfully met this week"
          tone="success"
          Icon={CheckCircle2}
          footer="Use these to nudge stage forward"
        />
        <MetricCard
          label="Cancelled / no-show"
          value={cancelledCount}
          hint="Need rescheduling or a follow-up call"
          tone={cancelledCount > 0 ? 'danger' : 'neutral'}
          Icon={CalendarX}
          footer={
            cancelledCount > 0
              ? 'Send a quick reschedule via WhatsApp'
              : 'Nothing to recover right now'
          }
        />
      </section>

      <section
        style={{
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr)',
        }}
        className="sos-detail-grid"
      >
        <GlassCard variant="strong" padded="lg" glow="accent">
          <BookingHeader
            confirmed={confirmed}
            scheduledDateTime={scheduledDateTime}
            duration={duration}
          />

          <form
            onSubmit={handleBook}
            style={{
              marginTop: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            <FormSelect
              label="Client"
              required
              hint="Pick the lead this meeting is for."
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              options={MOCK_LEADS.map((l) => ({
                value: l.id,
                label: `${l.firstName} ${l.lastName} — ${l.service}, ${l.targetCountry}`,
              }))}
            />

            {selectedLead ? (
              <SelectedLeadCard
                name={`${selectedLead.firstName} ${selectedLead.lastName}`}
                phone={selectedLead.phone}
                service={`${selectedLead.service} → ${selectedLead.targetCountry}`}
              />
            ) : null}

            <Field
              label="Meeting type"
              required
              hint="Office meeting and visit need a location below."
            >
              <div
                style={{
                  display: 'grid',
                  gap: '10px',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                }}
              >
                {TYPES.map((t) => (
                  <TypeTile
                    key={t}
                    active={type === t}
                    onClick={() => setType(t)}
                    label={APPT_TYPE_LABEL[t]}
                    caption={TYPE_META[t].caption}
                    Icon={TYPE_META[t].Icon}
                    tone={TYPE_META[t].tone}
                  />
                ))}
              </div>
            </Field>

            <div
              style={{
                display: 'grid',
                gap: '12px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              }}
            >
              <Field label="Date" required>
                <input
                  type="date"
                  className="sos-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="Time" required>
                <input
                  type="time"
                  className="sos-input"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Duration" hint="How long do you need the slot for?">
              <div
                style={{
                  display: 'grid',
                  gap: '8px',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                }}
              >
                {[15, 30, 45, 60].map((m) => (
                  <DurationChip
                    key={m}
                    active={duration === m}
                    onClick={() => setDuration(m)}
                    label={`${m}m`}
                  />
                ))}
              </div>
            </Field>

            {requiresLocation ? (
              <Field
                label="Location"
                required
                hint="Where should the client show up?"
              >
                <FormInput
                  iconLeft={<MapPin size={14} />}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Office, room, or address"
                />
                <div
                  style={{
                    marginTop: '10px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  {PRESET_LOCATIONS.map((p) => (
                    <PresetChip
                      key={p}
                      active={location === p}
                      onClick={() => setLocation(p)}
                      label={p}
                    />
                  ))}
                </div>
              </Field>
            ) : null}

            <FormTextarea
              label="Note for the meeting"
              hint="Mention what the client should bring or prepare."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What should the client bring?"
              style={{ minHeight: 100 }}
            />

            <PrimaryButton
              type="submit"
              size="lg"
              fullWidth
              iconLeft={<CalendarPlus size={16} />}
            >
              Book appointment
            </PrimaryButton>

            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '10px 12px',
                borderRadius: 'var(--sos-radius-sm)',
                background: 'var(--sos-surface-1)',
                border: '1px solid var(--sos-border-subtle)',
              }}
            >
              <Sparkles
                size={13}
                style={{
                  color: 'var(--sos-brand-primary-strong)',
                  marginTop: '3px',
                  flexShrink: 0,
                }}
              />
              <div
                className="sos-text-muted"
                style={{ fontSize: '12px', lineHeight: 1.55 }}
              >
                Booking sets the lead stage to{' '}
                <strong style={{ color: 'var(--sos-text-primary)' }}>
                  Appointment Booked
                </strong>{' '}
                and queues a reminder follow-up automatically.
              </div>
            </div>
          </form>
        </GlassCard>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <UpcomingList items={upcoming} />
          <PastList items={past} />
        </div>
      </section>
    </div>
  );
}

function BookingHeader({
  confirmed,
  scheduledDateTime,
  duration,
}: {
  confirmed: boolean;
  scheduledDateTime: Date | null;
  duration: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="sos-eyebrow">Book a meeting</div>
          <h2
            className="sos-title"
            style={{ fontSize: '17px', marginTop: '6px' }}
          >
            New appointment
          </h2>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '13px' }}
          >
            Pick a client, choose the format, lock the time.
          </p>
        </div>
        {scheduledDateTime ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: 'var(--sos-radius-sm)',
              background: 'var(--sos-brand-primary-soft)',
              color: 'var(--sos-brand-primary-strong)',
              border: '1px solid var(--sos-brand-primary-border)',
              minWidth: '92px',
            }}
          >
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              {new Intl.DateTimeFormat('en-PK', {
                weekday: 'short',
              }).format(scheduledDateTime)}
            </span>
            <span style={{ fontSize: '24px', fontWeight: 700, lineHeight: 1, marginTop: '2px' }}>
              {scheduledDateTime.getDate()}
            </span>
            <span style={{ fontSize: '11px', marginTop: '2px' }}>
              {fmtTimeOnly(scheduledDateTime.toISOString())} · {duration}m
            </span>
          </div>
        ) : null}
      </div>

      {confirmed ? (
        <div className="sos-banner sos-banner--success">
          <CheckCircle2 size={15} />
          <span>
            Appointment booked. A reminder follow-up has been queued and the
            lead stage updated.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SelectedLeadCard({
  name,
  phone,
  service,
}: {
  name: string;
  phone: string;
  service: string;
}) {
  const [first, last] = name.split(' ');
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 14px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
      }}
    >
      <div className="sos-avatar" aria-hidden>
        {initialsOf(first ?? '', last ?? '')}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: '13.5px',
            fontWeight: 700,
            color: 'var(--sos-text-primary)',
          }}
        >
          {name}
        </div>
        <div
          className="sos-text-muted"
          style={{ marginTop: '2px', fontSize: '12px' }}
        >
          {service}
        </div>
      </div>
      <span
        className="sos-text-muted"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '12px',
          fontWeight: 600,
        }}
      >
        <Phone size={12} /> {phone}
      </span>
    </div>
  );
}

function TypeTile({
  active,
  onClick,
  label,
  caption,
  Icon,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  caption: string;
  Icon: typeof Users;
  tone: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '12px',
        borderRadius: 'var(--sos-radius-sm)',
        border: active ? '1.5px solid ' + tone : '1px solid var(--sos-border)',
        background: active
          ? 'color-mix(in srgb, ' + tone + ' 12%, transparent)'
          : 'var(--sos-surface-1)',
        boxShadow: active
          ? `0 0 0 3px color-mix(in srgb, ${tone} 18%, transparent)`
          : 'none',
        transition: 'all 160ms ease',
      }}
    >
      <div
        style={{
          width: '34px',
          height: '34px',
          borderRadius: '11px',
          display: 'grid',
          placeItems: 'center',
          background: 'color-mix(in srgb, ' + tone + ' 18%, transparent)',
          color: tone,
          border: '1px solid color-mix(in srgb, ' + tone + ' 30%, transparent)',
          flexShrink: 0,
        }}
      >
        <Icon size={16} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--sos-text-primary)',
          }}
        >
          {label}
        </div>
        <div
          className="sos-text-muted"
          style={{ marginTop: '2px', fontSize: '11.5px', lineHeight: 1.45 }}
        >
          {caption}
        </div>
      </div>
    </button>
  );
}

function DurationChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        textAlign: 'center',
        padding: '10px 12px',
        borderRadius: 'var(--sos-radius-button)',
        border: active
          ? '1.5px solid var(--sos-border-accent)'
          : '1px solid var(--sos-border)',
        background: active
          ? 'var(--sos-brand-primary-soft)'
          : 'var(--sos-surface-1)',
        color: active
          ? 'var(--sos-brand-primary-strong)'
          : 'var(--sos-text-secondary)',
        fontSize: '13px',
        fontWeight: 700,
        transition: 'all 160ms ease',
      }}
    >
      {label}
    </button>
  );
}

function PresetChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        padding: '6px 12px',
        fontSize: '11.5px',
        fontWeight: 600,
        borderRadius: '999px',
        border: active
          ? '1px solid var(--sos-border-accent)'
          : '1px solid var(--sos-border)',
        background: active
          ? 'var(--sos-brand-primary-soft)'
          : 'var(--sos-surface-1)',
        color: active
          ? 'var(--sos-brand-primary-strong)'
          : 'var(--sos-text-secondary)',
        transition: 'all 160ms ease',
      }}
    >
      {label}
    </button>
  );
}

function UpcomingList({ items }: { items: Appointment[] }) {
  return (
    <GlassCard variant="default" padded={false}>
      <div
        style={{
          padding: '18px 20px',
          borderBottom: '1px solid var(--sos-divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="sos-eyebrow">Calendar</div>
          <h2
            className="sos-title"
            style={{ fontSize: '17px', marginTop: '6px' }}
          >
            Upcoming appointments
          </h2>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '12.5px' }}
          >
            Booked and pending consultations on your calendar.
          </p>
        </div>
        <StatusBadge tone="accent" size="sm">
          {items.length} scheduled
        </StatusBadge>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: '20px' }}>
          <EmptyState
            Icon={CalendarPlus}
            title="No upcoming appointments"
            description="Use the form on the left to book the first slot."
          />
        </div>
      ) : (
        <div>
          {items.map((a, idx) => (
            <AppointmentRow key={a.id} item={a} divider={idx !== 0} />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function PastList({ items }: { items: Appointment[] }) {
  return (
    <GlassCard variant="default" padded={false}>
      <div
        style={{
          padding: '18px 20px',
          borderBottom: '1px solid var(--sos-divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="sos-eyebrow">History</div>
          <h2
            className="sos-title"
            style={{ fontSize: '17px', marginTop: '6px' }}
          >
            Past appointments
          </h2>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '12.5px' }}
          >
            Completed, cancelled, or no-show meetings — newest first.
          </p>
        </div>
        <span
          className="sos-text-faint"
          style={{ fontSize: '11.5px', fontWeight: 600 }}
        >
          {items.length} entries
        </span>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: '20px' }}>
          <EmptyState
            Icon={Briefcase}
            title="No past appointments yet"
            description="Once meetings finish, they show up here for review."
          />
        </div>
      ) : (
        <div>
          {items.map((a, idx) => (
            <PastRow key={a.id} item={a} divider={idx !== 0} />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function AppointmentRow({
  item,
  divider,
}: {
  item: Appointment;
  divider: boolean;
}) {
  const [first, last] = item.clientName.split(' ');
  const meta = TYPE_META[item.type];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto auto minmax(0, 1fr) auto',
        gap: '14px',
        alignItems: 'center',
        padding: '16px 20px',
        borderTop: divider ? '1px solid var(--sos-divider)' : 'none',
      }}
    >
      <DateBadge iso={item.scheduledAt} />

      <div className="sos-avatar" aria-hidden>
        {initialsOf(first ?? '', last ?? '')}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: 'var(--sos-text-primary)',
            }}
          >
            {item.clientName}
          </span>
          <StatusBadge tone={statusTone(item.status)} size="sm">
            {item.status.replace('_', ' ').toLowerCase()}
          </StatusBadge>
          <TypeChip type={item.type} />
        </div>
        {item.location ? (
          <div
            style={{
              marginTop: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: 'var(--sos-text-secondary)',
            }}
          >
            <MapPin size={12} /> {item.location}
          </div>
        ) : null}
        {item.note ? (
          <div
            className="sos-text-faint"
            style={{ marginTop: '4px', fontSize: '11.5px', lineHeight: 1.5 }}
          >
            <StickyNote
              size={11}
              style={{
                display: 'inline',
                verticalAlign: '-2px',
                marginRight: '6px',
                color: meta.tone,
              }}
            />
            {item.note}
          </div>
        ) : null}
      </div>

      <div style={{ textAlign: 'right' }}>
        <div
          className="sos-text-faint"
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          In
        </div>
        <div
          style={{
            fontSize: '13.5px',
            fontWeight: 700,
            color: 'var(--sos-text-primary)',
            marginTop: '2px',
          }}
        >
          {fmtRelative(item.scheduledAt)}
        </div>
        <div
          className="sos-text-faint"
          style={{
            marginTop: '2px',
            fontSize: '11px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            justifyContent: 'flex-end',
          }}
        >
          <Clock size={11} /> {item.durationMin}m
        </div>
      </div>
    </div>
  );
}

function PastRow({ item, divider }: { item: Appointment; divider: boolean }) {
  const [first, last] = item.clientName.split(' ');
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gap: '12px',
        alignItems: 'center',
        padding: '12px 20px',
        borderTop: divider ? '1px solid var(--sos-divider)' : 'none',
      }}
    >
      <div
        className="sos-avatar"
        style={{
          background: 'var(--sos-avatar-muted-gradient)',
          width: '36px',
          height: '36px',
          fontSize: '12px',
        }}
      >
        {initialsOf(first ?? '', last ?? '')}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--sos-text-primary)',
            }}
          >
            {item.clientName}
          </span>
          <StatusBadge tone={statusTone(item.status)} size="sm">
            {item.status.replace('_', ' ').toLowerCase()}
          </StatusBadge>
        </div>
        <div
          className="sos-text-muted"
          style={{ marginTop: '2px', fontSize: '12px' }}
        >
          {APPT_TYPE_LABEL[item.type]} · {fmtDateTime(item.scheduledAt)}
        </div>
      </div>
      <span
        className="sos-text-faint"
        style={{ fontSize: '11.5px', fontWeight: 600 }}
      >
        {item.durationMin}m
      </span>
    </div>
  );
}

function DateBadge({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 12px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-brand-primary-soft)',
        color: 'var(--sos-brand-primary-strong)',
        border: '1px solid var(--sos-brand-primary-border)',
        minWidth: '64px',
      }}
    >
      <span
        style={{
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        {new Intl.DateTimeFormat('en-PK', { month: 'short' }).format(d)}
      </span>
      <span style={{ fontSize: '20px', fontWeight: 700, lineHeight: 1, marginTop: '2px' }}>
        {d.getDate()}
      </span>
      <span style={{ fontSize: '10.5px', marginTop: '2px' }}>
        {fmtTimeOnly(iso)}
      </span>
    </div>
  );
}

function TypeChip({ type }: { type: AppointmentType }) {
  const meta = TYPE_META[type];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '999px',
        fontSize: '11px',
        fontWeight: 600,
        background: 'color-mix(in srgb, ' + meta.tone + ' 12%, transparent)',
        color: meta.tone,
        border: '1px solid color-mix(in srgb, ' + meta.tone + ' 28%, transparent)',
      }}
    >
      <TypeIcon type={type} size={11} />
      {APPT_TYPE_LABEL[type]}
    </span>
  );
}

