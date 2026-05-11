'use client';

import { useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '../shared/DataTable';
import { ErrorState } from '../shared/ErrorState';
import { FilterBar } from '../shared/FilterBar';
import { LoadingState } from '../shared/LoadingState';
import { PageHeader } from '../shared/PageHeader';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { apiFetch, buildQuery } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';

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

  const tableColumns: DataTableColumn<TRecord>[] = [
    ...columns,
    {
      key: 'actions',
      header: 'Actions',
      render: (record) => (
        <button
          onClick={() => void openEditForm(record)}
          className="rounded-md border px-3 py-1 text-xs font-medium"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <button
              onClick={() => setRefreshKey((current) => current + 1)}
              className="rounded-md border px-4 py-2 text-sm font-medium"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              Refresh
            </button>
            <button
              onClick={openCreateForm}
              className="rounded-md px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: 'var(--color-primary-600)', color: 'var(--color-text-inverse)' }}
            >
              New Record
            </button>
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
        <form onSubmit={handleSubmit} className="rounded-[28px] border px-4 py-5 shadow-sm sm:px-6" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {editingRecord ? 'Edit Record' : 'Create Record'}
              </h3>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Save the current form to update the Week 3 admin data.
              </p>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="w-full rounded-md border px-3 py-2 text-sm font-medium sm:w-auto"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              Cancel
            </button>
          </div>

          {loadingEditForm ? (
            <p className="mb-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Loading record details...
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => {
              const value = formValues[field.name];
              if (field.type === 'textarea') {
                return (
                  <label key={field.name} className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    {field.label}
                    <textarea
                      required={field.required}
                      disabled={loadingEditForm}
                      placeholder={field.placeholder}
                      value={typeof value === 'string' ? value : ''}
                      onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      className="min-h-[120px] rounded-md border px-3 py-2 outline-none"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                    />
                  </label>
                );
              }

              if (field.type === 'select') {
                return (
                  <label key={field.name} className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    {field.label}
                    <select
                      required={field.required}
                      disabled={loadingEditForm}
                      value={typeof value === 'string' ? value : ''}
                      onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      className="rounded-md border px-3 py-2 outline-none"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }}
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
                  <label key={field.name} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
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
                <label key={field.name} className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {field.label}
                  <input
                    type={field.type ?? 'text'}
                    required={field.required}
                    disabled={loadingEditForm}
                    placeholder={field.placeholder}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    className="rounded-md border px-3 py-2 outline-none"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                  />
                </label>
              );
            })}
          </div>

          {error ? (
            <p className="mt-4 text-sm" style={{ color: 'var(--color-status-danger)' }}>
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="submit"
              disabled={submitting || loadingEditForm}
              className="w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 sm:w-auto"
              style={{ backgroundColor: 'var(--color-primary-600)', color: 'var(--color-text-inverse)' }}
            >
              {submitting ? 'Saving...' : editingRecord ? 'Save Changes' : 'Create Record'}
            </button>
          </div>
        </form>
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