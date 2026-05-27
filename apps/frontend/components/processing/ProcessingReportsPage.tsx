'use client';
// Processing Reports — wired to /processing/reports/*.
// Tabbed report viewer: Workload / Throughput / Doc Quality / SLA / Expiry Risk.
// Each tab fetches its own data on demand. Date-range filter applies across tabs.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  BarChart2,
  Download,
  FileWarning,
  Loader2,
  ShieldAlert,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import { STAGE_LABEL, PRIORITY_LABEL, fmtDate } from '@/components/processing/mockData';
import { stageTone, priorityTone } from './ProcessingDashboardPage';
import {
  fetchWorkloadReport,
  fetchThroughputReport,
  fetchDocQualityReport,
  fetchSlaReport,
  fetchExpiryRiskReport,
  type ApiWorkloadReport,
  type ApiThroughputReport,
  type ApiDocQualityReport,
  type ApiSlaReport,
  type ApiExpiryRiskReport,
  type ReportDateRangeQuery,
} from '@/lib/processing';
import { labelForServiceCode } from '@/lib/service-types';

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

type ReportTab = 'workload' | 'throughput' | 'doc-quality' | 'sla' | 'expiry-risk';

const REPORT_TABS: { key: ReportTab; label: string; Icon: React.ElementType }[] = [
  { key: 'workload',     label: 'Workload',     Icon: Users        },
  { key: 'throughput',   label: 'Throughput',   Icon: TrendingUp   },
  { key: 'doc-quality',  label: 'Doc Quality',  Icon: BarChart2    },
  { key: 'sla',          label: 'SLA',          Icon: ShieldAlert  },
  { key: 'expiry-risk',  label: 'Expiry Risk',  Icon: FileWarning  },
];

function MiniBar({ value, max, tone = 'neutral' }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const colors: Record<string, string> = {
    success: 'var(--sos-status-success)',
    danger:  'var(--sos-status-danger)',
    warning: 'var(--sos-status-warning)',
    neutral: 'var(--sos-brand-primary)',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--sos-surface-2)', borderRadius: 9999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: colors[tone] ?? colors.neutral, borderRadius: 9999, transition: 'width 300ms' }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--sos-text-muted)', minWidth: 28, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function LoadingShell({ label }: { label: string }) {
  return (
    <GlassCard variant="panel" padded="lg">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24, fontSize: 13 }}>
        <Loader2 size={16} className="sos-spin" /> {label}
      </div>
    </GlassCard>
  );
}

function ErrorShell({ err }: { err: string }) {
  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>Failed to load report: {err}</div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function WorkloadTab({ q }: { q: ReportDateRangeQuery }) {
  const [data, setData] = useState<ApiWorkloadReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setData(null);
    fetchWorkloadReport(q)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed'); });
    return () => { cancelled = true; };
  }, [q]);

  if (err) return <ErrorShell err={err} />;
  if (!data) return <LoadingShell label="Loading workload…" />;
  const maxCases = Math.max(...data.rows.map((r) => r.caseCount), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
        Period: {fmtDate(data.from)} – {fmtDate(data.to)} · {data.rows.length} officer{data.rows.length !== 1 ? 's' : ''}
      </div>
      {data.rows.length === 0 ? (
        <GlassCard variant="panel" padded="md"><div style={{ fontSize: 13, color: 'var(--sos-text-muted)' }}>No activity in this range.</div></GlassCard>
      ) : (
        data.rows.map((r) => (
          <GlassCard key={r.officerId ?? 'unassigned'} variant="default" padded="md">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 160, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{r.officerName}</div>
                <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>Avg {r.avgDaysOpen} days open per case</div>
              </div>
              <div style={{ minWidth: 200, flex: 1 }}>
                <MiniBar value={r.caseCount} max={maxCases} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                {Object.entries(r.stageCounts).slice(0, 3).map(([s, n]) => `${STAGE_LABEL[s as keyof typeof STAGE_LABEL] ?? s}: ${n}`).join(' · ')}
              </div>
            </div>
          </GlassCard>
        ))
      )}
    </div>
  );
}

