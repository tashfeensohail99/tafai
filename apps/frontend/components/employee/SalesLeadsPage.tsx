'use client';
// Sales OS — Assigned Leads (premium dark glass redesign).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  type Priority,
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
import {
  fetchLeadsPage,
  fetchLeadsListIndex,
  mapStageToStatus,
  mapPriorityToApi,
  type LeadsListIndex,
} from '@/lib/sales-api';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';
import { DISPOSITION_LABEL } from '@/lib/whatsapp';
import { Modal } from '@/components/whatsapp/Modal';
import { AddFollowUpModal } from '@/components/whatsapp/AddFollowUpModal';

/** Tone for the WhatsApp-CRM disposition chip — positive outcomes green,
 *  at-risk amber, dead-ends red/neutral. Mirrors the inbox colours. */
function dispositionTone(d: string): BadgeTone {
  switch (d) {
    case 'QUALIFIED':
    case 'CONVERTED_TO_DEAL':
      return 'success';
    case 'FOLLOW_UP':
    case 'CONTACT_LATER':
    case 'REQUESTED_DISCOUNT':
      return 'warning';
    case 'PRICE_CONCERN':
    case 'NOT_ELIGIBLE':
    case 'NO_RESPONSE':
      return 'danger';
    default:
      return 'neutral'; // JUNK / DEAD / unknown
  }
}

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

/**
 * Translate the active tab + the advanced "Filters" panel into the query params
 * the backend /leads/page endpoint understands. Everything is applied
 * server-side now (over the rep's WHOLE book), so there is no client-side
 * filtering left.
 *
 *   df.stage         → status  (reverse mapStatus; 'PENDING' → NEW)
 *   df.priority      → priority (HIGH→HOT / MEDIUM→WARM / LOW→COLD)
 *   df.service       → serviceInterest
 *   df.country       → targetCountry
 *   df.emailVerified → emailVerified ('yes' | 'no')
 *   df.assignmentType→ tab (ADMIN | AUTO_CRM)
 *   df.slaStatus     → slaStatus (server reverses it to a fixed status set)
 *   df.source        → source    (server reverses mapSource; PHONE = catch-all)
 *
 * The backend expresses ADMIN/AUTO_CRM only through `tab`, so when the advanced
 * assignment filter is set we fold a single-status tab (OVERDUE→LOST,
 * PAYMENT→PROPOSAL_SENT) into `status` first so it isn't lost, then let the
 * assignment own `tab`. The APPOINTMENT tab spans two statuses and can't fold
 * into one `status`, so that rare combination drops the status side.
 */
