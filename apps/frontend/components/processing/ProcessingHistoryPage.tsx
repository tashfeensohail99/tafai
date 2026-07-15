'use client';
// Case History — wired to /processing/cases?stages=COMPLETED,CANCELLED,REJECTED.
// Read-only archive of terminal cases. Filter by outcome, service, date range.

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  Archive,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Filter,
  Globe,
  History,
  Loader2,
  Search,
  XCircle,
} from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  STAGE_LABEL,
  PRIORITY_LABEL,
  fmtDate,
} from '@/components/processing/mockData';
import { stageTone, priorityTone } from './ProcessingDashboardPage';
import {
  casePersonName,
  fetchProcessingCases,
  type ApiProcessingCaseListItem,
  type ProcessingStage,
} from '@/lib/processing';
import { labelForServiceCode } from '@/lib/service-types';

const HISTORY_STAGES: ProcessingStage[] = ['COMPLETED', 'CANCELLED', 'REJECTED'];

type OutcomeFilter = 'ALL' | ProcessingStage;
type ServiceFilter = 'ALL' | string;

const OUTCOME_OPTIONS: { value: OutcomeFilter; label: string }[] = [
  { value: 'ALL',       label: 'All outcomes' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'REJECTED',  label: 'Rejected' },
];

function OutcomeIcon({ stage }: { stage: ProcessingStage }) {
  if (stage === 'COMPLETED') return <CheckCircle2 size={18} style={{ color: 'var(--sos-status-success)', flexShrink: 0 }} />;
  if (stage === 'REJECTED')  return <XCircle size={18} style={{ color: 'var(--sos-status-danger)', flexShrink: 0 }} />;
  return <Archive size={18} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />;
}

function HistoryRow({ c }: { c: ApiProcessingCaseListItem }) {
  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap' }}>
        <div style={{ paddingTop: '2px' }}>
          <OutcomeIcon stage={c.stage} />
        </div>

        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {casePersonName(c)}
            </span>
            <StatusBadge tone={stageTone(c.stage)} size="sm">
              {STAGE_LABEL[c.stage]}
            </StatusBadge>
            <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>
              {PRIORITY_LABEL[c.priority]}
            </StatusBadge>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--sos-text-muted)' }}>
            <Globe size={12} />
            {labelForServiceCode(c.service)} · {c.targetCountry}
          </div>
        </div>

        <div style={{ minWidth: '140px', flexShrink: 0 }}>
          <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginBottom: '3px' }}>
            Officer: <strong style={{ color: 'var(--sos-text-primary)' }}>{c.assignedOfficer?.email.split('@')[0] ?? '—'}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
            <CalendarClock size={11} />
            Opened {fmtDate(c.createdAt)}
          </div>
        </div>

        <div style={{ flexShrink: 0, alignSelf: 'center' }}>
          <Link
            href={`/processing/cases/${c.id}` as Route}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', color: 'var(--sos-text-secondary)', fontSize: '12.5px', fontWeight: 600, textDecoration: 'none' }}
          >
            <ExternalLink size={12} /> View
          </Link>
        </div>
      </div>
    </GlassCard>
  );
}

export function ProcessingHistoryPage() {
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL');
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('ALL');
  const [search, setSearch] = useState('');
  const [cases, setCases] = useState<ApiProcessingCaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProcessingCases({ stages: HISTORY_STAGES, limit: 500 })
      .then((res) => {
        if (!cancelled) setCases(res.cases);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const serviceOptions: { value: ServiceFilter; label: string }[] = useMemo(() => {
    const services = [...new Set(cases.map((c) => c.service))].sort();
    return [{ value: 'ALL', label: 'All services' }, ...services.map((s) => ({ value: s, label: labelForServiceCode(s) }))];
  }, [cases]);

  const completedCount = cases.filter((c) => c.stage === 'COMPLETED').length;
  const cancelledCount = cases.filter((c) => c.stage === 'CANCELLED').length;
  const rejectedCount  = cases.filter((c) => c.stage === 'REJECTED').length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases.filter((c) => {
      const oOk = outcomeFilter === 'ALL' || c.stage === outcomeFilter;
      const sOk = serviceFilter === 'ALL' || c.service === serviceFilter;
      const qOk =
        !q ||
        [casePersonName(c), labelForServiceCode(c.service), c.targetCountry, c.lead?.referenceCode ?? '', c.id]
          .join(' ')
          .toLowerCase()
          .includes(q);
      return oOk && sOk && qOk;
    });
  }, [cases, outcomeFilter, serviceFilter, search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Case History"
        description="Completed, cancelled, and rejected cases. Read-only archive — click any row to view the full case file."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        <MetricCard label="Total archived" value={String(cases.length)} hint="All closed cases" Icon={History} tone="neutral" />
        <MetricCard label="Completed" value={String(completedCount)} hint="Successful outcomes" Icon={CheckCircle2} tone="success" />
        <MetricCard label="Cancelled" value={String(cancelledCount)} hint="Client/officer cancelled" Icon={Archive} tone="neutral" />
        <MetricCard label="Rejected" value={String(rejectedCount)} hint="Authority rejections" Icon={XCircle} tone={rejectedCount > 0 ? 'danger' : 'neutral'} />
      </div>

      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '4px', background: 'var(--sos-surface-2)', borderRadius: 'var(--sos-radius-md)', padding: '3px' }}>
            {OUTCOME_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setOutcomeFilter(value)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--sos-radius-sm)',
                  border: 'none',
                  background: outcomeFilter === value ? 'var(--sos-brand-primary-strong)' : 'transparent',
                  color: outcomeFilter === value ? '#fff' : 'var(--sos-text-secondary)',
                  fontSize: '12.5px',
                  fontWeight: outcomeFilter === value ? 600 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={13} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-default)', background: 'var(--sos-bg-surface)', color: 'var(--sos-text-primary)', fontSize: '12.5px', cursor: 'pointer', outline: 'none' }}
            >
              {serviceOptions.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', minWidth: 200 }}>
            <Search size={13} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
            <input
              type="search"
              placeholder="Search name, service, country…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--sos-text-primary)', fontSize: 12.5 }}
            />
          </div>

          <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
            {filtered.length} case{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      </GlassCard>

      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" /> Loading history…
          </div>
        </GlassCard>
      ) : error ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>Failed to load history: {error}</div>
        </GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={cases.length === 0 ? History : CheckCircle2}
            title={cases.length === 0 ? 'No closed cases yet' : 'No cases match this filter'}
            description={
              cases.length === 0
                ? 'Cases will appear here once they are completed, cancelled, or rejected.'
                : 'Try a different outcome or service filter.'
            }
          />
        </GlassCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((c) => <HistoryRow key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}
