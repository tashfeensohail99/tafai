'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Plus,
  Receipt as ReceiptIcon,
  Trash2,
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
  addInstallments,
  displayContactName,
  fmtDate,
  fmtMoney,
  generateInvoiceForInstallment,
  getAgreementDownloadUrl,
  getServiceContract,
  type ApiServiceContract,
  type CreateInstallmentInput,
  type InstallmentStatus,
  type ServiceContractStatus,
} from '@/lib/service-contracts-api';

interface Props {
  contractId: string;
}

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

function installmentTone(status: InstallmentStatus): BadgeTone {
  switch (status) {
    case 'PENDING':
      return 'neutral';
    case 'INVOICED':
      return 'info';
    case 'PAID':
      return 'success';
    case 'OVERDUE':
      return 'danger';
    case 'CANCELLED':
      return 'warning';
    default:
      return 'neutral';
  }
}

interface InstallmentDraft {
  key: string;
  dueDate: string;
  amount: string;
  description: string;
}

function emptyInstallment(): InstallmentDraft {
  return {
    key: Math.random().toString(36).slice(2),
    dueDate: '',
    amount: '',
    description: '',
  };
}

export function ServiceContractDetailPage({ contractId }: Props) {
  const [contract, setContract] = useState<ApiServiceContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [downloadingAgreement, setDownloadingAgreement] = useState(false);

  const [scheduleDrafts, setScheduleDrafts] = useState<InstallmentDraft[]>([emptyInstallment()]);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getServiceContract(contractId);
      setContract(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load contract');
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  async function handleGenerate(installmentId: string) {
    setGeneratingId(installmentId);
    setError(null);
    try {
      const result = await generateInvoiceForInstallment(installmentId);
      setSuccess(`Invoice ${result.invoiceNumber} generated.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate invoice');
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleDownloadAgreement() {
    if (!contract) return;
    setDownloadingAgreement(true);
    setError(null);
    try {
      const data = await getAgreementDownloadUrl(contract.id);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch agreement');
    } finally {
      setDownloadingAgreement(false);
    }
  }

  function updateDraft(key: string, patch: Partial<InstallmentDraft>) {
    setScheduleDrafts((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addDraft() {
    setScheduleDrafts((prev) => [...prev, emptyInstallment()]);
  }

  function removeDraft(key: string) {
    setScheduleDrafts((prev) =>
      prev.length > 1 ? prev.filter((row) => row.key !== key) : prev,
    );
  }

  async function handleSaveSchedule() {
    if (!contract) return;
    setError(null);
    setSavingSchedule(true);
    try {
      const installments: CreateInstallmentInput[] = scheduleDrafts.map((row, idx) => {
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
      const sum = installments.reduce((acc, i) => acc + i.amount, 0);
      const total = Number(contract.totalAmount);
      if (Math.abs(sum - total) > 0.01) {
        throw new Error(
          `Installments sum to ${sum.toFixed(2)} but contract total is ${total.toFixed(2)}.`,
        );
      }
      await addInstallments(contract.id, installments);
      setSuccess('Installment schedule saved. Contract is now active.');
      setScheduleDrafts([emptyInstallment()]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  }

  if (loading && !contract) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-muted)' }}>Loading contract…</div>;
  }

  if (error && !contract) {
    return (
      <div style={{ padding: 24 }}>
        <Link href={'/finance/contracts' as Route} className="sos-btn sos-btn--ghost sos-btn--sm" style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={13} /> Back to contracts
        </Link>
        <GlassCard variant="panel" padded="lg">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{error}</div>
        </GlassCard>
      </div>
    );
  }

  if (!contract) return null;

  const customer = contract.client ?? contract.lead;
  const paidAmount = contract.installments
    .filter((i) => i.status === 'PAID')
    .reduce((acc, i) => acc + Number(i.amount), 0);
  const outstanding = Number(contract.totalAmount) - paidAmount;

  const needsSchedule = contract.installments.length === 0 && contract.status !== 'CANCELLED';
  const draftSum = scheduleDrafts.reduce((acc, row) => {
    const n = Number(row.amount);
    return acc + (isFinite(n) ? n : 0);
  }, 0);
  const draftMismatch = Math.abs(draftSum - Number(contract.totalAmount)) > 0.01;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Link
        href={'/finance/contracts' as Route}
        className="sos-btn sos-btn--ghost sos-btn--sm"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}
      >
        <ArrowLeft size={13} /> Back to contracts
      </Link>

      <PageHeader
        eyebrow={`Finance · ${contract.contractNumber}`}
        title={displayContactName(customer)}
        description={
          customer
            ? `${customer.referenceCode} · ${customer.phone}${customer.email ? ` · ${customer.email}` : ''}`
            : 'No linked customer'
        }
        actions={<StatusBadge tone={statusTone(contract.status)} size="md">{contract.status}</StatusBadge>}
      />

      {success ? (
        <GlassCard
          variant="soft"
          padded="sm"
          style={{ borderLeft: '4px solid var(--sos-status-success)', fontSize: 13.5, color: 'var(--sos-text-primary)' }}
        >
          {success}
        </GlassCard>
      ) : null}

      {error ? (
        <GlassCard
          variant="soft"
          padded="sm"
          style={{ borderLeft: '4px solid var(--sos-status-danger)', fontSize: 13.5, color: 'var(--sos-status-danger)' }}
        >
          {error}
        </GlassCard>
      ) : null}

      {/* Summary panel */}
      <GlassCard variant="panel" padded="lg">
        <div
          style={{
            display: 'grid',
            gap: 24,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          <SummaryStat label="Total fee" value={fmtMoney(contract.totalAmount, contract.currency)} />
          <SummaryStat label="Paid" value={fmtMoney(paidAmount, contract.currency)} />
          <SummaryStat label="Outstanding" value={fmtMoney(outstanding, contract.currency)} accent />
          <SummaryStat label="Signed on" value={fmtDate(contract.signedDate)} />
          <SummaryStat label="Currency" value={contract.currency} />
        </div>

        {contract.notes ? (
          <div style={{ marginTop: 18, padding: '12px 14px', background: 'var(--sos-surface-1)', borderRadius: 8, fontSize: 13, color: 'var(--sos-text-secondary)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Notes</div>
            {contract.notes}
          </div>
        ) : null}
      </GlassCard>

      {/* Agreement card */}
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 'var(--sos-radius-sm)',
                background: contract.agreementKey ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: contract.agreementKey ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)',
              }}
            >
              <FileText size={20} />
            </div>
            <div>
              <div className="sos-eyebrow">Signed agreement</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)', marginTop: 4 }}>
                {contract.agreementFileName ?? 'No agreement uploaded'}
              </div>
              {contract.agreementSizeBytes ? (
                <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                  {(contract.agreementSizeBytes / 1024).toFixed(0)} KB · {contract.agreementMimeType ?? 'file'}
                </div>
              ) : null}
            </div>
          </div>
          {contract.agreementKey ? (
            <PrimaryButton
              disabled={downloadingAgreement}
              iconLeft={downloadingAgreement ? <Loader2 size={14} className="sos-spin" /> : <Download size={14} />}
              onClick={() => void handleDownloadAgreement()}
            >
              {downloadingAgreement ? 'Opening…' : 'Download / view'}
            </PrimaryButton>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', fontStyle: 'italic' }}>
              Sales uploads the signed PDF from the lead profile&apos;s Finance tab.
            </span>
          )}
        </div>
      </GlassCard>

      {/* Set installment schedule — only when contract has no installments yet */}
      {needsSchedule ? (
        <GlassCard variant="strong" padded="lg" glow="accent">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="sos-eyebrow">Action needed</div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--sos-text-primary)', marginTop: 6 }}>
                Set the installment schedule
              </h2>
              <p style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginTop: 4 }}>
                Read the uploaded agreement and break the total of{' '}
                <strong>{fmtMoney(contract.totalAmount, contract.currency)}</strong> into installments.
                Each installment becomes an invoice when its due-date arrives.
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Installments
              </div>
              <SecondaryButton type="button" iconLeft={<Plus size={13} />} onClick={addDraft}>
                Add installment
              </SecondaryButton>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {scheduleDrafts.map((row, idx) => (
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
                    onChange={(e) => updateDraft(row.key, { dueDate: e.target.value })}
                    className="sos-input"
                    style={{ fontSize: 13 }}
                  />
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={row.amount}
                    onChange={(e) => updateDraft(row.key, { amount: e.target.value })}
                    placeholder="Amount"
                    className="sos-input"
                    style={{ fontSize: 13 }}
                  />
                  <input
                    value={row.description}
                    onChange={(e) => updateDraft(row.key, { description: e.target.value })}
                    placeholder='e.g. "On signing", "After visa approval"'
                    className="sos-input"
                    style={{ fontSize: 13 }}
                  />
                  <button
                    type="button"
                    onClick={() => removeDraft(row.key)}
                    disabled={scheduleDrafts.length === 1}
                    title="Remove installment"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: scheduleDrafts.length === 1 ? 'not-allowed' : 'pointer',
                      opacity: scheduleDrafts.length === 1 ? 0.3 : 1,
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

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 16,
                fontSize: 13,
                color: draftMismatch ? 'var(--sos-status-danger)' : 'var(--sos-text-secondary)',
                fontWeight: 600,
                padding: '8px 12px',
                background: draftMismatch ? 'var(--sos-status-danger-soft)' : 'transparent',
                borderRadius: 'var(--sos-radius-sm)',
              }}
            >
              <span>Schedule sum</span>
              <span>
                {fmtMoney(draftSum, contract.currency)}
                {draftMismatch ? ` (needs to equal ${fmtMoney(contract.totalAmount, contract.currency)})` : ''}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <PrimaryButton
                disabled={savingSchedule || draftMismatch}
                iconLeft={savingSchedule ? <Loader2 size={14} className="sos-spin" /> : <Plus size={14} />}
                onClick={() => void handleSaveSchedule()}
              >
                {savingSchedule ? 'Saving…' : 'Save schedule & activate'}
              </PrimaryButton>
            </div>
          </div>
        </GlassCard>
      ) : null}

      {/* Installments — only when set */}
      {contract.installments.length > 0 ? (
      <GlassCard variant="panel" padded={false}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid var(--sos-divider)',
          }}
        >
          <div>
            <div className="sos-eyebrow">Schedule</div>
            <h2 className="sos-title" style={{ fontSize: 16, marginTop: 4 }}>Installments</h2>
          </div>
        </div>

        {(
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr style={{ background: 'var(--sos-surface-1)' }}>
                  {['#', 'Due date', 'Amount', 'Description', 'Status', 'Invoice', ''].map((h) => (
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
                {contract.installments.map((inst) => {
                  const canGenerate = !inst.invoice && inst.status !== 'CANCELLED';
                  const isGenerating = generatingId === inst.id;
                  return (
                    <tr key={inst.id} style={{ borderBottom: '1px solid var(--sos-divider)' }}>
                      <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 600, color: 'var(--sos-text-muted)' }}>
                        #{inst.sequence}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--sos-text-secondary)', whiteSpace: 'nowrap' }}>
                        {fmtDate(inst.dueDate)}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {fmtMoney(inst.amount, contract.currency)}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--sos-text-secondary)' }}>
                        {inst.description ?? <span style={{ color: 'var(--sos-text-muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <StatusBadge tone={installmentTone(inst.status)} size="sm">{inst.status}</StatusBadge>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>
                        {inst.invoice ? (
                          <span style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>{inst.invoice.invoiceNumber}</span>
                        ) : (
                          <span style={{ color: 'var(--sos-text-muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {canGenerate ? (
                          <PrimaryButton
                            size="sm"
                            disabled={isGenerating}
                            iconLeft={isGenerating ? <Loader2 size={13} className="sos-spin" /> : <ReceiptIcon size={13} />}
                            onClick={() => void handleGenerate(inst.id)}
                          >
                            {isGenerating ? 'Generating…' : 'Generate Invoice'}
                          </PrimaryButton>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
      ) : null}
    </div>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--sos-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: accent ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-primary)',
        }}
      >
        {value}
      </div>
    </div>
  );
}
