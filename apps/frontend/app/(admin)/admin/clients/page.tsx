'use client';

import { useEffect, useState } from 'react';
import { ResourceManager, type ResourceFieldOption } from '@/components/admin/ResourceManager';
import type { DataTableColumn } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api-client';

interface BranchOption {
  id: string;
  name: string;
}

interface ClientRecord {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone: string;
  status: string;
  branch?: { name?: string | null } | null;
  _count?: { cases?: number; documents?: number; appointments?: number; invoices?: number };
}

interface ClientDetail extends ClientRecord {
  branchId?: string | null;
  alternatePhone?: string | null;
  nationality?: string | null;
  passportNumber?: string | null;
  nationalId?: string | null;
  address?: string | null;
}

const columns: DataTableColumn<ClientRecord>[] = [
  { key: 'name', header: 'Client', render: (row) => `${row.firstName} ${row.lastName}` },
  { key: 'phone', header: 'Phone', render: (row) => row.phone },
  { key: 'email', header: 'Email', render: (row) => row.email ?? '—' },
  { key: 'branch', header: 'Branch', render: (row) => row.branch?.name ?? '—' },
  { key: 'cases', header: 'Cases', render: (row) => row._count?.cases ?? 0 },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge type="user" status={row.status} /> },
];

export default function ClientsPage() {
  const [branchOptions, setBranchOptions] = useState<ResourceFieldOption[]>([]);

  useEffect(() => {
    async function loadBranches() {
      const branches = await apiFetch<BranchOption[]>('/branches');
      setBranchOptions(branches.map((branch) => ({ label: branch.name, value: branch.id })));
    }

    void loadBranches();
  }, []);

  return (
    <ResourceManager<ClientRecord>
      permissionKey="clients.view_all"
      title="Clients"
      description="Build the Week 3 client base with searchable profiles and branch grouping."
      endpoint="/clients"
      columns={columns}
      searchPlaceholder="Search client name, email, or phone..."
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: [
            { label: 'Active', value: 'ACTIVE' },
            { label: 'Inactive', value: 'INACTIVE' },
            { label: 'Completed', value: 'COMPLETED' },
            { label: 'Blocked', value: 'BLOCKED' },
          ],
        },
      ]}
      fields={[
        { name: 'branchId', label: 'Branch', type: 'select', options: branchOptions },
        { name: 'firstName', label: 'First Name', required: true },
        { name: 'lastName', label: 'Last Name', required: true },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'phone', label: 'Phone', required: true },
        { name: 'alternatePhone', label: 'Alternate Phone' },
        { name: 'nationality', label: 'Nationality' },
        { name: 'passportNumber', label: 'Passport Number' },
        { name: 'nationalId', label: 'National ID' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { label: 'Active', value: 'ACTIVE' },
            { label: 'Inactive', value: 'INACTIVE' },
            { label: 'Completed', value: 'COMPLETED' },
            { label: 'Blocked', value: 'BLOCKED' },
          ],
        },
        { name: 'address', label: 'Address', type: 'textarea' },
      ]}
      initialForm={{
        branchId: '',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        alternatePhone: '',
        nationality: '',
        passportNumber: '',
        nationalId: '',
        status: 'ACTIVE',
        address: '',
      }}
      transformRecordToForm={(record) => ({
        branchId: '',
        firstName: record.firstName,
        lastName: record.lastName,
        email: record.email ?? '',
        phone: record.phone,
        alternatePhone: '',
        nationality: '',
        passportNumber: '',
        nationalId: '',
        status: record.status,
        address: '',
      })}
      loadEditFormValues={async (record) => {
        const detail = await apiFetch<ClientDetail>(`/clients/${record.id}`);
        return {
          branchId: detail.branchId ?? '',
          firstName: detail.firstName,
          lastName: detail.lastName,
          email: detail.email ?? '',
          phone: detail.phone,
          alternatePhone: detail.alternatePhone ?? '',
          nationality: detail.nationality ?? '',
          passportNumber: detail.passportNumber ?? '',
          nationalId: detail.nationalId ?? '',
          status: detail.status,
          address: detail.address ?? '',
        };
      }}
      transformFormToPayload={(form) => ({
        branchId: form.branchId || undefined,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email || undefined,
        phone: form.phone,
        alternatePhone: form.alternatePhone || undefined,
        nationality: form.nationality || undefined,
        passportNumber: form.passportNumber || undefined,
        nationalId: form.nationalId || undefined,
        status: form.status || undefined,
        address: form.address || undefined,
      })}
    />
  );
}