function ThroughputTab({ q }: { q: ReportDateRangeQuery }) {
  const [data, setData] = useState<ApiThroughputReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setData(null);
    fetchThroughputReport(q)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed'); });
    return () => { cancelled = true; };
  }, [q]);

  if (err) return <ErrorShell err={err} />;
  if (!data) return <LoadingShell label="Loading throughput…" />;
  const max = Math.max(...data.weeks.map((w) => w.total), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
        Period: {fmtDate(data.from)} – {fmtDate(data.to)} · {data.totalClosed} cases closed
      </div>
      {data.weeks.length === 0 ? (
        <GlassCard variant="panel" padded="md"><div style={{ fontSize: 13, color: 'var(--sos-text-muted)' }}>No closures in this range.</div></GlassCard>
      ) : (
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 60px 60px 60px 60px', gap: 8, padding: '6px 0 8px 0', fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
            <span>Week</span>
            <span></span>
            <span style={{ textAlign: 'right' }}>Comp</span>
            <span style={{ textAlign: 'right' }}>Canc</span>
            <span style={{ textAlign: 'right' }}>Rej</span>
            <span style={{ textAlign: 'right' }}>Total</span>
          </div>
          {data.weeks.map((w) => (
            <div key={w.week} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 60px 60px 60px 60px', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--sos-border-subtle)', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--sos-text-primary)' }}>{w.week}</span>
              <MiniBar value={w.total} max={max} />
              <span style={{ fontSize: 12.5, textAlign: 'right', color: 'var(--sos-status-success)' }}>{w.completed}</span>
              <span style={{ fontSize: 12.5, textAlign: 'right', color: 'var(--sos-text-muted)' }}>{w.cancelled}</span>
              <span style={{ fontSize: 12.5, textAlign: 'right', color: 'var(--sos-status-danger)' }}>{w.rejected}</span>
              <span style={{ fontSize: 12.5, textAlign: 'right', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{w.total}</span>
            </div>
          ))}
        </GlassCard>
      )}
    </div>
  );
}

function DocQualityTab({ q }: { q: ReportDateRangeQuery }) {
  const [data, setData] = useState<ApiDocQualityReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setData(null);
    fetchDocQualityReport(q)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed'); });
    return () => { cancelled = true; };
  }, [q]);

  if (err) return <ErrorShell err={err} />;
  if (!data) return <LoadingShell label="Loading doc quality…" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>Period: {fmtDate(data.from)} – {fmtDate(data.to)}</div>

      {data.topReasonCodes.length > 0 ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--sos-text-primary)' }}>Top rejection reason codes</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {data.topReasonCodes.map((c) => (
              <StatusBadge key={c.code} tone="danger" size="sm" dot={false}>{c.code} · {c.count}</StatusBadge>
            ))}
          </div>
        </GlassCard>
      ) : null}

      {data.documents.length === 0 ? (
        <GlassCard variant="panel" padded="md"><div style={{ fontSize: 13, color: 'var(--sos-text-muted)' }}>No document reviews in this range.</div></GlassCard>
      ) : (
        <GlassCard variant="panel" padded={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 60px 60px 100px 80px', gap: 8, padding: '9px 14px', fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
            <span>Document</span>
            <span style={{ textAlign: 'right' }}>Acc</span>
            <span style={{ textAlign: 'right' }}>Rej</span>
            <span>Rejection rate</span>
            <span style={{ textAlign: 'right' }}>Total</span>
          </div>
          {data.documents.map((d) => (
            <div key={d.documentName} style={{ display: 'grid', gridTemplateColumns: '2fr 60px 60px 100px 80px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--sos-border-subtle)', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{d.documentName}</div>
                {d.topReasonCodes.length > 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginTop: 2 }}>
                    Top: {d.topReasonCodes.slice(0, 3).map((r) => `${r.code} (${r.count})`).join(' · ')}
                  </div>
                ) : null}
              </div>
              <span style={{ fontSize: 12.5, textAlign: 'right', color: 'var(--sos-status-success)' }}>{d.accepted}</span>
              <span style={{ fontSize: 12.5, textAlign: 'right', color: 'var(--sos-status-danger)' }}>{d.rejected}</span>
              <MiniBar value={d.rejectionRate} max={100} tone={d.rejectionRate >= 50 ? 'danger' : d.rejectionRate >= 25 ? 'warning' : 'success'} />
              <span style={{ fontSize: 12.5, textAlign: 'right', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{d.total}</span>
            </div>
          ))}
        </GlassCard>
      )}
    </div>
  );
}

