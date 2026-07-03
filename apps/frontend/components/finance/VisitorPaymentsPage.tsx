'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, Clock, Loader2, Wallet, XCircle } from 'lucide-react';
import { GlassCard, GhostButton, PageHeader, PrimaryButton } from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useFinanceSession } from '@/components/layout/FinanceShell';
import {
  listVisitorPayments,
  rejectVisitorPayment,
  verifyVisitorPayment,
  type VisitorPaymentList,
  type VisitorPaymentRow,
} from '@/lib/reception-api';

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString()}`;
}

function fmtWhen(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  const t = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${t}`;
}

export function VisitorPaymentsPage() {
  const { user } = useFinanceSession();
  const canVerify = user.permissions.includes('finance.verify_payment');

  const [data, setData] = useState<VisitorPaymentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    listVisitorPayments({ status: 'PENDING_REVIEW' })
      .then((r) => {
        if (mine === seq.current) setData(r);
      })
      .catch((e) => {
        if (mine === seq.current) setError(e instanceof Error ? e.message : 'Could not load pending payments');
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (canVerify) load();
  }, [canVerify, load]);

  if (!canVerify) {
    return <PermissionDeniedState message="You need the finance.verify_payment permission to verify visitor payments." />;
  }

  async function verify(row: VisitorPaymentRow) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await verifyVisitorPayment(row.id);
      setFlash(
        res.alreadyVerified
          ? `${row.name} was already verified.`
          : `Verified ${row.name}${res.receiptNumber ? ` — receipt ${res.receiptNumber}` : ''}.`,
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify the payment');
      load(); // a concurrent action may have handled it — refresh the queue
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject(row: VisitorPaymentRow) {
    setBusyId(row.id);
    setError(null);
    try {
      await rejectVisitorPayment(row.id, rejectReason.trim());
      setFlash(`Rejected ${row.name}. The slot was released.`);
      setRejectId(null);
      setRejectReason('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reject the payment');
      setRejectId(null);
      setRejectReason('');
      load();
    } finally {
      setBusyId(null);
    }
  }

  const rows = data?.rows ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Finance · Reception"
        title="Visitor payments"
        description="Bank-transfer consultation fees taken at the front desk, awaiting verification. Verify to issue the receipt and confirm the appointment; reject to release the slot."
      />

      {flash ? (
        <div className="sos-banner sos-banner--success" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BadgeCheck size={15} /> {flash}
        </div>
      ) : null}
      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      ) : null}

      <GlassCard variant="default" padded="lg">
        {loading && !data ? (
          <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading queue…
          </div>
        ) : rows.length === 0 ? (
          <div className="sos-text-faint" style={{ fontSize: 13, padding: '26px 4px', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
            <BadgeCheck size={16} style={{ color: 'var(--sos-status-success)' }} /> No transfers awaiting verification.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
            {rows.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 16px',
                  borderRadius: 12,
                  border: '1px solid var(--sos-border-subtle)',
                  background: 'var(--sos-surface-1)',
                }}
              >
                <div style={{ minWidth: 160, flex: '1 1 200px' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{r.name}</div>
                  <div className="sos-text-faint" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={12} /> {fmtWhen(r.createdAt)}{r.phone ? ` · ${r.phone}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{money(r.currency, r.amount)}</div>
                  <div className="sos-text-faint" style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
                    {r.transactionRef ? `Ref ${r.transactionRef}` : 'No reference given'}
                  </div>
                </div>

                {rejectId === r.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 100%' }}>
                    <input
                      className="sos-input"
                      placeholder="Reason (optional)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      style={{ flex: 1 }}
                      autoFocus
                    />
                    <PrimaryButton
                      type="button"
                      onClick={() => void confirmReject(r)}
                      disabled={busyId === r.id}
                      iconLeft={busyId === r.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <XCircle size={14} />}
                    >
                      Confirm reject
                    </PrimaryButton>
                    <GhostButton type="button" onClick={() => { setRejectId(null); setRejectReason(''); }} disabled={busyId === r.id}>
                      Cancel
                    </GhostButton>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                    <GhostButton type="button" onClick={() => { setRejectId(r.id); setRejectReason(''); }} disabled={busyId != null}>
                      Reject
                    </GhostButton>
                    <PrimaryButton
                      type="button"
                      onClick={() => void verify(r)}
                      disabled={busyId != null}
                      iconLeft={busyId === r.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <BadgeCheck size={14} />}
                    >
                      Verify &amp; confirm
                    </PrimaryButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <div className="sos-text-faint" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Wallet size={13} /> Cash payments are verified at the desk and appear in the reception payment register. Receipt scans + OCR land in a later update.
      </div>
    </div>
  );
}
