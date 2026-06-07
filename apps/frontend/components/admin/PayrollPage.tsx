'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Loader2, RefreshCw, X, FileDown, Lock, Unlock, Plus } from 'lucide-react';
import { GlassCard, PageHeader, PrimaryButton, SecondaryButton, StatusBadge, Field, FormInput, type BadgeTone } from '@/components/sales-v2/ui';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useAdminSession } from '../layout/AdminShell';
import { apiFetch } from '@/lib/api-client';
import * as P from '@/lib/payroll';

type Tab = 'review' | 'duty' | 'leave' | 'payroll' | 'comp' | 'settings';
interface Emp { id: string; firstName: string; lastName: string }

const STATUS_TONE: Record<string, BadgeTone> = {
  PRESENT: 'success', LATE: 'warning', HALF_DAY: 'info', ON_LEAVE: 'violet', ABSENT: 'danger',
  HOLIDAY: 'cyan', WEEKLY_OFF: 'neutral', OFFICIAL_DUTY: 'accent',
};
const REVIEW_TONE: Record<string, BadgeTone> = { COMPUTED: 'neutral', NEEDS_REVIEW: 'warning', APPROVED: 'success', LOCKED: 'info' };
function todayPkt(): string { return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10); }
function hrs(min?: number | null): string { if (!min) return '0h'; const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h ${m}m` : `${h}h`; }
function money(v: string | number): string { return Number(v).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
const inp = { background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', borderRadius: 8, padding: '6px 10px', color: 'var(--sos-text-primary)', fontSize: 14 } as const;

export function PayrollPage() {
  const { user } = useAdminSession();
  const canView = user.permissions.includes('employees.view_all');
  const [tab, setTab] = useState<Tab>('review');
  const [emps, setEmps] = useState<Emp[]>([]);
  useEffect(() => { if (canView) apiFetch<Emp[]>('/employees').then((r) => setEmps(r)).catch(() => undefined); }, [canView]);
  const empName = useCallback((id: string) => { const e = emps.find((x) => x.id === id); return e ? `${e.firstName} ${e.lastName}` : id.slice(0, 8); }, [emps]);

  if (!canView) return <PermissionDeniedState />;
  const TABS: Array<{ k: Tab; label: string }> = [
    { k: 'review', label: 'Daily Review' }, { k: 'duty', label: 'Official Duty' },
    { k: 'leave', label: 'Leave' }, { k: 'payroll', label: 'Payroll' }, { k: 'comp', label: 'Salaries' }, { k: 'settings', label: 'Policy' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Payroll & Attendance" description="Raw camera data → policy-computed attendance → admin-approved → locked payroll. Payroll pays only from approved data." />
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--sos-border-subtle)', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{ all: 'unset', cursor: 'pointer', padding: '8px 14px', fontSize: 13.5, fontWeight: tab === t.k ? 700 : 500, color: tab === t.k ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)', borderBottom: tab === t.k ? '2px solid var(--sos-brand-primary-strong)' : '2px solid transparent' }}>{t.label}</button>
        ))}
      </div>
      {tab === 'review' && <ReviewTab empName={empName} />}
      {tab === 'duty' && <DutyTab emps={emps} empName={empName} />}
      {tab === 'leave' && <LeaveTab emps={emps} empName={empName} />}
      {tab === 'payroll' && <PayrollTab />}
      {tab === 'comp' && <CompTab emps={emps} />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

// ─────────────────────────── Daily Review ───────────────────────────
function ReviewTab({ empName }: { empName: (id: string) => string }) {
  const [date, setDate] = useState(todayPkt());
  const [rows, setRows] = useState<P.DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await P.fetchDaily(date); setRows(r.rows); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setLoading(false); }
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<unknown>, label: string) {
    setBusy(label); setBanner(null); setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(''); }
  }

  return (
    <>
      {banner && <GlassCard><div style={{ padding: 12, color: 'var(--sos-status-success)', fontSize: 13 }}>{banner}</div></GlassCard>}
      {err && <ErrorState message={err} onRetry={() => void load()} />}
      <GlassCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, flexWrap: 'wrap' }}>
          <CalendarClock size={16} style={{ color: 'var(--sos-text-muted)' }} />
          <input type="date" value={date} max={todayPkt()} onChange={(e) => setDate(e.target.value)} style={inp} />
          <SecondaryButton onClick={() => void act(async () => { const r = await P.recompute({ date }); setBanner(`Recomputed: ${r.processed} days, ${r.needsReview} need review.`); }, 'recompute')} disabled={!!busy}>
            {busy === 'recompute' ? <Loader2 size={14} className="sos-spin" /> : <RefreshCw size={14} />} Recompute from camera
          </SecondaryButton>
          <SecondaryButton onClick={() => void act(async () => { const r = await P.bulkApprove(date); setBanner(`Approved ${r.approved} clean day(s).`); }, 'bulk')} disabled={!!busy}>
            <Check size={14} /> Approve all clean
          </SecondaryButton>
        </div>
      </GlassCard>
      {loading ? <LoadingState /> : (
        <GlassCard>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--sos-text-muted)', fontSize: 11.5 }}>
                <th style={{ padding: '10px 12px' }}>Employee</th><th style={{ padding: '10px 12px' }}>Status</th><th style={{ padding: '10px 12px' }}>Net</th><th style={{ padding: '10px 12px' }}>Exceptions</th><th style={{ padding: '10px 12px' }}>Review</th><th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId} style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{r.name}</td>
                    <td style={{ padding: '10px 12px' }}>{r.record?.status ? <StatusBadge tone={STATUS_TONE[r.record.status] ?? 'neutral'}>{r.record.status.replace('_', ' ')}</StatusBadge> : <span style={{ color: 'var(--sos-text-faint)' }}>—</span>}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--sos-text-secondary)' }}>{hrs(r.record?.netPayableMin)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {r.exceptions.length === 0 ? <span style={{ color: 'var(--sos-text-faint)', fontSize: 12 }}>none</span> :
                          r.exceptions.map((ex) => (
                            <span key={ex.id} title={ex.description ?? ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, padding: '2px 6px', borderRadius: 5, border: '1px solid var(--sos-border-subtle)', background: ex.status === 'PENDING' ? 'var(--sos-status-warning-soft)' : ex.status === 'APPROVED' ? 'var(--sos-status-success-soft)' : 'var(--sos-status-danger-soft)' }}>
                              {ex.type.replace('_', ' ')}{ex.minutes ? ` ${ex.minutes}m` : ''}
                              {ex.status === 'PENDING' && (
                                <>
                                  <button title="Approve" onClick={() => void act(() => P.reviewException(ex.id, { status: 'APPROVED', overtimeResolution: ex.type === 'OVERTIME' ? 'APPROVED_PAID' : undefined }), ex.id)} style={{ all: 'unset', cursor: 'pointer', color: 'var(--sos-status-success)' }}><Check size={11} /></button>
                                  <button title="Reject" onClick={() => void act(() => P.reviewException(ex.id, { status: 'REJECTED' }), ex.id)} style={{ all: 'unset', cursor: 'pointer', color: 'var(--sos-status-danger)' }}><X size={11} /></button>
                                </>
                              )}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>{r.record ? <StatusBadge tone={REVIEW_TONE[r.record.reviewStatus] ?? 'neutral'} size="sm">{r.record.reviewStatus.replace('_', ' ')}</StatusBadge> : '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {r.record && r.record.reviewStatus !== 'LOCKED' && r.record.reviewStatus !== 'APPROVED' ? (
                        <button onClick={() => void act(() => P.approveDay(r.employeeId, date), r.employeeId)} disabled={!!busy} className="rounded-md border px-2.5 py-1 text-xs font-medium" style={{ borderColor: 'var(--sos-status-success-border, var(--sos-divider))', color: 'var(--sos-status-success)' }}>Approve</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--sos-text-muted)' }}>No employees.</td></tr>}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </>
  );
}

// ─────────────────────────── Official Duty ───────────────────────────
function DutyTab({ emps, empName }: { emps: Emp[]; empName: (id: string) => string }) {
  const [list, setList] = useState<P.OfficialDuty[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ employeeId: '', date: todayPkt(), fromTime: '13:00', toTime: '16:00', reason: '', location: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); try { setList(await P.fetchDuty()); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function create() { setBusy(true); setErr(null); try { await P.createDuty(form); setForm({ ...form, reason: '', location: '' }); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); } }
  async function review(id: string, status: string) { try { await P.reviewDuty(id, { status }); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } }

  return (
    <>
      {err && <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>}
      <GlassCard><div style={{ padding: 14 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>New official-duty slip</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Employee</label><br /><select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} style={inp}><option value="">Select…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></div>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Date</label><br /><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={inp} /></div>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>From</label><br /><input type="time" value={form.fromTime} onChange={(e) => setForm({ ...form, fromTime: e.target.value })} style={inp} /></div>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>To</label><br /><input type="time" value={form.toTime} onChange={(e) => setForm({ ...form, toTime: e.target.value })} style={inp} /></div>
          <div style={{ flex: 1, minWidth: 160 }}><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Reason</label><br /><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Client visit, bank…" style={{ ...inp, width: '100%' }} /></div>
          <PrimaryButton onClick={() => void create()} disabled={busy || !form.employeeId || !form.reason}>{busy ? <Loader2 size={14} className="sos-spin" /> : <Plus size={14} />} Create</PrimaryButton>
        </div>
      </div></GlassCard>
      {loading ? <LoadingState /> : (
        <GlassCard><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--sos-text-muted)', fontSize: 11.5 }}><th style={{ padding: '10px 12px' }}>Employee</th><th style={{ padding: '10px 12px' }}>Date</th><th style={{ padding: '10px 12px' }}>Time</th><th style={{ padding: '10px 12px' }}>Reason</th><th style={{ padding: '10px 12px' }}>Status</th><th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th></tr></thead>
          <tbody>{list.map((d) => (
            <tr key={d.id} style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
              <td style={{ padding: '10px 12px', fontWeight: 600 }}>{empName(d.employeeId)}</td><td style={{ padding: '10px 12px' }}>{d.date.slice(0, 10)}</td>
              <td style={{ padding: '10px 12px' }}>{d.fromTime}–{d.toTime} ({hrs(d.minutes)})</td><td style={{ padding: '10px 12px', color: 'var(--sos-text-muted)' }}>{d.reason}</td>
              <td style={{ padding: '10px 12px' }}><StatusBadge tone={d.status === 'APPROVED' ? 'success' : d.status === 'REJECTED' ? 'danger' : 'warning'} size="sm">{d.status}</StatusBadge></td>
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>{d.status === 'PENDING' && (<><button onClick={() => void review(d.id, 'APPROVED')} className="rounded-md border px-2 py-0.5 text-xs" style={{ color: 'var(--sos-status-success)', borderColor: 'var(--sos-divider)', marginRight: 6 }}>Approve</button><button onClick={() => void review(d.id, 'REJECTED')} className="rounded-md border px-2 py-0.5 text-xs" style={{ color: 'var(--sos-status-danger)', borderColor: 'var(--sos-divider)' }}>Reject</button></>)}</td>
            </tr>
          ))}{list.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: 'var(--sos-text-muted)' }}>No duty slips.</td></tr>}</tbody>
        </table></div></GlassCard>
      )}
    </>
  );
}

// ─────────────────────────── Leave ───────────────────────────
function LeaveTab({ emps, empName }: { emps: Emp[]; empName: (id: string) => string }) {
  const [list, setList] = useState<P.LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ employeeId: '', kind: 'ANNUAL', fromDate: todayPkt(), toDate: todayPkt(), reason: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); try { setList(await P.fetchLeave()); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function create() { setBusy(true); setErr(null); try { await P.createLeave(form); setForm({ ...form, reason: '' }); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); } }
  async function review(id: string, status: string) { try { await P.reviewLeave(id, { status }); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } }

  return (
    <>
      {err && <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>}
      <GlassCard><div style={{ padding: 14 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>New leave request</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Employee</label><br /><select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} style={inp}><option value="">Select…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></div>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Type</label><br /><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={inp}>{['ANNUAL', 'SICK', 'CASUAL', 'UNPAID'].map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>From</label><br /><input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} style={inp} /></div>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>To</label><br /><input type="date" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} style={inp} /></div>
          <div style={{ flex: 1, minWidth: 160 }}><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Reason</label><br /><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={{ ...inp, width: '100%' }} /></div>
          <PrimaryButton onClick={() => void create()} disabled={busy || !form.employeeId}>{busy ? <Loader2 size={14} className="sos-spin" /> : <Plus size={14} />} Request</PrimaryButton>
        </div>
      </div></GlassCard>
      {loading ? <LoadingState /> : (
        <GlassCard><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--sos-text-muted)', fontSize: 11.5 }}><th style={{ padding: '10px 12px' }}>Employee</th><th style={{ padding: '10px 12px' }}>Type</th><th style={{ padding: '10px 12px' }}>Dates</th><th style={{ padding: '10px 12px' }}>Days</th><th style={{ padding: '10px 12px' }}>Status</th><th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th></tr></thead>
          <tbody>{list.map((l) => (
            <tr key={l.id} style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
              <td style={{ padding: '10px 12px', fontWeight: 600 }}>{empName(l.employeeId)}</td><td style={{ padding: '10px 12px' }}>{l.kind}{l.paid ? '' : ' (unpaid)'}</td>
              <td style={{ padding: '10px 12px' }}>{l.fromDate.slice(0, 10)} → {l.toDate.slice(0, 10)}</td><td style={{ padding: '10px 12px' }}>{l.days}</td>
              <td style={{ padding: '10px 12px' }}><StatusBadge tone={l.status === 'APPROVED' ? 'success' : l.status === 'REJECTED' ? 'danger' : l.status === 'CANCELLED' ? 'neutral' : 'warning'} size="sm">{l.status}</StatusBadge></td>
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>{l.status === 'PENDING' && (<><button onClick={() => void review(l.id, 'APPROVED')} className="rounded-md border px-2 py-0.5 text-xs" style={{ color: 'var(--sos-status-success)', borderColor: 'var(--sos-divider)', marginRight: 6 }}>Approve</button><button onClick={() => void review(l.id, 'REJECTED')} className="rounded-md border px-2 py-0.5 text-xs" style={{ color: 'var(--sos-status-danger)', borderColor: 'var(--sos-divider)' }}>Reject</button></>)}</td>
            </tr>
          ))}{list.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: 'var(--sos-text-muted)' }}>No leave requests.</td></tr>}</tbody>
        </table></div></GlassCard>
      )}
    </>
  );
}

// ─────────────────────────── Payroll ───────────────────────────
function PayrollTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [periods, setPeriods] = useState<P.PayrollPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [data, setData] = useState<{ period: P.PayrollPeriod; payslips: P.Payslip[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadPeriods = useCallback(async () => { try { setPeriods(await P.fetchPeriods()); } catch { /* */ } }, []);
  useEffect(() => { void loadPeriods(); }, [loadPeriods]);
  useEffect(() => { if (periodId) P.fetchPayslips(periodId).then(setData).catch(() => undefined); }, [periodId]);

  async function gen() {
    setBusy('gen'); setBanner(null); setErr(null);
    try { const r = await P.generatePayroll(year, month); setBanner(`Generated ${r.generated} payslips. ${r.unapprovedDays} working day(s) still unapproved (counted as absent in preview).`); await loadPeriods(); setPeriodId(r.periodId); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Generate failed'); } finally { setBusy(''); }
  }
  async function lock() { if (!periodId) return; if (!confirm('Lock this month? Attendance for the period becomes immutable and payslips are final.')) return; setBusy('lock'); try { await P.lockPeriod(periodId); await loadPeriods(); await P.fetchPayslips(periodId).then(setData); } catch (e) { setErr(e instanceof Error ? e.message : 'Lock failed'); } finally { setBusy(''); } }
  async function unlock() { if (!periodId) return; if (!confirm('Unlock this month? (Audited — for corrections only.)')) return; setBusy('unlock'); try { await P.unlockPeriod(periodId); await loadPeriods(); await P.fetchPayslips(periodId).then(setData); } catch (e) { setErr(e instanceof Error ? e.message : 'Unlock failed'); } finally { setBusy(''); } }

  function exportCsv() {
    if (!data) return;
    const head = ['Employee', 'Basic', 'Allowances', 'Present', 'Absent', 'Half', 'Paid leave', 'Unpaid leave', 'Absence ded.', 'Unpaid ded.', 'Overtime', 'Gross', 'Deductions', 'Net payable'];
    const lines = data.payslips.map((s) => [s.employee?.name ?? s.employeeId, s.basicSalary, s.allowances, s.presentDays, s.absentDays, s.halfDays, s.paidLeaveDays, s.unpaidLeaveDays, s.absenceDeduction, s.unpaidLeaveDeduction, s.overtimePay, s.grossPay, s.totalDeductions, s.netPayable].join(','));
    const csv = [head.join(','), ...lines].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `payroll-${data.period.year}-${String(data.period.month).padStart(2, '0')}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  const total = useMemo(() => (data ? data.payslips.reduce((s, p) => s + Number(p.netPayable), 0) : 0), [data]);

  return (
    <>
      {banner && <GlassCard><div style={{ padding: 12, color: 'var(--sos-status-success)', fontSize: 13 }}>{banner}</div></GlassCard>}
      {err && <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>}
      <GlassCard><div style={{ display: 'flex', gap: 10, padding: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={inp}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i, 1).toLocaleString('en', { month: 'long' })}</option>)}</select>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ ...inp, width: 90 }} />
        <PrimaryButton onClick={() => void gen()} disabled={!!busy}>{busy === 'gen' ? <Loader2 size={14} className="sos-spin" /> : <RefreshCw size={14} />} Generate / refresh</PrimaryButton>
        {periods.length > 0 && <select value={periodId ?? ''} onChange={(e) => setPeriodId(e.target.value || null)} style={inp}><option value="">View a period…</option>{periods.map((p) => <option key={p.id} value={p.id}>{p.year}-{String(p.month).padStart(2, '0')} {p.status === 'LOCKED' ? '🔒' : ''}</option>)}</select>}
      </div></GlassCard>
      {data && (
        <GlassCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{data.period.year}-{String(data.period.month).padStart(2, '0')} · {data.payslips.length} payslips · Net total <b>Rs {money(total)}</b> {data.period.status === 'LOCKED' && <StatusBadge tone="info" size="sm">LOCKED</StatusBadge>}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <SecondaryButton onClick={exportCsv}><FileDown size={14} /> Export CSV</SecondaryButton>
              {data.period.status === 'DRAFT'
                ? <PrimaryButton onClick={() => void lock()} disabled={!!busy}><Lock size={14} /> Lock month</PrimaryButton>
                : <SecondaryButton onClick={() => void unlock()} disabled={!!busy}><Unlock size={14} /> Unlock</SecondaryButton>}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--sos-text-muted)', fontSize: 11 }}>
              <th style={{ padding: '8px 10px' }}>Employee</th><th style={{ padding: '8px 10px' }}>Basic</th><th style={{ padding: '8px 10px' }}>Present</th><th style={{ padding: '8px 10px' }}>Absent</th><th style={{ padding: '8px 10px' }}>Leave (P/U)</th><th style={{ padding: '8px 10px' }}>Deductions</th><th style={{ padding: '8px 10px' }}>OT</th><th style={{ padding: '8px 10px', textAlign: 'right' }}>Net payable</th>
            </tr></thead>
            <tbody>{data.payslips.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>{s.employee?.name ?? s.employeeId.slice(0, 8)}</td>
                <td style={{ padding: '8px 10px' }}>Rs {money(s.basicSalary)}</td><td style={{ padding: '8px 10px' }}>{s.presentDays}</td><td style={{ padding: '8px 10px' }}>{s.absentDays}</td>
                <td style={{ padding: '8px 10px' }}>{s.paidLeaveDays}/{s.unpaidLeaveDays}</td><td style={{ padding: '8px 10px', color: 'var(--sos-status-danger)' }}>Rs {money(s.totalDeductions)}</td>
                <td style={{ padding: '8px 10px', color: 'var(--sos-status-success)' }}>{Number(s.overtimePay) > 0 ? `Rs ${money(s.overtimePay)}` : '—'}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>Rs {money(s.netPayable)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </GlassCard>
      )}
    </>
  );
}

