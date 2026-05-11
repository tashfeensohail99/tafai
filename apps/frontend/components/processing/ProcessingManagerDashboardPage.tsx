'use client';
// Processing Manager Dashboard — Phase 2C-4.
// Shows team workload, SLA breaches, stage bottlenecks, and stuck cases.
// Backend: GET /processing/manager/dashboard (requires processing.case.view_all)
// Frontend: uses mock data; replace with API call in production.

import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  FolderKanban,
  ShieldAlert,
  User,
  Users,
} from 'lucide-react';
import {
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  MOCK_PROCESSING_CASES,
  MOCK_CORRECTIONS,
  STAGE_LABEL,
  type ProcessingStage,
} from '@/components/processing/mockData';
import { stageTone, priorityTone } from './ProcessingDashboardPage';
import { useProcessingSession } from '@/components/layout/ProcessingShell';

// ---------- Derived data helpers -------------------------------------------

const ACTIVE_STAGES: ProcessingStage[] = [
  'DOCUMENTS_COLLECTION',
  'DOCUMENTS_UNDER_REVIEW',
  'DOCUMENTS_INCOMPLETE',
  'DOCUMENTS_COMPLETE',
  'READY_FOR_SUBMISSION',
  'SUBMITTED',
  'UNDER_AUTHORITY_REVIEW',
  'ADDITIONAL_INFO_REQUESTED',
  'DECISION_RECEIVED',
];

/** Returns active cases (not COMPLETED, not CANCELLED, not INTAKE_PENDING) */
function getActiveCases() {
  return MOCK_PROCESSING_CASES.filter((c) => ACTIVE_STAGES.includes(c.stage));
}

/** Group cases by officer, return sorted by case count desc */
function getOfficerWorkload() {
  const activeCases = getActiveCases();
  const map = new Map<string, { name: string; cases: typeof activeCases }>();

  for (const c of activeCases) {
    const key = c.assignedOfficer?.id ?? 'unassigned';
    const name = c.assignedOfficer?.name ?? 'Unassigned';
    if (!map.has(key)) map.set(key, { name, cases: [] });
    map.get(key)!.cases.push(c);
  }

  return Array.from(map.values())
    .map(({ name, cases }) => {
      const stuck = cases.filter((c) => c.daysInCurrentStage >= 7).length;
      const avgDays = cases.length
        ? Math.round(cases.reduce((s, c) => s + c.daysInCurrentStage, 0) / cases.length)
        : 0;
      return { name, total: cases.length, stuck, avgDays };
    })
    .sort((a, b) => b.total - a.total);
}

