'use client';
// Finance Payment History — Screen 6 of 7.
// Searchable, filterable, read-only record of every payment record.
// Scope: all statuses (including SENT_TO_PROCESSING, VERIFIED, REJECTED).
//
// Phase 1: mock data, client-side filter/sort, stub row actions.
// Phase 2: real pagination, CSV/XLSX/PDF export, refund initiation.

import { useMemo, useState, useEffect } from 'react';
import {
  ArrowUpDown,
  Calendar,
  Download,
  Eye,
  FileText,
  Filter,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  GhostButton,
  PageHeader,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  adminDeleteHandover,
  fetchHandovers,
  METHOD_LABEL,
  STATUS_LABEL,
  fmtAmount,
  fmtRelative,
  clientName,
  type ApiHandover,
  type FinanceHandoverStatus,
} from '@/lib/finance-api';
import { AdminAuthDeleteModal } from './AdminAuthDeleteModal';

// ---------- Config -------------------------------------------------------

const STATUS_TONE: Record<FinanceHandoverStatus, BadgeTone> = {
  SUBMITTED: 'neutral',
  IN_REVIEW: 'info',
  PAYMENT_RECORDED: 'accent',
  PAYMENT_VERIFIED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  SENT_TO_PROCESSING: 'violet',
};

const ALL_STATUSES: FinanceHandoverStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'PAYMENT_RECORDED',
  'PAYMENT_VERIFIED',
  'REJECTED',
  'CANCELLED',
  'SENT_TO_PROCESSING',
];

const ALL_METHODS = ['CASH', 'BANK', 'CARD', 'CHEQUE', 'MOBILE', 'WIRE', 'ONLINE', 'OTHER'];

type SortField = 'date' | 'amount' | 'client' | 'status';
type SortDir = 'asc' | 'desc';

// ---------- Filter state -------------------------------------------------

interface FilterState {
  search: string;
  status: FinanceHandoverStatus | '';
  method: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTER: FilterState = {
  search: '',
  status: '',
  method: '',
  dateFrom: '',
  dateTo: '',
};

// ---------- Helpers ------------------------------------------------------

function applyFilters(
  records: ApiHandover[],
  f: FilterState,
): ApiHandover[] {
  const q = f.search.toLowerCase();
  return records.filter((p) => {
    if (
      q &&
      !clientName(p).toLowerCase().includes(q) &&
      !p.id.toLowerCase().includes(q) &&
      !(p.transactionRef ?? '').toLowerCase().includes(q) &&
      !p.leadId.toLowerCase().includes(q)
    )
      return false;
    if (f.status && p.status !== f.status) return false;
    if (f.method && p.paymentMethod !== f.method) return false;
    if (f.dateFrom && new Date(p.submittedAt) < new Date(f.dateFrom))
      return false;
    if (f.dateTo) {
      const to = new Date(f.dateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(p.submittedAt) > to) return false;
    }
    return true;
  });
}

function sortRecords(
  records: ApiHandover[],
  field: SortField,
  dir: SortDir,
): ApiHandover[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...records].sort((a, b) => {
    switch (field) {
      case 'date':
        return sign * (+new Date(a.submittedAt) - +new Date(b.submittedAt));
      case 'amount':
        return sign * (parseFloat(a.submittedAmount) - parseFloat(b.submittedAmount));
      case 'client':
        return sign * clientName(a).localeCompare(clientName(b));
      case 'status':
        return sign * a.status.localeCompare(b.status);
    }
  });
}

// ---------- Sub-components -----------------------------------------------

function FilterPill({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'var(--sos-accent-muted)',
        border: '1px solid var(--sos-accent)',
        borderRadius: 99,
        padding: '2px 10px',
        fontSize: 'var(--sos-text-xs)',
        color: 'var(--sos-accent)',
        fontWeight: 500,
      }}
    >
      {label}
      <button
        onClick={onClear}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--sos-accent)',
          display: 'flex',
          alignItems: 'center',
          padding: 0,
        }}
      >
        <X size={11} />
      </button>
    </span>
  );
}

interface SelectFilterProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}

