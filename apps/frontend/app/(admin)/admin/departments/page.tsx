'use client';

import { ResourceManager } from '@/components/admin/ResourceManager';
import type { DataTableColumn } from '@/components/shared/DataTable';

interface DepartmentRecord {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  _count?: { employees?: number; cases?: number };
}

const columns: DataTableColumn<DepartmentRecord>[] = [
  { key: 'name', header: 'Department', render: (row) => row.name },
  { key: 'description', header: 'Description', render: (row) => row.description ?? '—' },
  { key: 'employees', header: 'Employees', render: (row) => row._count?.employees ?? 0 },
  { key: 'cases', header: 'Cases', render: (row) => row._count?.cases ?? 0 },
  { key: 'status', header: 'Status', render: (row) => (row.isActive ? 'Active' : 'Inactive') },
];

export default function DepartmentsPage() {
  return (
    <ResourceManager<DepartmentRecord>
      permissionKey="settings.manage"
      title="Departments"
      description="Manage department structure for assignment, ownership, and Week 3 admin setup."
      endpoint="/departments"
      columns={columns}
      searchPlaceholder="Search departments..."
      fields={[
        { name: 'name', label: 'Department Name', required: true },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'isActive', label: 'Active Department', type: 'checkbox' },
      ]}
      initialForm={{ name: '', description: '', isActive: true }}
      transformRecordToForm={(record) => ({
        name: record.name,
        description: record.description ?? '',
        isActive: record.isActive,
      })}
      transformFormToPayload={(form) => ({
        name: form.name,
        description: form.description || undefined,
        isActive: form.isActive,
      })}
    />
  );
}