'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { useAdminSession } from '@/components/layout/AdminShell';
import { PageHeader } from '@/components/shared/PageHeader';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';

interface SalesQueueRow {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  serviceInterest?: string | null;
  targetCountry?: string | null;
  assignedEmployee?: { firstName?: string | null; lastName?: string | null } | null;
  _count?: { appointments?: number; invoices?: number; timelineEvents?: number };
}

interface FinanceQueueRow {
  id: string;
  amount: string;
  status: string;
  paymentMethod?: string | null;
  createdAt: string;
  invoice: {
    id: string;
    invoiceNumber: string;
    lead?: { id: string; firstName: string; lastName: string; phone: string } | null;
    client?: { id: string; firstName: string; lastName: string; phone: string } | null;
  };
}

interface ProcessingQueueRow {
  id: string;
  caseNumber: string;
  serviceType: string;
  targetCountry: string;
  status: string;
  client: { id: string; firstName: string; lastName: string; phone: string };
  department?: { id: string; name: string } | null;
  assignedEmployee?: { id: string; firstName: string; lastName: string } | null;
  _count?: { documents?: number; appointments?: number; timelineEvents?: number };
}

interface PendingDocumentRow {
  id: string;
  name: string;
  status: string;
  client: { id: string; firstName: string; lastName: string; phone: string };
  case?: { id: string; caseNumber: string; status: string } | null;
  documentRequirement?: { id: string; name: string } | null;
}

interface HandoverRow {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  createdAt: string;
  actor?: { email?: string | null } | null;
}

interface TimelineRow {
  id: string;
  eventType: string;
  description: string;
  createdAt: string;
}

interface WorkflowBoardData {
  salesQueue: SalesQueueRow[];
  financeQueue: FinanceQueueRow[];
  processingQueue: ProcessingQueueRow[];
  pendingDocuments: PendingDocumentRow[];
  handoverHistory: HandoverRow[];
}

interface AppointmentFormState {
  leadId: string;
  title: string;
  appointmentType: string;
  scheduledAt: string;
  durationMinutes: string;
  location: string;
  notes: string;
}

interface FinanceFormState {
  leadId: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  notes: string;
}

const salesColumns: DataTableColumn<SalesQueueRow>[] = [
  { key: 'lead', header: 'Lead', render: (row) => `${row.firstName} ${row.lastName}` },
  { key: 'phone', header: 'Phone', render: (row) => row.phone },
  { key: 'service', header: 'Service', render: (row) => row.serviceInterest ?? '—' },
  { key: 'country', header: 'Target Country', render: (row) => row.targetCountry ?? '—' },
  { key: 'owner', header: 'Assigned', render: (row) => row.assignedEmployee ? `${row.assignedEmployee.firstName ?? ''} ${row.assignedEmployee.lastName ?? ''}`.trim() : 'Unassigned' },
  { key: 'activity', header: 'Activity', render: (row) => `${row._count?.appointments ?? 0} appts / ${row._count?.invoices ?? 0} invoices` },
];

const financeColumns: DataTableColumn<FinanceQueueRow>[] = [
  { key: 'invoice', header: 'Invoice', render: (row) => row.invoice.invoiceNumber },
  { key: 'owner', header: 'Owner', render: (row) => row.invoice.lead ? `${row.invoice.lead.firstName} ${row.invoice.lead.lastName}` : row.invoice.client ? `${row.invoice.client.firstName} ${row.invoice.client.lastName}` : '—' },
  { key: 'amount', header: 'Amount', render: (row) => row.amount },
  { key: 'method', header: 'Method', render: (row) => row.paymentMethod ?? '—' },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge type="payment" status={row.status} /> },
];

const processingColumns: DataTableColumn<ProcessingQueueRow>[] = [
  { key: 'case', header: 'Case', render: (row) => row.caseNumber },
  { key: 'client', header: 'Client', render: (row) => `${row.client.firstName} ${row.client.lastName}` },
  { key: 'service', header: 'Service', render: (row) => row.serviceType },
  { key: 'department', header: 'Department', render: (row) => row.department?.name ?? 'Unassigned' },
  { key: 'documents', header: 'Documents', render: (row) => `${row._count?.documents ?? 0}` },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge type="case" status={row.status} /> },
];

const pendingDocumentColumns: DataTableColumn<PendingDocumentRow>[] = [
  { key: 'document', header: 'Document', render: (row) => row.name },
  { key: 'client', header: 'Client', render: (row) => `${row.client.firstName} ${row.client.lastName}` },
  { key: 'case', header: 'Case', render: (row) => row.case?.caseNumber ?? '—' },
  { key: 'requirement', header: 'Requirement', render: (row) => row.documentRequirement?.name ?? '—' },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge type="document" status={row.status} /> },
];

