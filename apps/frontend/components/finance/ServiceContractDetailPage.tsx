'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowLeft, FileSignature, Loader2, Receipt as ReceiptIcon } from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  PageHeader,
  PrimaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  displayContactName,
  fmtDate,
  fmtMoney,
  generateInvoiceForInstallment,
  getServiceContract,
  type ApiServiceContract,
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

export function ServiceContractDetailPage({ contractId }: Props) {
  const [contract, setContract] = useState<ApiServiceContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

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

      {/* Installments */}
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

        {contract.installments.length === 0 ? (
          <EmptyState
            Icon={FileSignature}
            title="No installments"
            description="This contract has no scheduled installments."
          />
        ) : (
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
