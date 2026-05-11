'use client';
// Processing Reports — Phase 1G-F1.
// Tabbed report viewer: Workload / Throughput / Doc Quality / SLA / Expiry Risk.
// All data is mock; wires to GET /processing/reports/* once backend is live.

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  BarChart2,
  CalendarRange,
  CheckCircle2,
  Clock,
  Download,
  FileWarning,
  ShieldAlert,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  MOCK_WORKLOAD_REPORT,
  MOCK_THROUGHPUT_REPORT,
  MOCK_DOC_QUALITY_REPORT,
  MOCK_SLA_REPORT,
  MOCK_EXPIRY_RISK_REPORT,
  STAGE_LABEL,
  PRIORITY_LABEL,
  fmtDate,
  type ProcessingStage,
  type ProcessingPriority,
  type WorkloadOfficerRow,
  type ThroughputWeekRow,
  type DocQualityDocRow,
  type OverdueCorrectionRow,
  type AgingCaseRow,
  type ExpiryRiskRow,
} from '@/components/processing/mockData';
import { stageTone, priorityTone } from './ProcessingDashboardPage';

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

type ReportTab = 'workload' | 'throughput' | 'doc-quality' | 'sla' | 'expiry-risk';

const REPORT_TABS: { key: ReportTab; label: string; Icon: React.ElementType }[] = [
  { key: 'workload',     label: 'Workload',     Icon: Users        },
  { key: 'throughput',   label: 'Throughput',   Icon: TrendingUp   },
  { key: 'doc-quality',  label: 'Doc Quality',  Icon: BarChart2    },
  { key: 'sla',          label: 'SLA',          Icon: ShieldAlert  },
  { key: 'expiry-risk',  label: 'Expiry Risk',  Icon: FileWarning  },
];

// ---------------------------------------------------------------------------
// Shared mini-bar for visual proportion
// ---------------------------------------------------------------------------