const handoverColumns: DataTableColumn<HandoverRow>[] = [
  { key: 'action', header: 'Action', render: (row) => row.action.replace(/_/g, ' ') },
  { key: 'entity', header: 'Entity', render: (row) => row.entityType },
  { key: 'actor', header: 'Actor', render: (row) => row.actor?.email ?? 'System' },
  { key: 'created', header: 'Created', render: (row) => new Date(row.createdAt).toLocaleString() },
];

const timelineColumns: DataTableColumn<TimelineRow>[] = [
  { key: 'event', header: 'Event', render: (row) => row.eventType.replace(/_/g, ' ') },
  { key: 'description', header: 'Description', render: (row) => row.description },
  { key: 'created', header: 'Created', render: (row) => new Date(row.createdAt).toLocaleString() },
];

const initialAppointmentForm: AppointmentFormState = {
  leadId: '',
  title: '',
  appointmentType: 'Consultation',
  scheduledAt: '',
  durationMinutes: '30',
  location: '',
  notes: '',
};

const initialFinanceForm: FinanceFormState = {
  leadId: '',
  subtotal: '',
  taxAmount: '0',
  discountAmount: '0',
  notes: '',
};

export default function WorkflowBoardPage() {
  const { user } = useAdminSession();
  const [board, setBoard] = useState<WorkflowBoardData | null>(null);
  const [timelineRows, setTimelineRows] = useState<TimelineRow[]>([]);
  const [timelineLabel, setTimelineLabel] = useState('');
  const [appointmentForm, setAppointmentForm] = useState<AppointmentFormState>(initialAppointmentForm);
  const [financeForm, setFinanceForm] = useState<FinanceFormState>(initialFinanceForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadBoard() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<WorkflowBoardData>('/reports/workflow-board');
      setBoard(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load workflow board');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user.permissions.includes('reports.view')) return;
    void loadBoard();
  }, []);

  if (!user.permissions.includes('reports.view')) {
    return <PermissionDeniedState />;
  }

  if (loading && !board) {
    return <LoadingState message="Loading workflow board..." />;
  }

  if (error && !board) {
    return <ErrorState message="Unable to load workflow board" details={error} onRetry={() => void loadBoard()} />;
  }

  async function openTimeline(entityType: 'Lead' | 'Client' | 'Case', entityId: string, label: string) {
    try {
      const rows = await apiFetch<TimelineRow[]>(`/activity-timeline?entityType=${entityType}&entityId=${entityId}`);
      setTimelineRows(rows);
      setTimelineLabel(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load timeline');
    }
  }

  async function submitAppointment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          leadId: appointmentForm.leadId,
          title: appointmentForm.title,
          appointmentType: appointmentForm.appointmentType,
          scheduledAt: new Date(appointmentForm.scheduledAt).toISOString(),
          durationMinutes: Number(appointmentForm.durationMinutes),
          location: appointmentForm.location || undefined,
          notes: appointmentForm.notes || undefined,
        }),
      });
      setAppointmentForm(initialAppointmentForm);
      await loadBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to book appointment');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFinance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/finance/invoices', {
        method: 'POST',
        body: JSON.stringify({
          leadId: financeForm.leadId,
          subtotal: financeForm.subtotal,
          taxAmount: financeForm.taxAmount,
          discountAmount: financeForm.discountAmount,
          notes: financeForm.notes || undefined,
        }),
      });
      setFinanceForm(initialFinanceForm);
      await loadBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initiate finance');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow Board"
        description="Track sales, finance, and processing work queues and move leads into appointments and finance from one place."
        actions={
          <button
            onClick={() => void loadBoard()}
            className="rounded-md px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}
          >
            Refresh Board
          </button>
        }
      />

      {error ? <p className="mb-4 text-sm" style={{ color: 'var(--sos-status-danger)' }}>{error}</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <form onSubmit={submitAppointment} className="rounded-[28px] border px-4 py-5 shadow-sm sm:px-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <h3 className="mb-3 text-lg font-semibold" style={{ color: 'var(--sos-text-primary)' }}>Book Sales Appointment</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Lead
              <select value={appointmentForm.leadId} onChange={(event) => setAppointmentForm((current) => ({ ...current, leadId: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
                <option value="">Select lead</option>
                {board?.salesQueue.map((lead) => (
                  <option key={lead.id} value={lead.id}>{lead.firstName} {lead.lastName} - {lead.phone}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Appointment Type
              <input value={appointmentForm.appointmentType} onChange={(event) => setAppointmentForm((current) => ({ ...current, appointmentType: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Title
              <input value={appointmentForm.title} onChange={(event) => setAppointmentForm((current) => ({ ...current, title: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Scheduled At
              <input type="datetime-local" value={appointmentForm.scheduledAt} onChange={(event) => setAppointmentForm((current) => ({ ...current, scheduledAt: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Duration Minutes
              <input value={appointmentForm.durationMinutes} onChange={(event) => setAppointmentForm((current) => ({ ...current, durationMinutes: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Location
              <input value={appointmentForm.location} onChange={(event) => setAppointmentForm((current) => ({ ...current, location: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Notes
              <textarea value={appointmentForm.notes} onChange={(event) => setAppointmentForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[96px] rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
          </div>
          <div className="mt-6 flex justify-end">
            <button type="submit" disabled={submitting} className="w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 sm:w-auto" style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}>
              {submitting ? 'Saving...' : 'Book Appointment'}
            </button>
          </div>
        </form>

        <form onSubmit={submitFinance} className="rounded-[28px] border px-4 py-5 shadow-sm sm:px-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <h3 className="mb-3 text-lg font-semibold" style={{ color: 'var(--sos-text-primary)' }}>Initiate Finance From Sales</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Lead
              <select value={financeForm.leadId} onChange={(event) => setFinanceForm((current) => ({ ...current, leadId: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
                <option value="">Select lead</option>
                {board?.salesQueue.map((lead) => (
                  <option key={lead.id} value={lead.id}>{lead.firstName} {lead.lastName} - {lead.serviceInterest ?? 'General Service'}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Subtotal
              <input value={financeForm.subtotal} onChange={(event) => setFinanceForm((current) => ({ ...current, subtotal: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Tax Amount
              <input value={financeForm.taxAmount} onChange={(event) => setFinanceForm((current) => ({ ...current, taxAmount: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Discount Amount
              <input value={financeForm.discountAmount} onChange={(event) => setFinanceForm((current) => ({ ...current, discountAmount: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Notes
              <textarea value={financeForm.notes} onChange={(event) => setFinanceForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[96px] rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
          </div>
          <div className="mt-6 flex justify-end">
            <button type="submit" disabled={submitting} className="w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 sm:w-auto" style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}>
              {submitting ? 'Saving...' : 'Create Invoice'}
            </button>
          </div>
        </form>
      </div>

      <div className="space-y-6">
        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <PageHeader title="Sales Queue" description="Leads that are still in sales and have not crossed the payment boundary yet." />
          <DataTable columns={salesColumns} data={board?.salesQueue ?? []} rowKey={(row) => row.id} emptyMessage="No sales queue items." />
        </section>

        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <PageHeader title="Finance Verification Queue" description="Payments waiting for finance verification before lead conversion and processing handover." />
          <DataTable columns={financeColumns} data={board?.financeQueue ?? []} rowKey={(row) => row.id} emptyMessage="No finance queue items." />
        </section>

        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <PageHeader title="Processing Queue" description="Cases that are in documentation or processing stages after finance verification." />
          <DataTable columns={processingColumns} data={board?.processingQueue ?? []} rowKey={(row) => row.id} emptyMessage="No processing queue items." />
        </section>

        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <PageHeader title="Pending Documents" description="Documents still waiting for review or replacement inside the processing workflow." />
          <DataTable columns={pendingDocumentColumns} data={board?.pendingDocuments ?? []} rowKey={(row) => row.id} emptyMessage="No pending documents." />
        </section>

        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <PageHeader title="Handover History" description="Recent workflow transitions that admin can audit across sales, finance, and processing." />
          <DataTable columns={handoverColumns} data={board?.handoverHistory ?? []} rowKey={(row) => row.id} emptyMessage="No handover history yet." />
        </section>

        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--sos-text-primary)' }}>Timeline Viewer</h3>
              <p className="text-sm" style={{ color: 'var(--sos-text-muted)' }}>
                Read the timeline for any lead, client, or case from the workflow queues.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(board?.salesQueue ?? []).slice(0, 3).map((lead) => (
                <button key={lead.id} onClick={() => void openTimeline('Lead', lead.id, `${lead.firstName} ${lead.lastName}`)} className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)' }}>
                  Lead: {lead.firstName}
                </button>
              ))}
              {(board?.processingQueue ?? []).slice(0, 3).map((record) => (
                <button key={record.id} onClick={() => void openTimeline('Case', record.id, record.caseNumber)} className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)' }}>
                  Case: {record.caseNumber}
                </button>
              ))}
            </div>
          </div>
          {timelineLabel ? <p className="mb-4 text-sm" style={{ color: 'var(--sos-text-secondary)' }}>Showing timeline for {timelineLabel}</p> : null}
          <DataTable columns={timelineColumns} data={timelineRows} rowKey={(row) => row.id} emptyMessage="Select a lead or case to view its timeline." />
        </section>
      </div>
    </div>
  );
}