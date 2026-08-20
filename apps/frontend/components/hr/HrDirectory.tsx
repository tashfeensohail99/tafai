'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, UserMinus, Copy, Check, Loader2, Search, Mail, ShieldCheck, Users, UserCheck, MessageCircle } from 'lucide-react';
import { LoadingState } from '../shared/LoadingState';
import { ErrorState } from '../shared/ErrorState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useHrSession } from '../layout/HrShell';
import { Avatar, Pill, Modal } from './ui';
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
    <div className="hr-console">
      <div className="hr-head">
        <div>
          <div className="hr-eyebrow">Human Resources</div>
          <h1 className="hr-h1">Team</h1>
          <div className="hr-lede">Onboard staff with a business email in one step, and manage the directory.</div>
        </div>
        {can('hr.onboard') ? (
          <button className="hr-btn hr-btn--primary" onClick={() => setShowAdd(true)}><UserPlus size={16} /> Add employee</button>
        ) : null}
      </div>

      <div className="hr-stats">
        <Stat ico="indigo" Icon={Users} value={rows?.length ?? 0} label="Total staff" hint="All employee profiles" />
        <Stat ico="ok" Icon={UserCheck} value={active} label="Active" hint="Currently enabled" />
        <Stat ico="brand" Icon={MessageCircle} value={inPool} label="In WhatsApp pool" hint="Round-robin lead pool" />
      </div>

      <div className="hr-panel">
        <div className="hr-panel__head">
          <div className="hr-panel__title">All employees <span>{rows?.length ?? ''}</span></div>
          <div className="hr-search">
            <Search size={15} />
            <input placeholder="Search name, code, email…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load(search.trim() || undefined)} />
          </div>
        </div>

        {err ? <div style={{ padding: 20 }}><ErrorState message={err} onRetry={() => load(search.trim() || undefined)} /></div>
          : !rows ? <div style={{ padding: 20 }}><LoadingState /></div>
          : rows.length === 0 ? <div className="hr-empty">No employees found.</div>
          : (
            <div className="hr-tbl-wrap">
              <table className="hr-table">
                <thead><tr>{['Employee', 'Code', 'Department', 'Branch', 'Ext', 'Status', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="hr-who">
                          <Avatar name={`${r.firstName} ${r.lastName}`} />
                          <div style={{ minWidth: 0 }}>
                            <b>{r.firstName} {r.lastName}</b>
                            <small>{r.user?.email ?? '—'}</small>
                          </div>
                        </div>
                      </td>
                      <td className="hr-mono">{r.employeeCode ?? '—'}</td>
                      <td className="hr-cell-strong">{r.department?.name ?? '—'}</td>
                      <td className="hr-cell-strong">{r.branch?.name ?? '—'}</td>
                      <td className="hr-mono">{r.pbxExtension ?? '—'}</td>
                      <td><Pill tone={r.isActive ? 'ok' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Pill></td>
                      <td style={{ textAlign: 'right' }}>
                        {can('hr.offboard') && r.isActive ? (
                          <button className="hr-iconbtn" title="Offboard" onClick={() => setOffboardTarget(r)}><UserMinus size={15} /></button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

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

function Stat({ ico, Icon, value, label, hint }: { ico: string; Icon: React.ComponentType<{ size?: number }>; value: number | string; label: string; hint: string }) {
  return (
    <div className="hr-stat">
      <div className={`hr-stat__ico hr-i-${ico}`}><Icon size={17} /></div>
      <div className="hr-stat__v">{value}</div>
      <div className="hr-stat__l">{label}</div>
      <div className="hr-stat__h">{hint}</div>
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

  const Fld = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="hr-field"><label className="hr-label">{label}</label>{children}</div>
  );

  return (
    <Modal title={result ? 'Employee created' : 'Add employee'} onClose={result ? onDone : onClose} wide={!result}>
      {result ? (
        <CredentialCard title={`${result.name} created · ${result.employeeCode}`} email={result.email} password={result.password}
          note={result.mailboxCreated ? 'Mailbox created on MXRoute — same password works for the inbox and the CRM login.' : 'CRM login only (no mailbox created).'} onDone={onDone} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="First name"><input className="hr-input" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} onBlur={previewEmail} /></Fld>
            <Fld label="Last name"><input className="hr-input" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></Fld>
          </div>
          <div style={{ background: 'var(--hr-panel-2)', borderRadius: 'var(--hr-radius-sm)', padding: 14, border: '1px solid var(--hr-line)' }}>
            <label className="hr-check" style={{ fontWeight: 700, opacity: mailConfigured ? 1 : 0.5, cursor: mailConfigured ? 'pointer' : 'not-allowed' }}>
              <input type="checkbox" checked={!!form.generateBusinessEmail} disabled={!mailConfigured}
                onChange={(e) => { set('generateBusinessEmail', e.target.checked); if (e.target.checked) void previewEmail(); }} />
              <Mail size={15} /> Generate business email (MXRoute)
            </label>
            {!mailConfigured ? <div style={{ fontSize: 12, color: 'var(--hr-muted)', marginTop: 6 }}>Email provisioning not configured.</div>
              : form.generateBusinessEmail ? (
                <div style={{ fontSize: 13, marginTop: 8, color: 'var(--hr-text-2)' }}>Will create: <strong style={{ color: 'var(--hr-text)' }}>{emailPreview ?? '…enter first name'}</strong>
                  <span style={{ color: 'var(--hr-muted)' }}> — password auto-generated, shown once.</span></div>
              ) : <div style={{ marginTop: 8 }}><Fld label="Email"><input className="hr-input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Fld></div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Fld label="Department"><select className="hr-select" value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}><option value="">Select…</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Fld>
            <Fld label="Branch"><select className="hr-select" value={form.branchId} onChange={(e) => set('branchId', e.target.value)}><option value="">Select…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Fld>
            <Fld label="Designation"><select className="hr-select" value={form.designationId} onChange={(e) => set('designationId', e.target.value)}><option value="">Select…</option>{designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Fld>
            <Fld label="Role"><select className="hr-select" value={form.roleNames?.[0] ?? ''} onChange={(e) => set('roleNames', e.target.value ? [e.target.value] : [])}><option value="">Select…</option>{roles.map((r) => <option key={r.id} value={r.name}>{r.displayName}</option>)}</select></Fld>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Fld label="Phone"><input className="hr-input" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Fld>
            <Fld label="Telenor extension"><input className="hr-input" value={form.pbxExtension} onChange={(e) => set('pbxExtension', e.target.value)} /></Fld>
            <Fld label="Joining date"><input className="hr-input" type="date" value={form.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} /></Fld>
          </div>
          <label className="hr-check"><input type="checkbox" checked={!!form.whatsappInboxMember} onChange={(e) => set('whatsappInboxMember', e.target.checked)} /> Add to the WhatsApp lead inbox (round-robin pool)</label>
          {error ? <div style={{ color: 'var(--hr-bad)', fontSize: 13 }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 2 }}>
            <button className="hr-btn hr-btn--ghost" onClick={onClose} disabled={submitting}>Cancel</button>
            <button className="hr-btn hr-btn--primary" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 size={16} className="hr-spin" /> : <UserPlus size={16} />}{submitting ? 'Creating…' : 'Create employee'}
            </button>
          </div>
        </div>
      )}
    </Modal>
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
    <Modal title={`Offboard ${employee.firstName} ${employee.lastName}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 14, color: 'var(--hr-text-2)', margin: 0 }}>Disables their CRM login immediately and revokes active sessions. Their data stays intact.</p>
        {onDomain ? (
          <label className="hr-check"><input type="checkbox" checked={deleteMailbox} onChange={(e) => setDeleteMailbox(e.target.checked)} /> Also permanently delete the mailbox <code style={{ color: 'var(--hr-text)' }}>{employee.user?.email}</code></label>
        ) : <div style={{ fontSize: 13, color: 'var(--hr-muted)' }}>No MXRoute mailbox on this account to remove.</div>}
        {error ? <div style={{ color: 'var(--hr-bad)', fontSize: 13 }}>{error}</div> : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="hr-btn hr-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hr-btn hr-btn--danger" onClick={run} disabled={busy}>{busy ? 'Offboarding…' : 'Offboard'}</button>
        </div>
      </div>
    </Modal>
  );
}

export function CredentialCard({ title, email, password, note, onDone }: { title: string; email: string; password: string; note: string; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (label: string, value: string) => void navigator.clipboard.writeText(value).then(() => { setCopied(label); setTimeout(() => setCopied(null), 1500); });
  const both = `Email: ${email}\nPassword: ${password}\nLogin: https://tashfeengroup.com/login`;
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="hr-cred"><span>{label}</span><code>{value}</code>
      <button className="hr-iconbtn" title="Copy" onClick={() => copy(label, value)}>{copied === label ? <Check size={15} /> : <Copy size={15} />}</button></div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--hr-ok)', fontWeight: 700 }}><ShieldCheck size={18} /> {title}</div>
      <div className="hr-note">
        <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 700, color: 'var(--hr-text)' }}>⚠ Save these now — the password is shown only once.</div>
        <Row label="Email" value={email} />
        <Row label="Password" value={password} />
        <div style={{ fontSize: 12, color: 'var(--hr-muted)', marginTop: 4 }}>{note}</div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <button className="hr-btn hr-btn--ghost" onClick={() => copy('both', both)}>{copied === 'both' ? <Check size={16} /> : <Copy size={16} />} {copied === 'both' ? 'Copied' : 'Copy all'}</button>
        <button className="hr-btn hr-btn--primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