function MiniBar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const colors: Record<string, string> = {
    success: 'var(--sos-status-success)',
    danger:  'var(--sos-status-danger)',
    warning: 'var(--sos-status-warning)',
    neutral: 'var(--sos-brand-primary)',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '6px', background: 'var(--sos-surface-2)', borderRadius: '9999px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: colors[tone] ?? colors.neutral, borderRadius: '9999px', transition: 'width 300ms' }} />
      </div>
      <span style={{ fontSize: '11px', color: 'var(--sos-text-muted)', minWidth: '28px', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WORKLOAD TAB
// ---------------------------------------------------------------------------

function WorkloadTab() {
  const { rows, from, to } = MOCK_WORKLOAD_REPORT;
  const maxCases = Math.max(...rows.map((r) => r.caseCount), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>
        Period: {fmtDate(from)} – {fmtDate(to)}
      </div>

      {rows.map((row) => (
        <GlassCard key={row.officerId ?? 'unassigned'} variant="default" padded="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Officer name */}
            <div style={{ minWidth: '160px', flex: '1' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '2px' }}>
                {row.officerName}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>
                Avg {row.avgDaysOpen} days open per case
              </div>
            </div>

            {/* Case count bar */}
            <div style={{ flex: 2, minWidth: '160px' }}>
              <div style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '4px' }}>
                {row.caseCount} case{row.caseCount !== 1 ? 's' : ''}
              </div>
              <MiniBar value={row.caseCount} max={maxCases} tone="neutral" />
            </div>

            {/* Stage breakdown */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {Object.entries(row.stageCounts).map(([stage, count]) => (
                <StatusBadge key={stage} tone={stageTone(stage as ProcessingStage)} size="sm">
                  {STAGE_LABEL[stage as ProcessingStage]}: {count}
                </StatusBadge>
              ))}
            </div>
          </div>
        </GlassCard>
      ))}

      {rows.length === 0 && (
        <EmptyState Icon={Users} title="No workload data" description="No cases in this date range." />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// THROUGHPUT TAB
// ---------------------------------------------------------------------------

function ThroughputTab() {
  const { weeks, from, to, totalClosed } = MOCK_THROUGHPUT_REPORT;
  const maxTotal = Math.max(...weeks.map((w) => w.total), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '4px' }}>
        <MetricCard label="Total closed" value={String(totalClosed)} hint="In date range" Icon={CheckCircle2} tone="neutral" />
        <MetricCard label="Completed"    value={String(weeks.reduce((s, w) => s + w.completed, 0))} hint="" Icon={CheckCircle2} tone="success" />
        <MetricCard label="Cancelled"    value={String(weeks.reduce((s, w) => s + w.cancelled, 0))} hint="" Icon={XCircle} tone="neutral" />
        <MetricCard label="Rejected"     value={String(weeks.reduce((s, w) => s + w.rejected, 0))}  hint="" Icon={XCircle} tone="danger" />
      </div>

      <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>
        Period: {fmtDate(from)} – {fmtDate(to)} · Weekly breakdown
      </div>

      {weeks.map((w) => (
        <GlassCard key={w.week} variant="default" padded="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ minWidth: '90px', fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{w.week}</div>
            <div style={{ flex: 1, minWidth: '160px' }}>
              <MiniBar value={w.total} max={maxTotal} tone="neutral" />
            </div>
            <div style={{ display: 'flex', gap: '10px', fontSize: '12.5px' }}>
              <span style={{ color: 'var(--sos-status-success)' }}>✓ {w.completed}</span>
              <span style={{ color: 'var(--sos-text-muted)'    }}>✕ {w.cancelled}</span>
              <span style={{ color: 'var(--sos-status-danger)' }}>✗ {w.rejected}</span>
            </div>
          </div>
        </GlassCard>
      ))}

      {weeks.length === 0 && (
        <EmptyState Icon={TrendingUp} title="No throughput data" description="No closed cases in this date range." />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DOC QUALITY TAB
// ---------------------------------------------------------------------------

function DocQualityTab() {
  const { documents, topReasonCodes, from, to } = MOCK_DOC_QUALITY_REPORT;
  const maxRejections = Math.max(...documents.map((d) => d.rejected), 1);
  const maxReasonCount = topReasonCodes[0]?.count ?? 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Period: {fmtDate(from)} – {fmtDate(to)}</div>

      {/* Per-document rejection rates */}
      <div>
        <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Rejection rate by document
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {documents.map((doc) => (
            <GlassCard key={doc.documentName} variant="default" padded="md">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ minWidth: '160px', flex: 1 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '3px' }}>{doc.documentName}</div>
                  <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{doc.total} reviewed · {doc.accepted} accepted · {doc.rejected} rejected</div>
                </div>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <MiniBar value={doc.rejected} max={maxRejections} tone={doc.rejectionRate >= 30 ? 'danger' : doc.rejectionRate >= 15 ? 'warning' : 'success'} />
                </div>
                <StatusBadge
                  tone={doc.rejectionRate >= 30 ? 'danger' : doc.rejectionRate >= 15 ? 'warning' : 'success'}
                  size="sm"
                >
                  {doc.rejectionRate}% rejected
                </StatusBadge>
              </div>
              {doc.topReasonCodes.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--sos-border-subtle)' }}>
                  {doc.topReasonCodes.map(({ code, count }) => (
                    <span key={code} style={{ padding: '2px 8px', borderRadius: '9999px', background: 'var(--sos-surface-2)', fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>
                      {code.replace(/_/g, ' ')} × {count}
                    </span>
                  ))}
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      </div>

      {/* Top reason codes globally */}
      <div>
        <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Top rejection reason codes (all documents)
        </div>
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {topReasonCodes.map(({ code, count }) => (
              <div key={code} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 32px', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12.5px', color: 'var(--sos-text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>{code}</span>
                <MiniBar value={count} max={maxReasonCount} tone="danger" />
                <span style={{ fontSize: '12px', color: 'var(--sos-text-muted)', textAlign: 'right' }}>{count}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SLA TAB
// ---------------------------------------------------------------------------

function SlaTab() {
  const { overdueCorrections, agingCases, summary } = MOCK_SLA_REPORT;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
        <MetricCard label="Overdue corrections" value={String(summary.overdueCount)} hint="Past SLA due date" Icon={Clock}          tone={summary.overdueCount > 0 ? 'danger' : 'success'} />
        <MetricCard label="Aging 30–60 days"    value={String(summary.aging30to60)}  hint="Open cases"       Icon={AlertTriangle}  tone={summary.aging30to60 > 0 ? 'warning' : 'neutral'} />
        <MetricCard label="Aging 60–90 days"    value={String(summary.aging60to90)}  hint="Open cases"       Icon={AlertTriangle}  tone={summary.aging60to90 > 0 ? 'danger'  : 'neutral'} />
        <MetricCard label="Aging 90+ days"      value={String(summary.aging90plus)}  hint="Open cases"       Icon={ShieldAlert}    tone={summary.aging90plus > 0 ? 'danger'  : 'neutral'} />
      </div>

      {/* Overdue corrections */}
      <div>
        <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Overdue correction requests
        </div>
        {overdueCorrections.length === 0 ? (
          <GlassCard variant="panel" padded="md">
            <EmptyState Icon={CheckCircle2} title="No overdue corrections" description="All open correction requests are within SLA." />
          </GlassCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {overdueCorrections.map((cr) => (
              <GlassCard key={cr.correctionId} variant="default" padded="md" style={{ borderLeft: '3px solid var(--sos-status-danger)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '160px' }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '3px' }}>{cr.subject}</div>
                    <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Raised by {cr.raisedByName} · Due {fmtDate(cr.slaDueAt)}</div>
                  </div>
                  <StatusBadge tone="danger" size="sm">{cr.hoursOverdue}h overdue</StatusBadge>
                  <Link
                    href={`/processing/cases/${cr.caseId}` as Route}
                    style={{ fontSize: '12px', color: 'var(--sos-brand-primary)', textDecoration: 'none', fontWeight: 600 }}
                  >
                    Open case →
                  </Link>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      {/* Aging cases */}
      <div>
        <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Long-running open cases
        </div>
        {agingCases.length === 0 ? (
          <GlassCard variant="panel" padded="md">
            <EmptyState Icon={CheckCircle2} title="No aging cases" description="All active cases are under 30 days old." />
          </GlassCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {agingCases.map((c) => {
              const bucketTone: BadgeTone = c.bucket === '90+' ? 'danger' : c.bucket === '60-90' ? 'warning' : 'neutral';
              return (
                <GlassCard key={c.caseId} variant="default" padded="md">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '160px' }}>
                      <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '3px' }}>
                        {c.service} · {c.targetCountry}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{c.officerName} · {c.daysOpen} days open</div>
                    </div>
                    <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
                    <StatusBadge tone={priorityTone(c.priority)} size="sm">{PRIORITY_LABEL[c.priority]}</StatusBadge>
                    <StatusBadge tone={bucketTone} size="sm">{c.bucket} days</StatusBadge>
                    <Link
                      href={`/processing/cases/${c.caseId}` as Route}
                      style={{ fontSize: '12px', color: 'var(--sos-brand-primary)', textDecoration: 'none', fontWeight: 600 }}
                    >
                      Open →
                    </Link>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EXPIRY RISK TAB
// ---------------------------------------------------------------------------

function ExpiryRiskTab() {
  const { rows, summary, generatedAt } = MOCK_EXPIRY_RISK_REPORT;

  const bucketOrder = ['expired', '0-30', '31-60', '61-90'] as const;
  const bucketLabel: Record<string, string> = {
    expired: 'Already expired',
    '0-30':  'Expires in 0–30 days',
    '31-60': 'Expires in 31–60 days',
    '61-90': 'Expires in 61–90 days',
  };
  const bucketTone: Record<string, BadgeTone> = {
    expired: 'danger',
    '0-30':  'warning',
    '31-60': 'warm',
    '61-90': 'neutral',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
        <MetricCard label="Expired"           value={String(summary.expired)}  hint="Already past expiry" Icon={XCircle}      tone={summary.expired  > 0 ? 'danger'  : 'neutral'} />
        <MetricCard label="Expiring ≤ 30 days" value={String(summary.within30)} hint="Urgent action needed" Icon={FileWarning} tone={summary.within30 > 0 ? 'warning' : 'neutral'} />
        <MetricCard label="Expiring ≤ 60 days" value={String(summary.within60)} hint="Monitor closely"       Icon={Clock}       tone={summary.within60 > 0 ? 'warm'    : 'neutral'} />
        <MetricCard label="Expiring ≤ 90 days" value={String(summary.within90)} hint="Heads up"              Icon={CalendarRange} tone="neutral" />
      </div>

      <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Generated at {fmtDate(generatedAt)}</div>

      {/* Grouped by bucket */}
      {bucketOrder.map((bucket) => {
        const bucketRows = rows.filter((r) => r.bucket === bucket);
        if (bucketRows.length === 0) return null;
        return (
          <div key={bucket}>
            <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {bucketLabel[bucket]} ({bucketRows.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {bucketRows.map((row) => (
                <GlassCard
                  key={row.documentItemId}
                  variant="default"
                  padded="md"
                  style={{ borderLeft: `3px solid var(--sos-status-${bucket === 'expired' ? 'danger' : bucket === '0-30' ? 'warning' : 'info'})` }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '160px' }}>
                      <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '3px' }}>{row.documentName}</div>
                      <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>
                        {row.service} · {row.targetCountry} · {row.officerName}
                      </div>
                    </div>
                    <StatusBadge tone={bucketTone[bucket]} size="sm">
                      {row.daysUntilExpiry < 0
                        ? `${Math.abs(row.daysUntilExpiry)}d expired`
                        : `${row.daysUntilExpiry}d left`}
                    </StatusBadge>
                    <StatusBadge tone={row.criticality === 'CRITICAL' ? 'danger' : row.criticality === 'REQUIRED' ? 'warning' : 'neutral'} size="sm">
                      {row.criticality}
                    </StatusBadge>
                    <Link
                      href={`/processing/cases/${row.caseId}` as Route}
                      style={{ fontSize: '12px', color: 'var(--sos-brand-primary)', textDecoration: 'none', fontWeight: 600 }}
                    >
                      Open →
                    </Link>
                  </div>
                </GlassCard>
              ))}
            </div>
          </div>
        );
      })}

      {rows.length === 0 && (
        <GlassCard variant="panel" padded="lg">
          <EmptyState Icon={CheckCircle2} title="No expiring documents" description="No document items expiring within the next 90 days." />
        </GlassCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ProcessingReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('workload');

  function handleExport() {
    // Build query params matching the active tab and navigate to the export URL.
    // The endpoint streams a CSV with Content-Disposition: attachment so the browser
    // downloads it directly.  Authentication token must be attached for production;
    // here we construct the URL and open it in the same tab.
    const params = new URLSearchParams({ reportType: activeTab });
    const url = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/processing/reports/export?${params.toString()}`;
    window.open(url, '_self');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Processing Reports"
        description="Workload distribution, case throughput, document quality, SLA health, and document expiry risk."
        actions={
          <SecondaryButton
            iconLeft={<Download size={14} />}
            onClick={handleExport}
          >
            Export CSV
          </SecondaryButton>
        }
      />

      {/* Tab bar */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {REPORT_TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '7px 14px',
                borderRadius: 'var(--sos-radius-md)',
                border: 'none',
                background: activeTab === key ? 'var(--sos-brand-primary-strong)' : 'transparent',
                color: activeTab === key ? '#fff' : 'var(--sos-text-secondary)',
                fontSize: '13px',
                fontWeight: activeTab === key ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 150ms',
                whiteSpace: 'nowrap',
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </GlassCard>

      {/* Report content */}
      {activeTab === 'workload'    && <WorkloadTab    />}
      {activeTab === 'throughput'  && <ThroughputTab  />}
      {activeTab === 'doc-quality' && <DocQualityTab  />}
      {activeTab === 'sla'         && <SlaTab         />}
      {activeTab === 'expiry-risk' && <ExpiryRiskTab  />}
    </div>
  );
}
