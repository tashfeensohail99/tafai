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

interface AuditLogRecord {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  createdAt: string;
  actor?: { email?: string | null } | null;
}

const columns: DataTableColumn<AuditLogRecord>[] = [
  { key: 'action', header: 'Action', render: (row) => row.action.replace(/_/g, ' ') },
  { key: 'entityType', header: 'Entity Type', render: (row) => row.entityType },
  { key: 'entityId', header: 'Entity ID', render: (row) => row.entityId ?? '—' },
  { key: 'actor', header: 'Actor', render: (row) => row.actor?.email ?? 'System' },
  { key: 'createdAt', header: 'Created At', render: (row) => new Date(row.createdAt).toLocaleString() },
];

export function AuditLogPage() {
  const { user } = useAdminSession();
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadAuditLogs() {
    setLoading(true);
    setError(null);
    try {
      const query = buildQuery({ search, action, entityType, limit: 100 });
      const response = await apiFetch<AuditLogRecord[]>(`/audit-log${query}`);
      setAuditLogs(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load audit logs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user.permissions.includes('audit.view')) return;
    void loadAuditLogs();
  }, [search, action, entityType]);

  if (!user.permissions.includes('audit.view')) {
    return <PermissionDeniedState />;
  }

  if (loading && auditLogs.length === 0) {
    return <LoadingState message="Loading audit logs..." />;
  }

  if (error && auditLogs.length === 0) {
    return <ErrorState message="Unable to load audit logs" details={error} onRetry={() => void loadAuditLogs()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" description="Review sensitive actions recorded by the platform for Week 3 admin oversight." />
      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search entity type or entity id..."
        filters={[
          {
            key: 'action',
            label: 'Action',
            value: action,
            onChange: setAction,
            options: [
              { label: 'All Actions', value: '' },
              { label: 'USER_LOGIN', value: 'USER_LOGIN' },
              { label: 'USER_CREATED', value: 'USER_CREATED' },
              { label: 'LEAD_CREATED', value: 'LEAD_CREATED' },
              { label: 'CLIENT_CREATED', value: 'CLIENT_CREATED' },
              { label: 'PARTNER_CREATED', value: 'PARTNER_CREATED' },
            ],
          },
          {
            key: 'entityType',
            label: 'Entity Type',
            value: entityType,
            onChange: setEntityType,
            options: [
              { label: 'All Entity Types', value: '' },
              { label: 'UserAccount', value: 'UserAccount' },
              { label: 'Employee', value: 'Employee' },
              { label: 'Department', value: 'Department' },
              { label: 'Branch', value: 'Branch' },
              { label: 'Partner', value: 'Partner' },
              { label: 'Lead', value: 'Lead' },
              { label: 'Client', value: 'Client' },
              { label: 'Service', value: 'Service' },
              { label: 'Country', value: 'Country' },
              { label: 'Role', value: 'Role' },
            ],
          },
        ]}
        onClear={() => {
          setSearch('');
          setAction('');
          setEntityType('');
        }}
      />

      {error ? <p className="mb-4 text-sm" style={{ color: 'var(--color-status-danger)' }}>{error}</p> : null}

      <DataTable columns={columns} data={auditLogs} rowKey={(row) => row.id} emptyMessage="No audit events found." />
    </div>
  );
}