'use client';

import { useEffect, useState } from 'react';
import { Activity, Layers, ShieldCheck } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../shared/DataTable';
import { ErrorState } from '../shared/ErrorState';
import { FilterBar } from '../shared/FilterBar';
import { LoadingState } from '../shared/LoadingState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import {
  MetricCard,
  PageHeader,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { apiFetch, buildQuery } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';

const PAGE_SIZE = 50;

interface AuditLogRecord {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  createdAt: string;
  actor?: { email?: string | null } | null;
  // Which trail the row came from. CENTRAL = central AuditLog table;
  // PROCESSING / AGREEMENT are the bridged domain trails.
  source?: string | null;
  // Free-form one-line summary for the bridged domain trails (the central
  // table leaves this null and relies on the structured columns instead).
  description?: string | null;
  // Structured classification added by Phase 0 interceptor (all optional —
  // legacy rows predate these columns; bridged rows leave them null).
  severity?: string | null;
  category?: string | null;
  method?: string | null;
  route?: string | null;
  outcome?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
}

// Paginated envelope returned by GET /audit-log. `rows` is the current page;
// `total` is the full filtered count across the selected source(s).
interface AuditLogPageResponse {
  rows: AuditLogRecord[];
  total: number;
  page: number;
  pageSize: number;
}

// Source label tones: keep them visually distinct but quiet.
const SOURCE_TONE: Record<string, BadgeTone> = {
  CENTRAL: 'neutral',
  PROCESSING: 'info',
  AGREEMENT: 'success',
};

const SOURCE_LABEL: Record<string, string> = {
  CENTRAL: 'Central',
  PROCESSING: 'Processing',
  AGREEMENT: 'Agreement',
};

// Human-readable label for the active source, used in the summary metric.
const ACTIVE_SOURCE_LABEL: Record<string, string> = {
  CENTRAL: 'Central',
  PROCESSING: 'Processing',
  AGREEMENT: 'Agreements',
  ALL: 'All sources',
};

function renderSource(row: AuditLogRecord) {
  if (!row.source) return '—';
  return (
    <StatusBadge tone={SOURCE_TONE[row.source] ?? 'neutral'} dot={false}>
      {SOURCE_LABEL[row.source] ?? row.source}
    </StatusBadge>
  );
}

// CRITICAL=red, HIGH=amber, MEDIUM=blue, LOW=grey (per spec).
const SEVERITY_TONE: Record<string, BadgeTone> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'neutral',
};

// DENIED/FAILED should read as a problem; SUCCESS stays quiet.
const OUTCOME_TONE: Record<string, BadgeTone> = {
  SUCCESS: 'success',
  DENIED: 'danger',
  FAILED: 'warning',
};

function renderSeverity(row: AuditLogRecord) {
  if (!row.severity) return '—';
  return <StatusBadge tone={SEVERITY_TONE[row.severity] ?? 'neutral'} dot={false}>{row.severity}</StatusBadge>;
}

function renderOutcome(row: AuditLogRecord) {
  if (!row.outcome) return '—';
  return <StatusBadge tone={OUTCOME_TONE[row.outcome] ?? 'neutral'} dot={false}>{row.outcome}</StatusBadge>;
}

function renderRoute(row: AuditLogRecord) {
  if (!row.route && !row.method) return '—';
  return (
    <span className="font-mono text-xs" style={{ color: 'var(--sos-text-secondary)' }}>
      {row.method ? <span style={{ fontWeight: 700 }}>{row.method} </span> : null}
      {row.route ?? ''}
    </span>
  );
}

