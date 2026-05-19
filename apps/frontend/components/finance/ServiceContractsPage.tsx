'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  FileSignature,
  FileText,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  createServiceContract,
  displayContactName,
  fmtDate,
  fmtMoney,
  listServiceContracts,
  type ApiServiceContract,
  type CreateInstallmentInput,
  type ServiceContractStatus,
} from '@/lib/service-contracts-api';

type TabKey = 'ALL' | ServiceContractStatus;

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

function statusTone(status: ServiceContractStatus): BadgeTone {
  switch (status) {
    case 'DRAFT':
      return 'neutral';
    case 'ACTIVE':
      return 'info';
    case 'COMPLETED':
      return 'success';
    case 'CANCELLED':
      return 'warning';
    default:
      return 'neutral';
  }
}

interface InstallmentRowDraft {
  // Local-only id used as React key while editing.
  key: string;
  dueDate: string;
  amount: string;
  description: string;
}

function emptyInstallment(): InstallmentRowDraft {
  return {
    key: Math.random().toString(36).slice(2),
    dueDate: '',
    amount: '',
    description: '',
  };
}

export function ServiceContractsPage() {
  const [contracts, setContracts] = useState<ApiServiceContract[]>([]);
  const [tab, setTab] = useState<TabKey>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [linkType, setLinkType] = useState<'lead' | 'client'>('lead');
  const [linkId, setLinkId] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [currency, setCurrency] = useState('CAD');
  const [signedDate, setSignedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [installments, setInstallments] = useState<InstallmentRowDraft[]>([
    emptyInstallment(),
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listServiceContracts({
        ...(tab !== 'ALL' ? { status: tab } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      setContracts(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load contracts');
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  const counts = useMemo(() => {
    return {
      total: contracts.length,
      active: contracts.filter((c) => c.status === 'ACTIVE').length,
      draft: contracts.filter((c) => c.status === 'DRAFT').length,
      completed: contracts.filter((c) => c.status === 'COMPLETED').length,
    };
  }, [contracts]);

  const sumOfInstallments = useMemo(() => {
    return installments.reduce((acc, i) => {
      const n = Number(i.amount);
      return acc + (isFinite(n) ? n : 0);
    }, 0);
  }, [installments]);

  const totalParsed = Number(totalAmount);
  const totalMismatch =
    isFinite(totalParsed) &&
    totalParsed > 0 &&
    Math.abs(sumOfInstallments - totalParsed) > 0.01;

  function resetForm() {
    setLinkType('lead');
    setLinkId('');
    setTotalAmount('');
    setCurrency('CAD');
    setSignedDate('');
    setNotes('');
    setInstallments([emptyInstallment()]);
  }

  function openForm() {
    resetForm();
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
  }

  function updateInstallment(key: string, patch: Partial<InstallmentRowDraft>) {
    setInstallments((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addInstallmentRow() {
    setInstallments((prev) => [...prev, emptyInstallment()]);
  }

  function removeInstallmentRow(key: string) {
    setInstallments((prev) =>
      prev.length > 1 ? prev.filter((row) => row.key !== key) : prev,
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const totalNum = Number(totalAmount);
      if (!isFinite(totalNum) || totalNum <= 0) {
        throw new Error('Total amount must be a positive number.');
      }
      if (!linkId.trim()) {
        throw new Error(`${linkType === 'lead' ? 'Lead' : 'Client'} ID is required.`);
      }

      const parsedInstallments: CreateInstallmentInput[] = installments.map((row, idx) => {
        const amount = Number(row.amount);
        if (!isFinite(amount) || amount <= 0) {
          throw new Error(`Installment ${idx + 1}: amount must be a positive number.`);
        }
        if (!row.dueDate) {
          throw new Error(`Installment ${idx + 1}: due date is required.`);
        }
        return {
          sequence: idx + 1,
          dueDate: row.dueDate,
          amount,
          description: row.description.trim() || undefined,
        };
      });

      if (Math.abs(sumOfInstallments - totalNum) > 0.01) {
        throw new Error(
          `Installments sum to ${sumOfInstallments.toFixed(2)} but contract total is ${totalNum.toFixed(2)}.`,
        );
      }

      await createServiceContract({
        ...(linkType === 'lead'
          ? { leadId: linkId.trim() }
          : { clientId: linkId.trim() }),
        totalAmount: totalNum,
        currency: currency.trim() || 'CAD',
        signedDate: signedDate || undefined,
        notes: notes.trim() || undefined,
        installments: parsedInstallments,
      });

      setSuccess('Service contract created.');
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create contract');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Finance · Contracts"
        title="Service Contracts"
        description="Signed agreements with installment schedules. Each installment becomes an invoice when generated."
        actions={
          <PrimaryButton iconLeft={<Plus size={15} />} onClick={openForm}>
            New Contract
          </PrimaryButton>
        }
      />

      {/* KPI strip */}
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        }}
      >
        <MetricCard label="Total" value={counts.total} tone="info" Icon={FileSignature} hint="All contracts" />
        <MetricCard label="Active" value={counts.active} tone="success" Icon={FileText} hint="Signed & billing" />
        <MetricCard label="Drafts" value={counts.draft} tone="neutral" Icon={FileText} hint="Pending signature" />
        <MetricCard label="Completed" value={counts.completed} tone="accent" Icon={FileText} hint="All installments paid" />
      </div>

      {success ? (
        <GlassCard
          variant="soft"
          padded="sm"
          style={{ borderLeft: '4px solid var(--sos-status-success)', display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <span style={{ fontSize: 13.5, color: 'var(--sos-text-primary)', flex: 1 }}>{success}</span>
          <button
            onClick={() => setSuccess(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sos-text-muted)', display: 'flex' }}
          >
            <X size={14} />
          </button>
        </GlassCard>
      ) : null}

      {/* Inline form */}
      {formOpen ? (
        <GlassCard variant="strong" padded="lg" glow="accent">
          <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div className="sos-eyebrow">New contract</div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)', marginTop: 6 }}>
                  Create a service contract
                </h2>
                <p style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginTop: 4 }}>
                  Set the agreed total fee and break it into installments. Each installment can later be invoiced.
                </p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, color: 'var(--sos-text-muted)', display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Link to lead/client */}
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Linked to
                </span>
                <select
                  value={linkType}
                  onChange={(e) => setLinkType(e.target.value as 'lead' | 'client')}
                  className="sos-select"
                >
                  <option value="lead">Lead</option>
                  <option value="client">Client</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: 'span 2' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {linkType === 'lead' ? 'Lead ID' : 'Client ID'} (UUID)
                </span>
                <input
                  required
                  value={linkId}
                  onChange={(e) => setLinkId(e.target.value)}
                  placeholder="Paste UUID from the lead/client profile page URL"
                  className="sos-input"
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </label>
            </div>

            {/* Totals */}
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Total amount
                </span>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="0.00"
                  className="sos-input"
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Currency
                </span>
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={8}
                  className="sos-input"
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Signed date (optional)
                </span>
                <input
                  type="date"
                  value={signedDate}
                  onChange={(e) => setSignedDate(e.target.value)}
                  className="sos-input"
                />
              </label>
            </div>

            {/* Installments */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Installments
                </div>
                <SecondaryButton type="button" iconLeft={<Plus size={13} />} onClick={addInstallmentRow}>
                  Add installment
                </SecondaryButton>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {installments.map((row, idx) => (
                  <div
                    key={row.key}
                    style={{
                      display: 'grid',
                      gap: 8,
                      gridTemplateColumns: '50px 160px 140px 1fr 40px',
                      alignItems: 'center',
                      padding: '10px 12px',
                      background: 'var(--sos-surface-1)',
                      borderRadius: 'var(--sos-radius-sm)',
                      border: '1px solid var(--sos-border-subtle)',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-muted)' }}>#{idx + 1}</div>
                    <input
                      type="date"
                      required
                      value={row.dueDate}
                      onChange={(e) => updateInstallment(row.key, { dueDate: e.target.value })}
                      className="sos-input"
                      style={{ fontSize: 13 }}
                    />
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={row.amount}
                      onChange={(e) => updateInstallment(row.key, { amount: e.target.value })}
                      placeholder="Amount"
                      className="sos-input"
                      style={{ fontSize: 13 }}
                    />
                    <input
                      value={row.description}
                      onChange={(e) => updateInstallment(row.key, { description: e.target.value })}
                      placeholder='e.g. "On signing", "After medical exam"'
                      className="sos-input"
                      style={{ fontSize: 13 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeInstallmentRow(row.key)}
                      disabled={installments.length === 1}
                      title="Remove installment"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: installments.length === 1 ? 'not-allowed' : 'pointer',
                        opacity: installments.length === 1 ? 0.3 : 1,
                        color: 'var(--sos-status-danger)',
                        display: 'flex',
                        justifyContent: 'center',
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Running total */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 16,
                  fontSize: 13,
                  color: totalMismatch ? 'var(--sos-status-danger)' : 'var(--sos-text-secondary)',
                  fontWeight: 600,
                  padding: '8px 12px',
                  background: totalMismatch ? 'var(--sos-status-danger-soft)' : 'transparent',
                  borderRadius: 'var(--sos-radius-sm)',
                }}
              >
                <span>
                  Sum: {fmtMoney(sumOfInstallments, currency || 'CAD')}
                  {totalMismatch ? ` (must equal ${fmtMoney(totalParsed, currency || 'CAD')})` : ''}
                </span>
              </div>
            </div>

            {/* Notes */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Notes (optional)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Any context for finance — special terms, milestones, etc."
                className="sos-input"
              />
            </label>

            {error ? (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--sos-radius-sm)',
                  background: 'var(--sos-status-danger-soft)',
                  border: '1px solid var(--sos-status-danger-border)',
                  fontSize: 13,
                  color: 'var(--sos-status-danger)',
                }}
              >
                {error}
              </div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <SecondaryButton type="button" onClick={closeForm}>Cancel</SecondaryButton>
              <PrimaryButton
                type="submit"
                disabled={submitting || totalMismatch}
                iconLeft={submitting ? <Loader2 size={14} className="sos-spin" /> : <Plus size={14} />}
              >
                {submitting ? 'Creating…' : 'Create contract'}
              </PrimaryButton>
            </div>
          </form>
        </GlassCard>
      ) : null}

      {/* Tabs + search */}
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
          <div
            style={{
              flex: 1,
              minWidth: 220,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Search
              size={14}
              style={{ position: 'absolute', left: 12, color: 'var(--sos-text-muted)' }}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by contract number, client name, or reference code…"
              className="sos-input"
              style={{ paddingLeft: 34 }}
            />
          </div>
        </div>
      </GlassCard>

      {/* Results */}
      <GlassCard variant="panel" padded={false}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            Loading contracts…
          </div>
        ) : error && contracts.length === 0 ? (
          <div
            style={{
              padding: 24,
              color: 'var(--sos-status-danger)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : contracts.length === 0 ? (
          <EmptyState
            Icon={FileSignature}
            title="No contracts yet"
            description="Click ‘New Contract’ to create the first one."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr style={{ background: 'var(--sos-surface-1)' }}>
                  {['Contract', 'Customer', 'Total', 'Installments', 'Signed', 'Status', ''].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                        color: 'var(--sos-text-muted)',
                        borderBottom: '1px solid var(--sos-divider)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const customer = c.client ?? c.lead;
                  const paidCount = c.installments.filter((i) => i.status === 'PAID').length;
                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--sos-divider)' }}>
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        <Link
                          href={`/finance/contracts/${c.id}` as Route}
                          style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}
                        >
                          {c.contractNumber}
                        </Link>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontSize: 13, color: 'var(--sos-text-primary)' }}>{displayContactName(customer)}</div>
                        {customer ? (
                          <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{customer.referenceCode}</div>
                        ) : null}
                      </td>
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600 }}>
                        {fmtMoney(c.totalAmount, c.currency)}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>
                        {paidCount}/{c.installments.length} paid
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>
                        {fmtDate(c.signedDate)}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <StatusBadge tone={statusTone(c.status)} size="sm">{c.status}</StatusBadge>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <Link
                          href={`/finance/contracts/${c.id}` as Route}
                          className="sos-btn sos-btn--ghost sos-btn--sm"
                        >
                          Open
                        </Link>
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
