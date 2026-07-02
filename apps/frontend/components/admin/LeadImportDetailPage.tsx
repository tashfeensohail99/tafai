'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertCircle,
  ArrowLeft,
  Download,
  Loader2,
  Pause,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  bulkDeleteLeads,
  deleteLead,
  downloadErrorsCsv,
  getImportBatch,
  listLeadsInBatch,
  pauseImport,
  resumeImport,
  type LeadImportBatch,
  type LeadImportStatus,
  type LeadInBatch,
} from '@/lib/lead-imports-api';

interface Props {
  batchId: string;
}

function statusTone(status: LeadImportStatus): BadgeTone {
  switch (status) {
    case 'QUEUED': return 'neutral';
    case 'PROCESSING': return 'info';
    case 'COMPLETED': return 'success';
    case 'FAILED': return 'danger';
    case 'PAUSED': return 'warning';
    default: return 'neutral';
  }
}

export function LeadImportDetailPage({ batchId }: Props) {
  const [batch, setBatch] = useState<LeadImportBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'pause' | 'resume' | null>(null);

  // ----- Leads-in-batch panel state ------------------------------------------
  // List of leads created by this batch; refreshed on search / agent-filter
  // changes and after any delete. Capped at 500 server-side.
  const [leads, setLeads] = useState<LeadInBatch[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  // Search input is debounced — typing into it doesn't fire a query on every
  // keystroke; we wait 300ms of inactivity before re-fetching.
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  // Selected agent filter. null = all; "unassigned" = unassigned bucket;
  // otherwise an employee id from the per-agent breakdown.
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  // Bulk-select state for the leads table.
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await getImportBatch(batchId);
      setBatch(b);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load batch');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while in-flight. Worker updates batch row every ~50ms so 2s polling
  // gives near-real-time progress without DDoS-ing the API.
  useEffect(() => {
    if (!batch) return;
    if (batch.status !== 'PROCESSING' && batch.status !== 'QUEUED') return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [batch?.status, batch, load]);

  async function handlePause() {
    setBusyAction('pause');
    try {
      await pauseImport(batchId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pause failed');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleResume() {
    setBusyAction('resume');
    try {
      await resumeImport(batchId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed');
    } finally {
      setBusyAction(null);
    }
  }

  // Debounce search input → 300ms after the last keystroke, commit the
  // value that drives the actual fetch.
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Fetch the leads list whenever the batch is loaded or the filters change.
  // Drops any stale selectedLeadIds since the visible set may have shrunk.
  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      const rows = await listLeadsInBatch(batchId, {
        ...(searchDebounced.trim() ? { search: searchDebounced.trim() } : {}),
        ...(agentFilter ? { assignedEmployeeId: agentFilter } : {}),
      });
      setLeads(rows);
      setSelectedLeadIds(new Set());
    } catch (err) {
      setLeadsError(err instanceof Error ? err.message : 'Unable to load leads');
    } finally {
      setLeadsLoading(false);
    }
  }, [batchId, searchDebounced, agentFilter]);

  useEffect(() => {
    if (!batch) return;
    void loadLeads();
  }, [batch?.id, loadLeads]);

  async function handleDeleteLead(lead: LeadInBatch) {
    const msg =
      `Delete ${lead.firstName} ${lead.lastName} (${lead.phone})?\n\n` +
      `Removes the lead from the admin / sales lead lists and the WhatsApp inbox.`;
    if (!window.confirm(msg)) return;
    setDeletingId(lead.id);
    try {
      await deleteLead(lead.id);
      // Drop the row locally so the UI updates without waiting for refetch.
      setLeads((curr) => curr.filter((l) => l.id !== lead.id));
      // Refresh the batch counters in the background (importedCount drops).
      void load();
    } catch (err) {
      setLeadsError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDeleteLeads() {
    if (selectedLeadIds.size === 0) return;
    const ids = Array.from(selectedLeadIds);
    const msg =
      `Delete ${ids.length} selected lead${ids.length === 1 ? '' : 's'} from this batch?\n\n` +
      `Each lead disappears from admin / sales lead lists and the WhatsApp inbox.`;
    if (!window.confirm(msg)) return;
    setBulkDeleting(true);
    try {
      await bulkDeleteLeads(ids);
      // Optimistically drop the deleted rows; also refetch for safety.
      setLeads((curr) => curr.filter((l) => !selectedLeadIds.has(l.id)));
      setSelectedLeadIds(new Set());
      void load();
    } catch (err) {
      setLeadsError(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  }

  function toggleLeadSelection(id: string) {
    setSelectedLeadIds((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllLeads() {
    setSelectedLeadIds((curr) => {
      const allVisible = leads.every((l) => curr.has(l.id));
      if (allVisible) return new Set();
      const next = new Set(curr);
      leads.forEach((l) => next.add(l.id));
      return next;
    });
  }

  if (loading && !batch) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-muted)' }}>Loading…</div>;
  }
  if (error && !batch) {
    return (
      <div style={{ padding: 24 }}>
        <Link href={'/admin/lead-imports' as Route} className="sos-btn sos-btn--ghost sos-btn--sm">
          <ArrowLeft size={13} /> Back
        </Link>
        <div style={{ marginTop: 16, padding: 24, color: 'var(--sos-status-danger)' }}>{error}</div>
      </div>
    );
  }
  if (!batch) return null;

  const processed = batch.importedCount + batch.duplicateCount + batch.invalidCount;
  const pct = batch.totalRows > 0 ? Math.round((processed / batch.totalRows) * 100) : 0;
  const canPause = batch.status === 'PROCESSING' || batch.status === 'QUEUED';
  const canResume = batch.status === 'PAUSED';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Link href={'/admin/lead-imports' as Route} className="sos-btn sos-btn--ghost sos-btn--sm" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <ArrowLeft size={13} /> Back to imports
      </Link>

      <PageHeader
        eyebrow={`Admin · ${batch.batchNumber}`}
        title={batch.name}
        description={`${batch.fileName} · uploaded ${new Date(batch.uploadedAt).toLocaleString()}${batch.uploadedBy ? ` by ${batch.uploadedBy.email}` : ''}`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <StatusBadge tone={statusTone(batch.status)} size="md">{batch.status}</StatusBadge>
            {canPause ? (
              <SecondaryButton
                iconLeft={busyAction === 'pause' ? <Loader2 size={14} className="sos-spin" /> : <Pause size={14} />}
                onClick={() => void handlePause()}
                disabled={busyAction !== null}
              >
                Pause
              </SecondaryButton>
            ) : null}
            {canResume ? (
              <PrimaryButton
                iconLeft={busyAction === 'resume' ? <Loader2 size={14} className="sos-spin" /> : <Play size={14} />}
                onClick={() => void handleResume()}
                disabled={busyAction !== null}
              >
                Resume
              </PrimaryButton>
            ) : null}
            {batch.invalidCount > 0 ? (
              <SecondaryButton
                iconLeft={<Download size={14} />}
                onClick={() => downloadErrorsCsv(batch.id, batch.batchNumber)}
              >
                Download errors
              </SecondaryButton>
            ) : null}
          </div>
        }
      />

      {error ? (
        <GlassCard variant="soft" padded="sm" style={{ borderLeft: '4px solid var(--sos-status-danger)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} style={{ color: 'var(--sos-status-danger)' }} />
          <span style={{ fontSize: 13.5, flex: 1 }}>{error}</span>
        </GlassCard>
      ) : null}

      {/* Progress + counts */}
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="sos-eyebrow">Progress</div>
          <div style={{ fontSize: 13, color: 'var(--sos-text-secondary)' }}>
            {processed.toLocaleString()} / {batch.totalRows.toLocaleString()} rows · {pct}%
          </div>
        </div>
        <div style={{ height: 8, background: 'var(--sos-surface-1)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--sos-brand-primary-strong)', transition: 'width 400ms' }} />
        </div>

        {batch.status === 'PROCESSING' || batch.status === 'QUEUED' ? (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--sos-text-secondary)' }}>
            Importing in the background — you can safely leave this page or close the tab; it keeps
            running on the server. The progress here only updates while this page is open.
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 20 }}>
          <Stat label="Imported" value={batch.importedCount} tone="success" />
          <Stat label="Duplicates" value={batch.duplicateCount} tone="neutral" />
          <Stat label="Invalid" value={batch.invalidCount} tone="danger" />
          <Stat label="Assigned" value={batch.assignedCount} tone="info" />
          <Stat label="Total rows" value={batch.totalRows} tone="muted" />
        </div>
      </GlassCard>

      {/* Per-agent breakdown — agent name is now a chip that filters the
          Leads panel below. Click an agent to drill in; click "All" to clear. */}
      <GlassCard variant="panel" padded={false}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--sos-divider)' }}>
          <div className="sos-eyebrow">Round-robin distribution</div>
          <h3 className="sos-title" style={{ fontSize: 16, marginTop: 4 }}>Leads assigned per agent</h3>
        </div>
        {!batch.agentBreakdown || batch.agentBreakdown.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            No assignments yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--sos-surface-1)' }}>
                {['Agent', 'Leads assigned', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid var(--sos-divider)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batch.agentBreakdown.map((row) => {
                const filterValue = row.employeeId ?? 'unassigned';
                const active = agentFilter === filterValue;
                return (
                  <tr
                    key={filterValue}
                    style={{
                      borderBottom: '1px solid var(--sos-divider)',
                      background: active ? 'rgba(59,130,246,0.08)' : undefined,
                      cursor: 'pointer',
                    }}
                    onClick={() => setAgentFilter(active ? null : filterValue)}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13.5, color: 'var(--sos-text-primary)' }}>{row.employeeName}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{row.count.toLocaleString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--sos-text-muted)' }}>
                      {active ? 'Filtering ✓' : 'Click to filter'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </GlassCard>

      {/* Leads in this batch — search + per-agent filter + delete */}
      <GlassCard variant="panel" padded={false}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--sos-divider)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flexShrink: 0 }}>
            <div className="sos-eyebrow">Imported leads</div>
            <h3 className="sos-title" style={{ fontSize: 16, marginTop: 4 }}>
              {leads.length.toLocaleString()}
              {agentFilter ? (
                <span style={{ fontSize: 13, color: 'var(--sos-text-muted)', fontWeight: 400 }}>
                  {' '}· filtered by {batch.agentBreakdown?.find((a) => (a.employeeId ?? 'unassigned') === agentFilter)?.employeeName ?? 'agent'}
                </span>
              ) : null}
            </h3>
          </div>
          {/* Search input */}
          <div style={{ flex: 1, minWidth: 220, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, color: 'var(--sos-text-muted)' }} />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name, phone, email, or reference code…"
              className="sos-input"
              style={{ paddingLeft: 34, paddingRight: searchInput ? 32 : 12, width: '100%' }}
            />
            {searchInput ? (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                title="Clear search"
                aria-label="Clear search"
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  position: 'absolute',
                  right: 8,
                  padding: 4,
                  color: 'var(--sos-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          {/* Clear agent filter shortcut */}
          {agentFilter ? (
            <button
              type="button"
              onClick={() => setAgentFilter(null)}
              className="sos-btn sos-btn--ghost sos-btn--sm"
              style={{ flexShrink: 0 }}
            >
              Clear agent filter
            </button>
          ) : null}
        </div>

        {/* Bulk-action bar */}
        {selectedLeadIds.size > 0 ? (
          <div
            style={{
              padding: '10px 20px',
              background: 'var(--sos-status-danger-soft, rgba(239,68,68,0.12))',
              borderBottom: '1px solid var(--sos-status-danger-border, rgba(239,68,68,0.35))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              fontSize: 13,
            }}
          >
            <div><strong>{selectedLeadIds.size}</strong> selected</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setSelectedLeadIds(new Set())}
                disabled={bulkDeleting}
                className="sos-btn sos-btn--ghost sos-btn--sm"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void handleBulkDeleteLeads()}
                disabled={bulkDeleting}
                className="sos-btn sos-btn--sm"
                style={{
                  background: 'var(--sos-status-danger, #dc2626)',
                  color: '#fff',
                  borderColor: 'var(--sos-status-danger, #dc2626)',
                }}
              >
                {bulkDeleting ? 'Deleting…' : `Delete selected (${selectedLeadIds.size})`}
              </button>
            </div>
          </div>
        ) : null}

        {leadsError ? (
          <div style={{ padding: '12px 20px', fontSize: 13, color: 'var(--sos-status-danger)' }}>
            {leadsError}
          </div>
        ) : null}

        {leadsLoading && leads.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            Loading leads…
          </div>
        ) : leads.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            {searchInput || agentFilter
              ? 'No leads match the current filters.'
              : 'No leads imported by this batch yet.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--sos-surface-1)' }}>
                  <th style={{ padding: '10px 12px', width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all visible leads"
                      checked={leads.length > 0 && leads.every((l) => selectedLeadIds.has(l.id))}
                      ref={(el) => {
                        if (!el) return;
                        const any = leads.some((l) => selectedLeadIds.has(l.id));
                        const all = leads.every((l) => selectedLeadIds.has(l.id));
                        el.indeterminate = any && !all;
                      }}
                      onChange={toggleSelectAllLeads}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  {['Ref', 'Name', 'Phone', 'Email', 'Assigned', 'Status', ''].map((h, i) => (
                    <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid var(--sos-divider)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const selected = selectedLeadIds.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      style={{
                        borderBottom: '1px solid var(--sos-divider)',
                        background: selected ? 'rgba(59,130,246,0.04)' : undefined,
                      }}
                    >
                      <td style={{ padding: '10px 12px' }}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${lead.firstName} ${lead.lastName}`}
                          checked={selected}
                          onChange={() => toggleLeadSelection(lead.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>
                        {lead.referenceCode}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13.5, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap' }}>
                        {lead.firstName} {lead.lastName}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>{lead.phone}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--sos-text-secondary)' }}>
                        {lead.email ?? '—'}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>
                        {lead.assignedEmployee
                          ? `${lead.assignedEmployee.firstName} ${lead.assignedEmployee.lastName}`
                          : <span style={{ color: 'var(--sos-text-muted)' }}>Unassigned</span>}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <StatusBadge tone="neutral" size="sm">{lead.status}</StatusBadge>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => void handleDeleteLead(lead)}
                          disabled={deletingId === lead.id}
                          title="Delete lead"
                          aria-label="Delete lead"
                          style={{
                            all: 'unset',
                            cursor: deletingId === lead.id ? 'not-allowed' : 'pointer',
                            padding: 6,
                            borderRadius: 6,
                            color: 'var(--sos-status-danger)',
                            opacity: deletingId === lead.id ? 0.5 : 1,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          onMouseEnter={(e) => {
                            if (deletingId !== lead.id)
                              (e.currentTarget as HTMLButtonElement).style.background =
                                'rgba(239,68,68,0.12)';
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                          }}
                        >
                          {deletingId === lead.id ? (
                            <Loader2 size={15} className="sos-spin" />
                          ) : (
                            <Trash2 size={15} />
                          )}
                        </button>
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

function Stat({ label, value, tone }: { label: string; value: number; tone: 'success' | 'danger' | 'info' | 'neutral' | 'muted' }) {
  const color = {
    success: 'var(--sos-status-success)',
    danger: 'var(--sos-status-danger)',
    info: 'var(--sos-brand-primary-strong)',
    neutral: 'var(--sos-text-primary)',
    muted: 'var(--sos-text-muted)',
  }[tone];
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value.toLocaleString()}</div>
    </div>
  );
}
