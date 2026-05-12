'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { downloadCsv } from '@/lib/csv-download';
import { useAdminSession } from '@/components/layout/AdminShell';
import { PageHeader } from '@/components/shared/PageHeader';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

interface LeadOption {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  status: string;
}

interface ClientOption {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  currency: string;
  lead?: { id: string; firstName: string; lastName: string; phone: string } | null;
  client?: { id: string; firstName: string; lastName: string; phone: string } | null;
  payments?: Array<{ id: string; amount: string; status: string }>;
}

interface QueueRow {
  id: string;
  amount: string;
  status: string;
  paymentMethod?: string | null;
  transactionRef?: string | null;
  createdAt: string;
  invoice: {
    id: string;
    invoiceNumber: string;
    lead?: { id: string; firstName: string; lastName: string; phone: string } | null;
    client?: { id: string; firstName: string; lastName: string; phone: string } | null;
  };
}

interface HandoverRow {
  id: string;
  status: string;
  submittedAmount: string;
  currency: string;
  paymentMethod?: string | null;
  transactionRef?: string | null;
  financeNotes?: string | null;
  receiptFileName: string;
  receiptDownloadUrl?: string | null;
  createdAt: string;
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
  };
  invoice?: {
    id: string;
    invoiceNumber: string;
    status: string;
  } | null;
  payment?: {
    id: string;
    status: string;
  } | null;
}

interface InvoiceFormState {
  ownerType: 'lead' | 'client';
  ownerId: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  notes: string;
}

interface RevenueRollup {
  asOf: string;
  totals: { month: number; ytd: number; allTime: number };
  byService: Array<{ service: string; month: number; ytd: number; allTime: number }>;
}

interface PaymentFormState {
  invoiceId: string;
  amount: string;
  paymentMethod: string;
  transactionRef: string;
  notes: string;
}

const initialInvoiceForm: InvoiceFormState = {
  ownerType: 'lead',
  ownerId: '',
  subtotal: '',
  taxAmount: '0',
  discountAmount: '0',
  notes: '',
};

const initialPaymentForm: PaymentFormState = {
  invoiceId: '',
  amount: '',
  paymentMethod: 'Cash',
  transactionRef: '',
  notes: '',
};

const invoiceColumns: DataTableColumn<InvoiceRow>[] = [
  { key: 'invoice', header: 'Invoice', render: (row) => row.invoiceNumber },
  { key: 'owner', header: 'Owner', render: (row) => row.lead ? `${row.lead.firstName} ${row.lead.lastName}` : row.client ? `${row.client.firstName} ${row.client.lastName}` : 'Ã¢â‚¬â€' },
  { key: 'total', header: 'Total', render: (row) => `${row.currency} ${row.totalAmount}` },
  { key: 'paid', header: 'Paid', render: (row) => `${row.currency} ${row.paidAmount}` },
  { key: 'payments', header: 'Payments', render: (row) => `${row.payments?.length ?? 0}` },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge type="invoice" status={row.status} /> },
];

