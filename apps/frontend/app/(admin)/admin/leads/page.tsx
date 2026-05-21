'use client';

import { useEffect, useState } from 'react';
import { ResourceManager, type ResourceFieldOption } from '@/components/admin/ResourceManager';
import type { DataTableColumn } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api-client';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface PartnerOption {
  id: string;
  companyName: string;
  referralCode: string;
}

interface BranchOption {
  id: string;
  name: string;
}

interface LeadRecord {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone: string;
  status: string;
  sourceChannel?: string | null;
  serviceInterest?: string | null;
  targetCountry?: string | null;
  assignedEmployee?: { firstName?: string | null; lastName?: string | null } | null;
  importRows?: Array<{ id: string; batch: { id: string; batchNumber: string; name: string } }>;
}

interface LeadDetail extends LeadRecord {
  branchId?: string | null;
  assignedEmployeeId?: string | null;
  referralPartnerId?: string | null;
  priority?: string | null;
  notes?: string | null;
}

const columns: DataTableColumn<LeadRecord>[] = [
  {
    key: 'name',
    header: 'Lead',
    render: (row) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {row.firstName} {row.lastName}
        {row.importRows && row.importRows.length > 0 ? (
          <CsvLeadBadge batchName={row.importRows[0]?.batch.name} />
        ) : null}
      </span>
    ),
  },
  { key: 'phone', header: 'Phone', render: (row) => row.phone },
  { key: 'service', header: 'Service', render: (row) => row.serviceInterest ?? '—' },
  { key: 'country', header: 'Target Country', render: (row) => row.targetCountry ?? '—' },
  { key: 'assigned', header: 'Assigned', render: (row) => row.assignedEmployee ? `${row.assignedEmployee.firstName ?? ''} ${row.assignedEmployee.lastName ?? ''}`.trim() : '—' },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge type="lead" status={row.status} /> },
];

