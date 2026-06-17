'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, RefreshCw, Pencil } from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  Field,
  FormInput,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { ErrorState } from '../shared/ErrorState';
import { LoadingState } from '../shared/LoadingState';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { useAdminSession } from '../layout/AdminShell';
import {
  fetchAttendanceDaily,
  fetchAttendancePing,
  markAttendance,
  syncAttendanceFromEvents,
  ATTENDANCE_STATUSES,
  type AttendanceDailyRow,
  type AttendanceStatus,
  type AttendancePing,
} from '@/lib/attendance';

const STATUS_TONE: Record<AttendanceStatus, BadgeTone> = {
  PRESENT: 'success',
  LATE: 'warning',
  HALF_DAY: 'info',
  ON_LEAVE: 'neutral',
  ABSENT: 'danger',
};
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  HALF_DAY: 'Half day',
  ON_LEAVE: 'On leave',
  ABSENT: 'Absent',
};

/** Today's date in Asia/Karachi, as YYYY-MM-DD (matches the server's PKT day). */
function todayPkt(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}
/** ISO timestamp → HH:MM in PKT, or '—'. */
function pktTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
}

interface EditState {
  employeeId: string;
  name: string;
  status: AttendanceStatus;
  checkIn: string;
  checkOut: string;
  notes: string;
}

