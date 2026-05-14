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

interface RequirementRow {
  id: string;
  serviceType: string;
  targetCountry?: string | null;
  name: string;
  isRequired: boolean;
  isActive: boolean;
}

interface ClientOption {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface CaseOption {
  id: string;
  caseNumber: string;
}

interface DocumentRow {
  id: string;
  name: string;
  status: string;
  fileKey: string;
  client: { id: string; firstName: string; lastName: string; phone: string };
  case?: { id: string; caseNumber: string; status: string } | null;
  documentRequirement?: { id: string; name: string; serviceType: string } | null;
}

interface RequirementFormState {
  serviceType: string;
  targetCountry: string;
  name: string;
  description: string;
  isRequired: boolean;
  isActive: boolean;
}

interface DocumentFormState {
  clientId: string;
  caseId: string;
  documentRequirementId: string;
  name: string;
  fileKey: string;
  description: string;
}

const requirementColumns: DataTableColumn<RequirementRow>[] = [
  { key: 'name', header: 'Requirement', render: (row) => row.name },
  { key: 'service', header: 'Service', render: (row) => row.serviceType },
  { key: 'country', header: 'Target Country', render: (row) => row.targetCountry ?? 'All' },
  { key: 'required', header: 'Required', render: (row) => (row.isRequired ? 'Yes' : 'No') },
  { key: 'active', header: 'Active', render: (row) => (row.isActive ? 'Yes' : 'No') },
];

const documentColumns: DataTableColumn<DocumentRow>[] = [
  { key: 'name', header: 'Document', render: (row) => row.name },
  { key: 'client', header: 'Client', render: (row) => `${row.client.firstName} ${row.client.lastName}` },
  { key: 'case', header: 'Case', render: (row) => row.case?.caseNumber ?? '—' },
  { key: 'requirement', header: 'Requirement', render: (row) => row.documentRequirement?.name ?? '—' },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge type="document" status={row.status} /> },
  { key: 'file', header: 'File Key', render: (row) => row.fileKey },
];

const initialRequirementForm: RequirementFormState = {
  serviceType: '',
  targetCountry: '',
  name: '',
  description: '',
  isRequired: true,
  isActive: true,
};

const initialDocumentForm: DocumentFormState = {
  clientId: '',
  caseId: '',
  documentRequirementId: '',
  name: '',
  fileKey: '',
  description: '',
};

