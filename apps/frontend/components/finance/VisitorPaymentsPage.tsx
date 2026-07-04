'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, Clock, ImageOff, Loader2, RefreshCw, ScanLine, Send, Wallet, X, XCircle } from 'lucide-react';
import { GlassCard, GhostButton, PageHeader, PrimaryButton } from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useFinanceSession } from '@/components/layout/FinanceShell';
import {
  listVisitorPayments,
  reReadVisitorPaymentOcr,
  rejectVisitorPayment,
  remindVisitorPayment,
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

/** Short date (no time) for the OCR-read transaction date. */
function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Does the OCR-read amount AND currency line up with what the desk expects? A
 *  same-number receipt in another currency is a mismatch, not a match. */
function amountMatch(row: VisitorPaymentRow): 'match' | 'mismatch' | null {
  if (row.ocrAmount == null) return null;
  const numOk = Math.abs(row.ocrAmount - row.amount) < 1;
  const curOk = !row.ocrCurrency || row.ocrCurrency.toUpperCase() === row.currency.toUpperCase();
  return numOk && curOk ? 'match' : 'mismatch';
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
  const [proofView, setProofView] = useState<{ url: string; name: string } | null>(null);
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null);
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

  async function remind(row: VisitorPaymentRow) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await remindVisitorPayment(row.id);
      setFlash(
        res.sent
          ? `Payment reminder sent to ${row.name}.`
          : `Couldn't send the reminder to ${row.name}${res.reason ? ` (${res.reason})` : ''}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the reminder');
    } finally {
      setBusyId(null);
    }
  }

  async function reReadOcr(row: VisitorPaymentRow) {
    setOcrBusyId(row.id);
    try {
      await reReadVisitorPaymentOcr(row.id);
    } catch {
      /* the row refresh below surfaces the resulting ocrStatus */
    } finally {
      setOcrBusyId(null);
      load();
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
                {r.hasProof && r.proofUrl ? (
                  <button
                    type="button"
                    onClick={() => setProofView({ url: r.proofUrl!, name: r.name })}
                    title="View uploaded receipt"
                    style={{ padding: 0, border: '1px solid var(--sos-border-subtle)', borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in', background: 'var(--sos-surface-2)', width: 52, height: 52, flexShrink: 0 }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.proofUrl} alt={`Receipt from ${r.name}`} style={{ width: 52, height: 52, objectFit: 'cover', display: 'block' }} />
                  </button>
                ) : (
                  <div
                    title="No receipt uploaded yet"
                    style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 8, border: '1px dashed var(--sos-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sos-text-faint)' }}
                  >
                    <ImageOff size={16} />
                  </div>
                )}

                <div style={{ minWidth: 160, flex: '1 1 200px' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{r.name}</div>
                  <div className="sos-text-faint" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={12} /> {fmtWhen(r.createdAt)}{r.phone ? ` · ${r.phone}` : ''}
                  </div>
                  {!r.hasProof ? (
                    <div className="sos-text-faint" style={{ fontSize: 11, fontStyle: 'italic', marginTop: 2 }}>Awaiting receipt upload</div>
                  ) : null}
                  {r.notifyStatus === 'FAILED' ? (
                    <div
                      title="The WhatsApp confirmation to the customer did not send — follow up manually."
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: 10.5, fontWeight: 700, color: 'var(--sos-status-warning)', background: 'var(--sos-status-warning-soft, rgba(180,120,0,0.12))', borderRadius: 6, padding: '1px 6px' }}
                    >
                      <AlertTriangle size={11} /> WhatsApp not delivered
                    </div>
                  ) : null}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{money(r.currency, r.amount)}</div>
                  <div className="sos-text-faint" style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
                    {r.transactionRef ? `Ref ${r.transactionRef}` : 'No reference given'}
                  </div>
                </div>

                {/* OCR read of the uploaded receipt (advisory). Only for rows with a proof. */}
                {r.hasProof && r.ocrStatus && r.ocrStatus !== 'SKIPPED' ? (
                  (() => {
                    const reading = r.ocrStatus === 'READING' || ocrBusyId === r.id;
                    const match = amountMatch(r);
                    return (
                      <div
                        style={{
                          flex: '1 1 100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          flexWrap: 'wrap',
                          padding: '8px 11px',
                          borderRadius: 9,
                          border: '1px solid var(--sos-border-subtle)',
                          background: 'var(--sos-surface-2)',
                          fontSize: 12.5,
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--sos-text-faint)', fontWeight: 600 }}>
                          <ScanLine size={13} /> Receipt read
                        </span>
                        {reading ? (
                          <span className="sos-text-faint" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> reading…
                          </span>
                        ) : r.ocrStatus === 'FAILED' ? (
                          <>
                            <span className="sos-text-faint">couldn’t read this image</span>
                            <button
                              type="button"
                              onClick={() => void reReadOcr(r)}
                              disabled={ocrBusyId != null}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: 'var(--sos-brand-accent)', fontSize: 12, cursor: 'pointer', padding: 0 }}
                            >
                              <RefreshCw size={12} /> Re-read
                            </button>
                          </>
                        ) : (
                          <>
                            <span style={{ color: 'var(--sos-text-primary)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                              {r.ocrAmount != null ? money(r.ocrCurrency ?? r.currency, r.ocrAmount) : '—'}
                            </span>
                            {/* Only a MISMATCH is flagged (warning). A "match" is deliberately
                                NOT shown as a reassuring green tick — the read comes from a
                                customer-supplied image and must never substitute for checking
                                the amount + that funds landed. A neutral note is the most we say. */}
                            {match === 'mismatch' ? (
                              <span
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                                  color: 'var(--sos-status-warning)',
                                  background: 'var(--sos-status-warning-soft, rgba(245,158,11,0.12))',
                                }}
                              >
                                <AlertTriangle size={11} /> differs from expected
                              </span>
                            ) : match === 'match' ? (
                              <span className="sos-text-faint" style={{ fontSize: 11 }}>≈ expected — verify against the image</span>
                            ) : null}
                            {r.ocrPaidAt ? <span className="sos-text-faint">· {fmtDay(r.ocrPaidAt)}</span> : null}
                            {r.ocrReference ? <span className="sos-text-faint" style={{ fontVariantNumeric: 'tabular-nums' }}>· Ref {r.ocrReference}</span> : null}
                            {r.ocrBankName ? <span className="sos-text-faint">· {r.ocrBankName}</span> : null}
                          </>
                        )}
                      </div>
                    );
                  })()
                ) : null}

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
                    <GhostButton
                      type="button"
                      onClick={() => void remind(r)}
                      disabled={busyId != null}
                      iconLeft={busyId === r.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                    >
                      Remind
                    </GhostButton>
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
        <Wallet size={13} /> Cash payments are verified at the desk and appear in the reception payment register. The receipt read is an AI assist that can be fooled by a doctored image — always confirm the amount against the image <em>and</em> that the funds actually landed in our account before verifying.
      </div>

      {proofView ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Receipt from ${proofView.name}`}
          onClick={() => setProofView(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(9,16,28,0.78)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5vh 16px', zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: 640, width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Receipt · {proofView.name}</div>
              <button type="button" onClick={() => setProofView(null)} aria-label="Close" className="sos-btn sos-btn--ghost sos-btn--sm" style={{ color: '#fff' }}><X size={16} /></button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proofView.url} alt={`Receipt from ${proofView.name}`} style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 12, background: '#fff' }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
