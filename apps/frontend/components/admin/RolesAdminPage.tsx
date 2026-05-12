'use client';

import { useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '../shared/DataTable';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PageHeader } from '../shared/PageHeader';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { apiFetch } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';

interface PermissionRecord {
  id: string;
  key: string;
  module: string;
  description?: string | null;
}

interface RoleRecord {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  isSystem: boolean;
  isActive: boolean;
  rolePermissions: Array<{ permission: PermissionRecord }>;
  _count: { userRoles: number };
}

interface RoleFormState {
  name: string;
  displayName: string;
  description: string;
  isActive: boolean;
  permissionKeys: string[];
}

const initialRoleForm: RoleFormState = {
  name: '',
  displayName: '',
  description: '',
  isActive: true,
  permissionKeys: [],
};

export function RolesAdminPage() {
  const { user } = useAdminSession();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [form, setForm] = useState<RoleFormState>(initialRoleForm);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [rolesResponse, permissionsResponse] = await Promise.all([
        apiFetch<RoleRecord[]>('/roles'),
        apiFetch<PermissionRecord[]>('/permissions'),
      ]);
      setRoles(rolesResponse);
      setPermissions(permissionsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load roles');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user.permissions.includes('settings.manage')) return;
    void loadData();
  }, []);

  if (!user.permissions.includes('settings.manage')) {
    return <PermissionDeniedState />;
  }

  function resetForm() {
    setEditingRole(null);
    setForm(initialRoleForm);
    setError(null);
  }

  function togglePermission(permissionKey: string) {
    setForm((current) => ({
      ...current,
      permissionKeys: current.permissionKeys.includes(permissionKey)
        ? current.permissionKeys.filter((key) => key !== permissionKey)
        : [...current.permissionKeys, permissionKey],
    }));
  }

  function handleEdit(role: RoleRecord) {
    if (role.isSystem) return;
    setEditingRole(role);
    setForm({
      name: role.name,
      displayName: role.displayName,
      description: role.description ?? '',
      isActive: role.isActive,
      permissionKeys: role.rolePermissions.map((entry) => entry.permission.key),
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (editingRole) {
        await apiFetch(`/roles/${editingRole.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: form.displayName,
            description: form.description || undefined,
            isActive: form.isActive,
          }),
        });

        await apiFetch(`/roles/${editingRole.id}/permissions`, {
          method: 'POST',
          body: JSON.stringify({ permissionKeys: form.permissionKeys }),
        });
      } else {
        await apiFetch('/roles', {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            displayName: form.displayName,
            description: form.description || undefined,
            permissionKeys: form.permissionKeys,
          }),
        });
      }

      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save role');
    } finally {
      setSubmitting(false);
    }
  }

  const permissionGroups = permissions.reduce<Record<string, PermissionRecord[]>>((groups, permission) => {
    groups[permission.module] = groups[permission.module] ?? [];
    groups[permission.module].push(permission);
    return groups;
  }, {});

  const columns: DataTableColumn<RoleRecord>[] = [
    { key: 'displayName', header: 'Role', render: (row) => row.displayName },
    { key: 'name', header: 'Key', render: (row) => row.name },
    { key: 'permissions', header: 'Permissions', render: (row) => row.rolePermissions.length },
    { key: 'users', header: 'Assigned Users', render: (row) => row._count.userRoles },
    { key: 'type', header: 'Type', render: (row) => (row.isSystem ? 'System' : 'Custom') },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) =>
        row.isSystem ? (
          <span style={{ color: 'var(--sos-text-muted)' }}>Locked</span>
        ) : (
          <button onClick={() => handleEdit(row)} className="sos-btn sos-btn--ghost sos-btn--sm" style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)' }}>
            Edit
          </button>
        ),
    },
  ];

  if (loading) {
    return <LoadingState message="Loading roles..." />;
  }

  if (error && roles.length === 0) {
    return <ErrorState message="Unable to load roles" details={error} onRetry={() => void loadData()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles"
        description="Manage custom roles and permission matrices for the admin portal."
        actions={
          <button onClick={resetForm} className="sos-btn sos-btn--primary" style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}>
            {editingRole ? 'Create New Role' : 'New Role'}
          </button>
        }
      />

      <form onSubmit={handleSubmit} className="sos-glass sos-glass--panel" style={{ padding: 24 }}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            Role Key
            <input required disabled={Boolean(editingRole)} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="sos-input" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            Display Name
            <input required value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} className="sos-input" />
          </label>
          <label className="md:col-span-2 flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            Description
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="sos-textarea" style={{ minHeight: 100 }} />
          </label>
          <label className="flex items-center gap-3 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />
            Active Role
          </label>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(permissionGroups).map(([moduleName, modulePermissions]) => (
            <div key={moduleName} className="sos-glass sos-glass--soft" style={{ padding: 16 }}>
              <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--sos-text-muted)' }}>
                {moduleName}
              </h4>
              <div className="flex flex-col gap-2">
                {modulePermissions.map((permission) => (
                  <label key={permission.id} className="flex items-start gap-2 text-sm" style={{ color: 'var(--sos-text-secondary)' }}>
                    <input type="checkbox" checked={form.permissionKeys.includes(permission.key)} onChange={() => togglePermission(permission.key)} />
                    <span>
                      <span className="font-medium">{permission.key}</span>
                      <br />
                      <span style={{ color: 'var(--sos-text-muted)' }}>{permission.description ?? 'No description'}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error ? <p className="mt-4 text-sm" style={{ color: 'var(--sos-status-danger)' }}>{error}</p> : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {editingRole ? (
            <button type="button" onClick={resetForm} className="sos-btn sos-btn--ghost" style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)' }}>
              Cancel
            </button>
          ) : null}
          <button type="submit" disabled={submitting} className="sos-btn sos-btn--primary" style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}>
            {submitting ? 'Saving...' : editingRole ? 'Save Changes' : 'Create Role'}
          </button>
        </div>
      </form>

      <DataTable columns={columns} data={roles} rowKey={(row) => row.id} emptyMessage="No roles found." />
    </div>
  );
}