'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  MessageCircle,
  Search,
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
  /** Response-SLA on-time score (0–100). Starts at 100 with no history. */
  slaScore?: number;
  /** Lifetime count of replies that breached the Response-SLA. */
  slaBreaches?: number;
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

/**
 * Stable per-name gradient for avatar tiles. Same palette + hashing function
 * the employees page uses so a sales rep's avatar looks identical on both
 * /admin/sales and /admin/employees — visual continuity matters when admins
 * pivot between the two views.
 */
function avatarGradient(name: string): string {
  const colors: [string, string][] = [
    ['#6366f1', '#8b5cf6'],
    ['#0ea5e9', '#6366f1'],
    ['#10b981', '#0ea5e9'],
    ['#f59e0b', '#ef4444'],
    ['#ec4899', '#8b5cf6'],
    ['#14b8a6', '#3b82f6'],
  ];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  const [a, b] = colors[hash % colors.length]!;
  return `linear-gradient(135deg, ${a}, ${b})`;
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
        eyebrow="Admin · Sales"
        title="Sales overview"
        description="Per-agent KPIs across the full team. Click any agent to see their assigned leads and a live timeline of every touch."
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

      {/* ── Controls bar — flatter, icon-led so the page feels integrated
            with the employees page's filter row instead of a separate
            disclosure card.                                              ── */}
      <GlassCard variant="soft" padded="md">
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              flex: '1 1 280px',
              maxWidth: 360,
            }}
          >
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 12,
                color: 'var(--sos-text-muted)',
              }}
            />
            <input
              type="search"
              className="sos-input"
              placeholder="Search agent by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 34, width: '100%' }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginLeft: 'auto',
            }}
          >
            <ArrowUpDown size={14} style={{ color: 'var(--sos-text-muted)' }} />
            <select
              className="sos-select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              style={{ minWidth: 220 }}
            >
              <option value="assignedLeads">Assigned leads (high → low)</option>
              <option value="conversionRate">Conversion rate (30d)</option>
              <option value="overdueFollowUps">Overdue follow-ups</option>
              <option value="upcomingAppointments">Upcoming appointments</option>
              <option value="name">Name (A → Z)</option>
            </select>
          </div>
        </div>
      </GlassCard>

      {/* ── Agent table — same premium-glass pattern as /admin/employees:
            header strip with eyebrow + count + new-agent-style action;
            gradient avatars; hover row tint; numeric pill cells; trailing
            Open button.                                                  ── */}
      <GlassCard variant="panel" padded={false}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '18px 24px',
            borderBottom: '1px solid var(--sos-divider)',
          }}
        >
          <div>
            <div className="sos-eyebrow">Sales team</div>
            <h2 className="sos-title" style={{ fontSize: 16, marginTop: 4 }}>
              All agents
            </h2>
          </div>
          <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
            {filteredAgents.length} of {data.agents.length} agents
          </span>
        </div>

        {filteredAgents.length === 0 ? (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              color: 'var(--sos-text-muted)',
              fontSize: 14,
            }}
          >
            No agents match your filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 1020, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--sos-surface-1)' }}>
                  {[
                    'Agent',
                    'SLA score',
                    'Assigned',
                    'New (30d)',
                    'Converted (30d)',
                    'Conv. rate',
                    'Open follow-ups',
                    'Overdue',
                    'Upcoming appts',
                    '',
                  ].map((h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                        color: 'var(--sos-text-muted)',
                        whiteSpace: 'nowrap',
                        borderBottom: '1px solid var(--sos-divider)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((a) => (
                  <tr
                    key={a.employeeId}
                    onClick={() => {
                      window.location.href = `/admin/sales/${a.employeeId}`;
                    }}
                    style={{
                      borderBottom: '1px solid var(--sos-divider)',
                      cursor: 'pointer',
                      transition: 'background 140ms',
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLTableRowElement).style.background =
                        'var(--sos-surface-hover)')
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLTableRowElement).style.background = 'transparent')
                    }
                  >
                    {/* Agent identity (gradient avatar + name + presence + WA badge) */}
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            flexShrink: 0,
                            background: avatarGradient(a.name),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 13,
                            fontWeight: 700,
                            color: '#fff',
                            position: 'relative',
                          }}
                        >
                          {a.avatarInitials || '?'}
                          <span
                            style={{
                              position: 'absolute',
                              right: -2,
                              bottom: -2,
                              width: 11,
                              height: 11,
                              borderRadius: '50%',
                              background: presenceColor(a.presenceStatus),
                              border: '2px solid var(--sos-bg-elevated)',
                            }}
                            aria-label={`presence ${a.presenceStatus}`}
                          />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13.5,
                              fontWeight: 600,
                              color: 'var(--sos-text-primary)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {a.name}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--sos-text-muted)',
                              marginTop: 4,
                              display: 'flex',
                              gap: 6,
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            {a.whatsappInboxMember ? (
                              <StatusBadge tone="accent" size="sm" dot={false}>
                                <MessageCircle size={11} style={{ marginRight: 3 }} />
                                WA inbox
                              </StatusBadge>
                            ) : null}
                            <span>Active {fmtRelative(a.lastActivityAt)}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Response-SLA score */}
                    <td style={{ padding: '14px 16px' }}>
                      <SlaScorePill score={a.slaScore ?? 100} breaches={a.slaBreaches ?? 0} />
                    </td>

                    {/* Assigned (big number) */}
                    <td style={{ padding: '14px 16px' }}>
                      <NumPill value={a.assignedLeads} tone="primary" />
                    </td>

                    {/* New (30d) */}
                    <td style={{ padding: '14px 16px' }}>
                      <NumPill value={a.newLeadsLast30d} tone="muted" />
                    </td>

                    {/* Converted (30d) */}
                    <td style={{ padding: '14px 16px' }}>
                      <NumPill value={a.converted30d} tone={a.converted30d > 0 ? 'success' : 'muted'} />
                    </td>

                    {/* Conv. rate */}
                    <td style={{ padding: '14px 16px' }}>
                      <ConversionPill rate={a.conversionRate} sample={a.newLeadsLast30d} />
                    </td>

                    {/* Open follow-ups */}
                    <td style={{ padding: '14px 16px' }}>
                      <NumPill value={a.openFollowUps} tone="muted" />
                    </td>

                    {/* Overdue */}
                    <td style={{ padding: '14px 16px' }}>
                      <NumPill
                        value={a.overdueFollowUps}
                        tone={a.overdueFollowUps > 0 ? 'danger' : 'muted'}
                      />
                    </td>

                    {/* Upcoming appts */}
                    <td style={{ padding: '14px 16px' }}>
                      <NumPill value={a.upcomingAppointments} tone="muted" />
                    </td>

                    {/* Open action */}
                    <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <span
                          className="sos-btn sos-btn--ghost sos-btn--sm"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            pointerEvents: 'none',
                          }}
                        >
                          Open
                          <ChevronRight size={13} />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

