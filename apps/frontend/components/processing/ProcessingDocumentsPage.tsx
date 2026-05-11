'use client';
// Aggregated Document Review Queue — Phase 1F-1.
// Cross-case view of all documents needing officer attention:
// SUBMITTED (awaiting review), UNDER_REVIEW, REJECTED (awaiting client), EXPIRING_SOON.

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSearch,
  Filter,
  ShieldAlert,
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
  MOCK_PROCESSING_OFFICER,
  getAggregatedDocQueue,
  DOC_STATUS_LABEL,
  PRIORITY_LABEL,
  REJECTION_REASON_LABEL,
  fmtRelative,
  fmtDate,
  type DocumentItemStatus,
  type DocumentCriticality,
  type ProcessingPriority,
  type AggregatedDocRow,
} from '@/components/processing/mockData';
import { priorityTone } from './ProcessingDashboardPage';

// ---------------------------------------------------------------------------
// Tone helpers
// ---------------------------------------------------------------------------

function docStatusTone(status: DocumentItemStatus): BadgeTone {
  switch (status) {
    case 'SUBMITTED':     return 'info';
    case 'UNDER_REVIEW':  return 'accent';
    case 'REJECTED':      return 'danger';
    case 'EXPIRING_SOON': return 'warning';
    case 'EXPIRED':       return 'danger';
    case 'ACCEPTED':      return 'success';
    default:              return 'neutral';
  }
}

function criticalityTone(c: DocumentCriticality): BadgeTone {
  switch (c) {
    case 'CRITICAL':    return 'danger';
    case 'REQUIRED':    return 'warning';
    case 'CONDITIONAL': return 'warm';
    case 'SUPPORTING':  return 'neutral';
    case 'OPTIONAL':    return 'neutral';
  }
}

// ---------------------------------------------------------------------------
// Filter config
// ---------------------------------------------------------------------------

type StatusFilter = 'ALL' | DocumentItemStatus;
type CriticalityFilter = 'ALL' | DocumentCriticality;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL',          label: 'All' },
  { value: 'SUBMITTED',    label: 'Awaiting review' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'REJECTED',     label: 'Rejected' },
  { value: 'EXPIRING_SOON',label: 'Expiring soon' },
];

const CRITICALITY_OPTIONS: { value: CriticalityFilter; label: string }[] = [
  { value: 'ALL',         label: 'All criticality' },
  { value: 'CRITICAL',    label: 'Critical' },
  { value: 'REQUIRED',    label: 'Required' },
  { value: 'CONDITIONAL', label: 'Conditional' },
  { value: 'SUPPORTING',  label: 'Supporting' },
];

// ---------------------------------------------------------------------------
// Document row card
// ---------------------------------------------------------------------------

