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
  type LucideIcon,
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
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { fetchLeads } from '@/lib/sales-api';
import { phoneMatches } from '@/lib/phone-search';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';
import { Modal } from '@/components/whatsapp/Modal';

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

// ── Advanced filter (the "Filters" panel) ──────────────────────────────────
interface DetailFilters {
  stage: string;          // '' = any. 'PENDING' groups NEW + ASSIGNED.
  priority: string;       // '' | LOW | MEDIUM | HIGH
  source: string;         // '' | LeadSource
  assignmentType: string; // '' | ADMIN | AUTO_CRM
  slaStatus: string;      // '' | ACTIVE | OVERDUE | UPCOMING | COMPLETED
  country: string;        // '' | <targetCountry value>
  service: string;        // '' | <service value>
  emailVerified: string;  // '' | yes | no
}
const EMPTY_FILTERS: DetailFilters = {
  stage: '', priority: '', source: '', assignmentType: '',
  slaStatus: '', country: '', service: '', emailVerified: '',
};

const STAGE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'NO_RESPONSE', label: 'No Response' },
  { value: 'MEETING_NEEDED', label: 'Meeting Needed' },
  { value: 'APPOINTMENT_BOOKED', label: 'Appointment Booked' },
  { value: 'PAYMENT_INTERESTED', label: 'Payment Interested' },
  { value: 'RECEIPT_UPLOADED', label: 'Receipt Uploaded' },
  { value: 'SENT_TO_FINANCE', label: 'Sent to Finance' },
];
const PRIORITY_FILTER_OPTIONS = ['HIGH', 'MEDIUM', 'LOW'];
const SOURCE_FILTER_OPTIONS = ['WHATSAPP', 'META_LEAD_FORM', 'FACEBOOK', 'INSTAGRAM', 'WEBSITE', 'REFERRAL', 'PHONE', 'WALK_IN'];
const SLA_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ACTIVE', label: 'On time' },
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'COMPLETED', label: 'Completed' },
];

/** Apply the advanced "Filters" panel selections on top of the tab + search. */
function applyDetailFilters(leads: Lead[], f: DetailFilters): Lead[] {
  let r = leads;
  if (f.stage === 'PENDING') r = r.filter((l) => l.stage === 'NEW' || l.stage === 'ASSIGNED');
  else if (f.stage) r = r.filter((l) => l.stage === f.stage);
  if (f.priority) r = r.filter((l) => l.priority === f.priority);
  if (f.source) r = r.filter((l) => l.source === f.source);
  if (f.assignmentType) r = r.filter((l) => l.assignmentType === f.assignmentType);
  if (f.slaStatus) r = r.filter((l) => l.slaStatus === f.slaStatus);
  if (f.country) r = r.filter((l) => l.targetCountry === f.country);
  if (f.service) r = r.filter((l) => l.service === f.service);
  if (f.emailVerified === 'yes') r = r.filter((l) => l.emailVerified === true);
  if (f.emailVerified === 'no') r = r.filter((l) => l.emailVerified !== true);
  return r;
}

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
    case 'META_LEAD_FORM': return 'accent';
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

// Compact KPI tones (icon chip colors) for the one-line stat strip.
const KPI_TONE: Record<string, { bg: string; color: string; border: string }> = {
  info: { bg: 'var(--sos-status-info-soft)', color: 'var(--sos-status-info)', border: 'var(--sos-status-info-border)' },
  accent: { bg: 'var(--sos-brand-primary-soft)', color: 'var(--sos-brand-primary-strong)', border: 'var(--sos-brand-primary-border)' },
  success: { bg: 'var(--sos-status-success-soft)', color: 'var(--sos-status-success)', border: 'var(--sos-status-success-border)' },
  danger: { bg: 'var(--sos-status-danger-soft)', color: 'var(--sos-status-danger)', border: 'var(--sos-status-danger-border)' },
};

/** Small, single-line KPI box (replaces the tall MetricCard on this page so the
 *  four stats fit on one horizontal row). */
function StatBox({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: keyof typeof KPI_TONE;
  Icon: LucideIcon;
}) {
  const t = KPI_TONE[tone];
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
        padding: '10px 14px', borderRadius: 'var(--sos-radius-md)',
        border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface)',
      }}
    >
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 34, flexShrink: 0, borderRadius: 'var(--sos-radius-md)',
          background: t.bg, border: `1px solid ${t.border}`, color: t.color,
        }}
      >
        <Icon size={16} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--sos-text-primary)', lineHeight: 1.1 }}>{value}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
      </div>
    </div>
  );
}