function SlaTab({ q }: { q: ReportDateRangeQuery }) {
  const [data, setData] = useState<ApiSlaReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setData(null);
    fetchSlaReport(q)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed'); });
    return () => { cancelled = true; };
  }, [q]);

  if (err) return <ErrorShell err={err} />;
  if (!data) return <LoadingShell label="Loading SLA…" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <SlaKpi label="Overdue corrections" value={data.summary.overdueCount} tone="danger" />
        <SlaKpi label="Aging 30-60 days" value={data.summary.aging30to60} tone="warning" />
        <SlaKpi label="Aging 60-90 days" value={data.summary.aging60to90} tone="warning" />
        <SlaKpi label="Aging 90+ days" value={data.summary.aging90plus} tone="danger" />
      </div>

      {data.overdueCorrections.length > 0 ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--sos-text-primary)' }}>Overdue correction requests</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.overdueCorrections.map((c) => (
              <Link key={c.correctionId} href={`/processing/cases/${c.caseId}` as Route} style={{ display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', textDecoration: 'none', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{c.subject}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{c.status} · raised by {c.raisedByName}</div>
                </div>
                {c.hoursOverdue != null ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-status-danger)' }}>{c.hoursOverdue}h overdue</span>
                ) : null}
              </Link>
            ))}
          </div>
        </GlassCard>
      ) : null}

      {data.agingCases.length > 0 ? (
        <GlassCard variant="panel" padded={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px 80px', gap: 8, padding: '9px 14px', fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
            <span>Service / country</span>
            <span>Stage</span>
            <span>Priority</span>
            <span>Officer</span>
            <span style={{ textAlign: 'right' }}>Days</span>
            <span></span>
          </div>
          {data.agingCases.map((c) => (
            <div key={c.caseId} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px 80px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--sos-border-subtle)', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--sos-text-primary)' }}>{labelForServiceCode(c.service)} · {c.targetCountry}</span>
              <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
              <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
              <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>{c.officerName}</span>
              <span style={{ fontSize: 12.5, textAlign: 'right', fontWeight: 600, color: c.bucket === '90+' ? 'var(--sos-status-danger)' : 'var(--sos-status-warning)' }}>{c.daysOpen}d</span>
              <Link href={`/processing/cases/${c.caseId}` as Route} style={{ fontSize: 12.5, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}>Open →</Link>
            </div>
          ))}
        </GlassCard>
      ) : null}

      {data.agingCases.length === 0 && data.overdueCorrections.length === 0 ? (
        <GlassCard variant="panel" padded="md"><div style={{ fontSize: 13, color: 'var(--sos-text-muted)' }}>No SLA issues right now.</div></GlassCard>
      ) : null}
    </div>
  );
}

function SlaKpi({ label, value, tone }: { label: string; value: number; tone: 'danger' | 'warning' }) {
  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: value > 0 ? `var(--sos-status-${tone})` : 'var(--sos-text-primary)' }}>{value}</div>
    </GlassCard>
  );
}

