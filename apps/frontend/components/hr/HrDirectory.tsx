'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, UserMinus, Copy, Check, Loader2, Search, X, Mail, ShieldCheck, Users, UserCheck, MessageCircle } from 'lucide-react';
import { PageHeader, GlassCard, MetricCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/sales-v2/ui';
import { FormInput, FormSelect } from '@/components/sales-v2/ui/FormFields';
import { LoadingState } from '../shared/LoadingState';
import { ErrorState } from '../shared/ErrorState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useHrSession } from '../layout/HrShell';
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <MetricCard label="Total staff" value={String(rows?.length ?? '—')} Icon={Users} />
        <MetricCard label="Active" value={String(active)} Icon={UserCheck} />
        <MetricCard label="In WhatsApp pool" value={String(inPool)} Icon={MessageCircle} />
      </div>

      <GlassCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="sos-input-group" style={{ maxWidth: 340 }}>
            <span className="sos-input-group__icon"><Search size={15} /></span>
            <input className="sos-input" placeholder="Search name, code, email…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load(search.trim() || undefined)} />
          </div>
          <SecondaryButton size="sm" onClick={() => load(search.trim() || undefined)}>Search</SecondaryButton>
          {rows ? <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 13 }}>{rows.length} employees</span> : null}
        </div>

        {err ? <ErrorState message={err} onRetry={() => load(search.trim() || undefined)} />
          : !rows ? <LoadingState />
          : rows.length === 0 ? <div style={{ padding: 24, textAlign: 'center', opacity: 0.6 }}>No employees found.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table className="sos-table" style={{ width: '100%', minWidth: 820 }}>
                <thead><tr>
                  <th>Name</th><th>Code</th><th>Business email</th><th>Dept</th><th>Branch</th>
                  <th>Designation</th><th>Ext</th><th>Status</th><th></th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.firstName} {r.lastName}</td>
                      <td style={{ opacity: 0.7 }}>{r.employeeCode ?? '—'}</td>
                      <td>{r.user?.email ?? '—'}</td>
                      <td>{r.department?.name ?? '—'}</td>
                      <td>{r.branch?.name ?? '—'}</td>
                      <td>{r.designation?.name ?? '—'}</td>
                      <td>{r.pbxExtension ?? '—'}</td>
                      <td><StatusBadge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</StatusBadge></td>
                      <td>
                        {can('hr.offboard') && r.isActive ? (
                          <button className="sos-icon-btn" title="Offboard" onClick={() => setOffboardTarget(r)} style={{ color: 'var(--sos-danger, #e5484d)' }}>
                            <UserMinus size={16} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
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
            <div style={{ background: 'var(--sos-surface-2, rgba(255,255,255,0.03))', borderRadius: 12, padding: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: mailConfigured ? 'pointer' : 'not-allowed', opacity: mailConfigured ? 1 : 0.5 }}>
                <input type="checkbox" checked={!!form.generateBusinessEmail} disabled={!mailConfigured}
                  onChange={(e) => { set('generateBusinessEmail', e.target.checked); if (e.target.checked) void previewEmail(); }} />
                <Mail size={15} /> Generate business email (MXRoute)
              </label>
              {!mailConfigured ? <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>Email provisioning not configured.</div>
                : form.generateBusinessEmail ? (
                  <div style={{ fontSize: 13, marginTop: 8 }}>Will create: <strong>{emailPreview ?? '…enter first name'}</strong>
                    <span style={{ opacity: 0.6 }}> — password auto-generated, shown once.</span></div>
                ) : <FormInput label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} style={{ marginTop: 8 }} />}
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
            {error ? <div style={{ color: 'var(--sos-danger, #e5484d)', fontSize: 13 }}>{error}</div> : null}
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
        <p style={{ fontSize: 14, opacity: 0.85 }}>Disables their CRM login immediately and revokes active sessions. Their data stays intact.</p>
        {onDomain ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={deleteMailbox} onChange={(e) => setDeleteMailbox(e.target.checked)} />
            Also permanently delete the mailbox <code>{employee.user?.email}</code>
          </label>
        ) : <div style={{ fontSize: 13, opacity: 0.6 }}>No MXRoute mailbox on this account to remove.</div>}
        {error ? <div style={{ color: 'var(--sos-danger, #e5484d)', fontSize: 13 }}>{error}</div> : null}
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
      <span style={{ width: 90, opacity: 0.65, fontSize: 13 }}>{label}</span>
      <code style={{ flex: 1, fontSize: 14, wordBreak: 'break-all' }}>{value}</code>
      <button className="sos-icon-btn" title="Copy" onClick={() => copy(label, value)}>{copied === label ? <Check size={15} /> : <Copy size={15} />}</button>
    </div>
  );
  return (
    <div className="sos-stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sos-success, #30a46c)' }}><ShieldCheck size={18} /> <strong>{title}</strong></div>
      <div style={{ background: 'var(--sos-warning-bg, rgba(255,196,0,0.08))', border: '1px solid var(--sos-warning, rgba(255,196,0,0.4))', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 600 }}>⚠ Save these now — the password is shown only once.</div>
        <Row label="Email" value={email} />
        <Row label="Password" value={password} />
        <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>{note}</div>
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
    <div className="sos-modal-overlay" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div className="sos-glass" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: wide ? 640 : 460, maxHeight: '90vh', overflowY: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
          <button className="sos-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