export default function FinancePage() {
  const { user } = useAdminSession();
  const [revenue, setRevenue] = useState<RevenueRollup | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [handovers, setHandovers] = useState<HandoverRow[]>([]);
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(initialInvoiceForm);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(initialPaymentForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [invoiceRows, queueRows, handoverRows, leadRows, clientRows] = await Promise.all([
        apiFetch<InvoiceRow[]>('/finance/invoices'),
        apiFetch<QueueRow[]>('/finance/queue'),
        apiFetch<HandoverRow[]>('/finance/handovers'),
        user.permissions.includes('leads.view_all') ? apiFetch<LeadOption[]>('/leads') : Promise.resolve([]),
        user.permissions.includes('clients.view_all') ? apiFetch<ClientOption[]>('/clients') : Promise.resolve([]),
      ]);

      setInvoices(invoiceRows);
      setQueue(queueRows);
      setHandovers(handoverRows);
      setLeadOptions(leadRows.filter((lead) => lead.status !== 'CONVERTED'));
      setClientOptions(clientRows);
      // Module-wise revenue rollup Ã¢â‚¬â€ non-fatal if it fails.
      try {
        const r = await apiFetch<RevenueRollup>('/finance/revenue/by-service');
        setRevenue(r);
      } catch {
        // surface ignored Ã¢â‚¬â€ the page still works without the rollup
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load finance page');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user.permissions.includes('finance.view_all')) return;
    void loadData();
  }, []);

  if (!user.permissions.includes('finance.view_all')) {
    return <PermissionDeniedState />;
  }

  if (loading && invoices.length === 0 && queue.length === 0 && handovers.length === 0) {
    return <LoadingState message="Loading finance module..." />;
  }

  if (error && invoices.length === 0 && queue.length === 0 && handovers.length === 0) {
    return <ErrorState message="Unable to load finance module" details={error} onRetry={() => void loadData()} />;
  }

  async function reviewHandover(id: string, action: 'MARK_IN_REVIEW' | 'RECORD_PAYMENT' | 'REJECT') {
    const financeNotes = action === 'REJECT' ? 'Returned to sales for correction.' : undefined;

    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/finance/handovers/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          financeNotes: financeNotes || undefined,
        }),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review the finance handover');
    } finally {
      setSubmitting(false);
    }
  }

  async function createInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/finance/invoices', {
        method: 'POST',
        body: JSON.stringify({
          leadId: invoiceForm.ownerType === 'lead' ? invoiceForm.ownerId : undefined,
          clientId: invoiceForm.ownerType === 'client' ? invoiceForm.ownerId : undefined,
          subtotal: invoiceForm.subtotal,
          taxAmount: invoiceForm.taxAmount,
          discountAmount: invoiceForm.discountAmount,
          notes: invoiceForm.notes || undefined,
        }),
      });
      setInvoiceForm(initialInvoiceForm);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create invoice');
    } finally {
      setSubmitting(false);
    }
  }

  async function recordPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/finance/payments', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: paymentForm.invoiceId,
          amount: paymentForm.amount,
          paymentMethod: paymentForm.paymentMethod,
          transactionRef: paymentForm.transactionRef || undefined,
          notes: paymentForm.notes || undefined,
        }),
      });
      setPaymentForm(initialPaymentForm);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record payment');
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyPayment(paymentId: string) {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/finance/payments/${paymentId}/verify`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify payment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Create invoices, record payments, and verify finance activity that moves leads into clients and cases."
        actions={
          <>
            {user.permissions.includes('reports.export') ? (
              <button
                onClick={async () => {
                  try {
                    await downloadCsv('/finance/invoices/export.csv', 'invoices.csv');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Export failed');
                  }
                }}
                className="rounded-md border px-4 py-2 text-sm font-medium"
                style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)' }}
              >
                Export invoices CSV
              </button>
            ) : null}
            <button
              onClick={() => void loadData()}
              className="rounded-md px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}
            >
              Refresh Finance
            </button>
          </>
        }
      />

      {error ? <p className="mb-4 text-sm" style={{ color: 'var(--sos-status-danger)' }}>{error}</p> : null}

      {revenue ? <RevenueRollupCard data={revenue} /> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <form onSubmit={createInvoice} className="rounded-[28px] border px-4 py-5 shadow-sm sm:px-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <h3 className="mb-3 text-lg font-semibold" style={{ color: 'var(--sos-text-primary)' }}>Create Invoice</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Owner Type
              <select value={invoiceForm.ownerType} onChange={(event) => setInvoiceForm((current) => ({ ...current, ownerType: event.target.value as 'lead' | 'client', ownerId: '' }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
                <option value="lead">Lead</option>
                <option value="client">Client</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Owner
              <select value={invoiceForm.ownerId} onChange={(event) => setInvoiceForm((current) => ({ ...current, ownerId: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
                <option value="">Select owner</option>
                {(invoiceForm.ownerType === 'lead' ? leadOptions : clientOptions).map((record) => (
                  <option key={record.id} value={record.id}>{record.firstName} {record.lastName} - {record.phone}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Subtotal
              <input value={invoiceForm.subtotal} onChange={(event) => setInvoiceForm((current) => ({ ...current, subtotal: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Tax Amount
              <input value={invoiceForm.taxAmount} onChange={(event) => setInvoiceForm((current) => ({ ...current, taxAmount: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Discount Amount
              <input value={invoiceForm.discountAmount} onChange={(event) => setInvoiceForm((current) => ({ ...current, discountAmount: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Notes
              <textarea value={invoiceForm.notes} onChange={(event) => setInvoiceForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[96px] rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
          </div>
          <div className="mt-6 flex justify-end">
            <button type="submit" disabled={submitting} className="w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 sm:w-auto" style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}>
              {submitting ? 'Saving...' : 'Create Invoice'}
            </button>
          </div>
        </form>

        <form onSubmit={recordPayment} className="rounded-[28px] border px-4 py-5 shadow-sm sm:px-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <h3 className="mb-3 text-lg font-semibold" style={{ color: 'var(--sos-text-primary)' }}>Record Payment</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Invoice
              <select value={paymentForm.invoiceId} onChange={(event) => setPaymentForm((current) => ({ ...current, invoiceId: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
                <option value="">Select invoice</option>
                {invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} - {invoice.lead ? `${invoice.lead.firstName} ${invoice.lead.lastName}` : invoice.client ? `${invoice.client.firstName} ${invoice.client.lastName}` : 'No owner'}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Amount
              <input value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Payment Method
              <input value={paymentForm.paymentMethod} onChange={(event) => setPaymentForm((current) => ({ ...current, paymentMethod: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Transaction Reference
              <input value={paymentForm.transactionRef} onChange={(event) => setPaymentForm((current) => ({ ...current, transactionRef: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Notes
              <textarea value={paymentForm.notes} onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[96px] rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
          </div>
          <div className="mt-6 flex justify-end">
            <button type="submit" disabled={submitting} className="w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 sm:w-auto" style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}>
              {submitting ? 'Saving...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>

      <div className="space-y-6">
        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <PageHeader title="Sales Handovers" description="Receipts submitted by sales before finance records and verifies the payment." />
          <DataTable
            columns={[
              { key: 'lead', header: 'Lead', render: (row: HandoverRow) => `${row.lead.firstName} ${row.lead.lastName}` },
              { key: 'amount', header: 'Amount', render: (row: HandoverRow) => `${row.currency} ${row.submittedAmount}` },
              { key: 'method', header: 'Method', render: (row: HandoverRow) => row.paymentMethod ?? 'Ã¢â‚¬â€' },
              { key: 'receipt', header: 'Receipt', render: (row: HandoverRow) => row.receiptDownloadUrl ? <a href={row.receiptDownloadUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--sos-brand-primary)' }}>{row.receiptFileName}</a> : row.receiptFileName },
              { key: 'invoice', header: 'Invoice', render: (row: HandoverRow) => row.invoice?.invoiceNumber ?? 'Create on review' },
              { key: 'status', header: 'Status', render: (row: HandoverRow) => <StatusBadge type="finance_handover" status={row.status} /> },
              { key: 'notes', header: 'Finance Notes', render: (row: HandoverRow) => row.financeNotes ?? 'Ã¢â‚¬â€' },
              {
                key: 'actions',
                header: 'Actions',
                render: (row: HandoverRow) => (
                  <div className="flex flex-wrap gap-2">
                    {['SUBMITTED', 'REJECTED'].includes(row.status) ? (
                      <button onClick={() => void reviewHandover(row.id, 'MARK_IN_REVIEW')} className="rounded-md border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--sos-border-strong)', color: 'var(--sos-text-primary)' }}>
                        Review
                      </button>
                    ) : null}
                    {!['PAYMENT_RECORDED', 'PAYMENT_VERIFIED', 'CANCELLED'].includes(row.status) ? (
                      <button onClick={() => void reviewHandover(row.id, 'RECORD_PAYMENT')} className="rounded-md border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--sos-brand-primary)', color: 'var(--sos-brand-primary)' }}>
                        Record Payment
                      </button>
                    ) : null}
                    {!['PAYMENT_RECORDED', 'PAYMENT_VERIFIED', 'CANCELLED'].includes(row.status) ? (
                      <button onClick={() => void reviewHandover(row.id, 'REJECT')} className="rounded-md border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--sos-status-danger)', color: 'var(--sos-status-danger)' }}>
                        Reject
                      </button>
                    ) : null}
                  </div>
                ),
              },
            ]}
            data={handovers}
            rowKey={(row) => row.id}
            emptyMessage="No finance handovers have been submitted yet."
          />
        </section>

        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <PageHeader title="Pending Verification" description="Payments waiting for finance verification before the lead is converted and a case is created." />
          <DataTable
            columns={[
              { key: 'invoice', header: 'Invoice', render: (row: QueueRow) => row.invoice.invoiceNumber },
              { key: 'owner', header: 'Owner', render: (row: QueueRow) => row.invoice.lead ? `${row.invoice.lead.firstName} ${row.invoice.lead.lastName}` : row.invoice.client ? `${row.invoice.client.firstName} ${row.invoice.client.lastName}` : 'Ã¢â‚¬â€' },
              { key: 'amount', header: 'Amount', render: (row: QueueRow) => row.amount },
              { key: 'method', header: 'Method', render: (row: QueueRow) => row.paymentMethod ?? 'Ã¢â‚¬â€' },
              { key: 'status', header: 'Status', render: (row: QueueRow) => <StatusBadge type="payment" status={row.status} /> },
              {
                key: 'actions',
                header: 'Actions',
                render: (row: QueueRow) => (
                  <button onClick={() => void verifyPayment(row.id)} className="rounded-md border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--sos-brand-primary)', color: 'var(--sos-brand-primary)' }}>
                    Verify Payment
                  </button>
                ),
              },
            ]}
            data={queue}
            rowKey={(row) => row.id}
            emptyMessage="No pending finance items."
          />
        </section>

        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <PageHeader title="Invoices" description="Track invoice totals, paid amounts, and conversion progress across leads and clients." />
          <DataTable columns={invoiceColumns} data={invoices} rowKey={(row) => row.id} emptyMessage="No invoices found." />
        </section>
      </div>
    </div>
  );
}

// ---------- Revenue rollup card ----------------------------------------------

function formatCAD(amount: number): string {
  if (!amount) return 'CAD 0';
  return `CAD ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function RevenueRollupCard({ data }: { data: RevenueRollup }) {
  const maxAllTime = data.byService[0]?.allTime || 1;
  return (
    <section
      className="rounded-[28px] border p-4 shadow-sm sm:p-6"
      style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}
    >
      <PageHeader
        title="Revenue by service"
        description="Verified payments grouped by the immigration service line"
      />
      <div className="grid gap-4 sm:grid-cols-3" style={{ marginBottom: 14 }}>
        <RollupTotal label="This month" value={formatCAD(data.totals.month)} />
        <RollupTotal label="Year to date" value={formatCAD(data.totals.ytd)} />
        <RollupTotal label="All time" value={formatCAD(data.totals.allTime)} />
      </div>
      {data.byService.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            color: 'var(--sos-text-muted)',
            textAlign: 'center',
            padding: 16,
          }}
        >
          No verified payments recorded yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.byService.map((row) => (
            <div
              key={row.service}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(180px, 1.6fr) 1fr minmax(120px, 0.7fr)',
                gap: 12,
                alignItems: 'center',
                padding: '10px 12px',
                background: 'var(--sos-surface-1)',
                border: '1px solid var(--sos-border-subtle)',
                borderRadius: 'var(--sos-radius-sm)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{row.service}</span>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: 'var(--sos-surface-hover)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${(row.allTime / maxAllTime) * 100}%`,
                    height: '100%',
                    background: 'var(--sos-brand-gradient)',
                  }}
                />
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{formatCAD(row.allTime)}</div>
                <div style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>
                  YTD {formatCAD(row.ytd)} Ã‚Â· {formatCAD(row.month)} this month
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RollupTotal({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
        borderRadius: 'var(--sos-radius-md)',
      }}
    >
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
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--sos-brand-primary-strong)' }}>
        {value}
      </div>
    </div>
  );
}