/** Get stage breakdown for active cases */
function getStageBreakdown() {
  const activeCases = getActiveCases();
  const counts = new Map<ProcessingStage, number>();
  for (const c of activeCases) {
    counts.set(c.stage, (counts.get(c.stage) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);
}

/** Get stuck cases (daysInCurrentStage >= 7) */
function getStuckCases() {
  return MOCK_PROCESSING_CASES.filter(
    (c) => ACTIVE_STAGES.includes(c.stage) && c.daysInCurrentStage >= 7,
  ).sort((a, b) => b.daysInCurrentStage - a.daysInCurrentStage);
}

/** Get overdue corrections (SENT or IN_PROGRESS past SLA) */
function getOverdueCorrections() {
  const now = new Date();
  return MOCK_CORRECTIONS.filter(
    (c) =>
      (c.status === 'SENT' || c.status === 'IN_PROGRESS') &&
      new Date(c.slaDueAt) < now,
  );
}

// ---------- Officer workload row -------------------------------------------

interface OfficerWorkloadRowProps {
  name: string;
  total: number;
  stuck: number;
  avgDays: number;
  maxTotal: number;
}

function OfficerWorkloadRow({ name, total, stuck, avgDays, maxTotal }: OfficerWorkloadRowProps) {
  const barPct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--sos-border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--sos-brand-primary-soft)', border: '1px solid var(--sos-brand-primary-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <User size={14} style={{ color: 'var(--sos-brand-primary-strong)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{name}</div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ textAlign: 'center', minWidth: '36px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sos-text-primary)', lineHeight: 1 }}>{total}</div>
            <div style={{ fontSize: '10.5px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>cases</div>
          </div>
          <div style={{ textAlign: 'center', minWidth: '36px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: stuck > 0 ? 'var(--sos-status-warning)' : 'var(--sos-text-muted)', lineHeight: 1 }}>{stuck}</div>
            <div style={{ fontSize: '10.5px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>stuck</div>
          </div>
          <div style={{ textAlign: 'center', minWidth: '46px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: avgDays >= 7 ? 'var(--sos-status-warning)' : 'var(--sos-text-muted)', lineHeight: 1 }}>{avgDays}d</div>
            <div style={{ fontSize: '10.5px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>avg days</div>
          </div>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: '4px', borderRadius: '2px', background: 'var(--sos-border-subtle)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${barPct}%`, background: 'var(--sos-brand-primary-strong)', borderRadius: '2px', transition: 'width 400ms ease' }} />
      </div>
    </div>
  );
}

// ---------- Stage breakdown bar --------------------------------------------

interface StageBarProps {
  stage: ProcessingStage;
  count: number;
  maxCount: number;
}

function StageBar({ stage, count, maxCount }: StageBarProps) {
  const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
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

// ---------- Main page ------------------------------------------------------

export function ProcessingManagerDashboardPage() {
  const { user } = useProcessingSession();

  // Permission gate
  if (!user.permissions.includes('processing.case.view_all')) {
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

  const activeCases = getActiveCases();
  const officerWorkload = getOfficerWorkload();
  const stageBreakdown = getStageBreakdown();
  const stuckCases = getStuckCases();
  const overdueCorrections = getOverdueCorrections();
  const intakePending = MOCK_PROCESSING_CASES.filter((c) => c.stage === 'INTAKE_PENDING').length;
  const maxOfficerCases = Math.max(...officerWorkload.map((o) => o.total), 1);
  const maxStageCases = Math.max(...stageBreakdown.map((s) => s.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="Processing — Manager"
        title="Manager Dashboard"
        description="Team workload, SLA health, and stage bottlenecks at a glance."
      />

      {/* KPI strip */}
      <section style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <MetricCard
          label="Active cases"
          value={activeCases.length}
          hint="Across all officers"
          tone="accent"
          Icon={FolderKanban}
          footer="Live caseload"
        />
        <MetricCard
          label="Officers working"
          value={officerWorkload.filter((o) => o.name !== 'Unassigned').length}
          hint="With active caseloads"
          tone="info"
          Icon={Users}
          footer="Active team members"
        />
        <MetricCard
          label="Stuck cases"
          value={stuckCases.length}
          hint="7+ days in current stage"
          tone={stuckCases.length > 0 ? 'warning' : 'neutral'}
          Icon={Clock}
          footer={stuckCases.length > 0 ? 'Needs review' : 'All on track'}
        />
        <MetricCard
          label="Overdue corrections"
          value={overdueCorrections.length}
          hint="Past SLA deadline"
          tone={overdueCorrections.length > 0 ? 'danger' : 'neutral'}
          Icon={AlertTriangle}
          footer={overdueCorrections.length > 0 ? 'Escalate if needed' : 'SLA clear'}
        />
        <MetricCard
          label="Awaiting intake"
          value={intakePending}
          hint="Unacknowledged from Finance"
          tone={intakePending > 0 ? 'warning' : 'neutral'}
          Icon={FolderKanban}
          footer={intakePending > 0 ? 'Assign to officer' : 'None pending'}
        />
      </section>

      {/* Officer workload + Stage breakdown — side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px', alignItems: 'start' }}>
        {/* Officer Workload */}
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Users size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>Officer Workload</div>
            <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--sos-text-muted)' }}>{officerWorkload.length} officer{officerWorkload.length !== 1 ? 's' : ''}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '0 12px', padding: '6px 0 10px 42px', fontSize: '10.5px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--sos-border-subtle)', marginBottom: '4px' }}>
            <span></span>
            <span>Cases</span>
            <span>Stuck</span>
            <span>Avg days</span>
          </div>
          {officerWorkload.map((o) => (
            <OfficerWorkloadRow
              key={o.name}
              name={o.name}
              total={o.total}
              stuck={o.stuck}
              avgDays={o.avgDays}
              maxTotal={maxOfficerCases}
            />
          ))}
        </GlassCard>

        {/* Stage Breakdown */}
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <BarChart3 size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>Stage Breakdown</div>
            <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--sos-text-muted)' }}>{activeCases.length} active</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {stageBreakdown.map(({ stage, count }) => (
              <StageBar key={stage} stage={stage} count={count} maxCount={maxStageCases} />
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Stuck cases */}
      {stuckCases.length > 0 ? (
        <GlassCard variant="panel" padded="md" style={{ borderLeft: '3px solid var(--sos-status-warning)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Clock size={16} style={{ color: 'var(--sos-status-warning)' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              Stuck Cases — 7+ days in stage
            </div>
            <StatusBadge tone="warning" size="sm" dot={false}>{stuckCases.length}</StatusBadge>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--sos-border-subtle)' }}>
                  {['Client', 'Service / Country', 'Stage', 'Officer', 'Days stuck', ''].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: h === '' ? 'right' : 'left', fontSize: '10.5px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stuckCases.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--sos-border-subtle)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap' }}>{c.clientName}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>{c.service} · {c.targetCountry}</td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>
                      {c.assignedOfficer ? c.assignedOfficer.name.split(' ')[0] : <span style={{ color: 'var(--sos-status-warning)' }}>Unassigned</span>}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 700, color: c.daysInCurrentStage >= 14 ? 'var(--sos-status-danger)' : 'var(--sos-status-warning)', fontSize: '13.5px' }}>
                        {c.daysInCurrentStage}d
                      </span>
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
              <div style={{ fontSize: '14px', fontWeight: 600 }}>No stuck cases</div>
              <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>All active cases have moved within the last 7 days.</div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Overdue corrections */}
      {overdueCorrections.length > 0 ? (
        <GlassCard variant="panel" padded="md" style={{ borderLeft: '3px solid var(--sos-status-danger)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <AlertTriangle size={16} style={{ color: 'var(--sos-status-danger)' }} />
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              Overdue Correction Requests
            </div>
            <StatusBadge tone="danger" size="sm" dot={false}>{overdueCorrections.length}</StatusBadge>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {overdueCorrections.map((corr) => (
              <div
                key={corr.id}
                style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)' }}
              >
                <AlertTriangle size={14} style={{ color: 'var(--sos-status-danger)', flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{corr.subject}</div>
                  <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '3px' }}>
                    Case {corr.caseId} · SLA was due {new Date(corr.slaDueAt).toLocaleDateString()}
                    {corr.documentName ? ` · ${corr.documentName}` : ''}
                  </div>
                </div>
                <Link
                  href={`/processing/cases/${corr.caseId}` as Route}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12.5px', fontWeight: 500, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none', flexShrink: 0 }}
                >
                  Open <ArrowRight size={12} />
                </Link>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}
