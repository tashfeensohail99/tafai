'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, UserMinus, Copy, Check, Loader2, Search, X, Mail, ShieldCheck, Users, UserCheck, MessageCircle } from 'lucide-react';
import { PageHeader, GlassCard, MetricCard, PrimaryButton, SecondaryButton } from '@/components/sales-v2/ui';
import { FormInput, FormSelect } from '@/components/sales-v2/ui/FormFields';
import { LoadingState } from '../shared/LoadingState';
import { ErrorState } from '../shared/ErrorState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useHrSession } from '../layout/HrShell';
import { initials, avatarGradient, th, td, StatusPill } from './ui';
import {
  getHrConfig, getHrDirectory, suggestEmail, onboardEmployee, offboardEmployee,
  getDepartments, getBranches, getDesignations, getRoles,
  type HrEmployee, type OnboardPayload, type OnboardResult, type NamedRecord, type RoleRecord,
} from '@/lib/hr';

const EMPTY_FORM: OnboardPayload = {
  firstName: '', lastName: '', generateBusinessEmail: true, email: '',
  phone: '', roleNames: [], departmentId: '', branchId: '', designationId: '',
  whatsappInboxMember: false, pbxExtension: '', joiningDate: '',
};

export default function HrDirectory() {
  const { user } = useHrSession();
  const can = (k: string) => user?.permissions?.includes(k) ?? false;

  const [rows, setRows] = useState<HrEmployee[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mailConfigured, setMailConfigured] = useState(false);
  const [depts, setDepts] = useState<NamedRecord[]>([]);
  const [branches, setBranches] = useState<NamedRecord[]>([]);
  const [designations, setDesignations] = useState<NamedRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [offboardTarget, setOffboardTarget] = useState<HrEmployee | null>(null);

  const load = useCallback(async (q?: string) => {
    try { setErr(null); setRows(await getHrDirectory(q)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load employees'); }
  }, []);

  useEffect(() => {
    if (!can('hr.view')) return;
    void load();
    void getHrConfig().then((c) => setMailConfigured(c.mailConfigured)).catch(() => setMailConfigured(false));
    void getDepartments().then(setDepts).catch(() => {});
    void getBranches().then(setBranches).catch(() => {});
    void getDesignations().then(setDesignations).catch(() => {});
    void getRoles().then((r) => setRoles(r.filter((x) => !['client', 'partner'].includes(x.name)))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!can('hr.view')) return <PermissionDeniedState />;

  const active = rows?.filter((r) => r.isActive).length ?? 0;
  const inPool = rows?.filter((r) => r.whatsappInboxMember).length ?? 0;

  return (
    <div className="sos-stack" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Human Resources"
        title="Team"
        description="Onboard staff with a business email in one step, and manage the directory."
        actions={can('hr.onboard') ? (
          <PrimaryButton iconLeft={<UserPlus size={16} />} onClick={() => setShowAdd(true)}>Add employee</PrimaryButton>
        ) : null}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
        <MetricCard label="Total staff" value={rows?.length ?? 0} tone="info" Icon={Users} hint="All employee profiles" />
        <MetricCard label="Active" value={active} tone="success" Icon={UserCheck} hint="Currently enabled" />
        <MetricCard label="In WhatsApp pool" value={inPool} tone="accent" Icon={MessageCircle} hint="Round-robin lead pool" />
      </div>

      <GlassCard variant="panel" padded={false}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--sos-divider)', flexWrap: 'wrap' }}>
          <div className="sos-input-group" style={{ maxWidth: 340, flex: 1, minWidth: 220 }}>
            <span className="sos-input-group__icon"><Search size={15} /></span>
            <input className="sos-input" placeholder="Search name, code, email…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load(search.trim() || undefined)} />
          </div>
          <SecondaryButton size="sm" onClick={() => load(search.trim() || undefined)}>Search</SecondaryButton>
          {rows ? <span style={{ marginLeft: 'auto', color: 'var(--sos-text-muted)', fontSize: 13 }}>{rows.length} employees</span> : null}
        </div>

        {err ? <div style={{ padding: 20 }}><ErrorState message={err} onRetry={() => load(search.trim() || undefined)} /></div>
          : !rows ? <div style={{ padding: 20 }}><LoadingState /></div>
          : rows.length === 0 ? <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--sos-text-muted)' }}>No employees found.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--sos-surface-1)' }}>
                  {['Employee', 'Code', 'Department', 'Branch', 'Designation', 'Ext', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const full = `${r.firstName} ${r.lastName}`;
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--sos-divider)', transition: 'background 140ms' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover, var(--sos-surface-2))')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarGradient(full), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                              {initials(r.firstName, r.lastName)}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap' }}>{full}</div>
                              <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{r.user?.email ?? '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...td, color: 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>{r.employeeCode ?? '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.department?.name ?? '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.branch?.name ?? '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.designation?.name ?? '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.pbxExtension ?? '—'}</td>
                        <td style={td}><StatusPill tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</StatusPill></td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {can('hr.offboard') && r.isActive ? (
                            <button className="sos-icon-btn" title="Offboard" onClick={() => setOffboardTarget(r)} style={{ color: 'var(--sos-status-danger)' }}>
                              <UserMinus size={16} />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </GlassCard>

      {showAdd ? (
        <AddEmployeeModal mailConfigured={mailConfigured} depts={depts} branches={branches} designations={designations} roles={roles}
          onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); void load(search.trim() || undefined); }} />
      ) : null}
      {offboardTarget ? (
        <OffboardModal employee={offboardTarget} onClose={() => setOffboardTarget(null)}
          onDone={() => { setOffboardTarget(null); void load(search.trim() || undefined); }} />
      ) : null}
    </div>
  );
}

function AddEmployeeModal({ mailConfigured, depts, branches, designations, roles, onClose, onDone }: {
  mailConfigured: boolean; depts: NamedRecord[]; branches: NamedRecord[]; designations: NamedRecord[]; roles: RoleRecord[];
  onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState<OnboardPayload>({ ...EMPTY_FORM, generateBusinessEmail: mailConfigured });
  const [emailPreview, setEmailPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const set = <K extends keyof OnboardPayload>(k: K, v: OnboardPayload[K]) => setForm((f) => ({ ...f, [k]: v }));

  const previewEmail = async () => {
    if (!form.generateBusinessEmail || !form.firstName.trim()) { setEmailPreview(null); return; }
    try { setEmailPreview((await suggestEmail(form.firstName.trim())).email); } catch { setEmailPreview(null); }
  };
  const submit = async () => {
    setError(null);
    if (!form.firstName.trim() || !form.lastName.trim()) { setError('First and last name are required.'); return; }
    if (!form.generateBusinessEmail && !form.email?.trim()) { setError('Enter an email, or turn on "Generate business email".'); return; }
    setSubmitting(true);
    try {
      setResult(await onboardEmployee({
        ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        email: form.generateBusinessEmail ? undefined : form.email?.trim(),
        roleNames: form.roleNames?.length ? form.roleNames : undefined,
        departmentId: form.departmentId || undefined, branchId: form.branchId || undefined,
        designationId: form.designationId || undefined, phone: form.phone?.trim() || undefined,
        pbxExtension: form.pbxExtension?.trim() || undefined, joiningDate: form.joiningDate || undefined,
      }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Onboarding failed'); }
    finally { setSubmitting(false); }
  };

  return (
    <ModalShell title={result ? 'Employee created' : 'Add employee'} onClose={result ? onDone : onClose} wide={!result}>
      {result ? <CredentialCard title={`${result.name} created · ${result.employeeCode}`} email={result.email} password={result.password}
          note={result.mailboxCreated ? 'Mailbox created on MXRoute — same password works for the inbox and the CRM login.' : 'CRM login only (no mailbox created).'} onDone={onDone} />
        : (
          <div className="sos-stack" style={{ gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormInput label="First name" required value={form.firstName} onChange={(e) => set('firstName', e.target.value)} onBlur={previewEmail} />
              <FormInput label="Last name" required value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
            </div>
            <div style={{ background: 'var(--sos-surface-2)', borderRadius: 'var(--sos-radius-sm)', padding: 14, border: '1px solid var(--sos-border-subtle)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: mailConfigured ? 'pointer' : 'not-allowed', opacity: mailConfigured ? 1 : 0.5, fontSize: 14, fontWeight: 600 }}>
                <input type="checkbox" checked={!!form.generateBusinessEmail} disabled={!mailConfigured}
                  onChange={(e) => { set('generateBusinessEmail', e.target.checked); if (e.target.checked) void previewEmail(); }} />
                <Mail size={15} /> Generate business email (MXRoute)
              </label>
              {!mailConfigured ? <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 6 }}>Email provisioning not configured.</div>
                : form.generateBusinessEmail ? (
                  <div style={{ fontSize: 13, marginTop: 8, color: 'var(--sos-text-secondary)' }}>Will create: <strong style={{ color: 'var(--sos-text-primary)' }}>{emailPreview ?? '…enter first name'}</strong>
                    <span style={{ color: 'var(--sos-text-muted)' }}> — password auto-generated, shown once.</span></div>
                ) : <div style={{ marginTop: 8 }}><FormInput label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormSelect label="Department" value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)} placeholder="Select…" options={depts.map((d) => ({ value: d.id, label: d.name }))} />
              <FormSelect label="Branch" value={form.branchId} onChange={(e) => set('branchId', e.target.value)} placeholder="Select…" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              <FormSelect label="Designation" value={form.designationId} onChange={(e) => set('designationId', e.target.value)} placeholder="Select…" options={designations.map((d) => ({ value: d.id, label: d.name }))} />
              <FormSelect label="Role" value={form.roleNames?.[0] ?? ''} onChange={(e) => set('roleNames', e.target.value ? [e.target.value] : [])} placeholder="Select…" options={roles.map((r) => ({ value: r.name, label: r.displayName }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <FormInput label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              <FormInput label="Telenor extension" value={form.pbxExtension} onChange={(e) => set('pbxExtension', e.target.value)} />
              <FormInput label="Joining date" type="date" value={form.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={!!form.whatsappInboxMember} onChange={(e) => set('whatsappInboxMember', e.target.checked)} />
              Add to the WhatsApp lead inbox (round-robin pool)
            </label>
            {error ? <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{error}</div> : null}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <SecondaryButton onClick={onClose} disabled={submitting}>Cancel</SecondaryButton>
              <PrimaryButton onClick={submit} disabled={submitting} iconLeft={submitting ? <Loader2 size={16} className="sos-spin" /> : <UserPlus size={16} />}>
                {submitting ? 'Creating…' : 'Create employee'}
              </PrimaryButton>
            </div>
          </div>
        )}
    </ModalShell>
  );
}

function OffboardModal({ employee, onClose, onDone }: { employee: HrEmployee; onClose: () => void; onDone: () => void }) {
  const [deleteMailbox, setDeleteMailbox] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onDomain = employee.user?.email?.endsWith('@tashfeengroup.com') ?? false;
  const run = async () => {
    setBusy(true); setError(null);
    try { await offboardEmployee(employee.id, deleteMailbox && onDomain); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Offboard failed'); setBusy(false); }
  };
  return (
    <ModalShell title={`Offboard ${employee.firstName} ${employee.lastName}`} onClose={onClose}>
      <div className="sos-stack" style={{ gap: 14 }}>
        <p style={{ fontSize: 14, color: 'var(--sos-text-secondary)' }}>Disables their CRM login immediately and revokes active sessions. Their data stays intact.</p>
        {onDomain ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={deleteMailbox} onChange={(e) => setDeleteMailbox(e.target.checked)} />
            Also permanently delete the mailbox <code>{employee.user?.email}</code>
          </label>
        ) : <div style={{ fontSize: 13, color: 'var(--sos-text-muted)' }}>No MXRoute mailbox on this account to remove.</div>}
        {error ? <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{error}</div> : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
          <button className="sos-btn sos-btn--danger" onClick={run} disabled={busy}>{busy ? 'Offboarding…' : 'Offboard'}</button>
        </div>
      </div>
    </ModalShell>
  );
}

export function CredentialCard({ title, email, password, note, onDone }: { title: string; email: string; password: string; note: string; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (label: string, value: string) => void navigator.clipboard.writeText(value).then(() => { setCopied(label); setTimeout(() => setCopied(null), 1500); });
  const both = `Email: ${email}\nPassword: ${password}\nLogin: https://tashfeengroup.com/login`;
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <span style={{ width: 90, color: 'var(--sos-text-muted)', fontSize: 13 }}>{label}</span>
      <code style={{ flex: 1, fontSize: 14, wordBreak: 'break-all', color: 'var(--sos-text-primary)' }}>{value}</code>
      <button className="sos-icon-btn" title="Copy" onClick={() => copy(label, value)}>{copied === label ? <Check size={15} /> : <Copy size={15} />}</button>
    </div>
  );
  return (
    <div className="sos-stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sos-status-success)' }}><ShieldCheck size={18} /> <strong>{title}</strong></div>
      <div style={{ background: 'var(--sos-status-warning-soft, rgba(255,196,0,0.08))', border: '1px solid var(--sos-status-warning-border, rgba(255,196,0,0.35))', borderRadius: 'var(--sos-radius-sm)', padding: 14 }}>
        <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 600, color: 'var(--sos-text-primary)' }}>⚠ Save these now — the password is shown only once.</div>
        <Row label="Email" value={email} />
        <Row label="Password" value={password} />
        <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 4 }}>{note}</div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <SecondaryButton onClick={() => copy('both', both)} iconLeft={copied === 'both' ? <Check size={16} /> : <Copy size={16} />}>{copied === 'both' ? 'Copied' : 'Copy all'}</SecondaryButton>
        <PrimaryButton onClick={onDone}>Done</PrimaryButton>
      </div>
    </div>
  );
}

export function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div className="sos-glass" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: wide ? 640 : 460, maxHeight: '90vh', overflowY: 'auto', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--sos-text-primary)' }}>{title}</h2>
          <button className="sos-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
