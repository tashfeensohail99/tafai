'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Clock,
  DoorOpen,
  Loader2,
  LogOut,
  PlayCircle,
  RefreshCw,
  Search,
  Star,
  UserPlus,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react';
import {
  GhostButton,
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
  type MetricTone,
} from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useAdminSession } from '@/components/layout/AdminShell';
import {
  createVisit,
  listVisits,
  receptionLookup,
  updateVisit,
  type LookupHit,
  type VisitList,
  type VisitRow,
  type VisitStatus,
  type VisitType,
} from '@/lib/reception-api';

// ── date / time helpers (all Pakistan time, UTC+5) ───────────────────────────
function todayPkt(): string {
  const p = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}-${String(p.getUTCDate()).padStart(2, '0')}`;
}
function fmtTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const TYPE_META: Record<VisitType, { label: string; tone: MetricTone }> = {
  WALK_IN: { label: 'Walk-in', tone: 'info' },
  EXISTING_CLIENT: { label: 'Existing', tone: 'accent' },
  PAID_CONSULT: { label: 'Paid consult', tone: 'warning' },
};
const STATUS_TONE: Record<VisitStatus, MetricTone> = {
  WAITING: 'warning',
  IN_MEETING: 'info',
  DONE: 'success',
  NO_SHOW: 'danger',
  CANCELLED: 'neutral',
};
const STATUS_LABEL: Record<VisitStatus, string> = {
  WAITING: 'Waiting',
  IN_MEETING: 'In meeting',
  DONE: 'Done',
  NO_SHOW: 'No-show',
  CANCELLED: 'Cancelled',
};

const th: CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--sos-text-faint)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  whiteSpace: 'nowrap',
};
const td: CSSProperties = {
  padding: '11px 14px',
  fontSize: 13,
  color: 'var(--sos-text-secondary)',
  borderBottom: '1px solid var(--sos-border-subtle)',
  verticalAlign: 'middle',
};
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: 13,
  borderRadius: 8,
  border: '1px solid var(--sos-border-subtle)',
  background: 'var(--sos-surface-1)',
  color: 'var(--sos-text-primary)',
};

function primaryBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    fontSize: 12.5,
    fontWeight: 600,
    borderRadius: 8,
    border: '1px solid var(--sos-brand-primary)',
    background: 'var(--sos-brand-primary)',
    color: '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}
function miniBtnStyle(): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 7,
    border: '1px solid var(--sos-border-subtle)',
    background: 'var(--sos-surface-1)',
    color: 'var(--sos-text-secondary)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

type QuickForm = { name: string; phone: string; purpose: string };
const EMPTY_FORM: QuickForm = { name: '', phone: '', purpose: '' };

export default function ReceptionPage() {
  const { user } = useAdminSession();
  // Gate on exactly the backend's permissions so the UI never shows a page whose
  // API calls would 403. Admins receive reception.* via the sync-reception-perms
  // script (granted to super_admin / admin / reception), matching the
  // whatsapp.block rollout pattern.
  const canView =
    user.permissions.includes('reception.view') || user.permissions.includes('reception.check_in');
  const canCheckIn = user.permissions.includes('reception.check_in');

  const [date, setDate] = useState<string>(() => todayPkt());
  const [data, setData] = useState<VisitList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Search / lookup
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<LookupHit[]>([]);
  const [searching, setSearching] = useState(false);
  // Monotonic request id so a slow earlier lookup can't clobber a newer one.
  const lookupSeq = useRef(0);

  // Quick-add forms
  const [walkIn, setWalkIn] = useState<QuickForm>(EMPTY_FORM);
  const [paid, setPaid] = useState<QuickForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listVisits({ date }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the visit register');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (canView) void reload();
  }, [canView, reload]);

  // Debounced lookup as the receptionist types.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++lookupSeq.current;
    const t = setTimeout(async () => {
      try {
        const res = await receptionLookup(term);
        if (seq === lookupSeq.current) setHits(res.results);
      } catch {
        if (seq === lookupSeq.current) setHits([]);
      } finally {
        if (seq === lookupSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const submit = useCallback(
    async (fn: () => Promise<unknown>) => {
      setSubmitting(true);
      setActionError(null);
      try {
        await fn();
        await reload();
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Something went wrong');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [reload],
  );

  const checkInExisting = (hit: LookupHit) =>
    void submit(async () => {
      await createVisit({
        visitType: 'EXISTING_CLIENT',
        name: hit.name,
        phone: hit.phone ?? undefined,
        leadId: hit.kind === 'lead' ? hit.id : undefined,
        clientId: hit.kind === 'client' ? hit.id : undefined,
      });
      setQuery('');
      setHits([]);
    });

  const addWalkIn = () =>
    void submit(async () => {
      await createVisit({
        visitType: 'WALK_IN',
        name: walkIn.name.trim(),
        phone: walkIn.phone.trim() || undefined,
        purpose: walkIn.purpose.trim() || undefined,
      });
      setWalkIn(EMPTY_FORM);
    });

  const addPaid = () =>
    void submit(async () => {
      await createVisit({
        visitType: 'PAID_CONSULT',
        name: paid.name.trim(),
        phone: paid.phone.trim() || undefined,
        purpose: paid.purpose.trim() || undefined,
      });
      setPaid(EMPTY_FORM);
    });

  const act = async (id: string, status: VisitStatus) => {
    setBusyId(id);
    setActionError(null);
    try {
      await updateVisit(id, { status });
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update the visit');
    } finally {
      setBusyId(null);
    }
  };

  const counts = data?.counts;
  const kpis = useMemo(
    () => [
      { label: 'Waiting', value: counts ? `${counts.waiting}` : '—', hint: 'In the lobby right now', tone: (counts && counts.waiting > 0 ? 'warning' : 'neutral') as MetricTone, Icon: Clock },
      { label: 'In meeting', value: counts ? `${counts.inMeeting}` : '—', hint: 'Currently with a staff member', tone: 'info' as MetricTone, Icon: Users },
      { label: 'Seen today', value: counts ? `${counts.done}` : '—', hint: 'Checked out', tone: 'success' as MetricTone, Icon: DoorOpen },
      { label: 'Total visits', value: counts ? `${counts.total}` : '—', hint: `${counts?.walkIn ?? 0} walk-in · ${counts?.existing ?? 0} client · ${counts?.paid ?? 0} paid`, tone: 'accent' as MetricTone, Icon: UserRound },
    ],
    [counts],
  );

  if (!canView) {
    return <PermissionDeniedState message="You need the reception.view or reception.check_in permission to open the front desk." />;
  }

  const isToday = date === todayPkt();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="CRM · Front Desk"
        title="Reception"
        description="Log everyone who walks into the office — new walk-ins, existing clients, and paid consultations. Walk-ins automatically become leads and are assigned to a sales rep. All times in Pakistan time."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="date" value={date} max={todayPkt()} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 'auto' }} />
            <GhostButton iconLeft={<RefreshCw size={14} />} onClick={() => void reload()}>
              Refresh
            </GhostButton>
          </div>
        }
      />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        {kpis.map((k) => (
          <MetricCard key={k.label} label={k.label} value={k.value} hint={k.hint} tone={k.tone} Icon={k.Icon} />
        ))}
      </div>

      {actionError ? <div className="sos-banner sos-banner--danger">{actionError}</div> : null}

      {/* Check-in panel */}
      {canCheckIn ? (
        <GlassCard variant="soft" padded="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Existing lookup */}
            <div>
              <label className="sos-text-faint" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Find an existing lead or client
              </label>
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--sos-text-faint)' }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by phone or name…"
                  style={{ ...inputStyle, paddingLeft: 34 }}
                />
                {searching ? <Loader2 size={15} style={{ position: 'absolute', right: 11, top: 10, color: 'var(--sos-text-faint)', animation: 'spin 1s linear infinite' }} /> : null}
              </div>
              {hits.length > 0 ? (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {hits.map((h) => (
                    <div key={`${h.kind}-${h.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-1)' }}>
                      <StatusBadge tone={h.kind === 'client' ? 'success' : 'neutral'} size="sm" dot={false}>
                        {h.kind === 'client' ? 'Client' : 'Lead'}
                      </StatusBadge>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{h.name}</div>
                        <div className="sos-text-faint" style={{ fontSize: 11.5 }}>
                          {h.referenceCode} · {h.phone ?? 'no phone'}{h.owner ? ` · ${h.owner}` : ''}
                        </div>
                      </div>
                      <button type="button" style={miniBtnStyle()} disabled={submitting} onClick={() => checkInExisting(h)}>
                        <DoorOpen size={13} /> Check in
                      </button>
                    </div>
                  ))}
                </div>
              ) : query.trim().length >= 2 && !searching ? (
                <div className="sos-text-faint" style={{ fontSize: 12, marginTop: 8 }}>
                  No match. Add them as a new walk-in below.
                </div>
              ) : null}
            </div>

            {/* Quick-add forms */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              <QuickAddForm
                title="New walk-in"
                subtitle="Becomes a lead + assigned to a rep"
                Icon={UserPlus}
                form={walkIn}
                setForm={setWalkIn}
                onSubmit={addWalkIn}
                submitting={submitting}
                cta="Add walk-in"
                requirePhone
              />
              <QuickAddForm
                title="Paid consultation"
                subtitle="In-person meeting with Mr. Tashfeen · fee collection arrives in the next phase"
                Icon={Star}
                form={paid}
                setForm={setPaid}
                onSubmit={addPaid}
                submitting={submitting}
                cta="Log paid visit"
              />
            </div>
          </div>
        </GlassCard>
      ) : null}

      {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}

      {/* Register */}
      <GlassCard variant="default" padded={false} glow="accent">
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Users size={16} style={{ color: 'var(--sos-brand-accent)' }} />
          <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>{isToday ? "Today's visitors" : `Visitors · ${date}`}</h2>
          {data ? <span style={{ marginLeft: 'auto' }}><StatusBadge tone="neutral" size="sm" dot={false}>{data.counts.total} total</StatusBadge></span> : null}
        </div>

        {loading ? (
          <div className="sos-text-muted" style={{ padding: 22, textAlign: 'center' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading…
          </div>
        ) : !data || data.visits.length === 0 ? (
          <div className="sos-text-faint" style={{ padding: 28, textAlign: 'center', fontSize: 13 }}>
            No visitors logged {isToday ? 'yet today' : 'on this day'}.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Time</th>
                  <th style={th}>Visitor</th>
                  <th style={th}>Type</th>
                  <th style={th}>Purpose</th>
                  <th style={th}>Host</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.visits.map((v) => (
                  <VisitRowView key={v.id} v={v} canCheckIn={canCheckIn} busy={busyId === v.id} onAct={act} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function QuickAddForm({
  title,
  subtitle,
  Icon,
  form,
  setForm,
  onSubmit,
  submitting,
  cta,
  requirePhone = false,
}: {
  title: string;
  subtitle: string;
  Icon: typeof UserPlus;
  form: QuickForm;
  setForm: (f: QuickForm) => void;
  onSubmit: () => void;
  submitting: boolean;
  cta: string;
  requirePhone?: boolean;
}) {
  // A walk-in must carry a phone (the backend needs it to create the Lead), so
  // block submit until it's there rather than paying a guaranteed 400 round-trip.
  const canSubmit =
    form.name.trim().length > 0 && (!requirePhone || form.phone.trim().length > 0) && !submitting;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10, border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={15} style={{ color: 'var(--sos-brand-accent)' }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{title}</div>
          <div className="sos-text-faint" style={{ fontSize: 11 }}>{subtitle}</div>
        </div>
      </div>
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" style={inputStyle} />
      <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone (required for walk-ins)" style={inputStyle} />
      <input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Purpose (optional)" style={inputStyle} />
      <button type="button" style={primaryBtnStyle(!canSubmit)} disabled={!canSubmit} onClick={onSubmit}>
        {submitting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Icon size={14} />} {cta}
      </button>
    </div>
  );
}

function VisitRowView({
  v,
  canCheckIn,
  busy,
  onAct,
}: {
  v: VisitRow;
  canCheckIn: boolean;
  busy: boolean;
  onAct: (id: string, status: VisitStatus) => void;
}) {
  const type = TYPE_META[v.visitType];
  return (
    <tr>
      <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtTime(v.checkedInAt)}</td>
      <td style={td}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{v.name}</div>
        <div className="sos-text-faint" style={{ fontSize: 11.5 }}>
          {v.referenceCode ? `${v.referenceCode} · ` : ''}{v.phone ?? 'no phone'}
        </div>
      </td>
      <td style={td}><StatusBadge tone={type.tone} size="sm" dot={false}>{type.label}</StatusBadge></td>
      <td style={{ ...td, maxWidth: 220, whiteSpace: 'normal' }}>{v.purpose ?? '—'}</td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>{v.hostName ?? '—'}</td>
      <td style={td}><StatusBadge tone={STATUS_TONE[v.status]} size="sm" dot>{STATUS_LABEL[v.status]}</StatusBadge></td>
      <td style={{ ...td, textAlign: 'right' }}>
        {busy ? (
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--sos-text-faint)' }} />
        ) : !canCheckIn || v.status === 'DONE' || v.status === 'NO_SHOW' || v.status === 'CANCELLED' ? (
          <span className="sos-text-faint" style={{ fontSize: 11.5 }}>
            {v.checkedOutAt ? `out ${fmtTime(v.checkedOutAt)}` : '—'}
          </span>
        ) : (
          <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {v.status === 'WAITING' ? (
              <button type="button" style={miniBtnStyle()} onClick={() => onAct(v.id, 'IN_MEETING')}>
                <PlayCircle size={13} /> Start
              </button>
            ) : null}
            <button type="button" style={miniBtnStyle()} onClick={() => onAct(v.id, 'DONE')}>
              <LogOut size={13} /> Check out
            </button>
            {v.status === 'WAITING' ? (
              <button type="button" style={miniBtnStyle()} onClick={() => onAct(v.id, 'NO_SHOW')}>
                <XCircle size={13} /> No-show
              </button>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}
