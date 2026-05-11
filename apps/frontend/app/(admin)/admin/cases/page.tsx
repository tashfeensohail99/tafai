'use client';

import { useEffect, useState } from 'react';
import { ResourceManager, type ResourceFieldOption } from '@/components/admin/ResourceManager';
import type { DataTableColumn } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api-client';

interface ClientOption {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface CaseRecord {
  id: string;
  clientId: string;
  departmentId?: string | null;
  assignedEmployeeId?: string | null;
  caseNumber: string;
  serviceType: string;
  targetCountry: string;
  status: string;
  priority?: string | null;
  notes?: string | null;
  submissionDeadline?: string | null;
  client: { firstName: string; lastName: string; phone: string };
  department?: { id?: string; name?: string | null } | null;
  assignedEmployee?: { id?: string; firstName?: string | null; lastName?: string | null } | null;
  _count?: { documents?: number; appointments?: number; timelineEvents?: number };
}

const columns: DataTableColumn<CaseRecord>[] = [
  { key: 'caseNumber', header: 'Case', render: (row) => row.caseNumber },
  { key: 'client', header: 'Client', render: (row) => `${row.client.firstName} ${row.client.lastName}` },
  { key: 'service', header: 'Service', render: (row) => row.serviceType },
  { key: 'country', header: 'Target Country', render: (row) => row.targetCountry },
  { key: 'department', header: 'Department', render: (row) => row.department?.name ?? 'Unassigned' },
  { key: 'documents', header: 'Documents', render: (row) => String(row._count?.documents ?? 0) },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge type="case" status={row.status} /> },
];

export default function CasesPage() {
  const [clientOptions, setClientOptions] = useState<ResourceFieldOption[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<ResourceFieldOption[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<ResourceFieldOption[]>([]);

  useEffect(() => {
    async function loadOptions() {
      const [clients, departments, employees] = await Promise.all([
        apiFetch<ClientOption[]>('/clients'),
        apiFetch<DepartmentOption[]>('/departments'),
        apiFetch<EmployeeOption[]>('/employees'),
      ]);

      setClientOptions(clients.map((client) => ({ label: `${client.firstName} ${client.lastName} (${client.phone})`, value: client.id })));
      setDepartmentOptions(departments.map((department) => ({ label: department.name, value: department.id })));
      setEmployeeOptions(employees.map((employee) => ({ label: `${employee.firstName} ${employee.lastName}`, value: employee.id })));
    }

    void loadOptions();
  }, []);

  return (
    <ResourceManager<CaseRecord>
      permissionKey="cases.view_all"
      title="Cases"
      description="Track case ownership, processing stage, and department handovers after finance verification."
      endpoint="/cases"
      columns={columns}
      searchPlaceholder="Search cases, client names, services, or case numbers..."
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: [
            { label: 'Open', value: 'OPEN' },
            { label: 'In Progress', value: 'IN_PROGRESS' },
            { label: 'Documentation', value: 'DOCUMENTATION' },
            { label: 'Processing', value: 'PROCESSING' },
            { label: 'Submitted', value: 'SUBMITTED' },
            { label: 'Approved', value: 'APPROVED' },
            { label: 'Rejected', value: 'REJECTED' },
            { label: 'Completed', value: 'COMPLETED' },
            { label: 'On Hold', value: 'ON_HOLD' },
          ],
        },
      ]}
      fields={[
        { name: 'clientId', label: 'Client', type: 'select', options: clientOptions, required: true },
        { name: 'departmentId', label: 'Department', type: 'select', options: departmentOptions },
        { name: 'assignedEmployeeId', label: 'Assigned Employee', type: 'select', options: employeeOptions },
        { name: 'serviceType', label: 'Service Type', required: true },
        { name: 'targetCountry', label: 'Target Country', required: true },
        { name: 'priority', label: 'Priority' },
        { name: 'submissionDeadline', label: 'Submission Deadline', placeholder: '2026-06-01T00:00:00.000Z' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { label: 'Open', value: 'OPEN' },
            { label: 'In Progress', value: 'IN_PROGRESS' },
            { label: 'Documentation', value: 'DOCUMENTATION' },
            { label: 'Processing', value: 'PROCESSING' },
            { label: 'Submitted', value: 'SUBMITTED' },
            { label: 'Approved', value: 'APPROVED' },
            { label: 'Rejected', value: 'REJECTED' },
            { label: 'Completed', value: 'COMPLETED' },
            { label: 'On Hold', value: 'ON_HOLD' },
          ],
        },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      initialForm={{
        clientId: '',
        departmentId: '',
        assignedEmployeeId: '',
        serviceType: '',
        targetCountry: '',
        priority: '',
        submissionDeadline: '',
        status: 'OPEN',
        notes: '',
      }}
      transformRecordToForm={(record) => ({
        clientId: record.clientId,
        departmentId: record.departmentId ?? '',
        assignedEmployeeId: record.assignedEmployeeId ?? '',
        serviceType: record.serviceType,
        targetCountry: record.targetCountry,
        priority: record.priority ?? '',
        submissionDeadline: record.submissionDeadline ?? '',
        status: record.status,
        notes: record.notes ?? '',
      })}
      loadEditFormValues={async (record) => {
        const detail = await apiFetch<CaseRecord>(`/cases/${record.id}`);
        return {
          clientId: detail.clientId,
          departmentId: detail.departmentId ?? '',
          assignedEmployeeId: detail.assignedEmployeeId ?? '',
          serviceType: detail.serviceType,
          targetCountry: detail.targetCountry,
          priority: detail.priority ?? '',
          submissionDeadline: detail.submissionDeadline ?? '',
          status: detail.status,
          notes: detail.notes ?? '',
        };
      }}
      transformFormToPayload={(form) => ({
        clientId: form.clientId,
        departmentId: form.departmentId || undefined,
        assignedEmployeeId: form.assignedEmployeeId || undefined,
        serviceType: form.serviceType,
        targetCountry: form.targetCountry,
        priority: form.priority || undefined,
        submissionDeadline: form.submissionDeadline || undefined,
        status: form.status || undefined,
        notes: form.notes || undefined,
      })}
    />
  );
}