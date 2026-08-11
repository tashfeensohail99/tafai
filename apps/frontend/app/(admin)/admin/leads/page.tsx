'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Banknote,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  Megaphone,
  MessageCircle,
  Pencil,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Timer,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  DangerButton,
  FormInput,
  FormSelect,
  GhostButton,
  GlassCard,
  MetricCard,
  PageHeader,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
  type MetricTone,
} from '@/components/sales-v2/ui';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { EditLeadModal, type EditLeadModalLead } from '@/components/whatsapp/EditLeadModal';
import { useAdminSession } from '@/components/layout/AdminShell';
import { apiFetch } from '@/lib/api-client';
import {
  bulkDeleteLeads,
  deleteLead,
  exportLeadsCsv,
  fetchAdPerformance,
  fetchAgentBreakdown,
  fetchLeadStats,
  listAdminLeads,
  type AdminLead,
  type AdPerformanceRow,
  type AgentBreakdown,
  type LeadFilters,
  type LeadStats,
  type MoneyByCurrency,
} from '@/lib/leads-admin';

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

const LEAD_STATUSES: Array<[string, string]> = [
  ['NEW', 'New'],
  ['CONTACTED', 'Contacted'],
  ['QUALIFIED', 'Qualified'],
  ['PROPOSAL_SENT', 'Proposal sent'],
  ['FOLLOW_UP', 'Follow up'],
  ['CONVERTED', 'Converted'],
  ['LOST', 'Lost'],
  ['DUPLICATE', 'Duplicate'],
  ['UNQUALIFIED', 'Unqualified'],
];

const STATUS_TONE: Record<string, BadgeTone> = {
  NEW: 'info',
  CONTACTED: 'accent',
  QUALIFIED: 'cyan',
  PROPOSAL_SENT: 'violet',
  FOLLOW_UP: 'warning',
  CONVERTED: 'success',
  LOST: 'danger',
  DUPLICATE: 'neutral',
  UNQUALIFIED: 'neutral',
};

