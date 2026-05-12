'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '../shared/DataTable';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PageHeader } from '../shared/PageHeader';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { apiFetch } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';

interface RoleRef {
  id: string;
  name: string;
  displayName: string;
}

interface UserRow {
  id: string;
  email: string;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
  lastLoginAt: string | null;
  createdAt: string;
  userRoles: Array<{ role: RoleRef }>;
}

interface RoleRecord extends RoleRef {
  isActive: boolean;
  isSystem: boolean;
}

interface CreateFormState {
  email: string;
  phone: string;
  password: string;
  roleNames: string[];
}

const emptyForm: CreateFormState = {
  email: '',
  phone: '',
  password: '',
  roleNames: [],
};

export function UsersAdminPage() {
  const { user } = useAdminSession();

  const canView = user.permissions.includes('users.view_all');
  const canCreate = user.permissions.includes('users.create');
  const canAssignRoles = user.permissions.includes('users.assign_role');
  const canDeactivate = user.permissions.includes('users.deactivate');

  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateFormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingRolesUser, setEditingRolesUser] = useState<UserRow | null>(null);
  const [roleDraft, setRoleDraft] = useState<string[]>([]);
  const [rolesSaving, setRolesSaving] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [userRows, roleRows] = await Promise.all([
        apiFetch<UserRow[]>('/users'),
        apiFetch<RoleRecord[]>('/roles'),
      ]);
      setUsers(userRows);
      setRoles(roleRows.filter((r) => r.isActive));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canView) return;
    void load();
  }, [canView]);

  const sortedRoles = useMemo(
    () => [...roles].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [roles],
  );

  if (!canView) return <PermissionDeniedState />;
  if (loading) return <LoadingState message="Loading users..." />;
  if (error && users.length === 0) {
    return <ErrorState message="Unable to load users" details={error} onRetry={() => void load()} />;
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setCreateError(null);
    try {
      await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          password: form.password,
          roleNames: form.roleNames,
        }),
      });
      setShowCreate(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create user');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssignRoles() {
    if (!editingRolesUser) return;
    setRolesSaving(true);
    setRolesError(null);
    try {
      const roleIds = sortedRoles.filter((r) => roleDraft.includes(r.name)).map((r) => r.id);
      await apiFetch(`/users/${editingRolesUser.id}/roles`, {
        method: 'POST',
        body: JSON.stringify({ roleIds }),
      });
      setEditingRolesUser(null);
      await load();
    } catch (err) {
      setRolesError(err instanceof Error ? err.message : 'Unable to update roles');
    } finally {
      setRolesSaving(false);
    }
  }

  async function handleDeactivate(target: UserRow) {
    if (target.id === user.id) return;
    if (!confirm(`Deactivate ${target.email}? They will lose all access until you re-enable them.`)) return;
    try {
      await apiFetch(`/users/${target.id}/deactivate`, { method: 'POST' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unable to deactivate user');
    }
  }

  const columns: DataTableColumn<UserRow>[] = [
    {
      key: 'email',
      header: 'Email',
      render: (row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{row.email}</span>
          {row.phone ? (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{row.phone}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusPill status={row.status} />,
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (row) =>
        row.userRoles.length === 0 ? (
          <span style={{ color: 'var(--color-text-muted)' }}>None</span>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {row.userRoles.map((ur) => (
              <span
                key={ur.role.id}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'var(--sos-brand-primary-soft)',
                  color: 'var(--sos-brand-primary-strong)',
                  border: '1px solid var(--sos-brand-primary-border)',
                }}
              >
                {ur.role.displayName}
              </span>
            ))}
          </div>
        ),
    },
    {
      key: 'lastLogin',
      header: 'Last Login',
      render: (row) =>
        row.lastLoginAt ? (
          new Date(row.lastLoginAt).toLocaleString()
        ) : (
          <span style={{ color: 'var(--color-text-muted)' }}>Never</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: 6 }}>
          {canAssignRoles ? (
            <button
              onClick={() => {
                setEditingRolesUser(row);
                setRoleDraft(row.userRoles.map((ur) => ur.role.name));
                setRolesError(null);
              }}
              className="rounded-md border px-3 py-1 text-xs font-medium"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              Edit roles
            </button>
          ) : null}
          {canDeactivate && row.id !== user.id && row.status === 'ACTIVE' ? (
            <button
              onClick={() => void handleDeactivate(row)}
              className="rounded-md border px-3 py-1 text-xs font-medium"
              style={{
                borderColor: 'var(--sos-status-danger-border)',
                color: 'var(--sos-status-danger)',
                background: 'var(--sos-status-danger-soft)',
              }}
            >
              Deactivate
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage every user account on the platform — admins, staff, partners, and client portal logins."
        actions={
          canCreate ? (
            <button
              onClick={() => {
                setShowCreate(true);
                setForm(emptyForm);
                setCreateError(null);
              }}
              className="rounded-md px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: 'var(--color-primary-600)', color: 'var(--color-text-inverse)' }}
            >
              New user
            </button>
          ) : null
        }
      />

      <DataTable data={users} columns={columns} rowKey={(row) => row.id} />

      {/* ---------- Create user modal ---------- */}
      {showCreate ? (
        <ModalShell title="Create user" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="Email" required>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="sos-input"
              />
            </FormField>
            <FormField label="Phone (optional)">
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="sos-input"
                placeholder="+1 416 555 0000"
              />
            </FormField>
            <FormField label="Temporary password" required>
              <input
                type="text"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="sos-input"
                placeholder="Min 8 characters"
              />
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                User will be forced to change this on first login.
              </div>
            </FormField>
            <FormField label="Initial roles">
              <RolePicker
                roles={sortedRoles}
                selected={form.roleNames}
                onToggle={(name) =>
                  setForm((f) =>
                    f.roleNames.includes(name)
                      ? { ...f, roleNames: f.roleNames.filter((n) => n !== name) }
                      : { ...f, roleNames: [...f.roleNames, name] },
                  )
                }
              />
            </FormField>

            {createError ? (
              <div className="sos-banner sos-banner--danger">{createError}</div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="sos-btn sos-btn--ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button type="submit" className="sos-btn sos-btn--primary" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create user'}
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {/* ---------- Edit roles modal ---------- */}
      {editingRolesUser ? (
        <ModalShell
          title={`Roles for ${editingRolesUser.email}`}
          onClose={() => setEditingRolesUser(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <RolePicker
              roles={sortedRoles}
              selected={roleDraft}
              onToggle={(name) =>
                setRoleDraft((curr) =>
                  curr.includes(name) ? curr.filter((n) => n !== name) : [...curr, name],
                )
              }
            />
            {rolesError ? (
              <div className="sos-banner sos-banner--danger">{rolesError}</div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="sos-btn sos-btn--ghost"
                onClick={() => setEditingRolesUser(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sos-btn sos-btn--primary"
                disabled={rolesSaving}
                onClick={() => void handleAssignRoles()}
              >
                {rolesSaving ? 'Saving…' : 'Save roles'}
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}

// ---------- small helpers ------------------------------------------------

function StatusPill({ status }: { status: UserRow['status'] }) {
  const map: Record<UserRow['status'], { label: string; bg: string; fg: string }> = {
    ACTIVE: { label: 'Active', bg: 'var(--sos-status-success-soft)', fg: 'var(--sos-status-success)' },
    INACTIVE: { label: 'Inactive', bg: 'var(--sos-surface-hover)', fg: 'var(--sos-text-muted)' },
    SUSPENDED: { label: 'Suspended', bg: 'var(--sos-status-danger-soft)', fg: 'var(--sos-status-danger)' },
    PENDING_VERIFICATION: {
      label: 'Pending',
      bg: 'var(--sos-status-warning-soft)',
      fg: 'var(--sos-status-warning)',
    },
  };
  const v = map[status];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 999,
        background: v.bg,
        color: v.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {v.label}
    </span>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--sos-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
        {required ? <span style={{ color: 'var(--sos-status-danger)' }}> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function RolePicker({
  roles,
  selected,
  onToggle,
}: {
  roles: RoleRecord[];
  selected: string[];
  onToggle: (roleName: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
      {roles.map((r) => {
        const checked = selected.includes(r.name);
        return (
          <label
            key={r.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 8,
              background: checked ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
              border: `1px solid ${checked ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(r.name)}
              style={{ flexShrink: 0 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.displayName}</span>
              <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{r.name}</span>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 16px',
        zIndex: 1000,
        overflowY: 'auto',
      }}
    >
      <div
        className="sos-glass sos-glass--strong"
        style={{
          width: '100%',
          maxWidth: 520,
          borderRadius: 'var(--sos-radius-panel)',
          padding: 0,
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--sos-border-subtle)',
          }}
        >
          <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)' }}>
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="sos-btn sos-btn--ghost sos-btn--sm"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}
