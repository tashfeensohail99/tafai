'use client';
// Case History — Phase 1F-3.
// Read-only archive of COMPLETED, CANCELLED, and REJECTED cases.
// Filter by outcome, service, date range. Each row links to the case workspace.

import { useState, useMemo } from 'react';
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
  XCircle,
} from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  MOCK_PROCESSING_CASES,
  STAGE_LABEL,
  PRIORITY_LABEL,
  fmtDate,
  fmtRelative,
  type MockProcessingCase,
  type ProcessingStage,
  type ProcessingPriority,
} from '@/components/processing/mockData';
import { stageTone, priorityTone } from './ProcessingDashboardPage';

// ---------------------------------------------------------------------------
// Terminal stages shown in history
// ---------------------------------------------------------------------------

const HISTORY_STAGES: ProcessingStage[] = ['COMPLETED', 'CANCELLED', 'REJECTED'];

// ---------------------------------------------------------------------------
// Filter config
// ---------------------------------------------------------------------------

type OutcomeFilter = 'ALL' | ProcessingStage;
type ServiceFilter = 'ALL' | string;

const OUTCOME_OPTIONS: { value: OutcomeFilter; label: string }[] = [
  { value: 'ALL',       label: 'All outcomes' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'REJECTED',  label: 'Rejected' },
];

// ---------------------------------------------------------------------------
// Outcome icon
// ---------------------------------------------------------------------------

function OutcomeIcon({ stage }: { stage: ProcessingStage }) {
  if (stage === 'COMPLETED') return <CheckCircle2 size={18} style={{ color: 'var(--sos-status-success)', flexShrink: 0 }} />;
  if (stage === 'REJECTED')  return <XCircle size={18} style={{ color: 'var(--sos-status-danger)', flexShrink: 0 }} />;
  return <Archive size={18} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />;
}

// ---------------------------------------------------------------------------
// Case history row
// ---------------------------------------------------------------------------

function HistoryRow({ c }: { c: MockProcessingCase }) {
  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap' }}>
        {/* Outcome icon */}
        <div style={{ paddingTop: '2px' }}>
          <OutcomeIcon stage={c.stage} />
        </div>

        {/* Case info */}
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {c.clientName}
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
            {c.service} · {c.targetCountry}
          </div>
        </div>

        {/* Officer + dates */}
        <div style={{ minWidth: '140px', flexShrink: 0 }}>
          <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginBottom: '3px' }}>
            Assigned to: <strong style={{ color: 'var(--sos-text-primary)' }}>{c.assignedOfficer?.name ?? '—'}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
            <CalendarClock size={11} />
            Opened {fmtDate(c.createdAt)}
          </div>
        </div>

        {/* View link */}
        <div style={{ flexShrink: 0, alignSelf: 'center' }}>
          <Link
            href={`/processing/cases/${c.id}` as Route}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', color: 'var(--sos-text-secondary)', fontSize: '12.5px', fontWeight: 600, textDecoration: 'none', transition: 'all 150ms' }}
          >
            <ExternalLink size={12} /> View
          </Link>
        </div>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function ProcessingHistoryPage() {
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL');
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('ALL');

  // All terminal cases (not filtered by officer for history — managers see all)
  const historyCases = useMemo(
    () => MOCK_PROCESSING_CASES.filter((c) => HISTORY_STAGES.includes(c.stage)),
    [],
  );

  // Derive unique services for filter
  const serviceOptions: { value: ServiceFilter; label: string }[] = useMemo(() => {
    const services = [...new Set(historyCases.map((c) => c.service))].sort();
    return [{ value: 'ALL', label: 'All services' }, ...services.map((s) => ({ value: s, label: s }))];
  }, [historyCases]);

  // Metrics
  const completedCount = historyCases.filter((c) => c.stage === 'COMPLETED').length;
  const cancelledCount = historyCases.filter((c) => c.stage === 'CANCELLED').length;
  const rejectedCount  = historyCases.filter((c) => c.stage === 'REJECTED').length;

  // Filtered
  const filtered = useMemo(() => {
    return historyCases.filter((c) => {
      const oOk = outcomeFilter === 'ALL' || c.stage === outcomeFilter;
      const sOk = serviceFilter === 'ALL' || c.service === serviceFilter;
      return oOk && sOk;
    });
  }, [historyCases, outcomeFilter, serviceFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Case History"
        description="Completed, cancelled, and rejected cases. Read-only archive — click any row to view the full case file."
      />

      {/* ── KPI strip ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        <MetricCard
          label="Total archived"
          value={String(historyCases.length)}
          hint="All closed cases"
          Icon={History}
          tone="neutral"
        />
        <MetricCard
          label="Completed"
          value={String(completedCount)}
          hint="Successful outcomes"
          Icon={CheckCircle2}
          tone="success"
        />
        <MetricCard
          label="Cancelled"
          value={String(cancelledCount)}
          hint="Client/officer cancelled"
          Icon={Archive}
          tone="neutral"
        />
        <MetricCard
          label="Rejected"
          value={String(rejectedCount)}
          hint="Authority rejections"
          Icon={XCircle}
          tone={rejectedCount > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* Outcome tabs */}
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
                  transition: 'all 150ms',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Service select */}
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

          <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
            {filtered.length} case{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      </GlassCard>

      {/* ── Case rows ──────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={historyCases.length === 0 ? History : CheckCircle2}
            title={historyCases.length === 0 ? 'No closed cases yet' : 'No cases match this filter'}
            description={
              historyCases.length === 0
                ? 'Cases will appear here once they are completed, cancelled, or rejected.'
                : 'Try selecting a different outcome or service filter.'
            }
          />
        </GlassCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((c) => (
            <HistoryRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}
