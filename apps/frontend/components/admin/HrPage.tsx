'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  UserPlus,
  UserMinus,
  Copy,
  Check,
  Loader2,
  Search,
  X,
  Mail,
  ShieldCheck,
  Building2,
  MapPin,
  Phone,
  MessageSquare,
} from 'lucide-react';
import { PageHeader, GlassCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/sales-v2/ui';
import { FormInput, FormSelect } from '@/components/sales-v2/ui/FormFields';
import { LoadingState } from '../shared/LoadingState';
import { ErrorState } from '../shared/ErrorState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useAdminSession } from '../layout/AdminShell';
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

// Directory list — CSS grid (matches the Processing cases list), NOT a raw <table>.
// Columns: Employee · Contact · Department/Branch · Ext · Status · action
const DIRECTORY_GRID =
  'minmax(190px, 2.3fr) minmax(180px, 2fr) minmax(140px, 1.4fr) 56px 128px 44px';

type StatusFilter = 'all' | 'active' | 'inactive';

// Soft avatar tints, keyed off a stable hash so each person keeps one colour.
// All from existing status/brand tokens, so they stay on-palette in both themes.
const AVATAR_TONES: { bg: string; fg: string }[] = [
  { bg: 'var(--sos-brand-primary-soft)', fg: 'var(--sos-brand-primary-strong)' },
  { bg: 'var(--sos-status-violet-soft)', fg: 'var(--sos-status-violet)' },
  { bg: 'var(--sos-status-cyan-soft)', fg: 'var(--sos-status-cyan)' },
  { bg: 'var(--sos-status-info-soft)', fg: 'var(--sos-status-info)' },
  { bg: 'var(--sos-status-success-soft)', fg: 'var(--sos-status-success)' },
  { bg: 'var(--sos-brand-accent-soft)', fg: 'var(--sos-brand-accent)' },
  { bg: 'var(--sos-status-pink-soft)', fg: 'var(--sos-status-pink)' },
];

function initials(first: string, last: string): string {
  const f = (first || '').trim();
  const l = (last || '').trim();
  const a = f ? f[0] : '';
  const b = l ? l[0] : f.length > 1 ? f[1] : '';
  return (a + b).toUpperCase() || '?';
}

function avatarTone(seed: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

// Square icon-button tile (the `.sos-icon-btn` class is not defined anywhere in
// the CSS system, so we style it inline — mirrors the Processing ActionIcon).
function IconBtn({
  title, onClick, danger, children,
}: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, flexShrink: 0, borderRadius: 'var(--sos-radius-sm)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-2)', color: danger ? 'var(--sos-status-danger)' : 'var(--sos-text-secondary)', cursor: 'pointer', transition: 'background 150ms' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sos-surface-3)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--sos-surface-2)'; }}
    >
      {children}
    </button>
  );
}

