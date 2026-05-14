'use client';
// Sales OS — Assigned Leads (premium dark glass redesign).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Flame,
  Globe2,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Search,
  Signal,
  Sliders,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import {
  type Lead,
  type LeadSource,
  type LeadStage,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  STAGE_LABEL,
  fmtRelative,
  initialsOf,
  stageDotColor,
} from '@/components/sales-v2/mockData';
import {
  ButtonLink,
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { fetchLeads } from '@/lib/sales-api';

type FilterKey =
  | 'ALL'
  | 'ADMIN'
  | 'AUTO_CRM'
  | 'OVERDUE'
  | 'PAYMENT'
  | 'APPOINTMENT';

const TABS: Array<{ key: FilterKey; label: string }> = [
  { key: 'ALL', label: 'All Assigned' },
  { key: 'ADMIN', label: 'Admin Assigned' },
  { key: 'AUTO_CRM', label: 'Auto CRM' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'PAYMENT', label: 'Payment Interested' },
  { key: 'APPOINTMENT', label: 'Appointment Needed' },
];

function applyFilter(leads: Lead[], key: FilterKey): Lead[] {
  switch (key) {
    case 'ADMIN':
      return leads.filter((l) => l.assignmentType === 'ADMIN');
    case 'AUTO_CRM':
      return leads.filter((l) => l.assignmentType === 'AUTO_CRM');
    case 'OVERDUE':
      return leads.filter((l) => l.slaStatus === 'OVERDUE');
    case 'PAYMENT':
      return leads.filter((l) => l.stage === 'PAYMENT_INTERESTED' || l.stage === 'RECEIPT_UPLOADED');
    case 'APPOINTMENT':
      return leads.filter((l) => l.stage === 'MEETING_NEEDED' || l.stage === 'APPOINTMENT_BOOKED');
    case 'ALL':
    default:
      return leads;
  }
}

function stageBadgeTone(stage: LeadStage): BadgeTone {
  switch (stage) {
    case 'NEW':
    case 'ASSIGNED':
      return 'info';
    case 'CONTACTED':
      return 'cyan';
    case 'NO_RESPONSE':
      return 'danger';
    case 'MEETING_NEEDED':
      return 'warm';
    case 'APPOINTMENT_BOOKED':
      return 'violet';
    case 'PAYMENT_INTERESTED':
    case 'RECEIPT_UPLOADED':
      return 'warning';
    case 'SENT_TO_FINANCE':
      return 'success';
    default:
      return 'neutral';
  }
}

function priorityTone(p: 'LOW' | 'MEDIUM' | 'HIGH'): BadgeTone {
  return p === 'HIGH' ? 'danger' : p === 'MEDIUM' ? 'warning' : 'neutral';
}

function sourceTone(s: LeadSource): BadgeTone {
  switch (s) {
    case 'FACEBOOK': return 'info';
    case 'INSTAGRAM': return 'pink';
    case 'WEBSITE': return 'violet';
    case 'WHATSAPP': return 'success';
    case 'REFERRAL': return 'warning';
    case 'PHONE': return 'cyan';
    case 'WALK_IN':
    default: return 'neutral';
  }
}

function slaTone(s: string): BadgeTone {
  if (s === 'OVERDUE') return 'danger';
  if (s === 'ACTIVE') return 'success';
  if (s === 'UPCOMING') return 'info';
  return 'neutral';
}

export function SalesLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterKey>('ALL');
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchLeads()
      .then(setLeads)
      .catch((e) => setError(e?.message ?? 'Failed to load leads'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = applyFilter(leads, tab);
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (l) =>
          `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
          l.phone.toLowerCase().includes(q) ||
          l.service.toLowerCase().includes(q) ||
          l.targetCountry.toLowerCase().includes(q),
      );
    }
    return result;
  }, [leads, tab, query]);

  const counts = useMemo(
    () => ({
      ALL: leads.length,
      ADMIN: leads.filter((l) => l.assignmentType === 'ADMIN').length,
      AUTO_CRM: leads.filter((l) => l.assignmentType === 'AUTO_CRM').length,
      OVERDUE: leads.filter((l) => l.slaStatus === 'OVERDUE').length,
      PAYMENT: leads.filter((l) => l.stage === 'PAYMENT_INTERESTED' || l.stage === 'RECEIPT_UPLOADED').length,
      APPOINTMENT: leads.filter((l) => l.stage === 'MEETING_NEEDED' || l.stage === 'APPOINTMENT_BOOKED').length,
    }),
    [leads],
  );

  const slaActive = leads.filter((l) => l.slaStatus === 'ACTIVE').length;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: '10px', color: 'var(--sos-text-muted)' }}>
        <Loader2 size={20} className="sos-spin" />
        <span>Loading leads…</span>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="Could not load leads"
        description={error}
        action={<PrimaryButton onClick={() => { setError(null); setLoading(true); fetchLeads().then(setLeads).catch((e) => setError(e?.message ?? 'Failed')).finally(() => setLoading(false)); }}>Retry</PrimaryButton>}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="Assigned queue"
        title={<>Every lead with a name, a stage, and a next move.</>}
        description={
          <>
            {counts.ALL} leads currently in your queue · {counts.ADMIN} from admin · {counts.AUTO_CRM} from
            auto-CRM · {counts.OVERDUE} need immediate attention.
          </>
        }
        actions={
          <>
            <ButtonLink
              href={'/sales/create-lead' as Route}
              variant="primary"
              iconLeft={<Plus size={16} />}
            >
              New Lead
            </ButtonLink>
            <SecondaryButton iconLeft={<Sliders size={15} />}>Filters</SecondaryButton>
          </>
        }
      />

      {/* KPIs */}
      <section
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <MetricCard
          label="Admin Assigned"
          value={counts.ADMIN}
          hint="Manually routed by admin"
          tone="info"
          Icon={Users}
          footer="Priority queue from the front desk"
        />
        <MetricCard
          label="Auto CRM Assigned"
          value={counts.AUTO_CRM}
          hint="Social media & website inflow"
          tone="accent"
          Icon={Sparkles}
          footer="Fresh inbound demand from digital channels"
        />
        <MetricCard
          label="SLA Active"
          value={slaActive}
          hint="Within first-response window"
          tone="success"
          Icon={Signal}
          footer="Touches still on schedule"
        />
        <MetricCard
          label="Overdue Leads"
          value={counts.OVERDUE}
          hint="Action required now"
          tone={counts.OVERDUE > 0 ? 'danger' : 'success'}
          Icon={CircleAlert}
          footer={counts.OVERDUE > 0 ? 'Reach out before the queue cools' : 'All touches inside the window'}
        />
      </section>

      {/* Toolbar */}
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
          {/* Tabs */}
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

          {/* Search */}
          <div className="sos-topbar__search sos-search-input">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, phone, service…"
              aria-label="Search leads"
            />
          </div>
        </div>
      </GlassCard>

      {/* Lead grid */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No leads match this filter"
          description="Try clearing the search or switching to another tab to see more results."
          action={
            <PrimaryButton onClick={() => { setTab('ALL'); setQuery(''); }}>
              Reset filters
            </PrimaryButton>
          }
        />
      ) : (
        <section
          style={{
            display: 'grid',
            gap: '16px',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
          }}
        >
          {filtered.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </section>
      )}
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const assignedLabel =
    lead.assignmentType === 'ADMIN'
      ? `Admin · ${lead.assignedBy?.split('·')[1]?.trim() ?? 'Front desk'}`
      : 'Auto CRM';

  return (
    <Link
      href={`/sales/leads/${lead.id}` as Route}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <GlassCard variant="default" hover padded="md">
        {/* Top row: avatar + name + chevron */}
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
          <div
            className="sos-avatar"
            style={{
              background: `linear-gradient(135deg, ${stageDotColor(lead.stage)}, var(--sos-brand-deep))`,
            }}
          >
            {initialsOf(lead.firstName, lead.lastName)}
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  color: 'var(--sos-text-primary)',
                  letterSpacing: '-0.005em',
                }}
              >
                {lead.firstName} {lead.lastName}
              </span>
              {lead.priority === 'HIGH' ? (
                <Flame size={13} style={{ color: 'var(--sos-status-danger)' }} aria-label="High priority" />
              ) : null}
            </div>
            <div
              style={{
                marginTop: '4px',
                fontSize: '11.5px',
                color: 'var(--sos-text-faint)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              {assignedLabel} · Assigned {fmtRelative(lead.assignedAt)}
            </div>
          </div>

          <ChevronRight size={16} style={{ color: 'var(--sos-text-faint)', flexShrink: 0 }} />
        </div>

        {/* Status pills row */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            marginTop: '14px',
          }}
        >
          <StatusBadge tone={stageBadgeTone(lead.stage)}>{STAGE_LABEL[lead.stage]}</StatusBadge>
          <StatusBadge tone={priorityTone(lead.priority)}>{PRIORITY_LABEL[lead.priority]} priority</StatusBadge>
          <StatusBadge tone={sourceTone(lead.source)}>{SOURCE_LABEL[lead.source]}</StatusBadge>
          {lead.slaStatus === 'OVERDUE' ? (
            <StatusBadge tone="danger">SLA overdue</StatusBadge>
          ) : (
            <StatusBadge tone={slaTone(lead.slaStatus)}>SLA {lead.slaStatus.toLowerCase()}</StatusBadge>
          )}
        </div>

        {/* Meta grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '10px',
            marginTop: '14px',
            padding: '12px 14px',
            borderRadius: 'var(--sos-radius-sm)',
            background: 'var(--sos-surface-1)',
            border: '1px solid var(--sos-border-subtle)',
          }}
        >
          <MetaItem
            Icon={Wallet}
            label="Service"
            value={lead.service}
          />
          <MetaItem
            Icon={Globe2}
            label="Country"
            value={lead.targetCountry}
          />
          <MetaItem
            Icon={Phone}
            label="Phone"
            value={lead.phone}
          />
          <MetaItem
            Icon={MapPin}
            label="Source"
            value={SOURCE_LABEL[lead.source]}
          />
        </div>

        {/* Next action */}
        <div
          style={{
            marginTop: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 14px',
            borderRadius: 'var(--sos-radius-sm)',
            background: 'var(--sos-brand-primary-soft)',
            border: '1px solid var(--sos-brand-primary-border)',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '10px',
              display: 'grid',
              placeItems: 'center',
              background: 'var(--sos-brand-primary-soft)',
              color: 'var(--sos-brand-primary-strong)',
              border: '1px solid var(--sos-brand-primary-border)',
              flexShrink: 0,
            }}
          >
            <CalendarClock size={15} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--sos-brand-primary-strong)',
              }}
            >
              Next action
            </div>
            <div
              style={{
                fontSize: '13px',
                color: 'var(--sos-text-primary)',
                marginTop: '2px',
                fontWeight: 500,
              }}
            >
              {lead.nextAction}
            </div>
          </div>
          {lead.slaDueAt ? (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div
                style={{
                  fontSize: '10.5px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--sos-text-faint)',
                }}
              >
                Due
              </div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color:
                    lead.slaStatus === 'OVERDUE'
                      ? 'var(--sos-status-danger)'
                      : 'var(--sos-text-primary)',
                  marginTop: '2px',
                }}
              >
                {fmtRelative(lead.slaDueAt)}
              </div>
            </div>
          ) : null}
        </div>
      </GlassCard>
    </Link>
  );
}

function MetaItem({
  Icon,
  label,
  value,
}: {
  Icon: typeof Wallet;
  label: string;
  value: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '9px',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--sos-surface-2)',
          color: 'var(--sos-text-muted)',
          border: '1px solid var(--sos-border-subtle)',
          flexShrink: 0,
        }}
      >
        <Icon size={13} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: '10px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--sos-text-faint)',
            fontWeight: 700,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: '12.5px',
            color: 'var(--sos-text-primary)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
