'use client';

import { ResourceManager } from '@/components/admin/ResourceManager';
import type { DataTableColumn } from '@/components/shared/DataTable';

interface BranchRecord {
  id: string;
  name: string;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive: boolean;
  _count?: { employees?: number; leads?: number; clients?: number; partners?: number };
}

const columns: DataTableColumn<BranchRecord>[] = [
  { key: 'name', header: 'Branch', render: (row) => row.name },
  { key: 'location', header: 'Location', render: (row) => [row.city, row.country].filter(Boolean).join(', ') || '—' },
  { key: 'contact', header: 'Contact', render: (row) => row.email ?? row.phone ?? '—' },
  { key: 'employees', header: 'Employees', render: (row) => row._count?.employees ?? 0 },
  { key: 'status', header: 'Status', render: (row) => (row.isActive ? 'Active' : 'Inactive') },
];

export default function BranchesPage() {
  return (
    <ResourceManager<BranchRecord>
      permissionKey="settings.manage"
      title="Branches"
      description="Manage branch locations and their operational counts."
      endpoint="/branches"
      columns={columns}
      searchPlaceholder="Search branches..."
      fields={[
        { name: 'name', label: 'Branch Name', required: true },
        { name: 'city', label: 'City' },
        { name: 'country', label: 'Country' },
        { name: 'phone', label: 'Phone' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'isActive', label: 'Active Branch', type: 'checkbox' },
      ]}
      initialForm={{ name: '', city: '', country: '', phone: '', email: '', isActive: true }}
      transformRecordToForm={(record) => ({
        name: record.name,
        city: record.city ?? '',
        country: record.country ?? '',
        phone: record.phone ?? '',
        email: record.email ?? '',
        isActive: record.isActive,
      })}
      transformFormToPayload={(form) => ({
        name: form.name,
        city: form.city || undefined,
        country: form.country || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        isActive: form.isActive,
      })}
    />
  );
}