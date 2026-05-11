'use client';

import { ResourceManager } from '@/components/admin/ResourceManager';
import type { DataTableColumn } from '@/components/shared/DataTable';

interface ServiceRecord {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
}

const columns: DataTableColumn<ServiceRecord>[] = [
  { key: 'name', header: 'Service', render: (row) => row.name },
  { key: 'code', header: 'Code', render: (row) => row.code },
  { key: 'description', header: 'Description', render: (row) => row.description ?? '—' },
  { key: 'sortOrder', header: 'Sort Order', render: (row) => row.sortOrder },
  { key: 'status', header: 'Status', render: (row) => (row.isActive ? 'Active' : 'Inactive') },
];

export default function ServicesPage() {
  return (
    <ResourceManager<ServiceRecord>
      permissionKey="settings.manage"
      title="Services"
      description="Manage the configurable visa/service catalog for Week 3 admin setup."
      endpoint="/services"
      staticQuery={{ includeInactive: 'true' }}
      columns={columns}
      searchPlaceholder="Search services..."
      fields={[
        { name: 'name', label: 'Service Name', required: true },
        { name: 'code', label: 'Code', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'sortOrder', label: 'Sort Order' },
        { name: 'isActive', label: 'Active Service', type: 'checkbox' },
      ]}
      initialForm={{ name: '', code: '', description: '', sortOrder: '0', isActive: true }}
      transformRecordToForm={(record) => ({
        name: record.name,
        code: record.code,
        description: record.description ?? '',
        sortOrder: String(record.sortOrder),
        isActive: record.isActive,
      })}
      transformFormToPayload={(form) => ({
        name: form.name,
        code: form.code,
        description: form.description || undefined,
        sortOrder: Number(form.sortOrder || 0),
        isActive: form.isActive,
      })}
    />
  );
}