export function AttendanceLogPage() {
  const { user } = useAdminSession();
  const canView = user.permissions.includes('employees.view_all');

  const [date, setDate] = useState(todayPkt());
  const [rows, setRows] = useState<AttendanceDailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ping, setPing] = useState<AttendancePing | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const board = await fetchAttendanceDaily(date);
      setRows(board.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  // Connectivity probe once on mount (so we can warn if the camera link is down).
  useEffect(() => {
    if (!canView) return;
    fetchAttendancePing().then(setPing).catch(() => setPing(null));
  }, [canView]);

  async function doSync() {
    setSyncing(true);
    setBanner(null);
    setError(null);
    try {
      const r = await syncAttendanceFromEvents({ date });
      setBanner(
        `Synced ${date}: ${r.seen} staff detected by camera, ${r.imported} marked present` +
          (r.skipped ? `, ${r.skipped} kept as manual` : '') +
          `. Provisional — from live camera detections; use “Mark” to correct any.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  function openEdit(row: AttendanceDailyRow) {
    setEditErr(null);
    setEdit({
      employeeId: row.employeeId,
      name: row.name,
      status: row.status ?? 'PRESENT',
      checkIn: row.checkInAt ? pktTime(row.checkInAt) : '',
      checkOut: row.checkOutAt ? pktTime(row.checkOutAt) : '',
      notes: row.notes ?? '',
    });
  }

  async function saveEdit() {
    if (!edit) return;
    setSaving(true);
    setEditErr(null);
    try {
      await markAttendance({
        employeeId: edit.employeeId,
        date,
        status: edit.status,
        checkIn: edit.checkIn || undefined,
        checkOut: edit.checkOut || undefined,
        notes: edit.notes || undefined,
      });
      setEdit(null);
      await load();
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const summary = useMemo(() => {
    const s = { present: 0, late: 0, absent: 0, leave: 0, half: 0, none: 0 };
    for (const r of rows) {
      if (r.status === 'PRESENT') s.present++;
      else if (r.status === 'LATE') s.late++;
      else if (r.status === 'ABSENT') s.absent++;
      else if (r.status === 'ON_LEAVE') s.leave++;
      else if (r.status === 'HALF_DAY') s.half++;
      else s.none++;
    }
    return s;
  }, [rows]);

  if (!canView) return <PermissionDeniedState />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attendance"
        description="Daily attendance for every employee — auto-synced from the camera every 15 minutes. Hit Sync for the latest now, or mark manually anytime."
        actions={
          <PrimaryButton onClick={() => void doSync()} disabled={syncing}>
            {syncing ? <Loader2 size={15} className="sos-spin" /> : <RefreshCw size={15} />}
            {syncing ? 'Syncing…' : 'Sync this day'}
          </PrimaryButton>
        }
      />

      {ping && !ping.ok ? (
        <GlassCard>
          <div style={{ padding: 12, color: 'var(--sos-status-warning)', fontSize: 13 }}>
            ⚠️ Camera attendance link is not reachable right now{ping.error ? ` (${ping.error})` : ''}. You can still
            mark attendance manually; syncing will work once the link is restored.
          </div>
        </GlassCard>
      ) : null}

      {banner ? (
        <GlassCard>
          <div style={{ padding: 12, color: 'var(--sos-status-success)', fontSize: 13 }}>{banner}</div>
        </GlassCard>
      ) : null}

      <GlassCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarClock size={16} style={{ color: 'var(--sos-text-muted)' }} />
            <input
              type="date"
              value={date}
              max={todayPkt()}
              onChange={(e) => setDate(e.target.value)}
              style={{
                background: 'var(--sos-surface-2)',
                border: '1px solid var(--sos-border-subtle)',
                borderRadius: 8,
                padding: '6px 10px',
                color: 'var(--sos-text-primary)',
                fontSize: 14,
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 12.5, color: 'var(--sos-text-muted)', flexWrap: 'wrap' }}>
            <span>Present <b style={{ color: 'var(--sos-text-primary)' }}>{summary.present}</b></span>
            <span>Late <b style={{ color: 'var(--sos-text-primary)' }}>{summary.late}</b></span>
            <span>Half <b style={{ color: 'var(--sos-text-primary)' }}>{summary.half}</b></span>
            <span>Leave <b style={{ color: 'var(--sos-text-primary)' }}>{summary.leave}</b></span>
            <span>Absent <b style={{ color: 'var(--sos-text-primary)' }}>{summary.absent}</b></span>
            <span>No data <b style={{ color: 'var(--sos-text-primary)' }}>{summary.none}</b></span>
          </div>
        </div>
      </GlassCard>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <GlassCard>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--sos-text-muted)', fontSize: 12 }}>
                  <th style={{ padding: '10px 14px' }}>Employee</th>
                  <th style={{ padding: '10px 14px' }}>Status</th>
                  <th style={{ padding: '10px 14px' }}>Check in</th>
                  <th style={{ padding: '10px 14px' }}>Check out</th>
                  <th style={{ padding: '10px 14px' }}>Notes</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId} style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--sos-text-primary)' }}>{r.name}</div>
                      {r.email ? <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{r.email}</div> : null}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {r.status ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
                          {r.isOverride ? (
                            <span title="Set manually" style={{ fontSize: 10.5, color: 'var(--sos-text-faint)' }}>manual</span>
                          ) : null}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--sos-text-faint)' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--sos-text-secondary)' }}>{pktTime(r.checkInAt)}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--sos-text-secondary)' }}>{pktTime(r.checkOutAt)}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--sos-text-muted)', fontSize: 12.5 }}>{r.notes ?? ''}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <button
                        onClick={() => openEdit(r)}
                        className="rounded-md border px-2.5 py-1 text-xs font-medium"
                        style={{ borderColor: 'var(--sos-border-subtle)', color: 'var(--sos-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      >
                        <Pencil size={13} /> Mark
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 28, textAlign: 'center', color: 'var(--sos-text-muted)' }}>
                      No employees to show.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* ── Mark / override modal ── */}
      {edit ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}
          onClick={() => setEdit(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(440px, 100%)', background: 'var(--sos-surface-1)', border: '1px solid var(--sos-border-subtle)', borderRadius: 14, padding: 20 }}
          >
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              Mark attendance — {edit.name}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--sos-text-muted)' }}>{date} · saved as a manual override</p>

            <Field label="Status">
              <select
                value={edit.status}
                onChange={(e) => setEdit({ ...edit, status: e.target.value as AttendanceStatus })}
                style={{ width: '100%', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', borderRadius: 8, padding: '8px 10px', color: 'var(--sos-text-primary)', fontSize: 14 }}
              >
                {ATTENDANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </Field>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <FormInput label="Check in (optional)" type="time" value={edit.checkIn} onChange={(e) => setEdit({ ...edit, checkIn: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <FormInput label="Check out (optional)" type="time" value={edit.checkOut} onChange={(e) => setEdit({ ...edit, checkOut: e.target.value })} />
              </div>
            </div>

            <FormInput label="Notes (optional)" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="e.g. remote day, approved leave…" />

            {editErr ? <div style={{ color: 'var(--sos-status-danger)', fontSize: 12.5, marginTop: 4 }}>{editErr}</div> : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <SecondaryButton onClick={() => setEdit(null)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={() => void saveEdit()} disabled={saving}>
                {saving ? <Loader2 size={14} className="sos-spin" /> : null}
                {saving ? 'Saving…' : 'Save'}
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
