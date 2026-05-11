'use client';

import { ResourceManager } from '@/components/admin/ResourceManager';
import type { DataTableColumn } from '@/components/shared/DataTable';

interface CountryRecord {
  id: string;
  name: string;
  code: string;
  isoCode?: string | null;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
}

const columns: DataTableColumn<CountryRecord>[] = [
  { key: 'name', header: 'Country', render: (row) => row.name },
  { key: 'code', header: 'Code', render: (row) => row.code },
  { key: 'isoCode', header: 'ISO', render: (row) => row.isoCode ?? '—' },
  { key: 'sortOrder', header: 'Sort Order', render: (row) => row.sortOrder },
  { key: 'status', header: 'Status', render: (row) => (row.isActive ? 'Active' : 'Inactive') },
];

export default function CountriesPage() {
  return (
    <ResourceManager<CountryRecord>
      permissionKey="settings.manage"
      title="Countries"
      description="Manage the target country configuration used across lead and case workflows."
      endpoint="/countries"
      staticQuery={{ includeInactive: 'true' }}
      columns={columns}
      searchPlaceholder="Search countries..."
      fields={[
        { name: 'name', label: 'Country Name', required: true },
        { name: 'code', label: 'Code', required: true },
        { name: 'isoCode', label: 'ISO Code' },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'sortOrder', label: 'Sort Order' },
        { name: 'isActive', label: 'Active Country', type: 'checkbox' },
      ]}
      initialForm={{ name: '', code: '', isoCode: '', description: '', sortOrder: '0', isActive: true }}
      transformRecordToForm={(record) => ({
        name: record.name,
        code: record.code,
        isoCode: record.isoCode ?? '',
        description: record.description ?? '',
        sortOrder: String(record.sortOrder),
        isActive: record.isActive,
      })}
      transformFormToPayload={(form) => ({
        name: form.name,
        code: form.code,
        isoCode: form.isoCode || undefined,
        description: form.description || undefined,
        sortOrder: Number(form.sortOrder || 0),
        isActive: form.isActive,
      })}
    />
  );
}