export default function HrPage() {
  const { user } = useAdminSession();
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [executedQuery, setExecutedQuery] = useState('');

  const load = useCallback(async (q?: string) => {
    try {
      setErr(null);
      setRows(await getHrDirectory(q));
      setExecutedQuery(q ?? '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load employees');
    }
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

  const all = rows ?? [];
  const activeCount = all.reduce((n, r) => n + (r.isActive ? 1 : 0), 0);
  const inactiveCount = all.length - activeCount;
  const visible = all.filter((r) =>
    statusFilter === 'all' ? true : statusFilter === 'active' ? r.isActive : !r.isActive,
  );
  const filters: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: all.length },
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'inactive', label: 'Inactive', count: inactiveCount },
  ];

  return (
    <div className="sos-stack" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Human Resources"
        title="HR"
        description="Onboard staff with a business email in one step, and manage the team directory."
        actions={
          can('hr.onboard') ? (
            <PrimaryButton iconLeft={<UserPlus size={16} />} onClick={() => setShowAdd(true)}>
              Add employee
            </PrimaryButton>
          ) : null
        }
      />

      <GlassCard padded={false}>
        {/* Toolbar: search + status filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '16px 18px' }}>
          <div className="sos-input-group" style={{ flex: '1 1 240px', maxWidth: 380 }}>
            <span className="sos-input-group__icon"><Search size={15} /></span>
            <input
              className="sos-input"
              placeholder="Search name, code, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load(search.trim() || undefined)}
              style={search ? { paddingRight: 34 } : undefined}
            />
            {search ? (
              <button
                type="button"
                title="Clear search"
                onClick={() => { setSearch(''); void load(); }}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sos-text-faint)' }}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          <SecondaryButton size="sm" onClick={() => load(search.trim() || undefined)}>Search</SecondaryButton>
          {!mailConfigured ? (
            <span className="sos-badge sos-badge--warning" title="Set the MXROUTE_* env vars to auto-provision mailboxes">Email provisioning off</span>
          ) : null}
          {rows ? (
            <div style={{ display: 'flex', gap: 3, background: 'var(--sos-surface-2)', borderRadius: 'var(--sos-radius-input)', padding: 3, marginLeft: 'auto' }}>
              {filters.map((f) => {
                const on = statusFilter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setStatusFilter(f.key)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 'var(--sos-radius-sm)', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: on ? 'var(--sos-brand-primary-soft)' : 'transparent', color: on ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)', transition: 'background 150ms' }}
                  >
                    {f.label}
                    <span style={{ fontSize: 11, fontWeight: 700, minWidth: 18, textAlign: 'center', padding: '0 5px', borderRadius: 999, background: on ? 'var(--sos-brand-primary-strong)' : 'var(--sos-surface-3)', color: on ? 'var(--sos-text-on-accent)' : 'var(--sos-text-muted)' }}>
                      {f.count}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {err ? (
          <div style={{ padding: '4px 18px 20px' }}><ErrorState message={err} onRetry={() => load(search.trim() || undefined)} /></div>
        ) : !rows ? (
          <div style={{ padding: '4px 18px 24px' }}><LoadingState /></div>
        ) : all.length === 0 ? (
          <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            {executedQuery ? 'No employees match your search.' : 'No employees yet. Use “Add employee” to onboard the first one.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', borderTop: '1px solid var(--sos-border-subtle)' }}>
            <div style={{ minWidth: 840 }}>
              {/* Header row */}
              <div style={{ display: 'grid', gridTemplateColumns: DIRECTORY_GRID, gap: 14, padding: '10px 18px', fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
                <span>Employee</span>
                <span>Contact</span>
                <span>Department · Branch</span>
                <span style={{ textAlign: 'right' }}>Ext</span>
                <span>Status</span>
                <span />
              </div>

              {visible.length === 0 ? (
                <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
                  No {statusFilter} employees.
                </div>
              ) : (
                visible.map((r) => {
                  const name = `${r.firstName} ${r.lastName}`.trim();
                  const tone = avatarTone(r.id || name);
                  const email = r.user?.email ?? '';
                  const phone = r.user?.phone ?? '';
                  const dept = r.department?.name;
                  const branch = r.branch?.name;
                  const sub = [r.employeeCode, r.designation?.name].filter(Boolean).join(' · ');
                  return (
                    <div
                      key={r.id}
                      style={{ display: 'grid', gridTemplateColumns: DIRECTORY_GRID, gap: 14, padding: '12px 18px', alignItems: 'center', borderBottom: '1px solid var(--sos-border-subtle)', transition: 'background 150ms' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-2)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Employee */}
                      <div style={{ display: 'flex', gap: 11, alignItems: 'center', minWidth: 0 }}>
                        <div style={{ width: 38, height: 38, flexShrink: 0, borderRadius: '50%', background: tone.bg, color: tone.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                          {initials(r.firstName, r.lastName)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                          {sub ? (
                            <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
                          ) : null}
                        </div>
                      </div>

                      {/* Contact */}
                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: email ? 'var(--sos-text-secondary)' : 'var(--sos-text-muted)' }}>
                          <Mail size={12} style={{ flexShrink: 0, color: 'var(--sos-text-muted)' }} />
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email || 'No email'}</span>
                        </div>
                        {phone ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sos-text-muted)' }}>
                            <Phone size={11} style={{ flexShrink: 0 }} />
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{phone}</span>
                          </div>
                        ) : null}
                      </div>

                      {/* Department · Branch */}
                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12.5 }}>
                        {dept ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--sos-text-secondary)' }}>
                            <Building2 size={12} style={{ flexShrink: 0, color: 'var(--sos-text-muted)' }} />
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dept}</span>
                          </div>
                        ) : null}
                        {branch ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--sos-text-muted)' }}>
                            <MapPin size={12} style={{ flexShrink: 0 }} />
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{branch}</span>
                          </div>
                        ) : null}
                        {!dept && !branch ? <span style={{ color: 'var(--sos-text-faint)' }}>—</span> : null}
                      </div>

                      {/* Ext */}
                      <div style={{ fontSize: 12.5, textAlign: 'right', color: r.pbxExtension ? 'var(--sos-text-secondary)' : 'var(--sos-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                        {r.pbxExtension || '—'}
                      </div>

                      {/* Status */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
                        <StatusBadge tone={r.isActive ? 'success' : 'neutral'} size="sm">{r.isActive ? 'Active' : 'Inactive'}</StatusBadge>
                        {r.whatsappInboxMember ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: 'var(--sos-brand-primary-strong)', background: 'var(--sos-brand-primary-soft)', padding: '1px 7px', borderRadius: 999 }}>
                            <MessageSquare size={10} /> WA inbox
                          </span>
                        ) : null}
                      </div>

                      {/* Action */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {can('hr.offboard') && r.isActive ? (
                          <IconBtn title={`Offboard ${name}`} danger onClick={() => setOffboardTarget(r)}>
                            <UserMinus size={16} />
                          </IconBtn>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </GlassCard>

      {showAdd ? (
        <AddEmployeeModal
          mailConfigured={mailConfigured}
          depts={depts} branches={branches} designations={designations} roles={roles}
          onClose={() => setShowAdd(false)}
          onDone={() => { setShowAdd(false); void load(search.trim() || undefined); }}
        />
      ) : null}

      {offboardTarget ? (
        <OffboardModal
          employee={offboardTarget}
          onClose={() => setOffboardTarget(null)}
          onDone={() => { setOffboardTarget(null); void load(search.trim() || undefined); }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-employee modal (the onboarding wizard)
// ---------------------------------------------------------------------------
function AddEmployeeModal({
  mailConfigured, depts, branches, designations, roles, onClose, onDone,
}: {
  mailConfigured: boolean;
  depts: NamedRecord[]; branches: NamedRecord[]; designations: NamedRecord[]; roles: RoleRecord[];
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
    try { setEmailPreview((await suggestEmail(form.firstName.trim())).email); }
    catch { setEmailPreview(null); }
  };

  const submit = async () => {
    setError(null);
    if (!form.firstName.trim() || !form.lastName.trim()) { setError('First and last name are required.'); return; }
    if (!form.generateBusinessEmail && !form.email?.trim()) { setError('Enter an email, or turn on "Generate business email".'); return; }
    setSubmitting(true);
    try {
      const payload: OnboardPayload = {
        ...form,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.generateBusinessEmail ? undefined : form.email?.trim(),
        roleNames: form.roleNames && form.roleNames.length ? form.roleNames : undefined,
        departmentId: form.departmentId || undefined,
        branchId: form.branchId || undefined,
        designationId: form.designationId || undefined,
        phone: form.phone?.trim() || undefined,
        pbxExtension: form.pbxExtension?.trim() || undefined,
        joiningDate: form.joiningDate || undefined,
      };
      setResult(await onboardEmployee(payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Onboarding failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={result ? 'Employee created' : 'Add employee'} onClose={result ? onDone : onClose} wide={!result}>
      {result ? (
        <CredentialCard result={result} onDone={onDone} />
      ) : (
        <div className="sos-stack" style={{ gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput label="First name" required value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)} onBlur={previewEmail} />
            <FormInput label="Last name" required value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)} />
          </div>

          <div style={{ background: 'var(--sos-surface-2, rgba(255,255,255,0.03))', borderRadius: 12, padding: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: mailConfigured ? 'pointer' : 'not-allowed', opacity: mailConfigured ? 1 : 0.5 }}>
              <input type="checkbox" checked={!!form.generateBusinessEmail} disabled={!mailConfigured}
                onChange={(e) => { set('generateBusinessEmail', e.target.checked); if (e.target.checked) void previewEmail(); }} />
              <Mail size={15} /> Generate business email (MXRoute)
            </label>
            {!mailConfigured ? (
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>Email provisioning not configured — set the MXROUTE_* env vars.</div>
            ) : form.generateBusinessEmail ? (
              <div style={{ fontSize: 13, marginTop: 8 }}>
                Will create: <strong>{emailPreview ?? '…enter first name'}</strong>
                <span style={{ opacity: 0.6 }}> — password auto-generated, shown once.</span>
              </div>
            ) : (
              <FormInput label="Email" type="email" className="" value={form.email}
                onChange={(e) => set('email', e.target.value)} style={{ marginTop: 8 }} />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormSelect label="Department" value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}
              placeholder="Select…" options={depts.map((d) => ({ value: d.id, label: d.name }))} />
            <FormSelect label="Branch" value={form.branchId} onChange={(e) => set('branchId', e.target.value)}
              placeholder="Select…" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            <FormSelect label="Designation" value={form.designationId} onChange={(e) => set('designationId', e.target.value)}
              placeholder="Select…" options={designations.map((d) => ({ value: d.id, label: d.name }))} />
            <FormSelect label="Role" value={form.roleNames?.[0] ?? ''} onChange={(e) => set('roleNames', e.target.value ? [e.target.value] : [])}
              placeholder="Select…" options={roles.map((r) => ({ value: r.name, label: r.displayName }))} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FormInput label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            <FormInput label="Telenor extension" value={form.pbxExtension} onChange={(e) => set('pbxExtension', e.target.value)} />
            <FormInput label="Joining date" type="date" value={form.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={!!form.whatsappInboxMember}
              onChange={(e) => set('whatsappInboxMember', e.target.checked)} />
            Add to the WhatsApp lead inbox (round-robin pool)
          </label>

          {error ? <div style={{ color: 'var(--sos-danger, #e5484d)', fontSize: 13 }}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <SecondaryButton onClick={onClose} disabled={submitting}>Cancel</SecondaryButton>
            <PrimaryButton onClick={submit} disabled={submitting}
              iconLeft={submitting ? <Loader2 size={16} className="sos-spin" /> : <UserPlus size={16} />}>
              {submitting ? 'Creating…' : 'Create employee'}
            </PrimaryButton>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function CredentialCard({ result, onDone }: { result: OnboardResult; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (label: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => { setCopied(label); setTimeout(() => setCopied(null), 1500); });
  };
  const both = `Email: ${result.email}\nPassword: ${result.password}\nLogin: https://tashfeengroup.com/login`;
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <span style={{ width: 90, opacity: 0.65, fontSize: 13 }}>{label}</span>
      <code style={{ flex: 1, fontSize: 14, wordBreak: 'break-all' }}>{value}</code>
      <IconBtn title="Copy" onClick={() => copy(label, value)}>
        {copied === label ? <Check size={15} /> : <Copy size={15} />}
      </IconBtn>
    </div>
  );
  return (
    <div className="sos-stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sos-success, #30a46c)' }}>
        <ShieldCheck size={18} /> <strong>{result.name}</strong> created · {result.employeeCode}
      </div>
      <div style={{ background: 'var(--sos-warning-bg, rgba(255,196,0,0.08))', border: '1px solid var(--sos-warning, rgba(255,196,0,0.4))', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 600 }}>⚠ Save these now — the password is shown only once.</div>
        <Row label="Email" value={result.email} />
        <Row label="Password" value={result.password} />
        {result.mailboxCreated ? <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>Mailbox created on MXRoute. Same password works for the inbox and the CRM login.</div>
          : <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>CRM login only (no mailbox created).</div>}
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <SecondaryButton onClick={() => copy('both', both)} iconLeft={copied === 'both' ? <Check size={16} /> : <Copy size={16} />}>
          {copied === 'both' ? 'Copied' : 'Copy all'}
        </SecondaryButton>
        <PrimaryButton onClick={onDone}>Done</PrimaryButton>
      </div>
    </div>
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
        <p style={{ fontSize: 14, opacity: 0.85 }}>
          This disables their CRM login immediately and revokes active sessions. Their data stays intact.
        </p>
        {onDomain ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={deleteMailbox} onChange={(e) => setDeleteMailbox(e.target.checked)} />
            Also permanently delete the mailbox <code>{employee.user?.email}</code>
          </label>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.6 }}>No MXRoute mailbox on this account to remove.</div>
        )}
        {error ? <div style={{ color: 'var(--sos-danger, #e5484d)', fontSize: 13 }}>{error}</div> : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
          <button className="sos-btn sos-btn--danger" onClick={run} disabled={busy}>
            {busy ? 'Offboarding…' : 'Offboard'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="sos-modal-overlay" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div className="sos-glass" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: wide ? 640 : 460, maxHeight: '90vh', overflowY: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
          <IconBtn title="Close" onClick={onClose}><X size={18} /></IconBtn>
        </div>
        {children}
      </div>
    </div>
  );
}