/**
 * Tone-able numeric pill — same shape as ConversionPill so all the numbers
 * in a row look like a consistent family rather than a wall of bare digits.
 * Zero values render in a muted tone so high-traffic agents read at a
 * glance vs idle ones.
 */
function NumPill({
  value,
  tone,
}: {
  value: number;
  tone: 'primary' | 'success' | 'danger' | 'muted';
}) {
  const palette = {
    primary: { color: 'var(--sos-text-primary)', bg: 'rgba(255,255,255,0.045)' },
    success: { color: 'var(--sos-status-success)', bg: 'var(--sos-status-success-soft)' },
    danger:  { color: 'var(--sos-status-danger)',  bg: 'var(--sos-status-danger-soft)' },
    muted:   { color: 'var(--sos-text-muted)',     bg: 'transparent' },
  }[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 32,
        padding: '3px 9px',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: tone === 'muted' ? 500 : 700,
        background: palette.bg,
        color: palette.color,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value.toLocaleString()}
    </span>
  );
}

/**
 * Response-SLA score chip. Green ≥90, amber ≥70, red below. Shows the % and,
 * when the agent has breaches, a small count so managers can see who's
 * approaching the 10-breach reassignment line.
 */
function SlaScorePill({ score, breaches }: { score: number; breaches: number }) {
  const color = score >= 90 ? 'var(--sos-status-success)' : score >= 70 ? 'var(--sos-status-warning)' : 'var(--sos-status-danger)';
  const bg = score >= 90 ? 'var(--sos-status-success-soft)' : score >= 70 ? 'var(--sos-status-warning-soft)' : 'var(--sos-status-danger-soft)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          padding: '3px 9px',
          borderRadius: 999,
          background: bg,
          color,
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {score}%
      </span>
      {breaches > 0 ? (
        <span style={{ fontSize: 10, color: 'var(--sos-text-faint)' }}>
          {breaches} breach{breaches === 1 ? '' : 'es'}
        </span>
      ) : null}
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
