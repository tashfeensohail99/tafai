'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Loader2, Search, Wallet } from 'lucide-react';
import { PRIORITY_LABEL, fmtRelative } from '@/components/processing/mockData';
import { priorityTone } from '@/components/processing/ProcessingDashboardPage';
import { StatusBadge, GlassCard } from '@/components/sales-v2/ui';
import {
  changeCaseStage,
  casePersonName,
  fetchRefundLane,
  markCaseForRefund,
  type ApiRefundLaneCase,
} from '@/lib/processing';
import { labelForServiceCode } from '@/lib/service-types';

/**
 * Refund / Escalation lane.
 *
 * Workflow doc: after the authority returns REJECTED, processing decides per
 * case whether to refund (Finance handles the money side) or escalate to
 * APPEAL_IN_PROGRESS (requires manager permission, surfaced via the same
 * existing stage gate). This page is the single place those two actions live,
 * so officers don't have to comb the main caseload for rejected work.
 */
export default function RefundLanePage() {
  const [cases, setCases] = useState<ApiRefundLaneCase[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-row inline action state — keyed by caseId. Single source of truth so
  // exactly one prompt is open at a time and the row knows whether it's busy.
  const [openAction, setOpenAction] = useState<{ caseId: string; kind: 'refund' | 'escalate' } | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRefundLane();
      setCases(res.cases);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lane');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const stats = useMemo(() => {
    const total = cases.length;
    const refundInitiated = cases.filter((c) => c.refundInitiatedAt).length;
    const inAppeal = cases.filter((c) => c.stage === 'APPEAL_IN_PROGRESS').length;
    const needsAction = cases.filter(
      (c) => !c.refundInitiatedAt && c.stage !== 'APPEAL_IN_PROGRESS',
    ).length;
    return { total, refundInitiated, inAppeal, needsAction };
  }, [cases]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter((c) =>
      [casePersonName(c), labelForServiceCode(c.service), c.targetCountry]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [cases, search]);

  function startAction(caseId: string, kind: 'refund' | 'escalate') {
    setOpenAction({ caseId, kind });
    setReason('');
    setActionError(null);
  }

  function cancelAction() {
    setOpenAction(null);
    setReason('');
    setActionError(null);
  }

  async function confirmAction() {
    if (!openAction) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setActionError('Please provide a reason — this gets recorded on the case.');
      return;
    }
    setBusyId(openAction.caseId);
    setActionError(null);
    try {
      if (openAction.kind === 'refund') {
        await markCaseForRefund(openAction.caseId, { reason: trimmed });
      } else {
        // Escalate uses the existing stage gate; APPEAL_IN_PROGRESS requires
        // manager permission server-side so a non-manager will get a 403 with
        // a clear message — we surface that as the action error.
        await changeCaseStage(openAction.caseId, {
          toStage: 'APPEAL_IN_PROGRESS',
          reason: trimmed,
          notes: trimmed,
        });
      }
      setOpenAction(null);
      setReason('');
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <KpiCard label="Rejected cases" value={stats.total} icon={<AlertTriangle size={14} />} tone="warning" />
        <KpiCard label="Needs action" value={stats.needsAction} icon={<AlertTriangle size={14} />} tone="danger" />
        <KpiCard label="Refund initiated" value={stats.refundInitiated} icon={<Wallet size={14} />} tone="info" />
        <KpiCard label="In appeal" value={stats.inAppeal} icon={<ArrowUpRight size={14} />} tone="success" />
      </div>

      <div style={{ fontSize: 13, color: 'var(--sos-text-muted)', lineHeight: 1.5 }}>
        Cases the authority rejected. From here you can either{' '}
        <strong style={{ color: 'var(--sos-text-primary)' }}>mark a refund initiated</strong>{' '}
        (Finance handles the actual payout — this just records intent on the case)
        or <strong style={{ color: 'var(--sos-text-primary)' }}>escalate to appeal</strong>{' '}
        (moves the case into <code>APPEAL_IN_PROGRESS</code>; manager permission required).
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', maxWidth: 340 }}>
        <Search size={13} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
        <input
          type="search"
          placeholder="Search client, service, country…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--sos-text-primary)', fontSize: 12.5 }}
        />
      </div>

      <GlassCard variant="panel" padded={false}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.2fr', gap: 12, padding: '9px 14px', fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <span>Client / Service</span>
          <span>Priority</span>
          <span>Rejected</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Loader2 size={14} className="sos-spin" /> Loading…
          </div>
        ) : error ? (
          <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>Failed to load lane: {error}</div>
        ) : cases.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            No rejected cases — nothing in the refund or escalation lane.
          </div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13 }}>
            No cases match “{search.trim()}”.
          </div>
        ) : (
          visible.map((c) => {
            const refunded = !!c.refundInitiatedAt;
            const inAppeal = c.stage === 'APPEAL_IN_PROGRESS';
            const open = openAction?.caseId === c.id;
            const busy = busyId === c.id;
            return (
              <div key={c.id} style={{ borderBottom: '1px solid var(--sos-border-subtle)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.2fr', gap: 12, padding: '12px 14px', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{casePersonName(c)}</div>
                    <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{labelForServiceCode(c.service)} · {c.targetCountry}</div>
                  </div>
                  <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
                  <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                    {c.authorityDecisionDate ? fmtRelative(c.authorityDecisionDate) : '—'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {refunded ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--sos-status-info)' }}>
                        <CheckCircle2 size={11} /> Refund initiated {fmtRelative(c.refundInitiatedAt!)}
                      </span>
                    ) : null}
                    {inAppeal ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--sos-status-success)' }}>
                        <ArrowUpRight size={11} /> In appeal
                      </span>
                    ) : null}
                    {!refunded && !inAppeal ? (
                      <span style={{ fontSize: 11.5, color: 'var(--sos-status-warning)' }}>Awaiting decision</span>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {!refunded && !inAppeal ? (
                      <>
                        <ActionButton
                          label="Mark refund"
                          onClick={() => startAction(c.id, 'refund')}
                          disabled={busy}
                          tone="info"
                        />
                        <ActionButton
                          label="Escalate"
                          onClick={() => startAction(c.id, 'escalate')}
                          disabled={busy}
                          tone="primary"
                        />
                      </>
                    ) : null}
                    <Link
                      href={`/processing/cases/${c.id}` as Route}
                      style={{ fontSize: 12, fontWeight: 500, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none', alignSelf: 'center' }}
                    >
                      Open →
                    </Link>
                  </div>
                </div>
                {open ? (
                  <div style={{ padding: '0 14px 14px 14px', background: 'var(--sos-surface-hover)' }}>
                    <div style={{ padding: 12, borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-primary)', border: '1px solid var(--sos-border-subtle)' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: 6 }}>
                        {openAction!.kind === 'refund' ? 'Mark refund initiated' : 'Escalate to appeal'}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', marginBottom: 8 }}>
                        {openAction!.kind === 'refund'
                          ? 'Recorded as a pinned note + audit-log entry. Finance handles the actual money side.'
                          : 'Moves the case to APPEAL_IN_PROGRESS. Manager permission required.'}
                      </div>
                      <textarea
                        className="sos-input"
                        placeholder="Reason (required — this gets recorded on the case)"
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        style={{ width: '100%', resize: 'vertical' }}
                      />
                      {actionError ? (
                        <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--sos-status-danger)' }}>
                          {actionError}
                        </div>
                      ) : null}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                        <ActionButton label="Cancel" onClick={cancelAction} disabled={busy} tone="muted" />
                        <ActionButton
                          label={busy ? 'Saving…' : openAction!.kind === 'refund' ? 'Confirm refund' : 'Confirm escalate'}
                          onClick={confirmAction}
                          disabled={busy}
                          tone={openAction!.kind === 'refund' ? 'info' : 'primary'}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </GlassCard>
    </div>
  );
}

function KpiCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: 'info' | 'success' | 'warning' | 'danger' }) {
  const colorVar = `--sos-status-${tone}`;
  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
        <span style={{ color: `var(${colorVar})` }}>{icon}</span>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{value}</div>
    </GlassCard>
  );
}

function ActionButton({ label, onClick, disabled, tone }: { label: string; onClick: () => void; disabled?: boolean; tone: 'info' | 'primary' | 'muted' }) {
  const bg = tone === 'primary'
    ? 'var(--sos-brand-primary-strong)'
    : tone === 'info'
    ? 'var(--sos-status-info-soft)'
    : 'transparent';
  const color = tone === 'primary'
    ? '#fff'
    : tone === 'info'
    ? 'var(--sos-status-info)'
    : 'var(--sos-text-muted)';
  const border = tone === 'muted' ? '1px solid var(--sos-border-subtle)' : '1px solid transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 10px',
        borderRadius: 'var(--sos-radius-sm)',
        background: bg,
        color,
        border,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
