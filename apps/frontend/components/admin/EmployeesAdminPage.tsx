'use client';

import { useEffect, useState } from 'react';
import { ConfirmationDialog } from '../shared/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../shared/DataTable';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PageHeader } from '../shared/PageHeader';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { apiFetch } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';

interface RoleOption {
  id: string;
  name: string;
  displayName: string;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface BranchOption {
  id: string;
  name: string;
}

interface EmployeeRow {
  id: string;
  userId?: string;
  firstName: string;
  lastName: string;
  department?: { name?: string | null } | null;
  branch?: { name?: string | null } | null;
  user?: { email?: string | null; phone?: string | null; status?: string | null } | null;
}

interface EmployeeDetail {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  departmentId?: string | null;
  branchId?: string | null;
  whatsappInboxMember?: boolean;
  skills?: string[];
  user: {
    email: string;
    phone?: string | null;
    status: string;
    userRoles: Array<{ role: { name: string; displayName: string } }>;
  };
}

interface EmployeeFormState {
  email: string;
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  roleId: string;
  departmentId: string;
  branchId: string;
  whatsappInboxMember: boolean;
  skills: string[];
}

const initialForm: EmployeeFormState = {
  email: '',
  phone: '',
  password: '',
  firstName: '',
  lastName: '',
  roleId: '',
  departmentId: '',
  branchId: '',
  whatsappInboxMember: false,
  skills: [],
};

/**
 * Canonical list of routing skills offered to admins. Pulled from the
 * services Tashfeen sells today. New entries can be appended; existing rows
 * keep whatever value was set even if a skill is later removed from this list.
 */
const SKILL_OPTIONS: string[] = [
  'UK',
  'Canada',
  'Australia',
  'USA',
  'Schengen',
  'Student',
  'Work permit',
  'Family visa',
  'Visit visa',
  'Business immigration',
];

export function EmployeesAdminPage() {
  const { user } = useAdminSession();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [form, setForm] = useState<EmployeeFormState>(initialForm);
  const [editing, setEditing] = useState<{ employeeId: string; userId: string } | null>(null);
  const [deactivateUserId, setDeactivateUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [employeesResponse, rolesResponse, departmentsResponse, branchesResponse] = await Promise.all([
        apiFetch<EmployeeRow[]>('/employees'),
        apiFetch<RoleOption[]>('/roles'),
        apiFetch<DepartmentOption[]>('/departments'),
        apiFetch<BranchOption[]>('/branches'),
      ]);

      setEmployees(employeesResponse);
      setRoles(rolesResponse);
      setDepartments(departmentsResponse);
      setBranches(branchesResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load employees');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user.permissions.includes('employees.view_all')) return;
    void loadData();
  }, []);

  if (!user.permissions.includes('employees.view_all')) {
    return <PermissionDeniedState />;
  }

  async function handleEdit(employeeId: string) {
    setError(null);
    try {
      const detail = await apiFetch<EmployeeDetail>(`/employees/${employeeId}`);
      const selectedRoleName = detail.user.userRoles[0]?.role.name ?? '';
      const selectedRole = roles.find((role) => role.name === selectedRoleName);

      setEditing({ employeeId: detail.id, userId: detail.userId });
      setForm({
        email: detail.user.email,
        phone: detail.user.phone ?? '',
        password: '',
        firstName: detail.firstName,
        lastName: detail.lastName,
        roleId: selectedRole?.id ?? '',
        departmentId: detail.departmentId ?? '',
        branchId: detail.branchId ?? '',
        whatsappInboxMember: detail.whatsappInboxMember ?? false,
        skills: detail.skills ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load employee details');
    }
  }

  async function handleDeactivateClick(row: EmployeeRow) {
    setError(null);

    if (row.userId) {
      setDeactivateUserId(row.userId);
      return;
    }

    try {
      const detail = await apiFetch<EmployeeDetail>(`/employees/${row.id}`);
      setDeactivateUserId(detail.userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resolve linked user account');
    }
  }

  function resetForm() {
    setForm(initialForm);
    setEditing(null);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const selectedRole = roles.find((role) => role.id === form.roleId);

    try {
      if (editing) {
        await apiFetch(`/users/${editing.userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ email: form.email, phone: form.phone || undefined }),
        });

        if (form.roleId) {
          await apiFetch(`/users/${editing.userId}/roles`, {
            method: 'POST',
            body: JSON.stringify({ roleIds: [form.roleId] }),
          });
        }

        await apiFetch(`/employees/${editing.employeeId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            firstName: form.firstName,
            lastName: form.lastName,
            departmentId: form.departmentId || undefined,
            branchId: form.branchId || undefined,
            whatsappInboxMember: form.whatsappInboxMember,
            skills: form.skills,
          }),
        });
      } else {
        const createdUser = await apiFetch<{ id: string }>('/users', {
          method: 'POST',
          body: JSON.stringify({
            email: form.email,
            phone: form.phone || undefined,
            password: form.password,
            roleNames: selectedRole ? [selectedRole.name] : [],
          }),
        });

        await apiFetch('/employees', {
          method: 'POST',
          body: JSON.stringify({
            userId: createdUser.id,
            firstName: form.firstName,
            lastName: form.lastName,
            departmentId: form.departmentId || undefined,
            branchId: form.branchId || undefined,
          }),
        });
      }

      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save employee');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDeactivate() {
    if (!deactivateUserId) return;

    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/users/${deactivateUserId}/deactivate`, { method: 'POST', body: JSON.stringify({}) });
      setDeactivateUserId(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to deactivate user');
    } finally {
      setSubmitting(false);
    }
  }

  const columns: DataTableColumn<EmployeeRow>[] = [
    {
      key: 'name',
      header: 'Employee',
      render: (row) => `${row.firstName} ${row.lastName}`,
    },
    {
      key: 'email',
      header: 'Email',
      render: (row) => row.user?.email ?? 'â€”',
    },
    {
      key: 'department',
      header: 'Department',
      render: (row) => row.department?.name ?? 'â€”',
    },
    {
      key: 'branch',
      header: 'Branch',
      render: (row) => row.branch?.name ?? 'â€”',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => row.user?.status ?? 'â€”',
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex gap-2">
          <button
            onClick={() => void handleEdit(row.id)}
            className="rounded-md border px-3 py-1 text-xs font-medium"
            style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)' }}
          >
            Edit
          </button>
          <button
            onClick={() => void handleDeactivateClick(row)}
            className="rounded-md border px-3 py-1 text-xs font-medium"
            style={{ borderColor: 'var(--sos-status-danger)', color: 'var(--sos-status-danger)' }}
          >
            Deactivate
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return <LoadingState message="Loading employees..." />;
  }

  if (error && employees.length === 0) {
    return <ErrorState message="Unable to load employees" details={error} onRetry={() => void loadData()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Manage employee access, profile assignment, and operational ownership for Week 3."
        actions={
          <button
            onClick={resetForm}
            className="rounded-md px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}
          >
            {editing ? 'Create Another Employee' : 'New Employee'}
          </button>
        }
      />

      <form onSubmit={handleSubmit} className="rounded-[28px] border px-4 py-5 shadow-sm sm:px-6" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--sos-text-primary)' }}>
            {editing ? 'Edit Employee' : 'Create Employee'}
          </h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--sos-text-muted)' }}>
            Keep employee access, branch ownership, and operational assignment aligned from one form.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            Email
            <input required value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="rounded-md border px-3 py-2 outline-none" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            Phone
            <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className="rounded-md border px-3 py-2 outline-none" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
          </label>
          {!editing ? (
            <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
              Temporary Password
              <input required type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} className="rounded-md border px-3 py-2 outline-none" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            First Name
            <input required value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} className="rounded-md border px-3 py-2 outline-none" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            Last Name
            <input required value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} className="rounded-md border px-3 py-2 outline-none" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            Role
            <select required value={form.roleId} onChange={(event) => setForm((current) => ({ ...current, roleId: event.target.value }))} className="rounded-md border px-3 py-2 outline-none" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
              <option value="">Select role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.displayName}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            Department
            <select value={form.departmentId} onChange={(event) => setForm((current) => ({ ...current, departmentId: event.target.value }))} className="rounded-md border px-3 py-2 outline-none" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
              <option value="">Unassigned</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium" style={{ color: 'var(--sos-text-secondary)' }}>
            Branch
            <select value={form.branchId} onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))} className="rounded-md border px-3 py-2 outline-none" style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-elevated)' }}>
              <option value="">Unassigned</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </label>
        </div>

        {/* ---- WhatsApp Inbox membership + skills ----
            Only editable in edit mode. On new-employee creation we keep the
            form lean; admin can flip these on after the row exists. */}
        {editing ? (
          <fieldset
            className="mt-6 rounded-md border px-4 py-4"
            style={{ borderColor: 'var(--sos-border-subtle)', backgroundColor: 'var(--sos-bg-app)' }}
          >
            <legend className="px-2 text-sm font-semibold" style={{ color: 'var(--sos-text-primary)' }}>
              WhatsApp Inbox
            </legend>

            <label
              className="flex cursor-pointer items-start gap-3 text-sm"
              style={{ color: 'var(--sos-text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={form.whatsappInboxMember}
                onChange={(event) =>
                  setForm((current) => ({ ...current, whatsappInboxMember: event.target.checked }))
                }
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="font-medium" style={{ color: 'var(--sos-text-primary)' }}>
                  WhatsApp Inbox Member
                </span>
                <span className="block text-xs" style={{ color: 'var(--sos-text-muted)' }}>
                  When on, this employee enters the round-robin pool that receives WhatsApp leads.
                </span>
              </span>
            </label>

            <div className="mt-4">
              <div
                className="mb-2 text-sm font-medium"
                style={{ color: 'var(--sos-text-primary)' }}
              >
                Skills <span className="text-xs font-normal" style={{ color: 'var(--sos-text-muted)' }}>
                  (soft routing preference â€” engine prefers but doesn't require a match)
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {SKILL_OPTIONS.map((skill) => {
                  const selected = form.skills.includes(skill);
                  return (
                    <button
                      type="button"
                      key={skill}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          skills: selected
                            ? current.skills.filter((s) => s !== skill)
                            : [...current.skills, skill],
                        }))
                      }
                      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
                      style={{
                        borderColor: selected
                          ? 'var(--sos-brand-primary)'
                          : 'var(--sos-border-subtle)',
                        backgroundColor: selected
                          ? 'var(--color-primary-50)'
                          : 'var(--sos-bg-elevated)',
                        color: selected
                          ? 'var(--color-primary-700)'
                          : 'var(--sos-text-secondary)',
                      }}
                    >
                      {skill}
                    </button>
                  );
                })}
              </div>
              {form.skills.some((s) => !SKILL_OPTIONS.includes(s)) ? (
                <div className="mt-2 text-xs" style={{ color: 'var(--sos-text-muted)' }}>
                  Custom (legacy): {form.skills.filter((s) => !SKILL_OPTIONS.includes(s)).join(', ')}
                </div>
              ) : null}
            </div>
          </fieldset>
        ) : null}

        {error ? <p className="mt-4 text-sm" style={{ color: 'var(--sos-status-danger)' }}>{error}</p> : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {editing ? (
            <button type="button" onClick={resetForm} className="w-full rounded-md border px-4 py-2 text-sm font-medium sm:w-auto" style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)' }}>
              Cancel
            </button>
          ) : null}
          <button type="submit" disabled={submitting} className="w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 sm:w-auto" style={{ backgroundColor: 'var(--sos-brand-primary)', color: 'var(--sos-text-inverse)' }}>
            {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Create Employee'}
          </button>
        </div>
      </form>

      <DataTable columns={columns} data={employees} rowKey={(row) => row.id} emptyMessage="No employees found." />

      <ConfirmationDialog
        open={Boolean(deactivateUserId)}
        title="Deactivate User"
        message="This will mark the linked user account as inactive and revoke their active sessions."
        confirmLabel={submitting ? 'Deactivating...' : 'Deactivate'}
        onConfirm={() => void confirmDeactivate()}
        onCancel={() => setDeactivateUserId(null)}
      />
    </div>
  );
}