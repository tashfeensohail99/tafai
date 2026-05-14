'use client';
// Sales OS — Follow-ups (premium dark glass redesign).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertCircle,
  AtSign,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  Search,
  Sliders,
  TimerReset,
} from 'lucide-react';
import {
  type FollowUp,
  type FollowUpStatus,
  FOLLOWUP_TYPE_LABEL,
  fmtDateTime,
  fmtRelative,
  initialsOf,
} from '@/components/sales-v2/mockData';
import {
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { fetchFollowUps } from '@/lib/sales-api';

type Tab =
  | 'TODAY'
  | 'OVERDUE'
  | 'UPCOMING'
  | 'NO_RESPONSE'
  | 'PAYMENT'
  | 'APPOINTMENT'
  | 'COMPLETED';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'TODAY', label: 'Today' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'UPCOMING', label: 'Upcoming' },
  { key: 'NO_RESPONSE', label: 'No Response' },
  { key: 'PAYMENT', label: 'Payment' },
  { key: 'APPOINTMENT', label: 'Appointment' },
  { key: 'COMPLETED', label: 'Completed' },
];

function applyTab(items: FollowUp[], tab: Tab): FollowUp[] {
  switch (tab) {
    case 'TODAY':
      return items.filter((f) => f.status === 'DUE_TODAY');
    case 'OVERDUE':
      return items.filter((f) => f.status === 'OVERDUE');
    case 'UPCOMING':
      return items.filter((f) => f.status === 'PENDING' || f.status === 'RESCHEDULED');
    case 'NO_RESPONSE':
      return items.filter((f) => f.status === 'NO_RESPONSE');
    case 'PAYMENT':
      return items.filter((f) => f.type === 'PAYMENT_REMINDER');
    case 'APPOINTMENT':
      return items.filter((f) => f.type === 'APPOINTMENT_REMINDER');
    case 'COMPLETED':
      return items.filter((f) => f.status === 'COMPLETED');
    default:
      return items;
  }
}

function statusLabel(s: FollowUpStatus): string {
  return ({
    PENDING: 'Pending',
    DUE_TODAY: 'Due Today',
    OVERDUE: 'Overdue',
    COMPLETED: 'Completed',
    RESCHEDULED: 'Rescheduled',
    NO_RESPONSE: 'No Response',
    PAYMENT_INTERESTED: 'Payment Interested',
  } as const)[s];
}

function statusTone(s: FollowUpStatus): BadgeTone {
  switch (s) {
    case 'OVERDUE':
    case 'NO_RESPONSE':
      return 'danger';
    case 'DUE_TODAY':
      return 'warning';
    case 'PENDING':
    case 'RESCHEDULED':
      return 'info';
    case 'PAYMENT_INTERESTED':
      return 'warm';
    case 'COMPLETED':
      return 'success';
    default:
      return 'neutral';
  }
}

function slaTone(s: FollowUp['slaStatus']): BadgeTone {
  if (s === 'OVERDUE') return 'danger';
  if (s === 'ACTIVE') return 'success';
  if (s === 'UPCOMING') return 'info';
  return 'neutral';
}

function ChannelIcon({ channel }: { channel: FollowUp['channel'] }) {
  switch (channel) {
    case 'CALL':
      return <Phone size={12} />;
    case 'WHATSAPP':
      return <MessageSquare size={12} />;
    case 'EMAIL':
      return <AtSign size={12} />;
    case 'IN_PERSON':
      return <MapPin size={12} />;
  }
}

