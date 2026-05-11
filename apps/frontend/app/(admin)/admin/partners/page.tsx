'use client';

import { useEffect, useState } from 'react';
import { ResourceManager, type ResourceFieldOption } from '@/components/admin/ResourceManager';
import type { DataTableColumn } from '@/components/shared/DataTable';
import { apiFetch } from '@/lib/api-client';

interface BranchOption {
  id: string;
  name: string;
}

interface PartnerRecord {
  id: string;
  companyName: string;
  contactName: string;
  email?: string | null;
  phone?: string | null;
  referralCode: string;
  status: string;
  isActive: boolean;
  branch?: { name?: string | null } | null;
  _count?: { leads?: number };
}

interface PartnerDetail extends PartnerRecord {
  branchId?: string | null;
  notes?: string | null;
}

const columns: DataTableColumn<PartnerRecord>[] = [
  { key: 'companyName', header: 'Company', render: (row) => row.companyName },
  { key: 'contactName', header: 'Contact', render: (row) => row.contactName },
  { key: 'referralCode', header: 'Referral Code', render: (row) => row.referralCode },
  { key: 'branch', header: 'Branch', render: (row) => row.branch?.name ?? '—' },
  { key: 'leads', header: 'Referred Leads', render: (row) => row._count?.leads ?? 0 },
  { key: 'status', header: 'Status', render: (row) => row.status },
];

export default function PartnersPage() {
  const [branchOptions, setBranchOptions] = useState<ResourceFieldOption[]>([]);

  useEffect(() => {
    async function loadBranches() {
      const branches = await apiFetch<BranchOption[]>('/branches');
      setBranchOptions(branches.map((branch) => ({ label: branch.name, value: branch.id })));
    }

    void loadBranches();
  }, []);

  return (
    <ResourceManager<PartnerRecord>
      permissionKey="partners.view_all"
      title="Partners"
      description="Manage referral partners, branch linkage, and referral code status."
      endpoint="/partners"
      columns={columns}
      searchPlaceholder="Search company, contact, email, or referral code..."
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: [
            { label: 'Active', value: 'ACTIVE' },
            { label: 'Inactive', value: 'INACTIVE' },
            { label: 'Suspended', value: 'SUSPENDED' },
          ],
        },
      ]}
      fields={[
        { name: 'branchId', label: 'Branch', type: 'select', options: branchOptions },
        { name: 'companyName', label: 'Company Name', required: true },
        { name: 'contactName', label: 'Contact Name', required: true },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'phone', label: 'Phone' },
        { name: 'referralCode', label: 'Referral Code' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { label: 'Active', value: 'ACTIVE' },
            { label: 'Inactive', value: 'INACTIVE' },
            { label: 'Suspended', value: 'SUSPENDED' },
          ],
        },
        { name: 'notes', label: 'Notes', type: 'textarea' },
        { name: 'isActive', label: 'Active Partner', type: 'checkbox' },
      ]}
      initialForm={{
        branchId: '',
        companyName: '',
        contactName: '',
        email: '',
        phone: '',
        referralCode: '',
        status: 'ACTIVE',
        notes: '',
        isActive: true,
      }}
      transformRecordToForm={(record) => ({
        branchId: '',
        companyName: record.companyName,
        contactName: record.contactName,
        email: record.email ?? '',
        phone: record.phone ?? '',
        referralCode: record.referralCode,
        status: record.status,
        notes: '',
        isActive: record.isActive,
      })}
      loadEditFormValues={async (record) => {
        const detail = await apiFetch<PartnerDetail>(`/partners/${record.id}`);
        return {
          branchId: detail.branchId ?? '',
          companyName: detail.companyName,
          contactName: detail.contactName,
          email: detail.email ?? '',
          phone: detail.phone ?? '',
          referralCode: detail.referralCode,
          status: detail.status,
          notes: detail.notes ?? '',
          isActive: detail.isActive,
        };
      }}
      transformFormToPayload={(form) => ({
        branchId: form.branchId || undefined,
        companyName: form.companyName,
        contactName: form.contactName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        referralCode: form.referralCode || undefined,
        status: form.status || undefined,
        notes: form.notes || undefined,
        isActive: form.isActive,
      })}
    />
  );
}