function ExpiryRiskTab({ q }: { q: ReportDateRangeQuery }) {
  const [data, setData] = useState<ApiExpiryRiskReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setData(null);
    fetchExpiryRiskReport(q)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed'); });
    return () => { cancelled = true; };
  }, [q]);

  if (err) return <ErrorShell err={err} />;
  if (!data) return <LoadingShell label="Loading expiry risk…" />;

  if (data.rows.length === 0) {
    return <GlassCard variant="panel" padded="md"><div style={{ fontSize: 13, color: 'var(--sos-text-muted)' }}>No documents expiring in the next 90 days.</div></GlassCard>;
  }

  const buckets: Array<'expired' | '0-30' | '31-60' | '61-90'> = ['expired', '0-30', '31-60', '61-90'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        {buckets.map((b) => {
          const count = data.rows.filter((r) => r.bucket === b).length;
          const tone = b === 'expired' || b === '0-30' ? 'danger' : 'warning';
          return (
            <GlassCard key={b} variant="panel" padded="md">
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{b === 'expired' ? 'Expired' : `${b} days`}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: count > 0 ? `var(--sos-status-${tone})` : 'var(--sos-text-primary)' }}>{count}</div>
            </GlassCard>
          );
        })}
      </div>

      <GlassCard variant="panel" padded={false}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 80px 80px', gap: 8, padding: '9px 14px', fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <span>Document</span>
          <span>Case</span>
          <span>Officer</span>
          <span style={{ textAlign: 'right' }}>Days</span>
          <span></span>
        </div>
        {data.rows.map((r) => (
          <div key={r.documentItemId} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 80px 80px', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--sos-border-subtle)', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--sos-text-primary)', fontWeight: 600 }}>{r.documentName}</div>
              <div style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{r.criticality} · {r.status}{r.validityExpiryDate ? ` · expires ${fmtDate(r.validityExpiryDate)}` : ''}</div>
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>{labelForServiceCode(r.service)} · {r.targetCountry}</span>
            <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>{r.officerName}</span>
            <span style={{ fontSize: 12.5, textAlign: 'right', fontWeight: 600, color: r.bucket === 'expired' ? 'var(--sos-status-danger)' : r.bucket === '0-30' ? 'var(--sos-status-danger)' : 'var(--sos-status-warning)' }}>
              {r.daysUntilExpiry == null ? '—' : r.daysUntilExpiry < 0 ? `${Math.abs(r.daysUntilExpiry)}d ago` : `${r.daysUntilExpiry}d`}
            </span>
            <Link href={`/processing/cases/${r.caseId}` as Route} style={{ fontSize: 12.5, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}>Open →</Link>
          </div>
        ))}
      </GlassCard>
    </div>
  );
}

export function ProcessingReportsPage() {
  const [tab, setTab] = useState<ReportTab>('workload');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Stable query identity so child tabs only re-fetch when the filter actually
  // changes — not on every re-render.
  const query = useMemo<ReportDateRangeQuery>(
    () => ({ ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) }),
    [dateFrom, dateTo],
  );

  const exportUrl = useCallback(() => {
    const qs = new URLSearchParams({ reportType: tab });
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);
    return `${apiBaseUrl()}/processing/reports/export?${qs.toString()}`;
  }, [tab, dateFrom, dateTo]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Processing"
        title="Reports"
        description="Workload, throughput, document quality, SLA, and validity-expiry across the team."
      />

      {/* Filter bar */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--sos-surface-2)', borderRadius: 'var(--sos-radius-md)', padding: 3 }}>
            {REPORT_TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 12px',
                  borderRadius: 'var(--sos-radius-sm)',
                  border: 'none',
                  background: tab === key ? 'var(--sos-brand-primary-strong)' : 'transparent',
                  color: tab === key ? '#fff' : 'var(--sos-text-secondary)',
                  fontSize: 12.5,
                  fontWeight: tab === key ? 600 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="sos-input" style={{ fontSize: 12.5 }} />
            <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="sos-input" style={{ fontSize: 12.5 }} />
          </div>

          <a
            href={exportUrl()}
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: 'auto', textDecoration: 'none' }}
          >
            <SecondaryButton iconLeft={<Download size={13} />}>Export CSV</SecondaryButton>
          </a>
        </div>
      </GlassCard>

      {tab === 'workload'    ? <WorkloadTab     q={query} /> : null}
      {tab === 'throughput'  ? <ThroughputTab   q={query} /> : null}
      {tab === 'doc-quality' ? <DocQualityTab   q={query} /> : null}
      {tab === 'sla'         ? <SlaTab          q={query} /> : null}
      {tab === 'expiry-risk' ? <ExpiryRiskTab   q={query} /> : null}
    </div>
  );
}