export function SalesLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterKey>('ALL');
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [df, setDf] = useState<DetailFilters>(EMPTY_FILTERS);
  const activeFilterCount = Object.values(df).filter(Boolean).length;

  useEffect(() => {
    fetchLeads()
      .then(setLeads)
      .catch((e) => setError(e?.message ?? 'Failed to load leads'))
      .finally(() => setLoading(false));
  }, []);

  // Distinct country / service values present in the data — drive the
  // dropdowns so they only ever show options that match real leads.
  const countryOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.targetCountry).filter(Boolean))).sort(),
    [leads],
  );
  const serviceOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.service).filter(Boolean))).sort(),
    [leads],
  );

  const filtered = useMemo(() => {
    let result = applyFilter(leads, tab);
    result = applyDetailFilters(result, df);
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (l) =>
          `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
          l.phone.toLowerCase().includes(q) ||
          // Numbers are stored +92…, everyone types 0… — without this a rep
          // searching the number reception wrote down finds nothing.
          phoneMatches(l.phone, query) ||
          l.service.toLowerCase().includes(q) ||
          l.targetCountry.toLowerCase().includes(q) ||
          (l.referenceCode ?? '').toLowerCase().includes(q) ||
          (l.email ?? '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [leads, tab, query, df]);

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
            <SecondaryButton
              iconLeft={<Sliders size={15} />}
              onClick={() => setFiltersOpen((o) => !o)}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </SecondaryButton>
          </>
        }
      />

      {/* Search — primary control, full-width, ABOVE the KPIs. */}
      <div className="sos-topbar__search" style={{ width: '100%' }}>
        <Search size={14} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, phone, service…"
          aria-label="Search leads"
        />
      </div>

      {/* KPIs — compact one-line stat strip (replaces the tall MetricCards so
          all four fit on a single horizontal row). */}
      <section
        style={{
          display: 'grid',
          gap: '10px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        }}
      >
        <StatBox label="Admin Assigned" value={counts.ADMIN} tone="info" Icon={Users} />
        <StatBox label="Auto CRM" value={counts.AUTO_CRM} tone="accent" Icon={Sparkles} />
        <StatBox label="SLA Active" value={slaActive} tone="success" Icon={Signal} />
        <StatBox
          label="Overdue"
          value={counts.OVERDUE}
          tone={counts.OVERDUE > 0 ? 'danger' : 'success'}
          Icon={CircleAlert}
        />
      </section>

      {/* Tabs (segmented control, above the lead grid) */}
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
          width: 'fit-content',
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

      {/* Advanced filter popup — opened by the "Filters" button. A modal so
          the team picks filters without scrolling the page. */}
      <Modal
        open={filtersOpen}
        title="Filter leads"
        onClose={() => setFiltersOpen(false)}
        width={640}
        footer={
          <>
            <span
              style={{
                fontSize: 12.5,
                color: 'var(--sos-text-muted)',
                marginRight: 'auto',
                alignSelf: 'center',
              }}
            >
              <strong style={{ color: 'var(--sos-text-primary)' }}>{filtered.length}</strong> of {leads.length} match
            </span>
            <button
              type="button"
              onClick={() => setDf(EMPTY_FILTERS)}
              disabled={activeFilterCount === 0}
              className="sos-btn sos-btn--ghost"
              style={{ opacity: activeFilterCount === 0 ? 0.5 : 1 }}
            >
              Clear all
            </button>
            <PrimaryButton onClick={() => setFiltersOpen(false)}>
              Show {filtered.length} {filtered.length === 1 ? 'lead' : 'leads'}
            </PrimaryButton>
          </>
        }
      >
        <div
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          <FilterSelect
            label="Status"
            value={df.stage}
            onChange={(v) => setDf((p) => ({ ...p, stage: v }))}
            options={STAGE_FILTER_OPTIONS}
          />
          <FilterSelect
            label="Priority"
            value={df.priority}
            onChange={(v) => setDf((p) => ({ ...p, priority: v }))}
            options={PRIORITY_FILTER_OPTIONS.map((p) => ({ value: p, label: PRIORITY_LABEL[p as keyof typeof PRIORITY_LABEL] ?? p }))}
          />
          <FilterSelect
            label="Source"
            value={df.source}
            onChange={(v) => setDf((p) => ({ ...p, source: v }))}
            options={SOURCE_FILTER_OPTIONS.map((s) => ({ value: s, label: SOURCE_LABEL[s as LeadSource] ?? s }))}
          />
          <FilterSelect
            label="Assigned by"
            value={df.assignmentType}
            onChange={(v) => setDf((p) => ({ ...p, assignmentType: v }))}
            options={[
              { value: 'ADMIN', label: 'Admin' },
              { value: 'AUTO_CRM', label: 'Auto CRM' },
            ]}
          />
          <FilterSelect
            label="SLA"
            value={df.slaStatus}
            onChange={(v) => setDf((p) => ({ ...p, slaStatus: v }))}
            options={SLA_FILTER_OPTIONS}
          />
          <FilterSelect
            label="Target country"
            value={df.country}
            onChange={(v) => setDf((p) => ({ ...p, country: v }))}
            options={countryOptions.map((c) => ({ value: c, label: c }))}
          />
          <FilterSelect
            label="Service"
            value={df.service}
            onChange={(v) => setDf((p) => ({ ...p, service: v }))}
            options={serviceOptions.map((s) => ({ value: s, label: s }))}
          />
          <FilterSelect
            label="Email verified"
            value={df.emailVerified}
            onChange={(v) => setDf((p) => ({ ...p, emailVerified: v }))}
            options={[
              { value: 'yes', label: 'Verified' },
              { value: 'no', label: 'Not verified' },
            ]}
          />
        </div>
      </Modal>

      {/* Lead grid */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No leads match this filter"
          description="Try clearing the search or switching to another tab to see more results."
          action={
            <PrimaryButton onClick={() => { setTab('ALL'); setQuery(''); setDf(EMPTY_FILTERS); }}>
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--sos-text-muted)',
        }}
      >
        {label}
      </span>
      <select
        className="sos-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%' }}
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const assignedLabel =
    lead.assignmentType === 'ADMIN'
      ? `Admin · ${lead.assignedBy ?? 'Unassigned'}`
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
              {lead.csvBatch ? <CsvLeadBadge batchName={lead.csvBatch.name} /> : null}
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
