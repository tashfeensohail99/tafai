'use client';
// Manager Dashboard — wired to GET /processing/admin-overview.
// Team workload, SLA breaches, stage bottlenecks, recent intake.
// Permission-gated: processing.case.view_all (manager / admin only).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileSearch,
  FolderKanban,
  Inbox,
  Layers,
  Loader2,
  Send,
  ShieldAlert,
  User,
  UserX,
  Users,
  XCircle,
} from 'lucide-react';
import {
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
} from '@/components/sales-v2/ui';
import { STAGE_LABEL, PRIORITY_LABEL, fmtRelative } from '@/components/processing/mockData';
import { stageTone, priorityTone } from './ProcessingDashboardPage';
import { useProcessingSession } from '@/components/layout/ProcessingShell';
import {
  fetchProcessingAdminOverview,
  type ApiProcessingAdminOverview,
} from '@/lib/processing';
import { labelForServiceCode } from '@/lib/service-types';

function OfficerRow({
  name,
  total,
  max,
}: {
  name: string;
  total: number;
  max: number;
}) {
  const pct = max > 0 ? Math.round((total / max) * 100) : 0;
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--sos-border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--sos-brand-primary-soft)', border: '1px solid var(--sos-brand-primary-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <User size={14} style={{ color: 'var(--sos-brand-primary-strong)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{name}</div>
        </div>
        <div style={{ textAlign: 'center', minWidth: '60px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sos-text-primary)', lineHeight: 1 }}>{total}</div>
          <div style={{ fontSize: '10.5px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>active cases</div>
        </div>
      </div>
      <div style={{ height: '4px', borderRadius: '2px', background: 'var(--sos-border-subtle)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--sos-brand-primary-strong)', borderRadius: '2px', transition: 'width 400ms ease' }} />
      </div>
    </div>
  );
}

function StageBar({ stage, count, max }: { stage: ApiProcessingAdminOverview['stageBreakdown'][number]['stage']; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0' }}>
      <div style={{ width: '180px', flexShrink: 0 }}>
        <StatusBadge tone={stageTone(stage)} size="sm">{STAGE_LABEL[stage]}</StatusBadge>
      </div>
      <div style={{ flex: 1, height: '8px', background: 'var(--sos-border-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--sos-brand-primary-strong)', borderRadius: '4px', transition: 'width 400ms ease' }} />
      </div>
      <div style={{ minWidth: '28px', textAlign: 'right', fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{count}</div>
    </div>
  );
}

export function ProcessingManagerDashboardPage() {
  const { user } = useProcessingSession();
  const [data, setData] = useState<ApiProcessingAdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasManagerAccess = user.permissions.includes('processing.case.view_all');

  useEffect(() => {
    if (!hasManagerAccess) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchProcessingAdminOverview()
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load overview'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hasManagerAccess]);

  if (!hasManagerAccess) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', padding: '40px 20px', textAlign: 'center' }}>
          <ShieldAlert size={40} style={{ color: 'var(--sos-status-warning)' }} />
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>Manager access required</div>
          <div style={{ fontSize: '14px', color: 'var(--sos-text-muted)' }}>
            This dashboard is only accessible to Processing Managers and Senior Officers.
          </div>
        </div>
      </GlassCard>
    );
  }

  if (loading) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 40 }}>
          <Loader2 size={16} className="sos-spin" /> Loading manager overview…
        </div>
      </GlassCard>
    );
  }

  if (error || !data) {
    return (
      <GlassCard variant="panel" padded="md">
        <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>Failed to load overview: {error ?? 'unknown error'}</div>
      </GlassCard>
    );
  }

  const maxOfficerCases = Math.max(...data.officerWorkload.map((o) => o.activeCases), 1);
  const maxStageCases = Math.max(...data.stageBreakdown.map((s) => s.count), 1);
  const workingOfficers = data.officerWorkload.filter((o) => o.activeCases > 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="Processing — Manager"
        title="Manager Dashboard"
        description="Team workload, SLA health, and stage bottlenecks at a glance."
      />

      {/* Primary KPI strip — the spec'd top-line numbers */}
      <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <MetricCard
          label="Active cases"
          value={data.totals.active}
          hint="Across all officers"
          tone="accent"
          Icon={FolderKanban}
        />
        <MetricCard
          label="Awaiting your review"
          value={data.totals.newIntake}
          hint="From Finance — assign"
          tone={data.totals.newIntake > 0 ? 'warning' : 'neutral'}
          Icon={Inbox}
        />
        <MetricCard
          label="Unassigned"
          value={data.totals.unassigned}
          hint={data.totals.unassigned > 0 ? 'Reassign needed' : 'All routed'}
          tone={data.totals.unassigned > 0 ? 'danger' : 'success'}
          Icon={UserX}
        />
        <MetricCard
          label="Officers working"
          value={workingOfficers}
          hint="Carrying caseload"
          tone="info"
          Icon={Users}
        />
        <MetricCard
          label="Pending documents"
          value={data.totals.pendingDocuments}
          hint="Submitted / under review"
          tone={data.totals.pendingDocuments > 0 ? 'warning' : 'success'}
          Icon={FileSearch}
        />
        <MetricCard
          label="Final submission pending"
          value={data.totals.finalSubmissionPending}
          hint="Ready to file"
          tone={data.totals.finalSubmissionPending > 0 ? 'info' : 'neutral'}
          Icon={Send}
        />
        <MetricCard
          label="SLA breached"
          value={data.totals.slaBreached}
          hint="Past deadline"
          tone={data.totals.slaBreached > 0 ? 'danger' : 'success'}
          Icon={AlertTriangle}
        />
        <MetricCard
          label="Approved / refused"
          value={`${data.totals.approved} / ${data.totals.refused}`}
          hint="Lifetime outcomes"
          tone={data.totals.refused > 0 ? 'neutral' : 'success'}
          Icon={CheckCircle2}
        />
      </section>

      {/* Cases by case type — spec'd as a primary breakdown for the manager */}
      {data.casesByType.length > 0 ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Layers size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sos-text-primary)' }}>Cases by case type</div>
            <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--sos-text-muted)' }}>{data.casesByType.length} categor{data.casesByType.length !== 1 ? 'ies' : 'y'}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(() => {
              const maxByType = Math.max(...data.casesByType.map((c) => c.count), 1);
              return data.casesByType.map(({ service, count }) => {
                const pct = Math.round((count / maxByType) * 100);
                return (
                  <Link
                    key={service}
                    href={`/processing/cases?service=${service}` as Route}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', textDecoration: 'none' }}
                  >
                    <div style={{ width: 180, flexShrink: 0, fontSize: 12.5, color: 'var(--sos-text-primary)', fontWeight: 500 }}>
                      {labelForServiceCode(service)}
                    </div>
                    <div style={{ flex: 1, height: 8, background: 'var(--sos-border-subtle)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--sos-brand-primary-strong)', borderRadius: 4, transition: 'width 400ms ease' }} />
                    </div>
                    <div style={{ minWidth: 28, textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{count}</div>
                  </Link>
                );
              });
            })()}
          </div>
        </GlassCard>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px', alignItems: 'start' }}>
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Users size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>Officer Workload</div>
            <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--sos-text-muted)' }}>{data.officerWorkload.length} officer{data.officerWorkload.length !== 1 ? 's' : ''}</div>
          </div>
          {data.officerWorkload.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', padding: '12px 0' }}>No officers with assigned cases.</div>
          ) : (
            data.officerWorkload.map((o) => (
              <OfficerRow key={o.officerId ?? o.name} name={o.name} total={o.activeCases} max={maxOfficerCases} />
            ))
          )}
        </GlassCard>

        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <BarChart3 size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>Stage Breakdown</div>
            <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--sos-text-muted)' }}>{data.totals.active} active</div>
          </div>
          {data.stageBreakdown.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', padding: '12px 0' }}>No active cases yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {data.stageBreakdown.map(({ stage, count }) => (
                <StageBar key={stage} stage={stage} count={count} max={maxStageCases} />
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* SLA breached — live list */}
      {data.breachedCases.length > 0 ? (
        <GlassCard variant="panel" padded="md" style={{ borderLeft: '3px solid var(--sos-status-danger)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <AlertTriangle size={16} style={{ color: 'var(--sos-status-danger)' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>SLA breached cases</div>
            <StatusBadge tone="danger" size="sm" dot={false}>{data.breachedCases.length}</StatusBadge>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--sos-border-subtle)' }}>
                  {['Client', 'Service / Country', 'Stage', 'Officer', 'SLA due', ''].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: h === '' ? 'right' : 'left', fontSize: '10.5px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.breachedCases.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--sos-border-subtle)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap' }}>{c.clientName ?? '—'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>{labelForServiceCode(c.service)} · {c.targetCountry}</td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>
                      {c.officerName ? c.officerName.split(' ')[0] : <span style={{ color: 'var(--sos-status-warning)' }}>Unassigned</span>}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 600, color: 'var(--sos-status-danger)' }}>{c.slaDueAt ? fmtRelative(c.slaDueAt) : '—'}</span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <Link
                        href={`/processing/cases/${c.id}` as Route}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12.5px', fontWeight: 500, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}
                      >
                        Open <ArrowRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      ) : (
        <GlassCard variant="panel" padded="md" style={{ borderLeft: '3px solid var(--sos-status-success)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--sos-status-success)' }}>
            <CheckCircle2 size={18} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>SLA clear</div>
              <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>No active cases past their SLA deadline.</div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Recent intake */}
      {data.recentIntake.length > 0 ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Inbox size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>Recent intake</div>
            <Link href="/processing/intake" style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              View queue <ArrowRight size={12} />
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.recentIntake.map((c) => (
              <Link
                key={c.id}
                href={`/processing/cases/${c.id}` as Route}
                style={{ display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', textDecoration: 'none', alignItems: 'center' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{c.clientName ?? '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{labelForServiceCode(c.service)} · {c.targetCountry} · {fmtRelative(c.createdAt)}</div>
                </div>
                <StatusBadge tone={priorityTone(c.priority)} size="sm">{PRIORITY_LABEL[c.priority]}</StatusBadge>
                <ArrowRight size={12} style={{ color: 'var(--sos-text-muted)' }} />
              </Link>
            ))}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}