export default function DocumentsPage() {
  const { user } = useAdminSession();
  const [requirements, setRequirements] = useState<RequirementRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([]);
  const [requirementForm, setRequirementForm] = useState<RequirementFormState>(initialRequirementForm);
  const [documentForm, setDocumentForm] = useState<DocumentFormState>(initialDocumentForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [requirementRows, documentRows, clients, cases] = await Promise.all([
        apiFetch<RequirementRow[]>('/documents/requirements'),
        apiFetch<DocumentRow[]>('/documents'),
        apiFetch<ClientOption[]>('/clients'),
        apiFetch<CaseOption[]>('/cases'),
      ]);
      setRequirements(requirementRows);
      setDocuments(documentRows);
      setClientOptions(clients);
      setCaseOptions(cases);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load documents page');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user.permissions.includes('documents.view_all')) return;
    void loadData();
  }, []);

  if (!user.permissions.includes('documents.view_all')) {
    return <PermissionDeniedState />;
  }

  if (loading && requirements.length === 0 && documents.length === 0) {
    return <LoadingState message="Loading documents module..." />;
  }

  if (error && requirements.length === 0 && documents.length === 0) {
    return <ErrorState message="Unable to load documents module" details={error} onRetry={() => void loadData()} />;
  }

  async function createRequirement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/documents/requirements', {
        method: 'POST',
        body: JSON.stringify({
          serviceType: requirementForm.serviceType,
          targetCountry: requirementForm.targetCountry || undefined,
          name: requirementForm.name,
          description: requirementForm.description || undefined,
          isRequired: requirementForm.isRequired,
          isActive: requirementForm.isActive,
        }),
      });
      setRequirementForm(initialRequirementForm);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create document requirement');
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/documents', {
        method: 'POST',
        body: JSON.stringify({
          clientId: documentForm.clientId,
          caseId: documentForm.caseId || undefined,
          documentRequirementId: documentForm.documentRequirementId || undefined,
          name: documentForm.name,
          fileKey: documentForm.fileKey,
          description: documentForm.description || undefined,
        }),
      });
      setDocumentForm(initialDocumentForm);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload document');
    } finally {
      setSubmitting(false);
    }
  }

  async function reviewDocument(id: string, status: 'VERIFIED' | 'REJECTED' | 'REPLACEMENT_REQUIRED') {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/documents/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review document');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Manage document requirements, upload client documents, and review them through the processing workflow."
        actions={
          <button
            onClick={() => void loadData()}
            className="rounded-md px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}
          >
            Refresh Documents
          </button>
        }
      />

      {error ? <p className="mb-4 text-sm" style={{ color: 'var(--sos-status-danger)' }}>{error}</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <form onSubmit={createRequirement} className="rounded-[28px] border px-4 py-5 shadow-sm sm:px-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <h3 className="mb-3 text-lg font-semibold" style={{ color: 'var(--sos-text-primary)' }}>Create Document Requirement</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Service Type
              <input value={requirementForm.serviceType} onChange={(event) => setRequirementForm((current) => ({ ...current, serviceType: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Target Country
              <input value={requirementForm.targetCountry} onChange={(event) => setRequirementForm((current) => ({ ...current, targetCountry: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Requirement Name
              <input value={requirementForm.name} onChange={(event) => setRequirementForm((current) => ({ ...current, name: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              <input type="checkbox" checked={requirementForm.isRequired} onChange={(event) => setRequirementForm((current) => ({ ...current, isRequired: event.target.checked }))} />
              Required
            </label>
            <label className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              <input type="checkbox" checked={requirementForm.isActive} onChange={(event) => setRequirementForm((current) => ({ ...current, isActive: event.target.checked }))} />
              Active
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Description
              <textarea value={requirementForm.description} onChange={(event) => setRequirementForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[96px] rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
          </div>
          <div className="mt-6 flex justify-end">
            <button type="submit" disabled={submitting} className="w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 sm:w-auto" style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}>
              {submitting ? 'Saving...' : 'Create Requirement'}
            </button>
          </div>
        </form>

        <form onSubmit={uploadDocument} className="rounded-[28px] border px-4 py-5 shadow-sm sm:px-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <h3 className="mb-3 text-lg font-semibold" style={{ color: 'var(--sos-text-primary)' }}>Upload Client Document</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Client
              <select value={documentForm.clientId} onChange={(event) => setDocumentForm((current) => ({ ...current, clientId: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
                <option value="">Select client</option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>{client.firstName} {client.lastName} - {client.phone}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Case
              <select value={documentForm.caseId} onChange={(event) => setDocumentForm((current) => ({ ...current, caseId: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
                <option value="">Optional case</option>
                {caseOptions.map((record) => (
                  <option key={record.id} value={record.id}>{record.caseNumber}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Requirement
              <select value={documentForm.documentRequirementId} onChange={(event) => setDocumentForm((current) => ({ ...current, documentRequirementId: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
                <option value="">Optional requirement</option>
                {requirements.map((requirement) => (
                  <option key={requirement.id} value={requirement.id}>{requirement.name} - {requirement.serviceType}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Document Name
              <input value={documentForm.name} onChange={(event) => setDocumentForm((current) => ({ ...current, name: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              File Key
              <input value={documentForm.fileKey} onChange={(event) => setDocumentForm((current) => ({ ...current, fileKey: event.target.value }))} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2" style={{ color: 'var(--sos-text-secondary)' }}>
              Description
              <textarea value={documentForm.description} onChange={(event) => setDocumentForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[96px] rounded-md border px-3 py-2" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
          </div>
          <div className="mt-6 flex justify-end">
            <button type="submit" disabled={submitting} className="w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 sm:w-auto" style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}>
              {submitting ? 'Saving...' : 'Upload Document'}
            </button>
          </div>
        </form>
      </div>

      <div className="space-y-6">
        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <PageHeader title="Document Requirements" description="Define the requirement list that processing teams use for each service and target country." />
          <DataTable columns={requirementColumns} data={requirements} rowKey={(row) => row.id} emptyMessage="No document requirements found." />
        </section>

        <section className="rounded-[28px] border p-4 shadow-sm sm:p-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
          <PageHeader title="Client Documents" description="Review uploaded documents and drive the next action for the processing team." />
          <DataTable
            columns={[
              ...documentColumns,
              {
                key: 'actions',
                header: 'Actions',
                render: (row: DocumentRow) => (
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => void reviewDocument(row.id, 'VERIFIED')} className="rounded-md border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--sos-status-success)', color: 'var(--sos-status-success)' }}>Verify</button>
                    <button onClick={() => void reviewDocument(row.id, 'REJECTED')} className="rounded-md border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--sos-status-danger)', color: 'var(--sos-status-danger)' }}>Reject</button>
                    <button onClick={() => void reviewDocument(row.id, 'REPLACEMENT_REQUIRED')} className="rounded-md border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--sos-status-warning)', color: 'var(--sos-status-warning)' }}>Replacement</button>
                  </div>
                ),
              },
            ]}
            data={documents}
            rowKey={(row) => row.id}
            emptyMessage="No documents uploaded yet."
          />
        </section>
      </div>
    </div>
  );
}