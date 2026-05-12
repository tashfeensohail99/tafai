'use client';

import { useEffect, useMemo, useState } from 'react';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PageHeader } from '../shared/PageHeader';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { apiFetch } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';

interface AgentRow {
  employeeId: string;
  name: string;
  avatarInitials: string;
  whatsappInboxMember: boolean;
  presenceStatus: 'ONLINE' | 'AWAY' | 'OFFLINE';
  lastActivityAt: string | null;
  assignedLeads: number;
  newLeadsLast30d: number;
  converted30d: number;
  conversionRate: number;
  openFollowUps: number;
  overdueFollowUps: number;
  upcomingAppointments: number;
}

interface SalesOverview {
  totals: {
    activeAgents: number;
    totalLeads: number;
    convertedThisMonth: number;
    overdueFollowUps: number;
    appointmentsToday: number;
  };
  agents: AgentRow[];
}

type SortKey =
  | 'name'
  | 'assignedLeads'
  | 'conversionRate'
  | 'overdueFollowUps'
  | 'upcomingAppointments';

function pctFormat(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function presenceColor(p: AgentRow['presenceStatus']): string {
  if (p === 'ONLINE') return 'var(--sos-status-success)';
  if (p === 'AWAY') return 'var(--sos-status-warning)';
  return 'var(--sos-text-muted)';
}

export function SalesOverviewPage() {
  const { user } = useAdminSession();
  const canView = user.permissions.includes('reports.view');

  const [data, setData] = useState<SalesOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>('assignedLeads');
  const [search, setSearch] = useState('');

  async function load() {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<SalesOverview>('/reports/sales-overview');
      setData(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load sales overview');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [canView]);

  // Sorting/filtering kept above early returns so hooks order stays stable.
  const filteredAgents = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const rows = q ? data.agents.filter((a) => a.name.toLowerCase().includes(q)) : data.agents;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'conversionRate':
          return b.conversionRate - a.conversionRate;
        case 'overdueFollowUps':
          return b.overdueFollowUps - a.overdueFollowUps;
        case 'upcomingAppointments':
          return b.upcomingAppointments - a.upcomingAppointments;
        case 'assignedLeads':
        default:
          return b.assignedLeads - a.assignedLeads;
      }
    });
  }, [data, sortKey, search]);

  if (!canView) return <PermissionDeniedState />;
  if (loading && !data) return <LoadingState message="Loading sales overview..." />;
  if (error && !data) {
    return <ErrorState message="Unable to load sales overview" details={error} onRetry={() => void load()} />;
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales overview"
        description="Per-agent KPIs across the full team. Use this view to balance workload, spot overdue follow-ups, and track 30-day conversion."
      />

      {/* Top totals */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <TotalTile label="Active agents" value={data.totals.activeAgents} />
        <TotalTile label="Total leads" value={data.totals.totalLeads} />
        <TotalTile label="Converted this month" value={data.totals.convertedThisMonth} accent="success" />
        <TotalTile label="Overdue follow-ups" value={data.totals.overdueFollowUps} accent="warning" />
        <TotalTile label="Appointments today" value={data.totals.appointmentsToday} />
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '12px 14px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--sos-radius-md)',
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Sort by
        </span>
        <select
          className="sos-select"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          style={{ maxWidth: 220 }}
        >
          <option value="assignedLeads">Assigned leads (high → low)</option>
          <option value="conversionRate">Conversion rate (30d)</option>
          <option value="overdueFollowUps">Overdue follow-ups</option>
          <option value="upcomingAppointments">Upcoming appointments</option>
          <option value="name">Name (A → Z)</option>
        </select>
        <input
          type="search"
          className="sos-input"
          placeholder="Search agent…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 220, marginLeft: 'auto' }}
        />
      </div>

      {/* Agent table */}
      <div
        className="overflow-hidden rounded-[24px] border shadow-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full">
            <thead style={{ backgroundColor: 'var(--color-surface-subtle)' }}>
              <tr>
                {[
                  'Agent',
                  'Assigned',
                  'New (30d)',
                  'Converted (30d)',
                  'Conv. rate',
                  'Open follow-ups',
                  'Overdue',
                  'Upcoming appts',
                ].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide sm:px-4"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAgents.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    No agents match your filters.
                  </td>
                </tr>
              ) : (
                filteredAgents.map((a) => (
                  <tr
                    key={a.employeeId}
                    style={{ borderTop: '1px solid var(--color-border)' }}
                  >
                    <td className="px-3 py-3 sm:px-4">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: 'var(--sos-brand-primary-soft)',
                            color: 'var(--sos-brand-primary-strong)',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 11,
                            fontWeight: 700,
                            position: 'relative',
                          }}
                        >
                          {a.avatarInitials || '?'}
                          <span
                            style={{
                              position: 'absolute',
                              right: -2,
                              bottom: -2,
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background: presenceColor(a.presenceStatus),
                              border: '2px solid var(--color-surface)',
                            }}
                            aria-label={`presence ${a.presenceStatus}`}
                          />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            {a.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                            {a.whatsappInboxMember ? (
                              <span
                                style={{
                                  fontSize: 10,
                                  padding: '1px 6px',
                                  borderRadius: 999,
                                  background: 'var(--sos-status-info-soft)',
                                  color: 'var(--sos-status-info)',
                                  fontWeight: 700,
                                }}
                              >
                                WA inbox
                              </span>
                            ) : null}
                            <span>Active {fmtRelative(a.lastActivityAt)}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 sm:px-4" style={{ fontSize: 13, fontWeight: 600 }}>
                      {a.assignedLeads}
                    </td>
                    <td className="px-3 py-3 sm:px-4" style={{ fontSize: 13 }}>
                      {a.newLeadsLast30d}
                    </td>
                    <td className="px-3 py-3 sm:px-4" style={{ fontSize: 13 }}>
                      {a.converted30d}
                    </td>
                    <td className="px-3 py-3 sm:px-4">
                      <ConversionPill rate={a.conversionRate} sample={a.newLeadsLast30d} />
                    </td>
                    <td className="px-3 py-3 sm:px-4" style={{ fontSize: 13 }}>
                      {a.openFollowUps}
                    </td>
                    <td
                      className="px-3 py-3 sm:px-4"
                      style={{
                        fontSize: 13,
                        fontWeight: a.overdueFollowUps > 0 ? 700 : 400,
                        color: a.overdueFollowUps > 0 ? 'var(--sos-status-danger)' : 'inherit',
                      }}
                    >
                      {a.overdueFollowUps}
                    </td>
                    <td className="px-3 py-3 sm:px-4" style={{ fontSize: 13 }}>
                      {a.upcomingAppointments}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TotalTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'success' | 'warning';
}) {
  const color =
    accent === 'success'
      ? 'var(--sos-status-success)'
      : accent === 'warning'
        ? 'var(--sos-status-warning)'
        : 'var(--sos-brand-primary-strong)';
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--sos-radius-md)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ConversionPill({ rate, sample }: { rate: number; sample: number }) {
  if (sample === 0) {
    return (
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
        no new leads
      </span>
    );
  }
  let color = 'var(--sos-status-info)';
  let bg = 'var(--sos-status-info-soft)';
  if (rate >= 0.3) {
    color = 'var(--sos-status-success)';
    bg = 'var(--sos-status-success-soft)';
  } else if (rate < 0.1) {
    color = 'var(--sos-status-warning)';
    bg = 'var(--sos-status-warning-soft)';
  }
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 9px',
        borderRadius: 999,
        background: bg,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {pctFormat(rate)}
    </span>
  );
}