/** Short relative time ("3m ago", "2h ago") to pair with the absolute stamp. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function renderCreatedAt(row: AuditLogRecord) {
  return (
    <div style={{ lineHeight: 1.35 }}>
      <div style={{ color: 'var(--sos-text-secondary)' }}>{new Date(row.createdAt).toLocaleString()}</div>
      <div style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-text-faint)' }}>{relativeTime(row.createdAt)}</div>
    </div>
  );
}

const columns: DataTableColumn<AuditLogRecord>[] = [
  { key: 'source', header: 'Source', render: renderSource },
  { key: 'severity', header: 'Severity', render: renderSeverity },
  { key: 'category', header: 'Category', render: (row) => row.category ?? '—' },
  { key: 'action', header: 'Action', render: (row) => row.action.replace(/_/g, ' ') },
  { key: 'entityType', header: 'Entity Type', render: (row) => row.entityType },
  { key: 'entityId', header: 'Entity ID', render: (row) => row.entityId ?? '—' },
  { key: 'route', header: 'Route', render: renderRoute },
  { key: 'outcome', header: 'Outcome', render: renderOutcome },
  { key: 'actor', header: 'Actor', render: (row) => row.actor?.email ?? 'System' },
  { key: 'createdAt', header: 'Created At', render: renderCreatedAt },
];

export function AuditLogPage() {
  const { user } = useAdminSession();
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [outcome, setOutcome] = useState('');
  // Which audit trail(s) to show. Defaults to CENTRAL (the historical view);
  // PROCESSING / AGREEMENT bridge in the domain trails, ALL merges all three.
  const [source, setSource] = useState('CENTRAL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadAuditLogs() {
    setLoading(true);
    setError(null);
    try {
      const query = buildQuery({
        search,
        action,
        entityType,
        severity,
        category,
        outcome,
        source,
        page,
        limit: PAGE_SIZE,
      });
      const response = await apiFetch<AuditLogPageResponse>(`/audit-log${query}`);
      setAuditLogs(response.rows);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load audit logs');
    } finally {
      setLoading(false);
    }
  }

  // Reload whenever the page changes.
  useEffect(() => {
    if (!user.permissions.includes('audit.view')) return;
    void loadAuditLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Any filter/search change snaps back to page 1. When already on page 1 this
  // effect still re-fires the load directly; on a later page, resetting `page`
  // triggers the effect above. (Both paths end in exactly one fetch.)
  useEffect(() => {
    if (!user.permissions.includes('audit.view')) return;
    if (page !== 1) {
      setPage(1);
    } else {
      void loadAuditLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, action, entityType, severity, category, outcome, source]);

  if (!user.permissions.includes('audit.view')) {
    return <PermissionDeniedState />;
  }

  if (loading && auditLogs.length === 0) {
    return <LoadingState message="Loading audit logs..." />;
  }

  if (error && auditLogs.length === 0) {
    return <ErrorState message="Unable to load audit logs" details={error} onRetry={() => void loadAuditLogs()} />;
  }

  const exportsActive = category === 'EXPORT';
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Oversight"
        title="Audit Log"
        description="Every sensitive action across the platform — who did what, from where, and when."
      />

      {/* ── Summary metrics ── */}
      <div
        style={{
          display: 'grid',
          gap: 'var(--sos-space-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <MetricCard
          label="Total events"
          value={total.toLocaleString()}
          hint={exportsActive ? 'Matching “Exports” + filters' : 'Matching the current filters'}
          tone="accent"
          Icon={ShieldCheck}
        />
        <MetricCard
          label="Active source"
          value={ACTIVE_SOURCE_LABEL[source] ?? source}
          hint="Audit trail in view"
          tone="info"
          Icon={Layers}
        />
        <MetricCard
          label="Page"
          value={`${Math.min(page, pageCount)} / ${pageCount}`}
          hint={`${PAGE_SIZE} events per page`}
          tone="neutral"
          Icon={Activity}
        />
      </div>

      {/* ── Exports quick filter (segmented pill) ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="inline-flex items-center gap-1 p-1"
          style={{
            background: 'var(--sos-surface-2)',
            border: '1px solid var(--sos-border-subtle)',
            borderRadius: 'var(--sos-radius-pill)',
          }}
        >
          <button
            onClick={() => setCategory('')}
            className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
            style={
              !exportsActive
                ? { background: 'var(--sos-surface-3)', color: 'var(--sos-text-primary)' }
                : { background: 'transparent', color: 'var(--sos-text-muted)' }
            }
          >
            All categories
          </button>
          <button
            onClick={() => setCategory('EXPORT')}
            className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
            style={
              exportsActive
                ? { background: 'var(--sos-brand-primary-soft)', color: 'var(--sos-brand-primary-strong)' }
                : { background: 'transparent', color: 'var(--sos-text-muted)' }
            }
          >
            Exports
          </button>
        </div>
        <span className="text-xs" style={{ color: 'var(--sos-text-muted)' }}>
          Who exported what, when — one click.
        </span>
      </div>

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search entity type or entity id..."
        filters={[
          {
            key: 'source',
            label: 'Source',
            value: source,
            onChange: setSource,
            options: [
              { label: 'Central', value: 'CENTRAL' },
              { label: 'Processing', value: 'PROCESSING' },
              { label: 'Agreements', value: 'AGREEMENT' },
              { label: 'All sources', value: 'ALL' },
            ],
          },
          {
            key: 'severity',
            label: 'Severity',
            value: severity,
            onChange: setSeverity,
            options: [
              { label: 'All Severities', value: '' },
              { label: 'Critical', value: 'CRITICAL' },
              { label: 'High', value: 'HIGH' },
              { label: 'Medium', value: 'MEDIUM' },
              { label: 'Low', value: 'LOW' },
            ],
          },
          {
            key: 'category',
            label: 'Category',
            value: category,
            onChange: setCategory,
            options: [
              { label: 'All Categories', value: '' },
              { label: 'Mutation', value: 'MUTATION' },
              { label: 'Read', value: 'READ' },
              { label: 'Auth', value: 'AUTH' },
              { label: 'Export', value: 'EXPORT' },
              { label: 'File access', value: 'FILE_ACCESS' },
              { label: 'Webhook', value: 'WEBHOOK' },
              { label: 'Cron', value: 'CRON' },
              { label: 'Config', value: 'CONFIG' },
            ],
          },
          {
            key: 'outcome',
            label: 'Outcome',
            value: outcome,
            onChange: setOutcome,
            options: [
              { label: 'All Outcomes', value: '' },
              { label: 'Success', value: 'SUCCESS' },
              { label: 'Denied', value: 'DENIED' },
              { label: 'Failed', value: 'FAILED' },
            ],
          },
          {
            key: 'action',
            label: 'Action',
            value: action,
            onChange: setAction,
            options: [
              { label: 'All Actions', value: '' },
              { label: 'DOCUMENT_VIEWED — file opened / downloaded', value: 'DOCUMENT_VIEWED' },
              { label: 'USER_LOGIN', value: 'USER_LOGIN' },
              { label: 'USER_CREATED', value: 'USER_CREATED' },
              { label: 'LEAD_CREATED', value: 'LEAD_CREATED' },
              { label: 'CLIENT_CREATED', value: 'CLIENT_CREATED' },
              { label: 'PARTNER_CREATED', value: 'PARTNER_CREATED' },
            ],
          },
          {
            key: 'entityType',
            label: 'Entity Type',
            value: entityType,
            onChange: setEntityType,
            options: [
              { label: 'All Entity Types', value: '' },
              { label: '— Documents —', value: '' },
              { label: 'ClientDocument', value: 'ClientDocument' },
              { label: 'ProcessingCaseDocument', value: 'ProcessingCaseDocument' },
              { label: 'InboundDocument', value: 'InboundDocument' },
              { label: 'Receipt', value: 'Receipt' },
              { label: 'Agreement', value: 'Agreement' },
              { label: 'LeadFile', value: 'LeadFile' },
              { label: 'ExpenseReceipt', value: 'ExpenseReceipt' },
              { label: 'CallRecording', value: 'CallRecording' },
              { label: 'WhatsAppMedia', value: 'WhatsAppMedia' },
              { label: 'UserAccount', value: 'UserAccount' },
              { label: 'Employee', value: 'Employee' },
              { label: 'Department', value: 'Department' },
              { label: 'Branch', value: 'Branch' },
              { label: 'Partner', value: 'Partner' },
              { label: 'Lead', value: 'Lead' },
              { label: 'Client', value: 'Client' },
              { label: 'Service', value: 'Service' },
              { label: 'Country', value: 'Country' },
              { label: 'Role', value: 'Role' },
            ],
          },
        ]}
        onClear={() => {
          setSearch('');
          setAction('');
          setEntityType('');
          setSeverity('');
          setCategory('');
          setOutcome('');
          setSource('CENTRAL');
        }}
      />

      {error ? <p className="mb-4 text-sm" style={{ color: 'var(--sos-status-danger)' }}>{error}</p> : null}

      <DataTable
        columns={columns}
        data={auditLogs}
        rowKey={(row) => row.id}
        emptyMessage="No audit events found for these filters."
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          onPageChange: setPage,
        }}
      />
    </div>
  );
}
