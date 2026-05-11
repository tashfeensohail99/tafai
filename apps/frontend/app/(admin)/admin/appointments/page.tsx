'use client';

import { useEffect, useState } from 'react';
import { ResourceManager, type ResourceFieldOption } from '@/components/admin/ResourceManager';
import type { DataTableColumn } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api-client';

interface LeadOption {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface ClientOption {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface CaseOption {
  id: string;
  caseNumber: string;
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface AppointmentRecord {
  id: string;
  leadId?: string | null;
  clientId?: string | null;
  caseId?: string | null;
  assignedEmployeeId?: string | null;
  title: string;
  appointmentType: string;
  scheduledAt: string;
  durationMinutes: number;
  location?: string | null;
  meetingLink?: string | null;
  notes?: string | null;
  status: string;
  lead?: { firstName?: string | null; lastName?: string | null; phone?: string | null } | null;
  client?: { firstName?: string | null; lastName?: string | null; phone?: string | null } | null;
  case?: { caseNumber?: string | null } | null;
}

const columns: DataTableColumn<AppointmentRecord>[] = [
  { key: 'title', header: 'Title', render: (row) => row.title },
  { key: 'owner', header: 'Owner', render: (row) => row.lead ? `${row.lead.firstName ?? ''} ${row.lead.lastName ?? ''}`.trim() : row.client ? `${row.client.firstName ?? ''} ${row.client.lastName ?? ''}`.trim() : '—' },
  { key: 'type', header: 'Type', render: (row) => row.appointmentType },
  { key: 'scheduledAt', header: 'Scheduled At', render: (row) => new Date(row.scheduledAt).toLocaleString() },
  { key: 'case', header: 'Case', render: (row) => row.case?.caseNumber ?? '—' },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge type="appointment" status={row.status} /> },
];

export default function AppointmentsPage() {
  const [leadOptions, setLeadOptions] = useState<ResourceFieldOption[]>([]);
  const [clientOptions, setClientOptions] = useState<ResourceFieldOption[]>([]);
  const [caseOptions, setCaseOptions] = useState<ResourceFieldOption[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<ResourceFieldOption[]>([]);

  useEffect(() => {
    async function loadOptions() {
      const [leads, clients, cases, employees] = await Promise.all([
        apiFetch<LeadOption[]>('/leads'),
        apiFetch<ClientOption[]>('/clients'),
        apiFetch<CaseOption[]>('/cases'),
        apiFetch<EmployeeOption[]>('/employees'),
      ]);

      setLeadOptions(leads.filter((lead) => Boolean(lead.id)).map((lead) => ({ label: `${lead.firstName} ${lead.lastName} (${lead.phone})`, value: lead.id })));
      setClientOptions(clients.map((client) => ({ label: `${client.firstName} ${client.lastName} (${client.phone})`, value: client.id })));
      setCaseOptions(cases.map((record) => ({ label: record.caseNumber, value: record.id })));
      setEmployeeOptions(employees.map((employee) => ({ label: `${employee.firstName} ${employee.lastName}`, value: employee.id })));
    }

    void loadOptions();
  }, []);

  return (
    <ResourceManager<AppointmentRecord>
      permissionKey="appointments.view_all"
      title="Appointments"
      description="Schedule and track meetings for leads before payment and for clients after conversion."
      endpoint="/appointments"
      columns={columns}
      searchPlaceholder="Search appointments, lead names, or client names..."
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: [
            { label: 'Scheduled', value: 'SCHEDULED' },
            { label: 'Confirmed', value: 'CONFIRMED' },
            { label: 'Completed', value: 'COMPLETED' },
            { label: 'Cancelled', value: 'CANCELLED' },
            { label: 'No Show', value: 'NO_SHOW' },
            { label: 'Rescheduled', value: 'RESCHEDULED' },
          ],
        },
      ]}
      fields={[
        { name: 'leadId', label: 'Lead', type: 'select', options: leadOptions },
        { name: 'clientId', label: 'Client', type: 'select', options: clientOptions },
        { name: 'caseId', label: 'Case', type: 'select', options: caseOptions },
        { name: 'assignedEmployeeId', label: 'Assigned Employee', type: 'select', options: employeeOptions },
        { name: 'title', label: 'Title', required: true },
        { name: 'appointmentType', label: 'Appointment Type', required: true },
        { name: 'scheduledAt', label: 'Scheduled At', required: true, placeholder: '2026-05-10T14:00:00.000Z' },
        { name: 'durationMinutes', label: 'Duration Minutes', required: true },
        { name: 'location', label: 'Location' },
        { name: 'meetingLink', label: 'Meeting Link' },
        { name: 'status', label: 'Status', type: 'select', options: [
          { label: 'Scheduled', value: 'SCHEDULED' },
          { label: 'Confirmed', value: 'CONFIRMED' },
          { label: 'Completed', value: 'COMPLETED' },
          { label: 'Cancelled', value: 'CANCELLED' },
          { label: 'No Show', value: 'NO_SHOW' },
          { label: 'Rescheduled', value: 'RESCHEDULED' },
        ] },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      initialForm={{
        leadId: '',
        clientId: '',
        caseId: '',
        assignedEmployeeId: '',
        title: '',
        appointmentType: 'Consultation',
        scheduledAt: '',
        durationMinutes: '30',
        location: '',
        meetingLink: '',
        status: 'SCHEDULED',
        notes: '',
      }}
      transformRecordToForm={(record) => ({
        leadId: record.leadId ?? '',
        clientId: record.clientId ?? '',
        caseId: record.caseId ?? '',
        assignedEmployeeId: record.assignedEmployeeId ?? '',
        title: record.title,
        appointmentType: record.appointmentType,
        scheduledAt: record.scheduledAt,
        durationMinutes: String(record.durationMinutes),
        location: record.location ?? '',
        meetingLink: record.meetingLink ?? '',
        status: record.status,
        notes: record.notes ?? '',
      })}
      loadEditFormValues={async (record) => {
        const detail = await apiFetch<AppointmentRecord>(`/appointments/${record.id}`);
        return {
          leadId: detail.leadId ?? '',
          clientId: detail.clientId ?? '',
          caseId: detail.caseId ?? '',
          assignedEmployeeId: detail.assignedEmployeeId ?? '',
          title: detail.title,
          appointmentType: detail.appointmentType,
          scheduledAt: detail.scheduledAt,
          durationMinutes: String(detail.durationMinutes),
          location: detail.location ?? '',
          meetingLink: detail.meetingLink ?? '',
          status: detail.status,
          notes: detail.notes ?? '',
        };
      }}
      transformFormToPayload={(form) => ({
        leadId: form.leadId || undefined,
        clientId: form.clientId || undefined,
        caseId: form.caseId || undefined,
        assignedEmployeeId: form.assignedEmployeeId || undefined,
        title: form.title,
        appointmentType: form.appointmentType,
        scheduledAt: form.scheduledAt,
        durationMinutes: Number(form.durationMinutes || 30),
        location: form.location || undefined,
        meetingLink: form.meetingLink || undefined,
        status: form.status || undefined,
        notes: form.notes || undefined,
      })}
    />
  );
}