function SelectFilter({ label, value, options, onChange }: SelectFilterProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        style={{
          fontSize: 'var(--sos-text-xs)',
          color: 'var(--sos-muted)',
          fontWeight: 500,
        }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '6px 10px',
          borderRadius: 'var(--sos-radius-sm)',
          border: '1px solid var(--sos-border)',
          background: 'var(--sos-input-bg)',
          color: 'var(--sos-text)',
          fontSize: 'var(--sos-text-sm)',
          minWidth: 140,
        }}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface DateFilterProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function DateFilter({ label, value, onChange }: DateFilterProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        style={{
          fontSize: 'var(--sos-text-xs)',
          color: 'var(--sos-muted)',
          fontWeight: 500,
        }}
      >
        {label}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '6px 10px',
          borderRadius: 'var(--sos-radius-sm)',
          border: '1px solid var(--sos-border)',
          background: 'var(--sos-input-bg)',
          color: 'var(--sos-text)',
          fontSize: 'var(--sos-text-sm)',
        }}
      />
    </div>
  );
}

// ---------- Table row ----------------------------------------------------

function HistoryRow({
  payment,
  index,
  onAdminDelete,
}: {
  payment: ApiHandover;
  index: number;
  /** Triggers the admin-auth delete modal for this row. */
  onAdminDelete: () => void;
}) {
  const tone = STATUS_TONE[payment.status];
  const isEven = index % 2 === 0;
  // Don't offer to delete an already-deleted row.
  const canDelete = payment.status !== 'CANCELLED';

  return (
    <tr
      style={{
        background: isEven ? 'var(--sos-surface)' : 'var(--sos-surface-2)',
        transition: 'background 0.12s',
      }}
    >
      {/* ID */}
      <td
        style={{
          padding: '10px 12px',
          fontSize: 'var(--sos-text-xs)',
          fontFamily: 'monospace',
          color: 'var(--sos-accent)',
          whiteSpace: 'nowrap',
        }}
      >
        {payment.id.slice(0, 8)}
      </td>

      {/* Date */}
      <td
        style={{
          padding: '10px 12px',
          fontSize: 'var(--sos-text-xs)',
          color: 'var(--sos-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        {fmtRelative(payment.submittedAt)}
      </td>

      {/* Client */}
      <td style={{ padding: '10px 12px' }}>
        <div
          style={{
            fontSize: 'var(--sos-text-sm)',
            fontWeight: 600,
            color: 'var(--sos-text)',
          }}
        >
          {clientName(payment)}
        </div>
        <div
          style={{
            fontSize: 'var(--sos-text-xs)',
            color: 'var(--sos-muted)',
            marginTop: 2,
          }}
        >
          {payment.lead.serviceInterest ?? '—'} · {payment.lead.targetCountry ?? '—'}
        </div>
      </td>

      {/* Amount */}
      <td
        style={{
          padding: '10px 12px',
          textAlign: 'right',
          whiteSpace: 'nowrap',
        }}
      >
        <div
          style={{
            fontSize: 'var(--sos-text-sm)',
            fontWeight: 700,
            color: 'var(--sos-text)',
          }}
        >
          {fmtAmount(payment.submittedAmount, payment.currency)}
        </div>
      </td>

      {/* Method */}
      <td
        style={{
          padding: '10px 12px',
          fontSize: 'var(--sos-text-xs)',
          color: 'var(--sos-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        <div>{payment.paymentMethod ? (METHOD_LABEL[payment.paymentMethod] ?? payment.paymentMethod) : '—'}</div>
        {payment.transactionRef && (
          <div
            style={{
              fontFamily: 'monospace',
              marginTop: 2,
              color: 'var(--sos-text)',
            }}
          >
            {payment.transactionRef}
          </div>
        )}
      </td>

      {/* Status */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
        <StatusBadge tone={tone} size="sm">
          {STATUS_LABEL[payment.status]}
        </StatusBadge>
      </td>

      {/* Lead ID */}
      <td
        style={{
          padding: '10px 12px',
          fontSize: 'var(--sos-text-xs)',
          color: 'var(--sos-muted)',
          fontFamily: 'monospace',
        }}
      >
        {payment.leadId.slice(0, 8)}
      </td>

      {/* Actions */}
      <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            title="View detail"
            style={{
              background: 'var(--sos-surface-hover)',
              border: '1px solid var(--sos-border)',
              borderRadius: 'var(--sos-radius-sm)',
              padding: '4px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              color: 'var(--sos-muted)',
            }}
          >
            <Eye size={13} />
          </button>
          {canDelete ? (
            <button
              type="button"
              title="Delete (requires admin password)"
              onClick={onAdminDelete}
              style={{
                background: 'var(--sos-status-danger-soft)',
                border: '1px solid var(--sos-status-danger)',
                borderRadius: 'var(--sos-radius-sm)',
                padding: '4px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: 'var(--sos-status-danger)',
              }}
            >
              <Trash2 size={13} />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

// ---------- Sort header cell ---------------------------------------------

function SortTh({
  label,
  field,
  current,
  dir,
  onSort,
  align = 'left',
}: {
  label: string;
  field: SortField;
  current: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const active = current === field;
  return (
    <th
      onClick={() => onSort(field)}
      style={{
        padding: '10px 12px',
        fontSize: 'var(--sos-text-xs)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: active ? 'var(--sos-accent)' : 'var(--sos-muted)',
        cursor: 'pointer',
        userSelect: 'none',
        textAlign: align,
        whiteSpace: 'nowrap',
        background: 'var(--sos-surface-2)',
        borderBottom: '1px solid var(--sos-border)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        <ArrowUpDown
          size={11}
          style={{
            opacity: active ? 1 : 0.4,
            transform:
              active && dir === 'asc' ? 'scaleY(-1)' : 'scaleY(1)',
          }}
        />
      </span>
    </th>
  );
}

// ---------- Main page ----------------------------------------------------

export function FinanceHistoryPage() {
  const [allHandovers, setAllHandovers] = useState<ApiHandover[]>([]);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [deletingHandover, setDeletingHandover] = useState<ApiHandover | null>(null);

  useEffect(() => {
    fetchHandovers().then(setAllHandovers).catch(console.error);
  }, []);

  /** Step-up delete handler. Wraps the api call so the modal can surface
   *  the error inline if the admin password is wrong / role check fails. */
  async function handleAdminDelete(values: {
    adminEmail: string;
    adminPassword: string;
    reason: string;
  }) {
    if (!deletingHandover) return;
    await adminDeleteHandover(deletingHandover.id, values);
    setDeletingHandover(null);
    // Reload so the deleted row disappears from active filters (or
    // reflects its new CANCELLED status if the user is showing all).
    const fresh = await fetchHandovers();
    setAllHandovers(fresh);
  }

  const set = <K extends keyof FilterState>(key: K) =>
    (value: FilterState[K]) =>
      setFilters((prev) => ({ ...prev, [key]: value }));

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  const filtered = useMemo(
    () => applyFilters(allHandovers, filters),
    [allHandovers, filters],
  );

  const sorted = useMemo(
    () => sortRecords(filtered, sortField, sortDir),
    [filtered, sortField, sortDir],
  );

  // Active filter pills
  const activePills: Array<{ label: string; clear: () => void }> = [];
  if (filters.status)
    activePills.push({ label: STATUS_LABEL[filters.status], clear: () => set('status')('') });
  if (filters.method)
    activePills.push({ label: METHOD_LABEL[filters.method] ?? filters.method, clear: () => set('method')('') });
  if (filters.dateFrom)
    activePills.push({ label: `From: ${filters.dateFrom}`, clear: () => set('dateFrom')('') });
  if (filters.dateTo)
    activePills.push({ label: `To: ${filters.dateTo}`, clear: () => set('dateTo')('') });

  const hasFilters =
    filters.search ||
    filters.status ||
    filters.method ||
    filters.dateFrom ||
    filters.dateTo;

  // Summary totals
  const totalFiltered = filtered.reduce((s, p) => s + parseFloat(p.submittedAmount), 0);
  const verifiedCount = filtered.filter(
    (p) => p.status === 'PAYMENT_VERIFIED' || p.status === 'SENT_TO_PROCESSING',
  ).length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sos-space-5)',
        maxWidth: 1280,
        margin: '0 auto',
      }}
    >
      {/* Page header */}
      <PageHeader
        eyebrow="Finance"
        title="Payment History"
        description="Searchable audit log of all payment records"
        actions={
          <div style={{ display: 'flex', gap: 'var(--sos-space-2)' }}>
            <GhostButton>
              <Download size={15} /> Export CSV
            </GhostButton>
            <GhostButton>
              <Download size={15} /> Export PDF
            </GhostButton>
          </div>
        }
      />

      {/* Search + filter bar */}
      <GlassCard>
        <div
          style={{
            padding: 'var(--sos-space-4) var(--sos-space-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sos-space-3)',
          }}
        >
          {/* Search row */}
          <div style={{ display: 'flex', gap: 'var(--sos-space-3)', alignItems: 'center' }}>
            <div
              style={{
                flex: 1,
                position: 'relative',
              }}
            >
              <Search
                size={15}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--sos-muted)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="text"
                placeholder="Search by client name, payment ID, receipt number, reference…"
                value={filters.search}
                onChange={(e) => set('search')(e.target.value)}
                style={{
                  width: '100%',
                  paddingLeft: 36,
                  paddingRight: 12,
                  paddingTop: 8,
                  paddingBottom: 8,
                  borderRadius: 'var(--sos-radius-md)',
                  border: '1px solid var(--sos-border)',
                  background: 'var(--sos-input-bg)',
                  color: 'var(--sos-text)',
                  fontSize: 'var(--sos-text-sm)',
                  boxSizing: 'border-box',
                }}
              />
              {filters.search && (
                <button
                  onClick={() => set('search')('')}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--sos-muted)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <SecondaryButton onClick={() => setShowFilters((v) => !v)}>
              <Filter size={14} />
              Filters
              {activePills.length > 0 && (
                <span
                  style={{
                    background: 'var(--sos-accent)',
                    color: '#fff',
                    borderRadius: 99,
                    padding: '0 5px',
                    fontSize: 'var(--sos-text-xs)',
                    fontWeight: 700,
                  }}
                >
                  {activePills.length}
                </span>
              )}
            </SecondaryButton>

            {hasFilters && (
              <GhostButton
                onClick={() => setFilters(EMPTY_FILTER)}
              >
                <X size={14} /> Clear all
              </GhostButton>
            )}
          </div>

          {/* Active pills */}
          {activePills.length > 0 && (
            <div style={{ display: 'flex', gap: 'var(--sos-space-2)', flexWrap: 'wrap' }}>
              {activePills.map((p) => (
                <FilterPill key={p.label} label={p.label} onClear={p.clear} />
              ))}
            </div>
          )}

          {/* Expanded filter panel */}
          {showFilters && (
            <div
              style={{
                display: 'flex',
                gap: 'var(--sos-space-4)',
                flexWrap: 'wrap',
                paddingTop: 'var(--sos-space-3)',
                borderTop: '1px solid var(--sos-border)',
              }}
            >
              <SelectFilter
                label="Status"
                value={filters.status}
                options={ALL_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                onChange={(v) => set('status')(v as FinanceHandoverStatus | '')}
              />
              <SelectFilter
                label="Payment method"
                value={filters.method}
                options={ALL_METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] ?? m }))}
                onChange={(v) => set('method')(v)}
              />
              <DateFilter
                label="Date from"
                value={filters.dateFrom}
                onChange={(v) => set('dateFrom')(v)}
              />
              <DateFilter
                label="Date to"
                value={filters.dateTo}
                onChange={(v) => set('dateTo')(v)}
              />
            </div>
          )}
        </div>
      </GlassCard>

      {/* Results summary */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--sos-space-4)',
          flexWrap: 'wrap',
        }}
      >
        <p
          style={{
            fontSize: 'var(--sos-text-sm)',
            color: 'var(--sos-muted)',
          }}
        >
          Showing{' '}
          <strong style={{ color: 'var(--sos-text)' }}>{sorted.length}</strong>{' '}
          of {allHandovers.length} records
          {hasFilters && ' (filtered)'}
        </p>
        <div style={{ display: 'flex', gap: 'var(--sos-space-4)', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)' }}>
              Total (filtered)
            </p>
            <p style={{ fontSize: 'var(--sos-text-sm)', fontWeight: 700, color: 'var(--sos-text)' }}>
              CAD {totalFiltered.toLocaleString()}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)' }}>
              Verified / Confirmed
            </p>
            <p style={{ fontSize: 'var(--sos-text-sm)', fontWeight: 700, color: 'var(--sos-text)' }}>
              {verifiedCount} records
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <EmptyState
          Icon={Calendar}
          title="No records match your filters"
          description="Try adjusting the search or clearing filters to see more results."
          action={
            <GhostButton onClick={() => setFilters(EMPTY_FILTER)}>
              Clear all filters
            </GhostButton>
          }
        />
      ) : (
        <GlassCard>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 'var(--sos-text-sm)',
              }}
            >
              <thead>
                <tr>
                  <SortTh label="Receipt / ID" field="date" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortTh label="Date" field="date" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortTh label="Client" field="client" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortTh label="Amount" field="amount" current={sortField} dir={sortDir} onSort={handleSort} align="right" />
                  <th
                    style={{
                      padding: '10px 12px',
                      fontSize: 'var(--sos-text-xs)',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--sos-muted)',
                      textAlign: 'left',
                      background: 'var(--sos-surface-2)',
                      borderBottom: '1px solid var(--sos-border)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Method / Ref
                  </th>
                  <SortTh label="Status" field="status" current={sortField} dir={sortDir} onSort={handleSort} />
                  <th
                    style={{
                      padding: '10px 12px',
                      fontSize: 'var(--sos-text-xs)',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--sos-muted)',
                      textAlign: 'left',
                      background: 'var(--sos-surface-2)',
                      borderBottom: '1px solid var(--sos-border)',
                    }}
                  >
                    Lead ID
                  </th>
                  <th
                    style={{
                      padding: '10px 12px',
                      fontSize: 'var(--sos-text-xs)',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--sos-muted)',
                      background: 'var(--sos-surface-2)',
                      borderBottom: '1px solid var(--sos-border)',
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p, i) => (
                  <HistoryRow
                    key={p.id}
                    payment={p}
                    index={i}
                    onAdminDelete={() => setDeletingHandover(p)}
                  />
                ))}
              </tbody>
              {/* Footer totals row */}
              <tfoot>
                <tr>
                  <td
                    colSpan={3}
                    style={{
                      padding: '10px 12px',
                      fontSize: 'var(--sos-text-xs)',
                      fontWeight: 600,
                      color: 'var(--sos-muted)',
                      background: 'var(--sos-surface-2)',
                      borderTop: '2px solid var(--sos-border)',
                    }}
                  >
                    {sorted.length} record{sorted.length !== 1 ? 's' : ''}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      fontSize: 'var(--sos-text-sm)',
                      fontWeight: 700,
                      color: 'var(--sos-text)',
                      textAlign: 'right',
                      background: 'var(--sos-surface-2)',
                      borderTop: '2px solid var(--sos-border)',
                    }}
                  >
                    CAD{' '}
                    {sorted
                      .reduce((s, p) => s + parseFloat(p.submittedAmount), 0)
                      .toLocaleString()}
                  </td>
                  <td
                    colSpan={5}
                    style={{
                      background: 'var(--sos-surface-2)',
                      borderTop: '2px solid var(--sos-border)',
                    }}
                  />
                </tr>
              </tfoot>
            </table>
          </div>
        </GlassCard>
      )}

      <AdminAuthDeleteModal
        open={deletingHandover !== null}
        onClose={() => setDeletingHandover(null)}
        title="Delete finance handover"
        subject={
          deletingHandover
            ? `${clientName(deletingHandover)} · ${fmtAmount(deletingHandover.submittedAmount, deletingHandover.currency)} · ${STATUS_LABEL[deletingHandover.status]}`
            : undefined
        }
        onConfirm={handleAdminDelete}
      />
    </div>
  );
}
