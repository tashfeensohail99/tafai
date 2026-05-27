'use client';
// Aggregated Document Review Queue — wired to GET /processing/documents.
// Cross-case view of all documents needing officer attention:
// SUBMITTED, UNDER_REVIEW, REJECTED, EXPIRING_SOON, EXPIRED.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSearch,
  Filter,
  Loader2,
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
  DOC_STATUS_LABEL,
  PRIORITY_LABEL,
  fmtDate,
  type DocumentItemStatus,
  type DocumentCriticality,
} from '@/components/processing/mockData';
import { priorityTone } from './ProcessingDashboardPage';
import {
  fetchAggregatedDocuments,
  type ApiAggregatedDocument,
} from '@/lib/processing';
import { labelForServiceCode } from '@/lib/service-types';

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

type StatusFilter = 'ALL' | DocumentItemStatus;
type CriticalityFilter = 'ALL' | DocumentCriticality;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL',          label: 'All' },
  { value: 'SUBMITTED',    label: 'Awaiting review' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'REJECTED',     label: 'Rejected' },
  { value: 'EXPIRING_SOON',label: 'Expiring soon' },
  { value: 'EXPIRED',      label: 'Expired' },
];

const CRITICALITY_OPTIONS: { value: CriticalityFilter; label: string }[] = [
  { value: 'ALL',         label: 'All criticality' },
  { value: 'CRITICAL',    label: 'Critical' },
  { value: 'REQUIRED',    label: 'Required' },
  { value: 'CONDITIONAL', label: 'Conditional' },
  { value: 'SUPPORTING',  label: 'Supporting' },
];

function personName(c: ApiAggregatedDocument['case']): string {
  const src = c.client ?? c.lead;
  const first = src?.firstName?.trim() ?? '';
  const last = src?.lastName?.trim() ?? '';
  const full = `${first} ${last}`.trim();
  return full || 'Unnamed';
}

function DocQueueRow({ doc }: { doc: ApiAggregatedDocument }) {
  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap' }}>
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

          {doc.validityExpiryDate ? (
            <div style={{ fontSize: '11.5px', color: doc.status === 'EXPIRING_SOON' || doc.status === 'EXPIRED' ? 'var(--sos-status-warning)' : 'var(--sos-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {doc.status === 'EXPIRING_SOON' || doc.status === 'EXPIRED' ? <AlertTriangle size={12} /> : <Clock size={12} />}
              Expires {fmtDate(doc.validityExpiryDate)}
            </div>
          ) : null}
        </div>

        <div style={{ minWidth: '160px', flexShrink: 0 }}>
          <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginBottom: '4px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Case
          </div>
          <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '2px' }}>
            {personName(doc.case)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginBottom: '6px' }}>
            {labelForServiceCode(doc.case.service)} · {doc.case.targetCountry}
          </div>
          <StatusBadge tone={priorityTone(doc.case.priority)} size="sm">
            {PRIORITY_LABEL[doc.case.priority]}
          </StatusBadge>
        </div>

        <div style={{ flexShrink: 0, alignSelf: 'center' }}>
          <Link
            href={`/processing/cases/${doc.case.id}` as Route}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-brand-primary-soft)', border: '1px solid var(--sos-brand-primary-border)', color: 'var(--sos-brand-primary-strong)', fontSize: '12.5px', fontWeight: 600, textDecoration: 'none' }}
          >
            <ExternalLink size={12} /> Open case
          </Link>
        </div>
      </div>
    </GlassCard>
  );
}

export function ProcessingDocumentsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [critFilter, setCritFilter]     = useState<CriticalityFilter>('ALL');
  const [docs, setDocs] = useState<ApiAggregatedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAggregatedDocuments()
      .then((res) => { if (!cancelled) setDocs(res.items); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load documents'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const submitted    = docs.filter((d) => d.status === 'SUBMITTED').length;
  const underReview  = docs.filter((d) => d.status === 'UNDER_REVIEW').length;
  const rejected     = docs.filter((d) => d.status === 'REJECTED').length;
  const expiringSoon = docs.filter((d) => d.status === 'EXPIRING_SOON' || d.status === 'EXPIRED').length;

  const filtered = useMemo(() => {
    return docs.filter((d) => {
      const statusOk = statusFilter === 'ALL' || d.status === statusFilter;
      const critOk   = critFilter === 'ALL'   || d.criticality === critFilter;
      return statusOk && critOk;
    });
  }, [docs, statusFilter, critFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Document Queue"
        description="Documents across your cases that need attention — review, re-submission, or follow-up."
      />

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
          label="Expiring / expired"
          value={String(expiringSoon)}
          hint={expiringSoon > 0 ? 'Needs follow-up' : 'None'}
          Icon={AlertTriangle}
          tone={expiringSoon > 0 ? 'warning' : 'success'}
        />
      </div>

      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
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

      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" /> Loading queue…
          </div>
        </GlassCard>
      ) : error ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>Failed to load queue: {error}</div>
        </GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={CheckCircle2}
            title={docs.length === 0 ? 'No documents need attention right now' : 'No documents match this filter'}
            description={
              docs.length === 0
                ? 'Documents will appear here as clients upload them and as validity dates approach.'
                : 'Try changing the status or criticality filter.'
            }
          />
        </GlassCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((doc) => <DocQueueRow key={doc.id} doc={doc} />)}
        </div>
      )}
    </div>
  );
}