export default function LeadsPage() {
  const [employeeOptions, setEmployeeOptions] = useState<ResourceFieldOption[]>([]);
  const [partnerOptions, setPartnerOptions] = useState<ResourceFieldOption[]>([]);
  const [branchOptions, setBranchOptions] = useState<ResourceFieldOption[]>([]);

  useEffect(() => {
    async function loadOptions() {
      const [employees, partners, branches] = await Promise.all([
        apiFetch<EmployeeOption[]>('/employees'),
        apiFetch<PartnerOption[]>('/partners'),
        apiFetch<BranchOption[]>('/branches'),
      ]);

      setEmployeeOptions(employees.map((employee) => ({ label: `${employee.firstName} ${employee.lastName}`, value: employee.id })));
      setPartnerOptions(partners.map((partner) => ({ label: `${partner.companyName} (${partner.referralCode})`, value: partner.id })));
      setBranchOptions(branches.map((branch) => ({ label: branch.name, value: branch.id })));
    }

    void loadOptions();
  }, []);

  return (
    <ResourceManager<LeadRecord>
      permissionKey="leads.view_all"
      title="Leads"
      description="Create and review the Week 3 lead CRM base with assignment and partner attribution."
      endpoint="/leads"
      exportPath="/leads/export.csv"
      exportFilename="leads.csv"
      columns={columns}
      searchPlaceholder="Search lead name, email, or phone..."
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: [
            { label: 'New', value: 'NEW' },
            { label: 'Contacted', value: 'CONTACTED' },
            { label: 'Qualified', value: 'QUALIFIED' },
            { label: 'Proposal Sent', value: 'PROPOSAL_SENT' },
            { label: 'Follow Up', value: 'FOLLOW_UP' },
            { label: 'Converted', value: 'CONVERTED' },
            { label: 'Lost', value: 'LOST' },
            { label: 'Duplicate', value: 'DUPLICATE' },
            { label: 'Unqualified', value: 'UNQUALIFIED' },
          ],
        },
      ]}
      fields={[
        { name: 'branchId', label: 'Branch', type: 'select', options: branchOptions },
        { name: 'assignedEmployeeId', label: 'Assigned Employee', type: 'select', options: employeeOptions },
        { name: 'referralPartnerId', label: 'Referral Partner', type: 'select', options: partnerOptions },
        { name: 'firstName', label: 'First Name', required: true },
        { name: 'lastName', label: 'Last Name', required: true },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'phone', label: 'Phone', required: true },
        { name: 'sourceChannel', label: 'Source Channel' },
        { name: 'serviceInterest', label: 'Service Interest' },
        { name: 'targetCountry', label: 'Target Country' },
        { name: 'priority', label: 'Priority' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { label: 'New', value: 'NEW' },
            { label: 'Contacted', value: 'CONTACTED' },
            { label: 'Qualified', value: 'QUALIFIED' },
            { label: 'Proposal Sent', value: 'PROPOSAL_SENT' },
            { label: 'Follow Up', value: 'FOLLOW_UP' },
            { label: 'Converted', value: 'CONVERTED' },
            { label: 'Lost', value: 'LOST' },
            { label: 'Duplicate', value: 'DUPLICATE' },
            { label: 'Unqualified', value: 'UNQUALIFIED' },
          ],
        },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      initialForm={{
        branchId: '',
        assignedEmployeeId: '',
        referralPartnerId: '',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        sourceChannel: '',
        serviceInterest: '',
        targetCountry: '',
        priority: '',
        status: 'NEW',
        notes: '',
      }}
      transformRecordToForm={(record) => ({
        branchId: '',
        assignedEmployeeId: '',
        referralPartnerId: '',
        firstName: record.firstName,
        lastName: record.lastName,
        email: record.email ?? '',
        phone: record.phone,
        sourceChannel: record.sourceChannel ?? '',
        serviceInterest: record.serviceInterest ?? '',
        targetCountry: record.targetCountry ?? '',
        priority: '',
        status: record.status,
        notes: '',
      })}
      loadEditFormValues={async (record) => {
        const detail = await apiFetch<LeadDetail>(`/leads/${record.id}`);
        return {
          branchId: detail.branchId ?? '',
          assignedEmployeeId: detail.assignedEmployeeId ?? '',
          referralPartnerId: detail.referralPartnerId ?? '',
          firstName: detail.firstName,
          lastName: detail.lastName,
          email: detail.email ?? '',
          phone: detail.phone,
          sourceChannel: detail.sourceChannel ?? '',
          serviceInterest: detail.serviceInterest ?? '',
          targetCountry: detail.targetCountry ?? '',
          priority: detail.priority ?? '',
          status: detail.status,
          notes: detail.notes ?? '',
        };
      }}
      deletable={{
        permission: 'leads.delete',
        confirmMessage: (record) =>
          `Delete ${record.firstName} ${record.lastName} (${record.phone})?\n\n` +
          `This hides the lead from the admin and sales lead lists and from the WhatsApp inbox. ` +
          `The underlying row is kept for audit purposes.`,
      }}
      bulkDeletable={{
        permission: 'leads.delete',
        confirmMessage: (count) =>
          `Delete ${count} selected lead${count === 1 ? '' : 's'}?\n\n` +
          `Each lead disappears from the admin and sales lead lists and from the WhatsApp inbox. ` +
          `The underlying rows are kept for audit purposes.`,
      }}
      transformFormToPayload={(form) => ({
        branchId: form.branchId || undefined,
        assignedEmployeeId: form.assignedEmployeeId || undefined,
        referralPartnerId: form.referralPartnerId || undefined,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email || undefined,
        phone: form.phone,
        sourceChannel: form.sourceChannel || undefined,
        serviceInterest: form.serviceInterest || undefined,
        targetCountry: form.targetCountry || undefined,
        priority: form.priority || undefined,
        status: form.status || undefined,
        notes: form.notes || undefined,
      })}
    />
  );
}