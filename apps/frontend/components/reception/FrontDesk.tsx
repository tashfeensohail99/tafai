'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  DoorOpen,
  Hourglass,
  Loader2,
  LogOut,
  PlayCircle,
  RefreshCw,
  Users,
  UserPlus,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  EmptyState,
  GhostButton,
  GlassCard,
  MetricCard,
  PrimaryButton,
  StatusBadge,
  type MetricTone,
} from '@/components/sales-v2/ui';
import {
  getReceptionSettings,
  listHosts,
  listVisits,
  updateVisit,
  type Host,
  type ReceptionSettings,
  type VisitList,
  type VisitRow,
  type VisitStatus,
} from '@/lib/reception-api';
import { CheckInModal } from './CheckInModal';
import { ConsultCollectModal } from './ConsultCollectModal';
import { avatarStyle, fmtElapsed, fmtTime, initials, TYPE_META } from './shared';

function fmtMins(mins: number): string {
  if (mins < 1) return '0m';
  if (mins < 60) return `${Math.round(mins)}m`;
  return `${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, '0')}m`;
}

export function FrontDesk({ canCheckIn }: { canCheckIn: boolean }) {
  const [data, setData] = useState<VisitList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [settings, setSettings] = useState<ReceptionSettings | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [consultVisit, setConsultVisit] = useState<VisitRow | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Desk "payment verified" pop — fires when a paid consult we'd already seen as
  // unpaid flips to paid between polls (i.e. finance just verified it).
  const [verifiedToast, setVerifiedToast] = useState<{ name: string; at: string | null } | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const paidRef = useRef<Set<string>>(new Set());

  const reload = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      // A generous limit so the live board shows everyone currently in — counts
      // come from the DB groupBy regardless.
      const next = await listVisits({ limit: 200 });
      // A consult we'd already seen (not first load) as unpaid is now verified.
      const justVerified = next.visits.find(
        (v) =>
          v.visitType === 'PAID_CONSULT' &&
          v.paid &&
          seenRef.current.has(v.id) &&
          !paidRef.current.has(v.id),
      );
      if (justVerified) setVerifiedToast({ name: justVerified.name, at: justVerified.appointmentAt });
      next.visits.forEach((v) => seenRef.current.add(v.id));
      paidRef.current = new Set(next.visits.filter((v) => v.paid).map((v) => v.id));
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the front desk');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    listHosts().then((r) => setHosts(r.hosts)).catch(() => setHosts([]));
    getReceptionSettings().then(setSettings).catch(() => setSettings(null));
  }, [reload]);

  // Keep the board live: refetch every 25s, and tick the clock every 30s so
  // waiting-time labels advance between fetches.
  useEffect(() => {
    const poll = setInterval(() => void reload({ quiet: true }), 25_000);
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [reload]);

  const act = async (id: string, status: VisitStatus) => {
    setBusyId(id);
    setActionError(null);
    try {
      await updateVisit(id, { status });
      await reload({ quiet: true });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update the visit');
    } finally {
      setBusyId(null);
    }
  };

  const counts = data?.counts;
  const waiting = useMemo(() => (data?.visits ?? []).filter((v) => v.status === 'WAITING'), [data]);
  const inMeeting = useMemo(() => (data?.visits ?? []).filter((v) => v.status === 'IN_MEETING'), [data]);

  const avgWaitMins = useMemo(() => {
    if (waiting.length === 0) return null;
    const total = waiting.reduce((s, v) => s + Math.max(0, nowMs - new Date(v.checkedInAt).getTime()), 0);
    return total / waiting.length / 60000;
  }, [waiting, nowMs]);

  const kpis: Array<{ label: string; value: string; hint: string; tone: MetricTone; Icon: typeof Clock }> = [
    { label: 'Waiting', value: counts ? `${counts.waiting}` : '—', hint: 'In the lobby right now', tone: counts && counts.waiting > 0 ? 'warning' : 'neutral', Icon: Clock },
    { label: 'In meeting', value: counts ? `${counts.inMeeting}` : '—', hint: 'With a staff member', tone: 'info', Icon: Users },
    { label: 'Seen today', value: counts ? `${counts.done}` : '—', hint: 'Checked out today', tone: 'success', Icon: DoorOpen },
    { label: 'Avg wait', value: avgWaitMins == null ? '—' : fmtMins(avgWaitMins), hint: 'Current lobby wait', tone: avgWaitMins != null && avgWaitMins >= 20 ? 'danger' : 'accent', Icon: Hourglass },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {verifiedToast ? (
        <PaymentVerifiedToast toast={verifiedToast} onClose={() => setVerifiedToast(null)} />
      ) : null}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="sos-text-faint" style={{ fontSize: 12.5 }}>
          Walk-ins become leads assigned to a sales rep automatically. Live view · Pakistan time.
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <GhostButton iconLeft={<RefreshCw size={14} />} onClick={() => void reload()}>Refresh</GhostButton>
          {canCheckIn ? (
            <PrimaryButton iconLeft={<UserPlus size={15} />} onClick={() => setCheckInOpen(true)}>Check in visitor</PrimaryButton>
          ) : null}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        {kpis.map((k) => (
          <MetricCard key={k.label} label={k.label} value={k.value} hint={k.hint} tone={k.tone} Icon={k.Icon} />
        ))}
      </div>

      {actionError ? <div className="sos-banner sos-banner--danger">{actionError}</div> : null}
      {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}

      {loading ? (
        <div className="sos-text-muted" style={{ padding: 30, textAlign: 'center' }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading the lobby…
        </div>
      ) : waiting.length === 0 && inMeeting.length === 0 ? (
        <GlassCard variant="soft" padded="lg">
          <EmptyState
            Icon={DoorOpen}
            title="The lobby is empty"
            description={canCheckIn ? 'When someone arrives, check them in and they’ll appear here live.' : 'No one is currently waiting or in a meeting.'}
            action={canCheckIn ? <PrimaryButton iconLeft={<UserPlus size={15} />} onClick={() => setCheckInOpen(true)}>Check in visitor</PrimaryButton> : undefined}
          />
        </GlassCard>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <QueueColumn title="Waiting" tone="warning" count={waiting.length}>
            {waiting.map((v) => (
              <QueueCard key={v.id} v={v} nowMs={nowMs} canCheckIn={canCheckIn} busy={busyId === v.id} onAct={act} onCollect={setConsultVisit} />
            ))}
          </QueueColumn>
          <QueueColumn title="In meeting" tone="info" count={inMeeting.length}>
            {inMeeting.length === 0 ? (
              <div className="sos-text-faint" style={{ fontSize: 12.5, padding: '10px 2px' }}>Nobody in a meeting.</div>
            ) : (
              inMeeting.map((v) => (
                <QueueCard key={v.id} v={v} nowMs={nowMs} canCheckIn={canCheckIn} busy={busyId === v.id} onAct={act} onCollect={setConsultVisit} />
              ))
            )}
          </QueueColumn>
        </div>
      )}

      <CheckInModal open={checkInOpen} hosts={hosts} settings={settings} onClose={() => setCheckInOpen(false)} onDone={() => void reload({ quiet: true })} />
      <ConsultCollectModal
        open={!!consultVisit}
        visit={consultVisit}
        settings={settings}
        onClose={() => setConsultVisit(null)}
        onDone={() => void reload({ quiet: true })}
      />
    </div>
  );
}

function QueueColumn({
  title,
  tone,
  count,
  children,
}: {
  title: string;
  tone: MetricTone;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>{title}</h2>
        <StatusBadge tone={tone} size="sm" dot>{count}</StatusBadge>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </GlassCard>
  );
}

function QueueCard({
  v,
  nowMs,
  canCheckIn,
  busy,
  onAct,
  onCollect,
}: {
  v: VisitRow;
  nowMs: number;
  canCheckIn: boolean;
  busy: boolean;
  onAct: (id: string, status: VisitStatus) => void;
  onCollect: (v: VisitRow) => void;
}) {
  const type = TYPE_META[v.visitType];
  const waited = fmtElapsed(v.checkedInAt, nowMs);
  return (
    <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={avatarStyle(38)}>{initials(v.name)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{v.name}</div>
          <div className="sos-text-faint" style={{ fontSize: 11.5 }}>
            {v.referenceCode ? `${v.referenceCode} · ` : ''}{v.phone ?? 'no phone'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 600, color: v.status === 'WAITING' ? 'var(--sos-status-warning)' : 'var(--sos-text-secondary)' }}>
            <Clock size={12} /> {waited}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <StatusBadge tone={type.tone} size="sm" dot={false}>{type.label}</StatusBadge>
        {v.hostName ? <span className="sos-text-muted" style={{ fontSize: 12 }}>→ {v.hostName}</span> : null}
        {v.purpose ? <span className="sos-text-faint" style={{ fontSize: 12 }}>· {v.purpose}</span> : null}
      </div>

      {v.visitType === 'PAID_CONSULT' ? (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {v.paid ? (
            <>
              <StatusBadge tone="success" size="sm" dot>Fee paid</StatusBadge>
              {v.appointmentAt ? <span className="sos-text-muted" style={{ fontSize: 12 }}>Consult @ {fmtTime(v.appointmentAt)}</span> : null}
            </>
          ) : v.pendingPayment ? (
            <>
              <StatusBadge tone="warning" size="sm" dot>Payment being verified</StatusBadge>
              {v.appointmentAt ? <span className="sos-text-muted" style={{ fontSize: 12 }}>Slot held @ {fmtTime(v.appointmentAt)}</span> : null}
            </>
          ) : canCheckIn ? (
            <button
              type="button"
              style={{ ...cardBtn, borderColor: 'var(--sos-brand-primary-border)', background: 'var(--sos-brand-primary-soft)', color: 'var(--sos-brand-primary-strong)' }}
              onClick={() => onCollect(v)}
            >
              <Wallet size={13} /> Collect fee &amp; confirm
            </button>
          ) : (
            <StatusBadge tone="warning" size="sm" dot>Fee due</StatusBadge>
          )}
        </div>
      ) : null}

      {canCheckIn ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {busy ? (
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--sos-text-faint)' }} />
          ) : (
            <>
              {v.status === 'WAITING' ? (
                <button type="button" style={cardBtn} onClick={() => onAct(v.id, 'IN_MEETING')}><PlayCircle size={13} /> Start</button>
              ) : null}
              <button type="button" style={cardBtn} onClick={() => onAct(v.id, 'DONE')}><LogOut size={13} /> Check out</button>
              {v.status === 'WAITING' ? (
                <button type="button" style={cardBtn} onClick={() => onAct(v.id, 'NO_SHOW')}><XCircle size={13} /> No-show</button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A "payment verified" pop that appears at the front desk when finance clears a
 *  pending consult fee. Auto-dismisses; also click-to-dismiss. */
function PaymentVerifiedToast({
  toast,
  onClose,
}: {
  toast: { name: string; at: string | null };
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 18,
        right: 18,
        zIndex: 1200,
        maxWidth: 340,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '13px 14px',
        borderRadius: 14,
        border: '1px solid var(--sos-status-success-border, #9fe0b8)',
        background: 'var(--sos-status-success-soft, #eafaf0)',
        boxShadow: '0 12px 32px rgba(15,42,74,0.18)',
      }}
    >
      <CheckCircle2 size={20} style={{ color: 'var(--sos-status-success, #16a34a)', flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Payment verified</div>
        <div style={{ fontSize: 12.5, color: 'var(--sos-text-secondary)', marginTop: 2 }}>
          {toast.name}&rsquo;s consultation is confirmed{toast.at ? ` · ${fmtTime(toast.at)}` : ''}. You can send them through.
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{ background: 'transparent', border: 'none', color: 'var(--sos-text-faint)', cursor: 'pointer', padding: 2, flexShrink: 0 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

const cardBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 11px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 8,
  border: '1px solid var(--sos-border-subtle)',
  background: 'var(--sos-surface-2)',
  color: 'var(--sos-text-secondary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
