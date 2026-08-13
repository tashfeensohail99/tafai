'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Search, X } from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  MetricCard,
  StatusBadge,
  FormInput,
  FormSelect,
  GhostButton,
} from '@/components/sales-v2/ui';
import type { BadgeTone } from '@/components/sales-v2/ui/StatusBadge';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useAdminSession } from '@/components/layout/AdminShell';
import {
  fetchSignedStats,
  listSignedAgreements,
  type SignedStats,
  type SignedAgreementRow,
  type SignedFilters,
} from '@/lib/agreements-admin';

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
  letterSpacing: '0.04em',
  color: 'var(--sos-text-faint)',
  whiteSpace: 'nowrap',
};
const td: CSSProperties = { padding: '11px 14px', fontSize: 13.5, verticalAlign: 'middle' };

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'FINANCE_REVIEW', label: 'Finance review' },
  { value: 'CHANGES_REQUESTED', label: 'Changes requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'SENT', label: 'Sent' },
  { value: 'SIGNED', label: 'Signed' },
];

function statusTone(s: string): BadgeTone {
  switch (s) {
    case 'SIGNED':
      return 'success';
    case 'APPROVED':
      return 'accent';
    case 'SENT':
      return 'info';
    case 'SUBMITTED':
    case 'FINANCE_REVIEW':
      return 'warning';
    case 'CHANGES_REQUESTED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function money(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${currency} ${amount}`;
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function SignedAgreementsPage() {
  const router = useRouter();
  const { user } = useAdminSession();
  const canView =
    user.permissions.includes('settings.manage') || user.permissions.includes('finance.view_all');

  const [stats, setStats] = useState<SignedStats | null>(null);
  const [rows, setRows] = useState<SignedAgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SignedFilters>({});
  const debFilters = useDebounced(filters, 250);
  const tableRef = useRef<HTMLDivElement>(null);

  const setFilter = <K extends keyof SignedFilters>(key: K, value: SignedFilters[K]) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === '' || value === undefined || value === false) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  // Stats once (and after a mutation — none in PR1).
  useEffect(() => {
    if (!canView) return;
    fetchSignedStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, [canView]);

  // Table refetch on debounced filters.
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listSignedAgreements(debFilters)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load agreements');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debFilters, canView]);

  const activeChips = useMemo(() => {
    const chips: Array<{ key: keyof SignedFilters; label: string }> = [];
    if (filters.search) chips.push({ key: 'search', label: `“${filters.search}”` });
    if (filters.status) chips.push({ key: 'status', label: filters.status });
    if (filters.changeRequested) chips.push({ key: 'changeRequested', label: 'Change requested' });
    if (filters.createdFrom) chips.push({ key: 'createdFrom', label: `From ${filters.createdFrom}` });
    if (filters.createdTo) chips.push({ key: 'createdTo', label: `To ${filters.createdTo}` });
    return chips;
  }, [filters]);

  if (!canView) {
    return <PermissionDeniedState message="You need the settings.manage or finance.view_all permission to view signed agreements." />;
  }

  const jumpToTable = () => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Agreements"
        title="Signed Agreements"
        description="Every agreement passed to Finance. Search by name, number, phone or email, then open one to review or apply a correction."
      />

      {/* KPI tiles — clickable filters */}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <MetricCard
          label="Total"
          value={stats ? stats.total.toLocaleString() : '—'}
          hint="Passed to finance"
          tone="accent"
          onClick={() => {
            setFilters({});
            jumpToTable();
          }}
          active={activeChips.length === 0}
        />
        <MetricCard
          label="Change requested"
          value={stats ? stats.changeRequested.toLocaleString() : '—'}
          hint="Pending correction"
          tone="warning"
          onClick={() => {
            setFilter('changeRequested', !filters.changeRequested);
            jumpToTable();
          }}
          active={!!filters.changeRequested}
        />
        <MetricCard
          label="New today"
          value={stats ? stats.newToday.toLocaleString() : '—'}
          hint="Created today (PKT)"
          tone="info"
        />
        <MetricCard
          label="This week"
          value={stats ? stats.thisWeek.toLocaleString() : '—'}
          hint="Last 7 days"
          tone="warm"
        />
      </div>

      {/* Search + filters */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FormInput
            placeholder="Search name, agreement number, phone (+92 / 0313) or email…"
            iconLeft={<Search size={16} />}
            value={filters.search ?? ''}
            onChange={(e) => setFilter('search', e.target.value)}
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 180 }}>
              <FormSelect
                label="Status"
                options={STATUS_OPTIONS}
                value={filters.status ?? ''}
                onChange={(e) => setFilter('status', e.target.value)}
              />
            </div>
            <div style={{ minWidth: 150 }}>
              <FormInput
                label="From"
                type="date"
                value={filters.createdFrom ?? ''}
                onChange={(e) => setFilter('createdFrom', e.target.value)}
              />
            </div>
            <div style={{ minWidth: 150 }}>
              <FormInput
                label="To"
                type="date"
                value={filters.createdTo ?? ''}
                onChange={(e) => setFilter('createdTo', e.target.value)}
              />
            </div>
          </div>
          {activeChips.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {activeChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setFilter(c.key, undefined)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: '1px solid var(--sos-border)',
                    background: 'var(--sos-bg-subtle)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {c.label} <X size={12} />
                </button>
              ))}
              <GhostButton size="sm" onClick={() => setFilters({})}>
                Clear all
              </GhostButton>
            </div>
          ) : null}
        </div>
      </GlassCard>

      {/* Table */}
      <div ref={tableRef}>
        <GlassCard variant="default" padded={false}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--sos-border)' }}>
                  <th style={th}>Agreement</th>
                  <th style={th}>Applicant</th>
                  <th style={th}>Service</th>
                  <th style={th}>Amount</th>
                  <th style={th}>Status</th>
                  <th style={th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--sos-text-muted)' }} colSpan={6}>
                      Loading…
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--sos-danger, #d33)' }} colSpan={6}>
                      {error}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--sos-text-muted)' }} colSpan={6}>
                      No agreements match.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => router.push(`/admin/agreements/signed/${r.id}` as Route)}
                      style={{ borderBottom: '1px solid var(--sos-border)', cursor: 'pointer' }}
                    >
                      <td style={td}>
                        <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{r.agreementNumber}</div>
                        {r.pendingChangeCount > 0 ? (
                          <div style={{ marginTop: 3 }}>
                            <StatusBadge tone="warning" size="sm" dot>
                              {r.pendingChangeCount} change{r.pendingChangeCount > 1 ? 's' : ''} requested
                            </StatusBadge>
                          </div>
                        ) : null}
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>
                          {r.lead ? `${r.lead.firstName} ${r.lead.lastName}`.trim() : '—'}
                        </div>
                        <div className="sos-text-faint" style={{ fontSize: 12 }}>
                          {r.lead?.phone ?? r.lead?.referenceCode ?? ''}
                        </div>
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{r.categoryKey}</td>
                      <td style={td}>{money(r.totalAmount, r.currency)}</td>
                      <td style={td}>
                        <StatusBadge tone={statusTone(r.status)} size="sm">
                          {r.status.replace(/_/g, ' ')}
                        </StatusBadge>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