function buildServerParams(
  tab: FilterKey,
  df: DetailFilters,
): { tab: string; filters: Record<string, string | undefined> } {
  let effTab: string = tab;
  let status: string | undefined = df.stage
    ? mapStageToStatus(df.stage as LeadStage)
    : undefined;

  if (df.assignmentType === 'ADMIN' || df.assignmentType === 'AUTO_CRM') {
    if (!status) {
      if (tab === 'OVERDUE') status = 'LOST';
      else if (tab === 'PAYMENT') status = 'PROPOSAL_SENT';
    }
    effTab = df.assignmentType;
  }

  return {
    tab: effTab,
    filters: {
      status,
      priority: df.priority ? mapPriorityToApi(df.priority as Priority) : undefined,
      serviceInterest: df.service || undefined,
      targetCountry: df.country || undefined,
      emailVerified: df.emailVerified || undefined,
      slaStatus: df.slaStatus || undefined,
      source: df.source || undefined,
    },
  };
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

// Returning from a lead detail should land the rep exactly where they were.
// The list is now server-paginated, so we cache the whole loaded VIEW (the
// accumulated rows, the page reached, the server total, the aggregate index and
// the tab/search/filter state they belong to) module-scoped. That survives the
// remount, so pressing Back renders the exact same list instantly (no blank, no
// refetch) and we restore the window scroll offset into it.
interface LeadsView {
  leads: Lead[];
  total: number;
  page: number;
  tab: FilterKey;
  query: string;
  df: DetailFilters;
  index: LeadsListIndex | null;
}
let cachedView: LeadsView | null = null;
let savedLeadsScrollY = 0;

const EMPTY_COUNTS: LeadsListIndex['counts'] = {
  ALL: 0, ADMIN: 0, AUTO_CRM: 0, OVERDUE: 0, PAYMENT: 0, APPOINTMENT: 0, SLA_ACTIVE: 0,
};

export function SalesLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>(cachedView?.leads ?? []);
  const [total, setTotal] = useState<number>(cachedView?.total ?? 0);
  const [page, setPage] = useState<number>(cachedView?.page ?? 1);
  const [index, setIndex] = useState<LeadsListIndex | null>(cachedView?.index ?? null);
  // Full-page spinner only for the very first load (no cache to render).
  const [loading, setLoading] = useState(cachedView == null);
  // Lighter indicator for tab/search/filter refetches — keeps the old rows on
  // screen (dimmed) rather than blanking the list.
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterKey>(cachedView?.tab ?? 'ALL');
  const [query, setQuery] = useState(cachedView?.query ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState(cachedView?.query ?? '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [df, setDf] = useState<DetailFilters>(cachedView?.df ?? EMPTY_FILTERS);
  // Add-follow-up popup opened straight from a lead card — no navigation, so
  // the rep never loses their scroll position in the list.
  const [followUpTarget, setFollowUpTarget] = useState<Lead | null>(null);
  const activeFilterCount = Object.values(df).filter(Boolean).length;
  const scrollRestored = useRef(false);
  // When we hydrate from the cache on mount, skip exactly ONE page-1 fetch so
  // pressing Back doesn't blank + refetch the list the rep was already viewing.
  const skipInitialFetch = useRef(cachedView != null);

  // Every tab / search / advanced-filter selection maps to the same set of
  // server params — memoised so the fetch effect and "Load more" agree.
  const serverParams = useMemo(() => buildServerParams(tab, df), [tab, df]);

  // Fetch page 1 for the current view. Used both by the change-effect and the
  // error "Retry" button. Always REPLACES the list (page reset to 1).
  const refetchFirstPage = () => {
    setListLoading(true);
    setError(null);
    return fetchLeadsPage({
      page: 1,
      tab: serverParams.tab,
      search: debouncedQuery.trim() || undefined,
      filters: serverParams.filters,
    })
      .then((res) => {
        setLeads(res.items);
        setTotal(res.total);
        setPage(1);
      })
      .catch((e) => {
        setError((e as Error)?.message ?? 'Failed to load leads');
      })
      .finally(() => {
        setListLoading(false);
        setLoading(false);
      });
  };

  // Debounce the search box so each keypress doesn't hit the server (~300ms).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Book-wide KPI/tab counts + dropdown options. Independent of search/tab/
  // filters, so fetched once per mount (background-refreshed when we had a
  // cache — the cached numbers show instantly meanwhile).
  useEffect(() => {
    let alive = true;
    fetchLeadsListIndex()
      .then((idx) => { if (alive) setIndex(idx); })
      .catch(() => { /* keep whatever we already have */ });
    return () => { alive = false; };
  }, []);

  // Page-1 (re)load whenever the tab, debounced search or advanced filters
  // change. On the first mount after a cache-hydrate we skip this exactly once.
  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    void refetchFirstPage();
    // refetchFirstPage closes over the current serverParams + debouncedQuery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverParams, debouncedQuery]);

  // Persist the current view so pressing Back from a lead restores it instantly.
  useEffect(() => {
    cachedView = { leads, total, page, tab, query: debouncedQuery, df, index };
  }, [leads, total, page, tab, debouncedQuery, df, index]);

  // Continuously remember the window scroll offset so we can put the rep back
  // exactly where they were after they open a lead and press Back.
  useEffect(() => {
    const onScroll = () => {
      savedLeadsScrollY = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Restore the saved offset once the rows are painted (page tall enough to
  // scroll). Runs once per mount, before paint — no visible jump.
  useLayoutEffect(() => {
    if (scrollRestored.current || leads.length === 0) return;
    scrollRestored.current = true;
    if (savedLeadsScrollY > 0) window.scrollTo(0, savedLeadsScrollY);
  }, [leads.length]);

  // KPI tiles + tab counts + dropdown options come from the book-wide index —
  // NOT from the loaded rows.
  const counts = index?.counts ?? EMPTY_COUNTS;
  const slaActive = counts.SLA_ACTIVE;
  const countryOptions = index?.countries ?? [];
  const serviceOptions = index?.services ?? [];

  async function loadMore() {
    if (loadingMore || leads.length >= total) return;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const res = await fetchLeadsPage({
        page: next,
        tab: serverParams.tab,
        search: debouncedQuery.trim() || undefined,
        filters: serverParams.filters,
      });
      setLeads((prev) => [...prev, ...res.items]);
      setTotal(res.total);
      setPage(next);
    } catch (e) {
      setError((e as Error)?.message ?? 'Failed to load more leads');
    } finally {
      setLoadingMore(false);
    }
  }

  function resetAll() {
    setTab('ALL');
    setQuery('');
    setDebouncedQuery('');
    setDf(EMPTY_FILTERS);
  }

  if (loading && leads.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: '10px', color: 'var(--sos-text-muted)' }}>
        <Loader2 size={20} className="sos-spin" />
        <span>Loading leads…</span>
      </div>
    );
  }

  if (error && leads.length === 0) {
    return (
      <EmptyState
        title="Could not load leads"
        description={error}
        action={<PrimaryButton onClick={() => { setLoading(true); void refetchFirstPage(); }}>Retry</PrimaryButton>}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <AddFollowUpModal
        open={followUpTarget != null}
        onClose={() => setFollowUpTarget(null)}
        leadId={followUpTarget?.id ?? null}
        defaultAssigneeId={null}
        onCreated={() => setFollowUpTarget(null)}
      />
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
              <strong style={{ color: 'var(--sos-text-primary)' }}>{total}</strong> {total === 1 ? 'match' : 'matches'}
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
              Show {total} {total === 1 ? 'lead' : 'leads'}
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
      {listLoading && leads.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '30vh', gap: '10px', color: 'var(--sos-text-muted)' }}>
          <Loader2 size={20} className="sos-spin" />
          <span>Loading leads…</span>
        </div>
      ) : leads.length === 0 ? (
        <EmptyState
          title="No leads match this filter"
          description="Try clearing the search or switching to another tab to see more results."
          action={
            <PrimaryButton onClick={resetAll}>
              Reset filters
            </PrimaryButton>
          }
        />
      ) : (
        <>
          <section
            style={{
              display: 'grid',
              gap: '16px',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
              // Dim (but keep) the current rows while a tab/search/filter change
              // is loading, so the list never blanks.
              opacity: listLoading ? 0.55 : 1,
              transition: 'opacity 120ms ease',
            }}
          >
            {leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onAddFollowUp={setFollowUpTarget} />
            ))}
          </section>

          {/* Paging footer — "showing X of total" + Load more. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
            <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
              Showing <strong style={{ color: 'var(--sos-text-primary)' }}>{leads.length}</strong> of {total}
            </span>
            {leads.length < total ? (
              <SecondaryButton
                onClick={loadMore}
                disabled={loadingMore}
                iconLeft={loadingMore ? <Loader2 size={15} className="sos-spin" /> : undefined}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </SecondaryButton>
            ) : null}
          </div>
        </>
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

function LeadCard({ lead, onAddFollowUp }: { lead: Lead; onAddFollowUp: (lead: Lead) => void }) {
  const assignedLabel =
    lead.assignmentType === 'ADMIN'
      ? `Admin · ${lead.assignedBy ?? 'Unassigned'}`
      : 'Auto CRM';

  return (
    <Link
      href={`/sales/leads/${lead.id}` as Route}
      // Capture the exact scroll offset at click time so returning to the list
      // restores it (the continuous listener can miss it if navigation scrolls).
      onClick={() => { savedLeadsScrollY = window.scrollY; }}
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
          {/* WhatsApp CRM disposition — the single source of truth. Shown only
              when set, so an undispositioned lead isn't cluttered. */}
          {lead.disposition ? (
            <StatusBadge tone={dispositionTone(lead.disposition)}>
              {DISPOSITION_LABEL[lead.disposition as keyof typeof DISPOSITION_LABEL] ?? lead.disposition}
            </StatusBadge>
          ) : null}
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
        {/* Add follow-up without leaving the list — opens the popup in place so
            the rep keeps their scroll. A <span role=button> (not <button>) since
            this sits inside the card's <Link> (a button there is invalid HTML). */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAddFollowUp(lead); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onAddFollowUp(lead);
            }
          }}
          style={{
            marginTop: '10px',
            width: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '9px 12px',
            borderRadius: 'var(--sos-radius-sm)',
            border: '1px solid var(--sos-brand-primary-border)',
            background: 'transparent',
            color: 'var(--sos-brand-primary-strong)',
            fontSize: '12.5px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <CalendarClock size={14} /> Add follow-up
        </span>
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
