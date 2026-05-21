'use client';

import { useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '../shared/DataTable';
import { ErrorState } from '../shared/ErrorState';
import { FilterBar } from '../shared/FilterBar';
import { LoadingState } from '../shared/LoadingState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { apiFetch, buildQuery } from '@/lib/api-client';
import { downloadCsv } from '@/lib/csv-download';
import { useAdminSession } from '../layout/AdminShell';
import {
  GhostButton,
  GlassCard,
  PageHeader,
  PrimaryButton,
} from '@/components/sales-v2/ui';

type FormValue = string | boolean;

export interface ResourceFieldOption {
  label: string;
  value: string;
}

export interface ResourceField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'textarea' | 'select' | 'checkbox';
  placeholder?: string;
  required?: boolean;
  options?: ResourceFieldOption[];
}

export interface ResourceFilter {
  key: string;
  label: string;
  options: ResourceFieldOption[];
}

interface ResourceManagerProps<TRecord extends { id: string }> {
  permissionKey: string;
  title: string;
  description?: string;
  endpoint: string;
  columns: DataTableColumn<TRecord>[];
  fields: ResourceField[];
  initialForm: Record<string, FormValue>;
  filters?: ResourceFilter[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  staticQuery?: Record<string, string>;
  transformRecordToForm?: (record: TRecord) => Record<string, FormValue>;
  transformFormToPayload?: (form: Record<string, FormValue>) => Record<string, unknown>;
  loadEditFormValues?: (record: TRecord) => Promise<Record<string, FormValue>>;
  /**
   * Path to a CSV-export endpoint. When set, an "Export CSV" button appears
   * next to "Refresh" and triggers a download. The current filter + search
   * values are appended as query parameters so the export mirrors what the
   * user is looking at. Gated on the `reports.export` permission.
   */
  exportPath?: string;
  /** Default filename to suggest if the server doesn't send one. */
  exportFilename?: string;
  /**
   * When set, the actions column also renders a Delete button. Click fires
   * DELETE on `${endpoint}/${id}` after the user confirms. Pass a permission
   * key to hide the button for users who lack it.
   *
   *   deletable={{ permission: 'leads.delete', confirmMessage: (r) => `Delete ${r.firstName}?` }}
   */
  deletable?: {
    permission?: string;
    confirmMessage?: (record: TRecord) => string;
  };
}

export function ResourceManager<TRecord extends { id: string }>({
  permissionKey,
  title,
  description,
  endpoint,
  columns,
  fields,
  initialForm,
  filters = [],
  searchPlaceholder,
  emptyMessage,
  staticQuery,
  transformRecordToForm,
  transformFormToPayload,
  loadEditFormValues,
  exportPath,
  exportFilename,
  deletable,
}: ResourceManagerProps<TRecord>) {
  const { user } = useAdminSession();
  const [records, setRecords] = useState<TRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>(
    Object.fromEntries(filters.map((filter) => [filter.key, ''])),
  );
  const [formValues, setFormValues] = useState<Record<string, FormValue>>(initialForm);
  const [editingRecord, setEditingRecord] = useState<TRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingEditForm, setLoadingEditForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function loadRecords() {
    setLoading(true);
    setError(null);

    try {
      const query = buildQuery({
        search,
        ...filterValues,
        ...(staticQuery ?? {}),
      });
      const data = await apiFetch<TRecord[]>(`${endpoint}${query}`);
      setRecords(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load records');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user.permissions.includes(permissionKey)) return;
    void loadRecords();
  }, [permissionKey, refreshKey, search, JSON.stringify(filterValues)]);

  if (!user.permissions.includes(permissionKey)) {
    return <PermissionDeniedState />;
  }

  function handleFilterChange(key: string, value: string) {
    setFilterValues((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setFormValues(initialForm);
    setEditingRecord(null);
    setIsFormOpen(false);
  }

  function openCreateForm() {
    setFormValues(initialForm);
    setEditingRecord(null);
    setIsFormOpen(true);
  }

  async function openEditForm(record: TRecord) {
    setError(null);
    setEditingRecord(record);
    setFormValues(transformRecordToForm ? transformRecordToForm(record) : initialForm);
    setIsFormOpen(true);

    if (!loadEditFormValues) {
      return;
    }

    setLoadingEditForm(true);
    try {
      const hydratedFormValues = await loadEditFormValues(record);
      setFormValues(hydratedFormValues);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load record details');
    } finally {
      setLoadingEditForm(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = transformFormToPayload ? transformFormToPayload(formValues) : formValues;

      if (editingRecord) {
        await apiFetch(`${endpoint}/${editingRecord.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      resetForm();
      setRefreshKey((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save changes');
    } finally {
      setSubmitting(false);
    }
  }

  // Per-row delete handler — shared between the inline Delete button and
  // any future bulk-select UI. Confirmed with a native window.confirm so
  // we don't have to ship a custom dialog component for this.
  async function handleDelete(record: TRecord) {
    if (!deletable) return;
    const message =
      deletable.confirmMessage?.(record) ??
      `Delete this record? This action affects every view that lists it.`;
    if (!window.confirm(message)) return;
    try {
      await apiFetch(`${endpoint}/${record.id}`, { method: 'DELETE' });
      setRefreshKey((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const canDelete =
    !!deletable &&
    (!deletable.permission || user.permissions.includes(deletable.permission));

  const tableColumns: DataTableColumn<TRecord>[] = [
    ...columns,
    {
      key: 'actions',
      header: 'Actions',
      render: (record) => (
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => void openEditForm(record)}
            className="rounded-md border px-3 py-1 text-xs font-medium"
            style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)' }}
          >
            Edit
          </button>
          {canDelete ? (
            <button
              onClick={() => void handleDelete(record)}
              className="rounded-md border px-3 py-1 text-xs font-medium"
              style={{
                borderColor: 'var(--sos-status-danger, #dc2626)',
                color: 'var(--sos-status-danger, #dc2626)',
              }}
              title="Delete (hides from all lists)"
            >
              Delete
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        eyebrow="Admin"
        title={title}
        description={description}
        actions={
          <>
            <GhostButton onClick={() => setRefreshKey((current) => current + 1)}>
              Refresh
            </GhostButton>
            {exportPath && user.permissions.includes('reports.export') ? (
              <GhostButton
                onClick={async () => {
                  const query = buildQuery({
                    search,
                    ...filterValues,
                    ...(staticQuery ?? {}),
                  });
                  try {
                    await downloadCsv(`${exportPath}${query}`, exportFilename ?? 'export.csv');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Export failed');
                  }
                }}
              >
                Export CSV
              </GhostButton>
            ) : null}
            <PrimaryButton onClick={openCreateForm}>New record</PrimaryButton>
          </>
        }
      />

      <FilterBar
        searchValue={search}
        searchPlaceholder={searchPlaceholder}
        onSearchChange={setSearch}
        filters={filters.map((filter) => ({
          key: filter.key,
          label: filter.label,
          value: filterValues[filter.key] ?? '',
          options: [{ label: `All ${filter.label}`, value: '' }, ...filter.options],
          onChange: (value) => handleFilterChange(filter.key, value),
        }))}
        onClear={() => {
          setSearch('');
          setFilterValues(Object.fromEntries(filters.map((filter) => [filter.key, ''])));
        }}
      />

      {isFormOpen ? (
        <GlassCard variant="panel" padded="lg">
          <form onSubmit={handleSubmit}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="sos-title" style={{ fontSize: 'var(--sos-text-lg)' }}>
                {editingRecord ? 'Edit record' : 'Create record'}
              </h3>
              <p className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)', marginTop: 4 }}>
                Save the current form to update.
              </p>
            </div>
            <GhostButton type="button" onClick={resetForm}>Cancel</GhostButton>
          </div>

          {loadingEditForm ? (
            <p className="mb-4 text-sm" style={{ color: 'var(--sos-text-muted)' }}>
              Loading record details...
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => {
              const value = formValues[field.name];
              if (field.type === 'textarea') {
                return (
                  <label key={field.name} className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
                    {field.label}
                    <textarea
                      required={field.required}
                      disabled={loadingEditForm}
                      placeholder={field.placeholder}
                      value={typeof value === 'string' ? value : ''}
                      onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      className="min-h-[120px] rounded-md border px-3 py-2 outline-none"
                      style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-input)' }}
                    />
                  </label>
                );
              }

              if (field.type === 'select') {
                return (
                  <label key={field.name} className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
                    {field.label}
                    <select
                      required={field.required}
                      disabled={loadingEditForm}
                      value={typeof value === 'string' ? value : ''}
                      onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      className="rounded-md border px-3 py-2 outline-none"
                      style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-input)', color: 'var(--sos-text-primary)' }}
                    >
                      <option value="">Select {field.label}</option>
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              if (field.type === 'checkbox') {
                return (
                  <label key={field.name} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)' }}>
                    <input
                      type="checkbox"
                      disabled={loadingEditForm}
                      checked={Boolean(value)}
                      onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.checked }))}
                    />
                    {field.label}
                  </label>
                );
              }

              return (
                <label key={field.name} className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
                  {field.label}
                  <input
                    type={field.type ?? 'text'}
                    required={field.required}
                    disabled={loadingEditForm}
                    placeholder={field.placeholder}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    className="rounded-md border px-3 py-2 outline-none"
                    style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-input)' }}
                  />
                </label>
              );
            })}
          </div>

          {error ? (
            <p className="mt-4 text-sm" style={{ color: 'var(--sos-status-danger)' }}>
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="submit"
              disabled={submitting || loadingEditForm}
              className="w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 sm:w-auto"
              style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}
            >
              {submitting ? 'Saving...' : editingRecord ? 'Save Changes' : 'Create Record'}
            </button>
          </div>
        </form>
        </GlassCard>
      ) : null}

      {loading ? (
        <LoadingState message="Loading records..." />
      ) : error ? (
        <ErrorState message="Unable to load records" details={error} onRetry={() => void loadRecords()} />
      ) : (
        <DataTable columns={tableColumns} data={records} rowKey={(row) => row.id} emptyMessage={emptyMessage} />
      )}
    </div>
  );
}