function statusLabel(status: string): string {
  return (
    LEAD_STATUSES.find(([v]) => v === status)?.[1] ??
    status.replace(/_/g, ' ').toLowerCase()
  );
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Funnel stages shown in order on the dashboard (keys are LeadStatus values). */
const FUNNEL_STAGES: Array<[string, string]> = [
  ['NEW', 'New'],
  ['CONTACTED', 'Contacted'],
  ['QUALIFIED', 'Qualified'],
  ['PROPOSAL_SENT', 'Proposal sent'],
  ['CONVERTED', 'Converted'],
];

function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n)}`;
}

/** Compact money across currencies, e.g. "Rs 1.8M" or "Rs 1.8M + CAD 4k". */
function fmtMoney(rows?: MoneyByCurrency[]): string {
  if (!rows || rows.length === 0) return '—';
  return rows
    .map((r) => `${r.currency === 'PKR' ? 'Rs ' : `${r.currency} `}${compactNum(r.amount)}`)
    .join(' + ');
}

/**
 * Precise single amount with a currency symbol, e.g. "Rs 2,500" or "USD 12.34".
 * Per-ad cost figures (spend/CPL/CPA) must NOT be compacted — advertisers
 * compare them directly, so a 1k-bucket rounding would mislead. Thousands get
 * separators; sub-1000 keep up to 2 decimals (the cents the backend computed).
 */
function fmtAmt(amount?: number | null, currency?: string | null): string {
  if (amount == null) return '—';
  const sym = currency === 'PKR' ? 'Rs ' : currency ? `${currency} ` : '';
  const n =
    Math.abs(amount) >= 1000
      ? Math.round(amount).toLocaleString()
      : (Math.round(amount * 100) / 100).toLocaleString();
  return `${sym}${n}`;
}

function adName(row: AdPerformanceRow): string {
  if (row.headline && row.headline.trim()) return row.headline.trim();
  if (row.sourceType) return `${row.sourceType} ad`;
  if (row.sourceId) return `Ad ${row.sourceId}`;
  return 'Untitled ad';
}

/** Case-insensitive distinct values for the source/service/country dropdowns. */
function distinct(list: AdminLead[], pick: (l: AdminLead) => string | null | undefined): string[] {
  const seen = new Map<string, string>();
  for (const l of list) {
    const raw = pick(l);
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Tiny debounce so typing in the search box doesn't fire a request per key. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--sos-text-faint)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  whiteSpace: 'nowrap',
};

const td: CSSProperties = {
  padding: '11px 14px',
  fontSize: 13,
  color: 'var(--sos-text-secondary)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  verticalAlign: 'middle',
};

export default function LeadsPage() {
  const { user } = useAdminSession();
  const perms = user.permissions;
  const canViewAll = perms.includes('leads.view_all');
  const canDelete = perms.includes('leads.delete');
  const canEdit = perms.includes('leads.update');
  const canExport = perms.includes('reports.export');

  const [stats, setStats] = useState<LeadStats | null>(null);
  const [ads, setAds] = useState<AdPerformanceRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [facets, setFacets] = useState<{ services: string[]; countries: string[]; sources: string[] }>({
    services: [],
    countries: [],
    sources: [],
  });

  const [rows, setRows] = useState<AdminLead[]>([]);
  const [filters, setFilters] = useState<LeadFilters>({});
  const [bootLoading, setBootLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editLead, setEditLead] = useState<EditLeadModalLead | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showAllAds, setShowAllAds] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Per-agent lead-volume leaderboard (24h / 7d / this-week / optional custom).
  // Collapsed by default so it doesn't push the KPIs down for admins who don't
  // need it; opens on click and fetches on demand + when the custom range
  // changes (server ignores partial ranges — see backend getAgentBreakdown).
  const [agentBreakdown, setAgentBreakdown] = useState<AgentBreakdown | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [bkCustomFrom, setBkCustomFrom] = useState('');
  const [bkCustomTo, setBkCustomTo] = useState('');
  const debBkCustom = useDebounced({ from: bkCustomFrom, to: bkCustomTo }, 300);

  const debFilters = useDebounced(filters, 250);
  const tableRef = useRef<HTMLDivElement>(null);

  function selectAd(row: AdPerformanceRow) {
    if (!row.sourceId) return;
    setFilters((f) => ({ ...f, fromAd: true, adSourceId: row.sourceId! }));
    // Let the filter chip render, then bring the (now filtered) table into view.
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  /** Fetch (or refetch) the per-agent breakdown. Called on first expand and
   *  whenever the custom date range settles. Silent on network errors — the
   *  section shows "—" values rather than breaking the whole page. */
  function loadAgentBreakdown(customFrom?: string, customTo?: string) {
    setBreakdownLoading(true);
    fetchAgentBreakdown({ customFrom, customTo })
      .then((b) => setAgentBreakdown(b))
      .catch(() => { /* leave prior data in place */ })
      .finally(() => setBreakdownLoading(false));
  }

  /** Click a cell → filter the table below by (agent, window). `fromIso`/`toIso`
   *  are ISO strings from the backend for custom, or computed here for the
   *  preset windows (24h / 7d / this-week PKT). The list endpoint accepts ISO
   *  timestamps in `createdFrom`/`createdTo`. */
  function applyAgentWindow(agentId: string, fromIso: string, toIso?: string) {
    setFilters((f) => ({
      ...f,
      assignedEmployeeId: agentId,
      createdFrom: fromIso,
      createdTo: toIso ?? new Date().toISOString(),
    }));
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  // ── Boot: KPIs, ad leaderboard, agent options, filter facets ──────────────
  useEffect(() => {
    if (!canViewAll) {
      setBootLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchLeadStats(),
      fetchAdPerformance(),
      apiFetch<EmployeeOption[]>('/employees').catch(() => [] as EmployeeOption[]),
      listAdminLeads({}),
    ])
      .then(([s, a, emps, all]) => {
        if (cancelled) return;
        setStats(s);
        setAds(a);
        setEmployees(emps);
        setFacets({
          services: distinct(all, (l) => l.serviceInterest),
          countries: distinct(all, (l) => l.targetCountry),
          sources: distinct(all, (l) => l.sourceChannel),
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load lead overview');
      })
      .finally(() => {
        if (!cancelled) setBootLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canViewAll]);

  // ── Agent breakdown: lazy-load on first expand, refetch when custom range
  //    settles (debounced). Only when both dates are present — the backend
  //    ignores half-open ranges, so partial input just fetches the presets.
  useEffect(() => {
    if (!canViewAll || !breakdownOpen) return;
    loadAgentBreakdown(debBkCustom.from || undefined, debBkCustom.to || undefined);
  }, [canViewAll, breakdownOpen, debBkCustom.from, debBkCustom.to]);

  // ── Table: refetch whenever the (debounced) filters change ────────────────
  useEffect(() => {
    if (!canViewAll) return;
    let cancelled = false;
    setTableLoading(true);
    listAdminLeads(debFilters)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setSelected(new Set());
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load leads');
      })
      .finally(() => {
        if (!cancelled) setTableLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debFilters, canViewAll]);

  async function reload() {
    const [s, a, r] = await Promise.all([
      fetchLeadStats(),
      fetchAdPerformance(),
      listAdminLeads(filters),
    ]);
    setStats(s);
    setAds(a);
    setRows(r);
    setSelected(new Set());
  }

  function setFilter<K extends keyof LeadFilters>(key: K, value: LeadFilters[K] | '' | undefined) {
    setFilters((f) => {
      const next = { ...f };
      if (value === '' || value === undefined || value === false) delete next[key];
      else next[key] = value as LeadFilters[K];
      return next;
    });
  }

  function clearAd() {
    setFilters((f) => {
      const next = { ...f };
      delete next.adSourceId;
      delete next.fromAd;
      return next;
    });
  }

  const activeAd = filters.adSourceId
    ? ads.find((a) => a.sourceId === filters.adSourceId) ?? null
    : null;

  async function handleDelete(lead: AdminLead) {
    if (
      !window.confirm(
        `Delete ${lead.firstName} ${lead.lastName} (${lead.phone})?\n\n` +
          'The lead is hidden from every list and the WhatsApp inbox. The row is kept for audit.',
      )
    )
      return;
    setDeletingId(lead.id);
    try {
      await deleteLead(lead.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete lead');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selected.size} selected lead${selected.size === 1 ? '' : 's'}?\n\n` +
          'Each lead is hidden from every list and the WhatsApp inbox. The rows are kept for audit.',
      )
    )
      return;
    setBulkDeleting(true);
    try {
      await bulkDeleteLeads([...selected]);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete leads');
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportLeadsCsv(filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export CSV');
    } finally {
      setExporting(false);
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  if (!canViewAll) {
    return <PermissionDeniedState message="You need the leads.view_all permission to view all leads." />;
  }

  const maxAdLeads = Math.max(1, ...ads.map((a) => a.leads));
  const visibleAds = showAllAds ? ads : ads.slice(0, 6);

  const employeeName = (id: string) => {
    const e = employees.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName}`.trim() : 'Agent';
  };

  // Active filter chips (everything except free-text search + the ad, which
  // gets its own labelled chip). Keeps the applied filters visible after the
  // panel is collapsed and lets each one be cleared individually.
  const chips: Array<{ key: string; label: string; onClear: () => void }> = [];
  if (filters.status) chips.push({ key: 'status', label: `Status: ${statusLabel(filters.status)}`, onClear: () => setFilter('status', '') });
  if (filters.sourceChannel) chips.push({ key: 'sourceChannel', label: `Source: ${filters.sourceChannel}`, onClear: () => setFilter('sourceChannel', '') });
  if (filters.serviceInterest) chips.push({ key: 'serviceInterest', label: `Service: ${filters.serviceInterest}`, onClear: () => setFilter('serviceInterest', '') });
  if (filters.targetCountry) chips.push({ key: 'targetCountry', label: `Country: ${filters.targetCountry}`, onClear: () => setFilter('targetCountry', '') });
  if (filters.assignedEmployeeId) chips.push({ key: 'assignedEmployeeId', label: `Agent: ${employeeName(filters.assignedEmployeeId)}`, onClear: () => setFilter('assignedEmployeeId', '') });
  if (filters.createdFrom) chips.push({ key: 'createdFrom', label: `From ${filters.createdFrom}`, onClear: () => setFilter('createdFrom', '') });
  if (filters.createdTo) chips.push({ key: 'createdTo', label: `To ${filters.createdTo}`, onClear: () => setFilter('createdTo', '') });
  if (filters.fromAd && !filters.adSourceId) chips.push({ key: 'fromAd', label: 'From ads', onClear: () => setFilter('fromAd', '') });

  const advancedCount = chips.length + (activeAd ? 1 : 0);
  const anyActive = advancedCount > 0 || !!filters.search;

  const kpis: Array<{ label: string; value: number; hint?: string; delta?: string; tone: MetricTone; Icon: typeof Users }> =
    stats
      ? [
          { label: 'Total leads', value: stats.total, hint: 'All-time, excluding deleted', tone: 'accent', Icon: Users },
          { label: 'New today', value: stats.newToday, hint: 'Created in the last 24h', tone: 'info', Icon: UserPlus },
          { label: 'Contacted', value: stats.byStatus['CONTACTED'] ?? 0, hint: 'Reached out at least once', tone: 'warm', Icon: MessageCircle },
          {
            label: 'Converted',
            value: stats.converted,
            delta: `${stats.conversionRate}%`,
            hint: 'Became clients',
            tone: 'success',
            Icon: CheckCircle2,
          },
          {
            label: 'From ads',
            value: stats.fromAds,
            hint: stats.total ? `${Math.round((stats.fromAds / stats.total) * 100)}% of all leads` : undefined,
            tone: 'warning',
            Icon: Megaphone,
          },
        ]
      : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="CRM · Leads"
        title="Leads"
        description="Every inbound lead across WhatsApp, ads and CSV imports — with live KPIs, ad attribution and filters."
        actions={
          canExport ? (
            <SecondaryButton
              onClick={() => void handleExport()}
              disabled={exporting}
              iconLeft={exporting ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={15} />}
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
            </SecondaryButton>
          ) : undefined
        }
      />

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      ) : null}


      {/* ── Search + smart filters ───────────────────────────────────────── */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <FormInput
              placeholder="Search by name, email or phone…"
              iconLeft={<Search size={16} />}
              value={filters.search ?? ''}
              onChange={(e) => setFilter('search', e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 42,
              padding: '0 14px',
              borderRadius: 'var(--sos-radius-input)',
              border: `1px solid ${filtersOpen || advancedCount ? 'var(--sos-brand-primary-border)' : 'var(--sos-border)'}`,
              background: filtersOpen || advancedCount ? 'var(--sos-brand-primary-soft)' : 'var(--sos-bg-input)',
              color: filtersOpen || advancedCount ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
              cursor: 'pointer',
              fontSize: 13.5,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            <SlidersHorizontal size={16} />
            Filters
            {advancedCount > 0 ? (
              <span style={{ display: 'inline-grid', placeItems: 'center', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: 'var(--sos-brand-primary)', color: 'var(--sos-text-on-accent)', fontSize: 11, fontWeight: 700 }}>
                {advancedCount}
              </span>
            ) : null}
            <ChevronDown size={15} style={{ transform: filtersOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
          </button>

          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, alignItems: 'center' }}>
            <span className="sos-text-faint" style={{ fontSize: 12 }}>
              {tableLoading ? 'Loading…' : `${fmtNum(rows.length)} lead${rows.length === 1 ? '' : 's'}`}
            </span>
            {anyActive ? (
              <GhostButton size="sm" onClick={() => setFilters({})} iconLeft={<RotateCcw size={14} />}>
                Reset
              </GhostButton>
            ) : null}
          </span>
        </div>

        {/* Applied filters — visible even when the panel is collapsed. */}
        {chips.length > 0 || activeAd ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {activeAd ? (
              <span style={chipStyle(true)}>
                <Megaphone size={12} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>Ad: {adName(activeAd)}</span>
                <button onClick={clearAd} aria-label="Clear ad filter" style={chipClearStyle}><X size={13} /></button>
              </span>
            ) : null}
            {chips.map((c) => (
              <span key={c.key} style={chipStyle(false)}>
                {c.label}
                <button onClick={c.onClear} aria-label={`Clear ${c.label}`} style={chipClearStyle}><X size={13} /></button>
              </span>
            ))}
          </div>
        ) : null}

        {/* Collapsible advanced filter panel. */}
        {filtersOpen ? (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--sos-border-subtle)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <FormSelect
                label="Status"
                value={filters.status ?? ''}
                onChange={(e) => setFilter('status', e.target.value)}
                options={[{ value: '', label: 'All statuses' }, ...LEAD_STATUSES.map(([v, l]) => ({ value: v, label: l }))]}
              />
              <FormSelect
                label="Source"
                value={filters.sourceChannel ?? ''}
                onChange={(e) => setFilter('sourceChannel', e.target.value)}
                options={[{ value: '', label: 'All sources' }, ...facets.sources.map((s) => ({ value: s, label: s }))]}
              />
              <FormSelect
                label="Service"
                value={filters.serviceInterest ?? ''}
                onChange={(e) => setFilter('serviceInterest', e.target.value)}
                options={[{ value: '', label: 'All services' }, ...facets.services.map((s) => ({ value: s, label: s }))]}
              />
              <FormSelect
                label="Target country"
                value={filters.targetCountry ?? ''}
                onChange={(e) => setFilter('targetCountry', e.target.value)}
                options={[{ value: '', label: 'All countries' }, ...facets.countries.map((c) => ({ value: c, label: c }))]}
              />
              <FormSelect
                label="Assigned agent"
                value={filters.assignedEmployeeId ?? ''}
                onChange={(e) => setFilter('assignedEmployeeId', e.target.value)}
                options={[
                  { value: '', label: 'All agents' },
                  ...employees.map((emp) => ({ value: emp.id, label: `${emp.firstName} ${emp.lastName}`.trim() })),
                ]}
              />
              <FormInput
                label="Created from"
                type="date"
                value={filters.createdFrom ?? ''}
                onChange={(e) => setFilter('createdFrom', e.target.value)}
              />
              <FormInput
                label="Created to"
                type="date"
                value={filters.createdTo ?? ''}
                onChange={(e) => setFilter('createdTo', e.target.value)}
              />
            </div>

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 12,
                padding: '7px 12px',
                borderRadius: 'var(--sos-radius-pill)',
                border: `1px solid ${filters.fromAd ? 'var(--sos-brand-accent-border)' : 'var(--sos-border-subtle)'}`,
                background: filters.fromAd ? 'var(--sos-brand-accent-soft)' : 'transparent',
                color: filters.fromAd ? 'var(--sos-brand-accent)' : 'var(--sos-text-secondary)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <input
                type="checkbox"
                checked={!!filters.fromAd}
                onChange={(e) => { if (!e.target.checked) clearAd(); else setFilter('fromAd', true); }}
                style={{ accentColor: 'var(--sos-brand-accent)' }}
              />
              <Megaphone size={14} /> From ads only
            </label>
          </div>
        ) : null}
      </GlassCard>


      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        {bootLoading && !stats
          ? Array.from({ length: 5 }).map((_, i) => (
              <GlassCard key={i} style={{ height: 132 }}>
                <div className="sos-text-faint" style={{ fontSize: 12 }}>Loading…</div>
              </GlassCard>
            ))
          : kpis.map((k) => (
              <MetricCard key={k.label} label={k.label} value={fmtNum(k.value)} hint={k.hint} delta={k.delta} tone={k.tone} Icon={k.Icon} />
            ))}
      </div>

      {/* ── Money + speed-to-lead ────────────────────────────────────────── */}
      {stats ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <MetricCard label="Cash collected" value={fmtMoney(stats.revenueReceived)} hint="Verified payments · lead clients" tone="success" Icon={Banknote} />
          <MetricCard label="Won (agreed fee)" value={fmtMoney(stats.revenueWon)} hint="Converted leads · promised fee" tone="accent" Icon={Wallet} />
          <MetricCard label="Pipeline value" value={fmtMoney(stats.revenuePipeline)} hint="Open leads · agreed fee" tone="info" Icon={TrendingUp} />
          <MetricCard
            label="Speed-to-lead"
            value={stats.speedToLead?.medianMinutes != null ? `${stats.speedToLead.medianMinutes} min` : '—'}
            hint={stats.speedToLead?.pctUnder5min != null ? `${stats.speedToLead.pctUnder5min}% human reply under 5 min` : 'Median time to first human reply'}
            tone="info"
            Icon={Timer}
          />
          <MetricCard
            label="Ad spend (30d)"
            value={fmtMoney(stats.adSpend)}
            hint={
              stats.blendedCpl != null
                ? `~CA$${compactNum(stats.blendedCpl)} per ad lead (CPL)`
                : 'Connect Meta ads in Settings → API Keys'
            }
            tone="warning"
            Icon={Megaphone}
          />
          <MetricCard
            label="Return on ad spend (30d)"
            value={stats.blendedRoas != null ? `${stats.blendedRoas}×` : '—'}
            hint={
              stats.adRevenueBaseCad
                ? `CA$${compactNum(stats.adRevenueBaseCad)} earned from ad leads`
                : 'CAD revenue ÷ CAD ad spend'
            }
            tone="success"
            Icon={TrendingUp}
          />
        </div>
      ) : null}

      {/* ── Conversion funnel + lost reasons ─────────────────────────────── */}
      {stats ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          <GlassCard variant="default">
            <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: '0 0 14px' }}>Conversion funnel</h2>
            {(() => {
              const funnelMax = Math.max(1, ...FUNNEL_STAGES.map(([k]) => stats.byStatus[k] ?? 0));
              return FUNNEL_STAGES.map(([key, label]) => {
                const n = stats.byStatus[key] ?? 0;
                const pct = Math.round((n / funnelMax) * 100);
                return (
                  <div key={key} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ color: 'var(--sos-text-secondary)' }}>{label}</span>
                      <span style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>{fmtNum(n)}</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 999, background: 'var(--sos-surface-3)', overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: key === 'CONVERTED' ? 'var(--sos-status-success)' : 'var(--sos-brand-primary)' }} />
                    </div>
                  </div>
                );
              });
            })()}
          </GlassCard>
          <GlassCard variant="default">
            <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: '0 0 14px' }}>Top lost reasons</h2>
            {(stats.lostReasons ?? []).length === 0 ? (
              <div className="sos-text-faint" style={{ fontSize: 13 }}>No lost leads recorded yet.</div>
            ) : (
              (() => {
                const lostMax = Math.max(1, ...(stats.lostReasons ?? []).map((x) => x.count));
                return (stats.lostReasons ?? []).map((r) => {
                  const pct = Math.round((r.count / lostMax) * 100);
                  return (
                    <div key={r.reason} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, marginBottom: 4 }}>
                        <span style={{ color: 'var(--sos-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</span>
                        <span style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>{fmtNum(r.count)}</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 999, background: 'var(--sos-surface-3)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--sos-status-danger)' }} />
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </GlassCard>
        </div>
      ) : null}

      {/* ── Leads per agent (24h / 7d / this week PKT / custom) ───────────
          Collapsed by default. Cells are clickable → filter the table below by
          that (agent, window). Only visible to admins with leads.view_all
          (same gate as the rest of the page). */}
      <GlassCard variant="default" padded={false}>
        <button
          type="button"
          onClick={() => setBreakdownOpen((v) => !v)}
          style={{
            width: '100%',
            padding: '14px 18px',
            borderBottom: breakdownOpen ? '1px solid var(--sos-border-subtle)' : 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            textAlign: 'left',
          }}
          aria-expanded={breakdownOpen}
        >
          <Users size={16} style={{ color: 'var(--sos-brand-primary)' }} />
          <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>Leads per agent</h2>
          <span className="sos-text-faint" style={{ fontSize: 12 }}>
            New leads assigned to each rep — click a number to filter the table below.
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--sos-text-muted)' }}>
            {breakdownOpen ? '▾ Hide' : '▸ Show'}
          </span>
        </button>

        {breakdownOpen ? (
          <div style={{ padding: '12px 18px 16px' }}>
            {/* Custom range picker — server ignores partial ranges, so both
                dates must be present for the Custom column to populate. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: 'var(--sos-text-secondary)' }}>
                Custom range:
                <input
                  type="date"
                  value={bkCustomFrom}
                  onChange={(e) => setBkCustomFrom(e.target.value)}
                  style={{ marginLeft: 8, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-2)', color: 'inherit', fontSize: 12 }}
                />
                <span style={{ margin: '0 6px' }}>→</span>
                <input
                  type="date"
                  value={bkCustomTo}
                  onChange={(e) => setBkCustomTo(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-2)', color: 'inherit', fontSize: 12 }}
                />
              </label>
              {(bkCustomFrom || bkCustomTo) ? (
                <button
                  type="button"
                  onClick={() => { setBkCustomFrom(''); setBkCustomTo(''); }}
                  style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-2)', color: 'inherit', cursor: 'pointer' }}
                >
                  Clear
                </button>
              ) : null}
              {breakdownLoading ? <span className="sos-text-faint" style={{ fontSize: 12 }}>Loading…</span> : null}
            </div>

            {agentBreakdown && agentBreakdown.agents.length === 0 ? (
              <div className="sos-text-muted" style={{ padding: 12, textAlign: 'center', fontSize: 13 }}>
                No leads assigned to any rep in the selected windows.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={th}>Agent</th>
                      <th style={{ ...th, textAlign: 'right' }}>24h</th>
                      <th style={{ ...th, textAlign: 'right' }}>7d</th>
                      <th style={{ ...th, textAlign: 'right' }}>This week</th>
                      {agentBreakdown?.hasCustom ? <th style={{ ...th, textAlign: 'right' }}>Custom</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {(agentBreakdown?.agents ?? []).map((a) => {
                      const now = new Date().toISOString();
                      const h24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                      const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                      // "This week" is Monday 00:00 PKT — compute in local terms
                      // relative to UTC (PKT = UTC+5, no DST). Cheap approximation
                      // that matches what the server counted.
                      const nowMs = Date.now();
                      const pktMs = nowMs + 5 * 60 * 60 * 1000; // shift to PKT
                      const pktD = new Date(pktMs);
                      const dow = pktD.getUTCDay(); // 0=Sun..6=Sat
                      const daysSinceMon = (dow + 6) % 7;
                      const mondayPktUtc = new Date(Date.UTC(pktD.getUTCFullYear(), pktD.getUTCMonth(), pktD.getUTCDate() - daysSinceMon, 0, 0, 0)).getTime() - 5 * 60 * 60 * 1000;
                      const thisWeekIso = new Date(mondayPktUtc).toISOString();
                      const cell = (n: number, from: string, to?: string) => (
                        <td style={{ ...td, textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => applyAgentWindow(a.id, from, to)}
                            disabled={n === 0}
                            style={{
                              padding: '4px 10px',
                              minWidth: 44,
                              borderRadius: 6,
                              border: '1px solid var(--sos-border-subtle)',
                              background: n === 0 ? 'transparent' : 'var(--sos-surface-2)',
                              color: n === 0 ? 'var(--sos-text-faint)' : 'var(--sos-text-primary)',
                              fontWeight: n === 0 ? 400 : 600,
                              cursor: n === 0 ? 'default' : 'pointer',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {n}
                          </button>
                        </td>
                      );
                      return (
                        <tr key={a.id}>
                          <td style={{ ...td, fontWeight: 600 }}>
                            {a.firstName} {a.lastName}
                          </td>
                          {cell(a.last24h, h24, now)}
                          {cell(a.last7d, d7, now)}
                          {cell(a.thisWeek, thisWeekIso, now)}
                          {agentBreakdown?.hasCustom ? cell(a.custom, agentBreakdown.customFrom!, agentBreakdown.customTo!) : null}
                        </tr>
                      );
                    })}
                    {!agentBreakdown && breakdownLoading ? (
                      <tr><td colSpan={5} style={{ ...td, textAlign: 'center' }} className="sos-text-faint">Loading…</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </GlassCard>

      {/* ── Ad attribution leaderboard ───────────────────────────────────── */}
      <GlassCard variant="default" padded={false} glow="warm">
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Megaphone size={16} style={{ color: 'var(--sos-brand-accent)' }} />
          <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>Ad attribution</h2>
          <span className="sos-text-faint" style={{ fontSize: 12 }}>
            Which Click-to-WhatsApp ads brought leads — click a row to filter. Leads/Contacted/Converted are all-time; Spend, CPL, CPA &amp; ROAS cover the last 30 days.
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <StatusBadge tone="warm" size="sm" dot={false}>{ads.length} ads</StatusBadge>
          </span>
        </div>

        {bootLoading ? (
          <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center' }}>Loading…</div>
        ) : ads.length === 0 ? (
          <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center', fontSize: 13 }}>
            No ad-attributed leads yet. Leads that arrive from a Click-to-WhatsApp ad will appear here.
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
                <thead>
                  <tr>
                    <th style={th}>Ad</th>
                    <th style={{ ...th, width: '22%' }}>Leads</th>
                    <th style={th}>Contacted</th>
                    <th style={th}>Converted</th>
                    <th style={th}>Conv.</th>
                    <th style={th}>Spend</th>
                    <th style={th}>CPL</th>
                    <th style={th}>CPA</th>
                    <th style={th}>ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAds.map((row, i) => {
                    const active = !!row.sourceId && row.sourceId === filters.adSourceId;
                    const conv = row.leads ? Math.round((row.converted / row.leads) * 1000) / 10 : 0;
                    const clickable = !!row.sourceId;
                    return (
                      <tr
                        key={`${row.sourceId ?? 'none'}-${i}`}
                        onClick={() => selectAd(row)}
                        style={{
                          cursor: clickable ? 'pointer' : 'default',
                          background: active ? 'var(--sos-brand-accent-soft)' : undefined,
                        }}
                      >
                        <td style={{ ...td, maxWidth: 300 }}>
                          <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {adName(row)}
                          </div>
                          <div className="sos-text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                            {row.sourceType ?? 'ad'}{row.sourceId ? ` · ${row.sourceId}` : ''}
                          </div>
                        </td>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontWeight: 700, color: 'var(--sos-text-primary)', minWidth: 34 }}>{fmtNum(row.leads)}</span>
                            <span style={{ flex: 1, height: 7, borderRadius: 999, background: 'var(--sos-surface-3)', overflow: 'hidden', minWidth: 60 }}>
                              <span style={{ display: 'block', height: '100%', width: `${Math.round((row.leads / maxAdLeads) * 100)}%`, background: 'var(--sos-brand-warm-gradient)' }} />
                            </span>
                          </div>
                        </td>
                        <td style={td}>{fmtNum(row.contacted)}</td>
                        <td style={td}>{fmtNum(row.converted)}</td>
                        <td style={td}>
                          <StatusBadge tone={conv > 0 ? 'success' : 'neutral'} size="sm" dot={false}>{conv}%</StatusBadge>
                        </td>
                        <td style={td}>{fmtAmt(row.spend, row.spendCurrency)}</td>
                        <td style={td}>{fmtAmt(row.cpl, row.spendCurrency)}</td>
                        <td style={td}>{fmtAmt(row.cpa, row.spendCurrency)}</td>
                        <td style={td}>
                          {row.roas != null ? (
                            <StatusBadge tone={row.roas >= 1 ? 'success' : 'warning'} size="sm" dot={false}>
                              {row.roas}×
                            </StatusBadge>
                          ) : (
                            <span className="sos-text-faint">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {ads.length > 6 ? (
              <div style={{ padding: '10px 18px', borderTop: '1px solid var(--sos-border-subtle)' }}>
                <GhostButton size="sm" onClick={() => setShowAllAds((v) => !v)}>
                  {showAllAds ? 'Show top 6' : `Show all ${ads.length} ads`}
                </GhostButton>
              </div>
            ) : null}
          </>
        )}
      </GlassCard>
      {/* ── Bulk action bar ──────────────────────────────────────────────── */}
      {canDelete && selected.size > 0 ? (
        <GlassCard variant="strong" padded="sm" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
            {selected.size} selected
          </span>
          <GhostButton size="sm" onClick={() => setSelected(new Set())}>Clear</GhostButton>
          <span style={{ marginLeft: 'auto' }}>
            <DangerButton
              size="sm"
              onClick={() => void handleBulkDelete()}
              disabled={bulkDeleting}
              iconLeft={bulkDeleting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
            >
              {bulkDeleting ? 'Deleting…' : `Delete ${selected.size}`}
            </DangerButton>
          </span>
        </GlassCard>
      ) : null}

      {/* ── Leads table ──────────────────────────────────────────────────── */}
      <div ref={tableRef} style={{ scrollMarginTop: 12 }}>
      <GlassCard variant="default" padded={false}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {canDelete ? (
                  <th style={{ ...th, width: 40 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={rows.length > 0 && selected.size === rows.length}
                      onChange={toggleAll}
                      style={{ accentColor: 'var(--sos-brand-primary)' }}
                    />
                  </th>
                ) : null}
                <th style={th}>Lead</th>
                <th style={th}>Phone</th>
                <th style={th}>Service</th>
                <th style={th}>Country</th>
                <th style={th}>Source</th>
                <th style={th}>Assigned</th>
                <th style={th}>Status</th>
                <th style={th}>Created</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tableLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={canDelete ? 10 : 9} style={{ padding: 28, textAlign: 'center', color: 'var(--sos-text-muted)' }}>
                    Loading leads…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={canDelete ? 10 : 9} style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13.5 }}>
                    No leads match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((lead) => {
                  const isSelected = selected.has(lead.id);
                  const agent = lead.assignedEmployee
                    ? `${lead.assignedEmployee.firstName ?? ''} ${lead.assignedEmployee.lastName ?? ''}`.trim()
                    : '';
                  return (
                    <tr key={lead.id} style={{ background: isSelected ? 'var(--sos-brand-primary-soft)' : undefined }}>
                      {canDelete ? (
                        <td style={td}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${lead.firstName} ${lead.lastName}`}
                            checked={isSelected}
                            onChange={() => toggleRow(lead.id)}
                            style={{ accentColor: 'var(--sos-brand-primary)' }}
                          />
                        </td>
                      ) : null}
                      <td style={{ ...td, color: 'var(--sos-text-primary)', fontWeight: 600 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {lead.firstName} {lead.lastName}
                          {lead.importRows && lead.importRows.length > 0 ? (
                            <CsvLeadBadge batchName={lead.importRows[0]?.batch.name} />
                          ) : null}
                        </span>
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 12.5, whiteSpace: 'nowrap' }}>{lead.phone}</td>
                      <td style={td}>{lead.serviceInterest ?? '—'}</td>
                      <td style={td}>{lead.targetCountry ?? '—'}</td>
                      <td style={td}>{lead.sourceChannel ?? '—'}</td>
                      <td style={td}>{agent || <span className="sos-text-faint">Unassigned</span>}</td>
                      <td style={td}>
                        <StatusBadge tone={STATUS_TONE[lead.status] ?? 'neutral'} size="sm">{statusLabel(lead.status)}</StatusBadge>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--sos-text-faint)', fontSize: 12 }}>{fmtDate(lead.createdAt)}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                          {canEdit ? (
                            <button
                              onClick={() =>
                                setEditLead({
                                  id: lead.id,
                                  firstName: lead.firstName,
                                  lastName: lead.lastName,
                                  phone: lead.phone,
                                  email: lead.email ?? undefined,
                                  service: lead.serviceInterest ?? undefined,
                                  targetCountry: lead.targetCountry ?? undefined,
                                })
                              }
                              aria-label="Edit lead"
                              title="Edit lead"
                              className="sos-icon-btn"
                              style={iconBtn}
                            >
                              <Pencil size={15} />
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button
                              onClick={() => void handleDelete(lead)}
                              disabled={deletingId === lead.id}
                              aria-label="Delete lead"
                              title="Delete lead"
                              style={{ ...iconBtn, color: 'var(--sos-status-danger)' }}
                            >
                              {deletingId === lead.id ? (
                                <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                              ) : (
                                <Trash2 size={15} />
                              )}
                            </button>
                          ) : null}
                          {!canEdit && !canDelete ? <span className="sos-text-faint">—</span> : null}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
      </div>

      <EditLeadModal
        open={editLead !== null}
        lead={editLead}
        onClose={() => setEditLead(null)}
        onSaved={() => void reload()}
      />
    </div>
  );
}

const iconBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  borderRadius: 'var(--sos-radius-button)',
  border: '1px solid var(--sos-border-subtle)',
  background: 'var(--sos-surface-2)',
  color: 'var(--sos-text-secondary)',
  cursor: 'pointer',
};

function chipStyle(primary: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 6px 5px 12px',
    borderRadius: 'var(--sos-radius-pill)',
    background: primary ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-2)',
    color: primary ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
    border: `1px solid ${primary ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
    fontSize: 12.5,
    fontWeight: 600,
  };
}

const chipClearStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  padding: 2,
  borderRadius: 6,
};