// ─────────────────────────── Salaries (Compensation) ───────────────────────────
function CompTab({ emps }: { emps: Emp[] }) {
  const [employeeId, setEmployeeId] = useState('');
  const [list, setList] = useState<P.Compensation[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ basicSalary: '', allowances: '', effectiveFrom: todayPkt(), remarks: '' });
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!employeeId) { setList([]); return; }
    setLoading(true); setErr(null);
    try { setList(await P.fetchCompensation(employeeId)); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setLoading(false); }
  }, [employeeId]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!employeeId || !form.basicSalary) return;
    setBusy(true); setBanner(null); setErr(null);
    try {
      await P.setCompensation({ employeeId, basicSalary: Number(form.basicSalary), allowances: form.allowances ? Number(form.allowances) : 0, effectiveFrom: form.effectiveFrom, remarks: form.remarks || undefined });
      setBanner('Salary saved. It applies from the effective date; older records are kept as history.');
      setForm({ basicSalary: '', allowances: '', effectiveFrom: todayPkt(), remarks: '' });
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); } finally { setBusy(false); }
  }

  const today = todayPkt();
  // List is sorted effectiveFrom desc. The first row effective on/before today is the one payroll pays now.
  const currentId = list.find((c) => c.isActive && c.effectiveFrom.slice(0, 10) <= today)?.id ?? null;

  return (
    <>
      {banner && <GlassCard><div style={{ padding: 12, color: 'var(--sos-status-success)', fontSize: 13 }}>{banner}</div></GlassCard>}
      {err && <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>}
      <GlassCard><div style={{ padding: 14 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>Employee salary</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--sos-text-muted)' }}>Basic salary is set by admin only. Payroll pays the salary that is effective for each month. Changing it keeps the previous amount as history.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Employee</label><br /><select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} style={inp}><option value="">Select…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></div>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Basic salary (Rs)</label><br /><input type="number" min={0} value={form.basicSalary} onChange={(e) => setForm({ ...form, basicSalary: e.target.value })} placeholder="e.g. 60000" style={{ ...inp, width: 140 }} /></div>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Allowances (Rs)</label><br /><input type="number" min={0} value={form.allowances} onChange={(e) => setForm({ ...form, allowances: e.target.value })} placeholder="0" style={{ ...inp, width: 120 }} /></div>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Effective from</label><br /><input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} style={inp} /></div>
          <div style={{ flex: 1, minWidth: 160 }}><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Remarks</label><br /><input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder="Increment, revision…" style={{ ...inp, width: '100%' }} /></div>
          <PrimaryButton onClick={() => void save()} disabled={busy || !employeeId || !form.basicSalary}>{busy ? <Loader2 size={14} className="sos-spin" /> : <Check size={14} />} Save salary</PrimaryButton>
        </div>
      </div></GlassCard>
      {!employeeId ? (
        <GlassCard><div style={{ padding: 24, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>Select an employee to view their salary history.</div></GlassCard>
      ) : loading ? <LoadingState /> : (
        <GlassCard><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--sos-text-muted)', fontSize: 11.5 }}><th style={{ padding: '10px 12px' }}>Effective from</th><th style={{ padding: '10px 12px' }}>Basic</th><th style={{ padding: '10px 12px' }}>Allowances</th><th style={{ padding: '10px 12px' }}>Remarks</th><th style={{ padding: '10px 12px' }}>Status</th></tr></thead>
          <tbody>{list.map((c) => (
            <tr key={c.id} style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
              <td style={{ padding: '10px 12px', fontWeight: 600 }}>{c.effectiveFrom.slice(0, 10)}</td>
              <td style={{ padding: '10px 12px' }}>Rs {money(c.basicSalary)}</td>
              <td style={{ padding: '10px 12px' }}>{Number(c.allowances) > 0 ? `Rs ${money(c.allowances)}` : '—'}</td>
              <td style={{ padding: '10px 12px', color: 'var(--sos-text-muted)' }}>{c.remarks ?? '—'}</td>
              <td style={{ padding: '10px 12px' }}>{!c.isActive ? <StatusBadge tone="danger" size="sm">Voided</StatusBadge> : c.id === currentId ? <StatusBadge tone="success" size="sm">Current</StatusBadge> : c.effectiveFrom.slice(0, 10) > today ? <StatusBadge tone="info" size="sm">Scheduled</StatusBadge> : <StatusBadge tone="neutral" size="sm">History</StatusBadge>}</td>
            </tr>
          ))}{list.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--sos-text-muted)' }}>No salary set yet.</td></tr>}</tbody>
        </table></div></GlassCard>
      )}
    </>
  );
}

// ─────────────────────────── Policy + Holidays ───────────────────────────
function SettingsTab() {
  const [policy, setPolicy] = useState<P.AttendancePolicy | null>(null);
  const [holidays, setHolidays] = useState<P.Holiday[]>([]);
  const [hForm, setHForm] = useState({ date: todayPkt(), name: '', type: 'COMPANY' });
  const [saving, setSaving] = useState(false); const [banner, setBanner] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setPolicy(await P.fetchPolicy()); setHolidays(await P.fetchHolidays()); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } }, []);
  useEffect(() => { void load(); }, [load]);
  function set<K extends keyof P.AttendancePolicy>(k: K, v: P.AttendancePolicy[K]) { setPolicy((p) => (p ? { ...p, [k]: v } : p)); }
  async function save() { if (!policy) return; setSaving(true); setBanner(null); setErr(null); try { await P.updatePolicy(policy); setBanner('Policy saved.'); } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); } finally { setSaving(false); } }
  async function addHoliday() { if (!hForm.name) return; try { await P.upsertHoliday(hForm); setHForm({ ...hForm, name: '' }); setHolidays(await P.fetchHolidays()); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } }
  async function delHoliday(id: string) { await P.deleteHoliday(id).catch(() => undefined); setHolidays(await P.fetchHolidays()); }

  if (!policy) return <LoadingState />;
  const numField = (label: string, k: keyof P.AttendancePolicy, suffix = '') => (
    <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{label}</label><br /><input type="number" value={policy[k] as number} onChange={(e) => set(k, Number(e.target.value) as never)} style={{ ...inp, width: 110 }} />{suffix && <span style={{ fontSize: 11, color: 'var(--sos-text-faint)', marginLeft: 4 }}>{suffix}</span>}</div>
  );
  const timeField = (label: string, k: keyof P.AttendancePolicy) => (
    <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{label}</label><br /><input type="time" value={policy[k] as string} onChange={(e) => set(k, e.target.value as never)} style={inp} /></div>
  );

  return (
    <>
      {banner && <div style={{ color: 'var(--sos-status-success)', fontSize: 13 }}>{banner}</div>}
      {err && <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>}
      <GlassCard><div style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600 }}>Attendance policy (v{policy.version})</h3>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {timeField('Work start', 'workStart')}{timeField('Work end', 'workEnd')}
          {timeField('Break start', 'breakStart')}{timeField('Break end', 'breakEnd')}
          {numField('Allowed break', 'allowedBreakMin', 'min')}{numField('Grace', 'graceMin', 'min')}
          {numField('Full day', 'fullDayMinMin', 'min')}{numField('Half day', 'halfDayMinMin', 'min')}
          {numField('OT min block', 'overtimeMinBlockMin', 'min')}{timeField('OT after', 'overtimeStartAfter')}
          {numField('Annual leave', 'annualLeaveQuota', 'days')}{numField('Sick leave', 'sickLeaveQuota', 'days')}{numField('Casual leave', 'casualLeaveQuota', 'days')}
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Saturday</label><br /><select value={policy.saturdayPolicy} onChange={(e) => set('saturdayPolicy', e.target.value as never)} style={inp}><option value="OPTIONAL_WFH">Optional / WFH</option><option value="OFF">Off</option><option value="WORKING">Working</option></select></div>
          <div><label style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>Salary basis</label><br /><select value={policy.salaryBasis} onChange={(e) => set('salaryBasis', e.target.value as never)} style={inp}><option value="THIRTY_DAYS">Salary ÷ 30</option><option value="WORKING_DAYS">Salary ÷ working days</option></select></div>
        </div>
        <div style={{ marginTop: 16 }}><PrimaryButton onClick={() => void save()} disabled={saving}>{saving ? <Loader2 size={14} className="sos-spin" /> : <Check size={14} />} Save policy</PrimaryButton></div>
      </div></GlassCard>

      <GlassCard><div style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Public holidays</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <input type="date" value={hForm.date} onChange={(e) => setHForm({ ...hForm, date: e.target.value })} style={inp} />
          <input value={hForm.name} onChange={(e) => setHForm({ ...hForm, name: e.target.value })} placeholder="Eid / Independence Day…" style={{ ...inp, minWidth: 200 }} />
          <select value={hForm.type} onChange={(e) => setHForm({ ...hForm, type: e.target.value })} style={inp}>{['NATIONAL', 'RELIGIOUS', 'COMPANY', 'EMERGENCY'].map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <SecondaryButton onClick={() => void addHoliday()}><Plus size={14} /> Add</SecondaryButton>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{holidays.map((h) => (
          <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ color: 'var(--sos-text-muted)', width: 100 }}>{h.date.slice(0, 10)}</span><span style={{ fontWeight: 500 }}>{h.name}</span><span style={{ fontSize: 11, color: 'var(--sos-text-faint)' }}>{h.type}</span>
            <button onClick={() => void delHoliday(h.id)} style={{ all: 'unset', cursor: 'pointer', color: 'var(--sos-status-danger)', marginLeft: 'auto' }}><X size={14} /></button>
          </div>
        ))}{holidays.length === 0 && <span style={{ color: 'var(--sos-text-muted)', fontSize: 13 }}>No holidays added.</span>}</div>
      </div></GlassCard>
    </>
  );
}
