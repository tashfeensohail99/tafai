'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  Clock,
  FileSpreadsheet,
  Loader2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  deleteImport,
  listImportBatches,
  type LeadImportBatch,
  type LeadImportStatus,
} from '@/lib/lead-imports-api';

type Tab = 'ALL' | LeadImportStatus;
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'PROCESSING', label: 'Processing' },
  { key: 'QUEUED', label: 'Queued' },
  { key: 'PAUSED', label: 'Paused' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'FAILED', label: 'Failed' },
];

function statusTone(status: LeadImportStatus): BadgeTone {
  switch (status) {
    case 'QUEUED':
      return 'neutral';
    case 'PROCESSING':
      return 'info';
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'PAUSED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function LeadImportsPage() {
  const [batches, setBatches] = useState<LeadImportBatch[]>([]);
  const [tab, setTab] = useState<Tab>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /**
   * Delete a batch + cascade soft-delete every lead it created. Two-step
   * native confirm (uses the batch's imported count in the message so the
   * admin sees exactly how many leads are about to disappear).
   */
  const handleDelete = async (batch: LeadImportBatch) => {
    const total = batch.importedCount;
    const msg =
      `Delete batch ${batch.batchNumber} and ${total.toLocaleString()} imported lead${total === 1 ? '' : 's'}?\n\n` +
      `This will also remove these leads from the sales team's CSV Leads list and from the WhatsApp inbox.\n\n` +
      `Duplicate matches (which already existed before this batch) are NOT affected.`;
    if (!window.confirm(msg)) return;
    setDeletingId(batch.id);
    try {
      await deleteImport(batch.id);
      setBatches((curr) => curr.filter((b) => b.id !== batch.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete batch');
    } finally {
      setDeletingId(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listImportBatches({
        ...(tab !== 'ALL' ? { status: tab } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      setBatches(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load batches');
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh while anything is in-flight so the dashboard updates without
  // the operator hammering F5. Polls every 3 seconds.
  useEffect(() => {
    const hasActive = batches.some(
      (b) => b.status === 'PROCESSING' || b.status === 'QUEUED',
    );
    if (!hasActive) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [batches, load]);

  const counts = useMemo(() => {
    return {
      total: batches.length,
      active: batches.filter((b) => b.status === 'PROCESSING' || b.status === 'QUEUED').length,
      completed: batches.filter((b) => b.status === 'COMPLETED').length,
      totalLeadsImported: batches.reduce((acc, b) => acc + b.importedCount, 0),
    };
  }, [batches]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Admin · CSV/Excel"
        title="Lead imports"
        description="Bulk upload spreadsheets and distribute via round-robin to active sales agents."
        actions={
          <Link href={'/admin/lead-imports/new' as Route}>
            <PrimaryButton iconLeft={<Plus size={15} />}>New import</PrimaryButton>
          </Link>
        }
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <MetricCard label="Total batches" value={counts.total} tone="info" Icon={FileSpreadsheet} hint="All-time uploads" />
        <MetricCard label="Active now" value={counts.active} tone="accent" Icon={Loader2} hint="Processing / queued" />
        <MetricCard label="Completed" value={counts.completed} tone="success" Icon={Clock} hint="Done" />
        <MetricCard label="Leads imported" value={counts.totalLeadsImported.toLocaleString()} tone="warm" Icon={FileSpreadsheet} hint="Across all batches" />
      </div>

      {/* Filters */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={tab === t.key ? 'sos-chip sos-chip--active' : 'sos-chip'}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 220, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, color: 'var(--sos-text-muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by batch number, name, or filename…"
              className="sos-input"
              style={{ paddingLeft: 34 }}
            />
          </div>
        </div>
      </GlassCard>

      {/* List */}
      <GlassCard variant="panel" padded={false}>
        {loading && batches.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-muted)' }}>
            Loading batches…
          </div>
        ) : error ? (
          <div style={{ padding: 24, color: 'var(--sos-status-danger)', fontSize: 13 }}>{error}</div>
        ) : batches.length === 0 ? (
          <EmptyState
            Icon={FileSpreadsheet}
            title="No imports yet"
            description="Click 'New import' to upload your first CSV or Excel file."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 800, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--sos-surface-1)' }}>
                  {['Batch', 'Name', 'Total / Imported / Duplicates / Invalid', 'Status', 'Uploaded', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid var(--sos-divider)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const progress = b.totalRows > 0 ? Math.round(((b.importedCount + b.duplicateCount + b.invalidCount) / b.totalRows) * 100) : 0;
                  const inFlight = b.status === 'PROCESSING' || b.status === 'QUEUED';
                  return (
                    <tr key={b.id} style={{ borderBottom: '1px solid var(--sos-divider)' }}>
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        <Link href={`/admin/lead-imports/${b.id}` as Route} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                          {b.batchNumber}
                        </Link>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--sos-text-primary)' }}>
                        <div>{b.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{b.fileName}</div>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>
                        <div>{b.totalRows.toLocaleString()} / {b.importedCount.toLocaleString()} / {b.duplicateCount.toLocaleString()} / {b.invalidCount.toLocaleString()}</div>
                        {inFlight ? (
                          <div style={{ marginTop: 4, height: 4, background: 'var(--sos-surface-1)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--sos-brand-primary-strong)', transition: 'width 300ms' }} />
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <StatusBadge tone={statusTone(b.status)} size="sm">{b.status}</StatusBadge>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>
                        {new Date(b.uploadedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <Link href={`/admin/lead-imports/${b.id}` as Route} className="sos-btn sos-btn--ghost sos-btn--sm">
                            Open
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(b)}
                            disabled={deletingId === b.id}
                            title={`Delete batch + ${b.importedCount.toLocaleString()} leads`}
                            aria-label="Delete batch"
                            style={{
                              all: 'unset',
                              cursor: deletingId === b.id ? 'not-allowed' : 'pointer',
                              padding: 6,
                              borderRadius: 6,
                              color: 'var(--sos-status-danger)',
                              opacity: deletingId === b.id ? 0.5 : 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            onMouseEnter={(e) => {
                              if (deletingId !== b.id)
                                (e.currentTarget as HTMLButtonElement).style.background =
                                  'rgba(239,68,68,0.12)';
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                            }}
                          >
                            {deletingId === b.id ? (
                              <Loader2 size={15} className="sos-spin" />
                            ) : (
                              <Trash2 size={15} />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