function DocQueueRow({ row }: { row: AggregatedDocRow }) {
  const { docItem: doc, caseId, clientName, service, targetCountry, casePriority } = row;

  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap' }}>
        {/* Left: doc info */}
        <div style={{ flex: 1, minWidth: '220px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {doc.documentName}
            </span>
            <StatusBadge tone={docStatusTone(doc.status)} size="sm">
              {DOC_STATUS_LABEL[doc.status]}
            </StatusBadge>
            <StatusBadge tone={criticalityTone(doc.criticality)} size="sm" dot={false}>
              {doc.criticality}
            </StatusBadge>
          </div>

          {doc.description ? (
            <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginBottom: '6px' }}>
              {doc.description}
            </div>
          ) : null}

          {/* Rejection reason codes */}
          {doc.status === 'REJECTED' && doc.rejectionReasonCodes?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
              {doc.rejectionReasonCodes.map((code) => (
                <span
                  key={code}
                  style={{ padding: '2px 8px', borderRadius: 'var(--sos-radius-full)', background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', fontSize: '11.5px', color: 'var(--sos-status-danger)' }}
                >
                  {REJECTION_REASON_LABEL[code] ?? code}
                </span>
              ))}
            </div>
          ) : null}

          {/* Validity / expiry */}
          {doc.validityExpiryDate ? (
            <div style={{ fontSize: '11.5px', color: doc.status === 'EXPIRING_SOON' ? 'var(--sos-status-warning)' : 'var(--sos-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {doc.status === 'EXPIRING_SOON' ? <AlertTriangle size={12} /> : <Clock size={12} />}
              Expires {fmtDate(doc.validityExpiryDate)}
            </div>
          ) : null}
        </div>

        {/* Centre: case context */}
        <div style={{ minWidth: '160px', flexShrink: 0 }}>
          <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginBottom: '4px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Case
          </div>
          <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '2px' }}>
            {clientName}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginBottom: '6px' }}>
            {service} · {targetCountry}
          </div>
          <StatusBadge tone={priorityTone(casePriority)} size="sm">
            {PRIORITY_LABEL[casePriority]}
          </StatusBadge>
        </div>

        {/* Right: meta + action */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
          <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)', textAlign: 'right' }}>
            {doc.uploadedAt ? (
              <>Uploaded {fmtRelative(doc.uploadedAt)}<br />v{doc.versionNumber ?? 1}</>
            ) : (
              <span>Not uploaded</span>
            )}
          </div>
          <Link
            href={`/processing/cases/${caseId}` as Route}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-brand-primary-soft)', border: '1px solid var(--sos-brand-primary-border)', color: 'var(--sos-brand-primary-strong)', fontSize: '12.5px', fontWeight: 600, textDecoration: 'none', transition: 'opacity 150ms' }}
          >
            <ExternalLink size={12} /> Open case
          </Link>
        </div>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function ProcessingDocumentsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [critFilter, setCritFilter]     = useState<CriticalityFilter>('ALL');

  // Fetch queue — my cases only for officer view
  const allRows = useMemo(() => getAggregatedDocQueue(MOCK_PROCESSING_OFFICER.id), []);

  // Metrics (always over full queue regardless of filter)
  const submitted    = allRows.filter((r) => r.docItem.status === 'SUBMITTED').length;
  const underReview  = allRows.filter((r) => r.docItem.status === 'UNDER_REVIEW').length;
  const rejected     = allRows.filter((r) => r.docItem.status === 'REJECTED').length;
  const expiringSoon = allRows.filter((r) => r.docItem.status === 'EXPIRING_SOON').length;

  // Filtered rows
  const filtered = useMemo(() => {
    return allRows.filter((r) => {
      const statusOk = statusFilter === 'ALL' || r.docItem.status === statusFilter;
      const critOk   = critFilter === 'ALL'   || r.docItem.criticality === critFilter;
      return statusOk && critOk;
    });
  }, [allRows, statusFilter, critFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Document Queue"
        description="Documents across your cases that need attention — review, re-submission, or follow-up."
      />

      {/* ── KPI strip ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
        <MetricCard
          label="Awaiting review"
          value={String(submitted)}
          hint={submitted > 0 ? `${submitted} need action` : 'All clear'}
          Icon={FileSearch}
          tone={submitted > 0 ? 'warning' : 'success'}
        />
        <MetricCard
          label="Under review"
          value={String(underReview)}
          hint="In progress"
          Icon={Clock}
          tone="accent"
        />
        <MetricCard
          label="Rejected"
          value={String(rejected)}
          hint={rejected > 0 ? 'Awaiting client' : 'None'}
          Icon={XCircle}
          tone={rejected > 0 ? 'danger' : 'success'}
        />
        <MetricCard
          label="Expiring soon"
          value={String(expiringSoon)}
          hint={expiringSoon > 0 ? 'Needs follow-up' : 'None'}
          Icon={AlertTriangle}
          tone={expiringSoon > 0 ? 'warning' : 'success'}
        />
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* Status tabs */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--sos-surface-2)', borderRadius: 'var(--sos-radius-md)', padding: '3px' }}>
            {STATUS_FILTER_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--sos-radius-sm)',
                  border: 'none',
                  background: statusFilter === value ? 'var(--sos-brand-primary-strong)' : 'transparent',
                  color: statusFilter === value ? '#fff' : 'var(--sos-text-secondary)',
                  fontSize: '12.5px',
                  fontWeight: statusFilter === value ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 150ms',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Criticality select */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={13} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
            <select
              value={critFilter}
              onChange={(e) => setCritFilter(e.target.value as CriticalityFilter)}
              style={{ padding: '5px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-default)', background: 'var(--sos-bg-surface)', color: 'var(--sos-text-primary)', fontSize: '12.5px', cursor: 'pointer', outline: 'none' }}
            >
              {CRITICALITY_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
            {filtered.length} document{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      </GlassCard>

      {/* ── Document rows ──────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={CheckCircle2}
            title="No documents match this filter"
            description="Try changing the status or criticality filter, or check back after new documents are uploaded."
          />
        </GlassCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((row) => (
            <DocQueueRow key={`${row.caseId}-${row.docItem.id}`} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
