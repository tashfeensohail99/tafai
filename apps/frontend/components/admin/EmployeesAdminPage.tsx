'use client';

import React, { useEffect, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  MessageCircle,
  Plus,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { ConfirmationDialog } from '../shared/ConfirmationDialog';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import {
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  Field,
  FormInput,
} from '@/components/sales-v2/ui';
import { apiFetch } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  whatsappInboxMember?: boolean;
  skills?: string[];
  department?: { name?: string | null } | null;
  branch?: { name?: string | null } | null;
  user?: {
    email?: string | null;
    phone?: string | null;
    status?: string | null;
    userRoles?: Array<{ role: { name: string; displayName: string } }>;
  } | null;
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

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

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

const SKILL_OPTIONS: string[] = [
  'UK', 'Canada', 'Australia', 'USA', 'Schengen',
  'Student', 'Work permit', 'Family visa', 'Visit visa', 'Business immigration',
];

const ROLE_TONE: Record<string, string> = {
  super_admin:   'var(--sos-status-danger)',
  admin:         'var(--sos-brand-primary-strong)',
  sales_manager: 'var(--sos-brand-accent)',
  sales:         'var(--sos-status-success)',
  finance:       'var(--sos-status-warning)',
  processing:    '#38bdf8',
  hr:            'var(--sos-text-secondary)',
};

function roleBg(name: string): string {
  return ROLE_TONE[name.toLowerCase()] ?? 'var(--sos-text-muted)';
}

function initials(first: string, last: string): string {
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

function avatarGradient(name: string): string {
  const colors: [string, string][] = [
    ['#6366f1', '#8b5cf6'],
    ['#0ea5e9', '#6366f1'],
    ['#10b981', '#0ea5e9'],
    ['#f59e0b', '#ef4444'],
    ['#ec4899', '#8b5cf6'],
    ['#14b8a6', '#3b82f6'],
  ];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  const [a, b] = colors[hash % colors.length]!;
  return `linear-gradient(135deg, ${a}, ${b})`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      {icon}
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sos-text-muted)' }}>
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--sos-divider)', margin: '4px 0 20px' }} />;
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <div style={{
      width: 44, height: 24, borderRadius: 12, flexShrink: 0,
      background: on ? 'var(--sos-brand-primary-strong)' : 'var(--sos-border)',
      position: 'relative', transition: 'background 200ms',
    }}>
      <div style={{
        position: 'absolute', top: 3, left: on ? 22 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left 200ms', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  );
}

function SelectWrap({
  value, onChange, required, children,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sos-select"
      >
        {children}
      </select>
      <ChevronDown size={14} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--sos-text-muted)', pointerEvents: 'none' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EmployeesAdminPage() {
  const { user } = useAdminSession();

  const [employees, setEmployees]   = useState<EmployeeRow[]>([]);
  const [roles, setRoles]           = useState<RoleOption[]>([]);
  const [departments, setDepts]     = useState<DepartmentOption[]>([]);
  const [branches, setBranches]     = useState<BranchOption[]>([]);

  const [form, setForm]             = useState<EmployeeFormState>(initialForm);
  const [formOpen, setFormOpen]     = useState(false);
  const [editing, setEditing]       = useState<{ employeeId: string; userId: string } | null>(null);
  const [showPw, setShowPw]         = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<{ userId: string; name: string } | null>(null);

  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState<string | null>(null);

  // ── data loading ──────────────────────────────────────────────────────────

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [emps, rolesRes, depts, brs] = await Promise.all([
        apiFetch<EmployeeRow[]>('/employees'),
        apiFetch<RoleOption[]>('/roles'),
        apiFetch<DepartmentOption[]>('/departments'),
        apiFetch<BranchOption[]>('/branches'),
      ]);
      setEmployees(emps);
      setRoles(rolesRes);
      setDepts(depts);
      setBranches(brs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load employees');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user.permissions.includes('employees.view_all')) return;
    void loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── permission guard ──────────────────────────────────────────────────────

  if (!user.permissions.includes('employees.view_all')) {
    return <PermissionDeniedState />;
  }

  // ── form helpers ──────────────────────────────────────────────────────────

  function openCreate() {
    setForm(initialForm);
    setEditing(null);
    setError(null);
    setSuccess(null);
    setFormOpen(true);
    setShowPw(false);
  }

  function closeForm() {
    setForm(initialForm);
    setEditing(null);
    setError(null);
    setSuccess(null);
    setFormOpen(false);
    setShowPw(false);
  }

  function setField<K extends keyof EmployeeFormState>(key: K, value: EmployeeFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSkill(skill: string) {
    setForm((prev) => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter((s) => s !== skill)
        : [...prev.skills, skill],
    }));
  }

  // ── edit ──────────────────────────────────────────────────────────────────

  async function handleEdit(employeeId: string) {
    setError(null);
    setSuccess(null);
    try {
      const detail = await apiFetch<EmployeeDetail>(`/employees/${employeeId}`);
      const roleNameInProfile = detail.user.userRoles[0]?.role.name ?? '';
      const matchedRole = roles.find((r) => r.name === roleNameInProfile);
      setEditing({ employeeId: detail.id, userId: detail.userId });
      setForm({
        email: detail.user.email,
        phone: detail.user.phone ?? '',
        password: '',
        firstName: detail.firstName,
        lastName: detail.lastName,
        roleId: matchedRole?.id ?? '',
        departmentId: detail.departmentId ?? '',
        branchId: detail.branchId ?? '',
        whatsappInboxMember: detail.whatsappInboxMember ?? false,
        skills: detail.skills ?? [],
      });
      setFormOpen(true);
      setShowPw(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load employee details');
    }
  }

  // ── deactivate ────────────────────────────────────────────────────────────

  async function handleDeactivateClick(row: EmployeeRow) {
    setError(null);
    const fullName = `${row.firstName} ${row.lastName}`;
    if (row.userId) {
      setDeactivateTarget({ userId: row.userId, name: fullName });
      return;
    }
    try {
      const detail = await apiFetch<EmployeeDetail>(`/employees/${row.id}`);
      setDeactivateTarget({ userId: detail.userId, name: fullName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resolve linked user account');
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/users/${deactivateTarget.userId}/deactivate`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const name = deactivateTarget.name;
      setDeactivateTarget(null);
      setSuccess(`${name} has been deactivated.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to deactivate user');
    } finally {
      setSubmitting(false);
    }
  }

  // ── submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const selectedRole = roles.find((r) => r.id === form.roleId);

    try {
      if (editing) {
        // 1. Update user account (email / phone)
        await apiFetch(`/users/${editing.userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ email: form.email, phone: form.phone || undefined }),
        });
        // 2. Re-assign role
        if (form.roleId) {
          await apiFetch(`/users/${editing.userId}/roles`, {
            method: 'POST',
            body: JSON.stringify({ roleIds: [form.roleId] }),
          });
        }
        // 3. Update employee profile (includes WhatsApp + skills)
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
        setSuccess(`${form.firstName} ${form.lastName} updated successfully.`);
      } else {
        // 1. Create user account
        const createdUser = await apiFetch<{ id: string }>('/users', {
          method: 'POST',
          body: JSON.stringify({
            email: form.email,
            phone: form.phone || undefined,
            password: form.password,
            roleNames: selectedRole ? [selectedRole.name] : [],
          }),
        });
        // 2. Create employee profile (pass temp password so the backend can send welcome email)
        const createdEmp = await apiFetch<{ id: string }>('/employees', {
          method: 'POST',
          body: JSON.stringify({
            userId: createdUser.id,
            firstName: form.firstName,
            lastName: form.lastName,
            departmentId: form.departmentId || undefined,
            branchId: form.branchId || undefined,
            tempPasswordForEmail: form.password,
          }),
        });
        // 3. Apply WhatsApp + skills if configured during creation
        if (form.whatsappInboxMember || form.skills.length > 0) {
          await apiFetch(`/employees/${createdEmp.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              whatsappInboxMember: form.whatsappInboxMember,
              skills: form.skills,
            }),
          });
        }
        setSuccess(`${form.firstName} ${form.lastName} created — they can now log in.`);
      }

      closeForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save employee');
    } finally {
      setSubmitting(false);
    }
  }

  // ── derived metrics ───────────────────────────────────────────────────────

  const totalCount    = employees.length;
  const activeCount   = employees.filter((e) => e.user?.status === 'ACTIVE').length;
  const waPoolCount   = employees.filter((e) => e.whatsappInboxMember).length;
  const inactiveCount = employees.filter((e) => e.user?.status !== 'ACTIVE').length;

  // ── loading / error guards ────────────────────────────────────────────────

  if (loading) return <LoadingState message="Loading employees…" />;
  if (error && employees.length === 0) {
    return <ErrorState message="Unable to load employees" details={error} onRetry={() => void loadData()} />;
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Header ── */}
      <PageHeader
        eyebrow="Admin · People"
        title="Employees"
        description="Manage employee accounts, roles, department assignments, and WhatsApp inbox membership from one place."
        actions={
          <PrimaryButton iconLeft={<Plus size={15} />} onClick={openCreate}>
            New Employee
          </PrimaryButton>
        }
      />

      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <MetricCard label="Total employees"    value={totalCount}    tone="info"    Icon={Users}         hint="All employee profiles" />
        <MetricCard label="Active accounts"    value={activeCount}   tone="success" Icon={UserCheck}     hint="Status = ACTIVE" />
        <MetricCard label="WhatsApp pool"      value={waPoolCount}   tone="accent"  Icon={MessageCircle} hint="In round-robin pool" />
        <MetricCard
          label="Inactive / pending"
          value={inactiveCount}
          tone={inactiveCount > 0 ? 'warning' : 'neutral'}
          Icon={UserMinus}
          hint="Need attention"
        />
      </div>

      {/* ── Success banner ── */}
      {success ? (
        <GlassCard
          variant="soft"
          padded="sm"
          style={{ borderLeft: '4px solid var(--sos-status-success)', display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <BadgeCheck size={16} style={{ color: 'var(--sos-status-success)', flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, color: 'var(--sos-text-primary)', flex: 1 }}>{success}</span>
          <button
            onClick={() => setSuccess(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sos-text-muted)', display: 'flex' }}
          >
            <X size={14} />
          </button>
        </GlassCard>
      ) : null}

      {/* ── Create / Edit form ── */}
      {formOpen ? (
        <GlassCard variant="strong" padded="lg" glow="accent">
          {/* Form header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 24 }}>
            <div>
              <div className="sos-eyebrow">{editing ? 'Edit employee' : 'New employee'}</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)', marginTop: 6 }}>
                {editing ? `Update ${form.firstName} ${form.lastName}` : 'Create a new team member'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginTop: 4 }}>
                Account credentials, role, department, and WhatsApp inbox configuration.
              </p>
            </div>
            <button
              type="button"
              onClick={closeForm}
              title="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, color: 'var(--sos-text-muted)', display: 'flex' }}
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)}>

            {/* Section: Account credentials */}
            <SectionLabel
              icon={<ShieldCheck size={14} style={{ color: 'var(--sos-brand-primary-strong)' }} />}
              label="Account credentials"
            />
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 4 }}>
              <Field label="Email" required>
                <FormInput
                  type="email"
                  required
                  placeholder="employee@tashfeen.com"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                />
              </Field>
              <Field label="Phone" hint="Optional — used for verification">
                <FormInput
                  type="tel"
                  placeholder="+92 300 0000000"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                />
              </Field>
              {!editing ? (
                <Field label="Temporary password" required hint="Employee should change this on first login">
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPw ? 'text' : 'password'}
                      required
                      placeholder="Min 8 characters"
                      value={form.password}
                      onChange={(e) => setField('password', e.target.value)}
                      className="sos-input"
                      style={{ paddingRight: 40 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sos-text-muted)', display: 'flex', alignItems: 'center' }}
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </Field>
              ) : null}
            </div>

            <Divider />

            {/* Section: Profile & assignment */}
            <SectionLabel
              icon={<UserPlus size={14} style={{ color: 'var(--sos-brand-accent)' }} />}
              label="Profile & assignment"
            />
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 4 }}>
              <Field label="First name" required>
                <FormInput required placeholder="First name" value={form.firstName} onChange={(e) => setField('firstName', e.target.value)} />
              </Field>
              <Field label="Last name" required>
                <FormInput required placeholder="Last name" value={form.lastName} onChange={(e) => setField('lastName', e.target.value)} />
              </Field>
              <Field label="Role" required>
                <SelectWrap value={form.roleId} onChange={(v) => setField('roleId', v)} required>
                  <option value="">Select role…</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.displayName}</option>)}
                </SelectWrap>
              </Field>
              <Field label="Department">
                <SelectWrap value={form.departmentId} onChange={(v) => setField('departmentId', v)}>
                  <option value="">Unassigned</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </SelectWrap>
              </Field>
              <Field label="Branch">
                <SelectWrap value={form.branchId} onChange={(v) => setField('branchId', v)}>
                  <option value="">Unassigned</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </SelectWrap>
              </Field>
            </div>

            <Divider />

            {/* Section: WhatsApp inbox */}
            <SectionLabel
              icon={<MessageCircle size={14} style={{ color: 'var(--sos-brand-primary-strong)' }} />}
              label="WhatsApp inbox"
            />

            {/* Toggle row */}
            <div
              onClick={() => setField('whatsappInboxMember', !form.whatsappInboxMember)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                padding: '14px 16px', borderRadius: 'var(--sos-radius-sm)',
                background: form.whatsappInboxMember ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-2)',
                border: `1px solid ${form.whatsappInboxMember ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                cursor: 'pointer', transition: 'all 180ms ease', marginBottom: 16,
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                  WhatsApp Inbox Member
                </div>
                <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 2 }}>
                  When enabled, this employee joins the round-robin pool that receives inbound WhatsApp leads.
                </div>
              </div>
              <ToggleSwitch on={form.whatsappInboxMember} />
            </div>

            {/* Skills */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sos-text-secondary)', marginBottom: 8 }}>
                Routing skills&nbsp;
                <span style={{ fontWeight: 400, color: 'var(--sos-text-muted)' }}>
                  — engine prefers but doesn&apos;t strictly require a match
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SKILL_OPTIONS.map((skill) => {
                  const selected = form.skills.includes(skill);
                  return (
                    <button
                      type="button"
                      key={skill}
                      onClick={() => toggleSkill(skill)}
                      style={{
                        padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        border: `1px solid ${selected ? 'var(--sos-brand-primary)' : 'var(--sos-border-subtle)'}`,
                        background: selected ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-2)',
                        color: selected ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
                        transition: 'all 160ms ease',
                      }}
                    >
                      {skill}
                    </button>
                  );
                })}
              </div>
              {form.skills.filter((s) => !SKILL_OPTIONS.includes(s)).length > 0 ? (
                <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
                  Legacy custom skills: {form.skills.filter((s) => !SKILL_OPTIONS.includes(s)).join(', ')}
                </div>
              ) : null}
            </div>

            {/* Error */}
            {error ? (
              <div style={{
                marginBottom: 16, padding: '12px 14px', borderRadius: 'var(--sos-radius-sm)',
                background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)',
                fontSize: 13, color: 'var(--sos-status-danger)',
              }}>
                {error}
              </div>
            ) : null}

            {/* Footer buttons */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <SecondaryButton type="button" onClick={closeForm}>Cancel</SecondaryButton>
              <PrimaryButton
                type="submit"
                disabled={submitting}
                iconLeft={
                  submitting
                    ? <Loader2 size={14} className="sos-spin" />
                    : editing
                      ? <BadgeCheck size={14} />
                      : <UserPlus size={14} />
                }
              >
                {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create employee'}
              </PrimaryButton>
            </div>
          </form>
        </GlassCard>
      ) : null}

      {/* ── Employee table ── */}
      <GlassCard variant="panel" padded={false}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 24px', borderBottom: '1px solid var(--sos-divider)' }}>
          <div>
            <div className="sos-eyebrow">Team roster</div>
            <h2 className="sos-title" style={{ fontSize: 16, marginTop: 4 }}>All employees</h2>
          </div>
          {!formOpen ? (
            <PrimaryButton size="sm" iconLeft={<Plus size={13} />} onClick={openCreate}>
              New Employee
            </PrimaryButton>
          ) : null}
        </div>

        {employees.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 14 }}>
            No employees found. Create the first one above.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--sos-surface-1)' }}>
                  {['Employee', 'Role', 'Department', 'Branch', 'WhatsApp', 'Status', ''].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700,
                        letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--sos-text-muted)',
                        whiteSpace: 'nowrap', borderBottom: '1px solid var(--sos-divider)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const roleName    = emp.user?.userRoles?.[0]?.role.name ?? '';
                  const roleDisplay = emp.user?.userRoles?.[0]?.role.displayName ?? '';
                  const statusActive = emp.user?.status === 'ACTIVE';
                  const fullName = `${emp.firstName} ${emp.lastName}`;
                  return (
                    <tr
                      key={emp.id}
                      style={{ borderBottom: '1px solid var(--sos-divider)', transition: 'background 140ms' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Name + email */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                            background: avatarGradient(fullName),
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 700, color: '#fff',
                          }}>
                            {initials(emp.firstName, emp.lastName)}
                          </div>
                          <div>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap' }}>
                              {fullName}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 2 }}>
                              {emp.user?.email ?? '—'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        {roleDisplay ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 600,
                            background: `color-mix(in srgb, ${roleBg(roleName)} 12%, transparent)`,
                            color: roleBg(roleName),
                            border: `1px solid color-mix(in srgb, ${roleBg(roleName)} 25%, transparent)`,
                          }}>
                            {roleDisplay}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--sos-text-muted)', fontSize: 12 }}>—</span>
                        )}
                      </td>

                      {/* Department */}
                      <td style={{ padding: '14px 16px', fontSize: 13, color: emp.department?.name ? 'var(--sos-text-secondary)' : 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>
                        {emp.department?.name ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Building2 size={12} style={{ opacity: 0.6 }} />
                            {emp.department.name}
                          </span>
                        ) : '—'}
                      </td>

                      {/* Branch */}
                      <td style={{ padding: '14px 16px', fontSize: 13, color: emp.branch?.name ? 'var(--sos-text-secondary)' : 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>
                        {emp.branch?.name ?? '—'}
                      </td>

                      {/* WhatsApp */}
                      <td style={{ padding: '14px 16px' }}>
                        {emp.whatsappInboxMember ? (
                          <StatusBadge tone="accent" size="sm" dot={false}>
                            <MessageCircle size={11} style={{ marginRight: 3 }} />
                            In pool
                          </StatusBadge>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '14px 16px' }}>
                        <StatusBadge tone={statusActive ? 'success' : 'warning'} size="sm">
                          {emp.user?.status ?? 'Unknown'}
                        </StatusBadge>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => void handleEdit(emp.id)}
                            className="sos-btn sos-btn--ghost sos-btn--sm"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void handleDeactivateClick(emp)}
                            className="sos-btn sos-btn--ghost sos-btn--sm"
                            style={{ color: 'var(--sos-status-danger)', borderColor: 'var(--sos-status-danger-border)' }}
                          >
                            Deactivate
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* ── Deactivate confirmation ── */}
      <ConfirmationDialog
        open={Boolean(deactivateTarget)}
        title={`Deactivate ${deactivateTarget?.name ?? 'employee'}?`}
        message="This will mark the linked user account as inactive and block future logins. The employee's data and history are preserved."
        confirmLabel={submitting ? 'Deactivating…' : 'Yes, deactivate'}
        onConfirm={() => void confirmDeactivate()}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
