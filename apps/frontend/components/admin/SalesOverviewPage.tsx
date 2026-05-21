'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { apiFetch } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';
import {
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
} from '@/components/sales-v2/ui';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        eyebrow="Sales · Admin"
        title="Sales overview"
        description="Per-agent KPIs across the full team. Balance workload, spot overdue follow-ups, track 30-day conversion."
      />

      {/* Top totals */}
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <MetricCard label="Active agents" value={data.totals.activeAgents} tone="accent" Icon={Users} />
        <MetricCard label="Total leads" value={data.totals.totalLeads} tone="info" Icon={UserCheck} />
        <MetricCard
          label="Converted this month"
          value={data.totals.convertedThisMonth}
          tone="success"
          Icon={BadgeCheck}
        />
        <MetricCard
          label="Overdue follow-ups"
          value={data.totals.overdueFollowUps}
          tone={data.totals.overdueFollowUps > 0 ? 'warning' : 'neutral'}
          Icon={AlertTriangle}
        />
        <MetricCard
          label="Appointments today"
          value={data.totals.appointmentsToday}
          tone="accent"
          Icon={CalendarDays}
        />
      </div>

      {/* Controls */}
      <GlassCard variant="soft" padded="md">
        <div
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--sos-text-muted)',
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
      </GlassCard>

      {/* Agent table */}
      <GlassCard variant="panel" padded={false}>
        <div className="overflow-x-auto" style={{ borderRadius: 'var(--sos-radius-panel)' }}>
          <table className="min-w-[760px] w-full">
            <thead style={{ background: 'var(--sos-surface-1)' }}>
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
                  '', // chevron column — no header label, just a visual cue rows are clickable
                ].map((h, i) => (
                  <th
                    key={i}
                    className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide sm:px-4"
                    style={{ color: 'var(--sos-text-muted)', letterSpacing: 'var(--sos-letter-eyebrow)' }}
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
                    colSpan={9}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--sos-text-muted)' }}
                  >
                    No agents match your filters.
                  </td>
                </tr>
              ) : (
                filteredAgents.map((a) => (
                  <tr
                    key={a.employeeId}
                    onClick={() => {
                      window.location.href = `/admin/sales/${a.employeeId}`;
                    }}
                    style={{
                      borderTop: '1px solid var(--sos-border-subtle)',
                      cursor: 'pointer',
                      transition: 'background 120ms',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background =
                        'rgba(255,255,255,0.025)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
                    }}
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
                              border: '2px solid var(--sos-bg-elevated)',
                            }}
                            aria-label={`presence ${a.presenceStatus}`}
                          />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                            {a.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                            {a.whatsappInboxMember ? (
                              <StatusBadge tone="info" size="sm">WA inbox</StatusBadge>
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
                    <td className="px-3 py-3 sm:px-4" style={{ width: 24, textAlign: 'right' }}>
                      <ChevronRight size={14} style={{ color: 'var(--sos-text-faint)' }} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}

function ConversionPill({ rate, sample }: { rate: number; sample: number }) {
  if (sample === 0) {
    return (
      <span style={{ fontSize: 11, color: 'var(--sos-text-muted)', fontStyle: 'italic' }}>
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