export function SalesFollowUpsPage() {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('TODAY');
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchFollowUps()
      .then(setFollowUps)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = applyTab(followUps, tab);
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (f) => f.clientName.toLowerCase().includes(q) || f.reason.toLowerCase().includes(q),
      );
    }
    return result.sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));
  }, [followUps, tab, query]);

  const counts = useMemo(
    () => ({
      TODAY: followUps.filter((f) => f.status === 'DUE_TODAY').length,
      OVERDUE: followUps.filter((f) => f.status === 'OVERDUE').length,
      UPCOMING: followUps.filter((f) => f.status === 'PENDING' || f.status === 'RESCHEDULED').length,
      NO_RESPONSE: followUps.filter((f) => f.status === 'NO_RESPONSE').length,
      PAYMENT: followUps.filter((f) => f.type === 'PAYMENT_REMINDER').length,
      APPOINTMENT: followUps.filter((f) => f.type === 'APPOINTMENT_REMINDER').length,
      COMPLETED: followUps.filter((f) => f.status === 'COMPLETED').length,
    }),
    [followUps],
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: '10px', color: 'var(--sos-text-muted)' }}>
        <Loader2 size={20} className="sos-spin" />
        <span>Loading follow-ups…</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="Follow-ups"
        title={<>Keep every touchpoint honest and on the clock.</>}
        description={
          <>
            {counts.TODAY} touches due today · {counts.OVERDUE} outside SLA · {counts.UPCOMING}{' '}
            queued for the rest of the week. Sort by what is bleeding most and clear it first.
          </>
        }
        actions={
          <>
            <PrimaryButton iconLeft={<TimerReset size={15} />}>
              Bulk reschedule
            </PrimaryButton>
            <SecondaryButton iconLeft={<Sliders size={15} />}>Filters</SecondaryButton>
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
          label="Due today"
          value={counts.TODAY}
          hint="Calls and messages today"
          tone="warm"
          Icon={Clock}
          footer="Hit these before clients cool off"
        />
        <MetricCard
          label="Overdue"
          value={counts.OVERDUE}
          hint="Past their SLA window"
          tone={counts.OVERDUE > 0 ? 'danger' : 'success'}
          Icon={AlertCircle}
          footer={
            counts.OVERDUE > 0
              ? 'Recover these to protect SLA score'
              : 'No SLA breaches right now'
          }
        />
        <MetricCard
          label="Upcoming"
          value={counts.UPCOMING}
          hint="Pending in the next few days"
          tone="info"
          Icon={TimerReset}
          footer="Plan ahead and batch the queue"
        />
        <MetricCard
          label="Completed"
          value={counts.COMPLETED}
          hint="Closed this week"
          tone="success"
          Icon={CheckCircle2}
          footer="Touches resolved with an outcome"
        />
      </section>

      <GlassCard variant="default" padded="md">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            className="sos-no-scrollbar"
            style={{
              display: 'flex',
              gap: '6px',
              padding: '4px',
              background: 'var(--sos-bg-input)',
              border: '1px solid var(--sos-border)',
              borderRadius: 'var(--sos-radius-button)',
              overflowX: 'auto',
              maxWidth: '100%',
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                onClick={() => setTab(t.key)}
                className="sos-tab"
              >
                {t.label}
                <span className="sos-tab__count">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          <div className="sos-topbar__search sos-search-input">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by client or reason…"
              aria-label="Search follow-ups"
            />
          </div>
        </div>
      </GlassCard>

      {filtered.length === 0 ? (
        <EmptyState
          title="You're all caught up!"
          description="No follow-ups in this view right now. Try another tab or clear your search to see more."
          action={
            <PrimaryButton onClick={() => { setTab('TODAY'); setQuery(''); }}>
              Reset filters
            </PrimaryButton>
          }
        />
      ) : (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map((f) => (
            <FollowUpRow key={f.id} item={f} />
          ))}
        </section>
      )}
    </div>
  );
}

function FollowUpRow({ item }: { item: FollowUp }) {
  const [first, last] = item.clientName.split(' ');
  const isOverdue = item.status === 'OVERDUE';
  const dueColor = isOverdue ? 'var(--sos-status-danger)' : 'var(--sos-text-primary)';

  return (
    <Link
      href={`/sales/follow-ups/${item.id}` as Route}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <GlassCard variant="default" hover padded="md">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
            gap: '14px',
            alignItems: 'center',
          }}
        >
          <div
            className="sos-avatar"
            style={{
              background: isOverdue
                ? 'var(--sos-avatar-danger-gradient)'
                : 'var(--sos-brand-gradient)',
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
                  fontSize: '15px',
                  fontWeight: 700,
                  color: 'var(--sos-text-primary)',
                  letterSpacing: '-0.005em',
                }}
              >
                {item.clientName}
              </span>
              <StatusBadge tone={statusTone(item.status)}>
                {statusLabel(item.status)}
              </StatusBadge>
              <StatusBadge tone={slaTone(item.slaStatus)}>
                SLA {item.slaStatus.toLowerCase()}
              </StatusBadge>
            </div>

            <div
              className="sos-text-secondary"
              style={{
                marginTop: '6px',
                fontSize: '13px',
                lineHeight: 1.55,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {item.reason}
            </div>

            <div
              style={{
                marginTop: '10px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
              }}
            >
              <MetaPill icon={<ChannelIcon channel={item.channel} />}>
                {item.channel.replace('_', ' ').toLowerCase()}
              </MetaPill>
              <MetaPill>{FOLLOWUP_TYPE_LABEL[item.type]}</MetaPill>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div
              className="sos-text-faint"
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              Due
            </div>
            <div
              style={{
                fontSize: '13.5px',
                fontWeight: 700,
                marginTop: '4px',
                color: dueColor,
              }}
            >
              {fmtRelative(item.dueAt)}
            </div>
            <div
              className="sos-text-faint"
              style={{ fontSize: '11px', marginTop: '2px' }}
            >
              {fmtDateTime(item.dueAt)}
            </div>
          </div>

          <ChevronRight
            size={16}
            style={{ color: 'var(--sos-text-faint)', flexShrink: 0 }}
          />
        </div>
      </GlassCard>
    </Link>
  );
}

function MetaPill({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '999px',
        background: 'var(--sos-surface-2)',
        border: '1px solid var(--sos-border-subtle)',
        color: 'var(--sos-text-muted)',
        fontSize: '11.5px',
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {icon}
      {children}
    </span>
  );
}
