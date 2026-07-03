'use client';

import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, CalendarClock, Clock, Landmark, Loader2, Wallet, X } from 'lucide-react';
import {
  Field,
  FormInput,
  FormSelect,
  GhostButton,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import {
  collectConsultation,
  getConsultAvailability,
  getPayQr,
  getReceptionSettings,
  type Availability,
  type AvailabilitySlot,
  type CollectConsultationResult,
  type PayQr,
  type ReceptionSettings,
  type VisitRow,
} from '@/lib/reception-api';
import { fmtTime, todayPkt } from './shared';

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer' },
];

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return '—';
  return `${currency ?? ''} ${amount.toLocaleString()}`.trim();
}

export function ConsultCollectModal({
  open,
  visit,
  settings,
  onClose,
  onDone,
}: {
  open: boolean;
  visit: VisitRow | null;
  settings: ReceptionSettings | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState<string>(() => todayPkt());
  const [avail, setAvail] = useState<Availability | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [method, setMethod] = useState('cash');
  const [ref, setRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CollectConsultationResult | null>(null);
  const [payQr, setPayQr] = useState<PayQr | null>(null);
  // Re-fetch settings on open so the fee the desk quotes/collects is never a
  // stale copy from an admin edit made after this screen first loaded.
  const [liveSettings, setLiveSettings] = useState<ReceptionSettings | null>(null);

  const reset = useCallback(() => {
    setDate(todayPkt());
    setAvail(null);
    setSlot(null);
    setMethod('cash');
    setRef('');
    setError(null);
    setResult(null);
    setPayQr(null);
    setSubmitting(false);
  }, []);

  const close = useCallback(() => {
    if (submitting) return; // fee is charged server-side — never abandon a live submit
    reset();
    onClose();
  }, [reset, onClose, submitting]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Pull the current settings each time the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getReceptionSettings()
      .then((s) => {
        if (!cancelled) setLiveSettings(s);
      })
      .catch(() => {
        /* fall back to the settings passed in from the board */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load the principal's free slots for the chosen day.
  useEffect(() => {
    if (!open || result) return;
    let cancelled = false;
    setLoadingSlots(true);
    setSlot(null);
    getConsultAvailability(date)
      .then((a) => {
        if (!cancelled) setAvail(a);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load available times');
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, date, result]);

  // A bank transfer lands in "pending" — pull a QR the customer can scan at the
  // desk to upload their own receipt (they may not have it on them at the desk).
  useEffect(() => {
    if (result?.status !== 'pending' || !result.visitorPaymentId) return;
    let cancelled = false;
    getPayQr(result.visitorPaymentId)
      .then((q) => {
        if (!cancelled) setPayQr(q);
      })
      .catch(() => {
        /* QR is a convenience; finance can still verify from the register */
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (!open || !visit) return null;

  const s = liveSettings ?? settings;
  const configured = !!s?.configured;
  const isToday = date === todayPkt();
  // For today, drop slots whose start has already passed so the desk can't book
  // (and pay to confirm) a consultation timestamped in the past.
  const slots = (avail?.freeSlots ?? []).filter((sl) => !isToday || new Date(sl.start).getTime() >= Date.now());

  // A bank transfer goes to finance for verification (pending); cash / card are
  // verified at the counter and confirm instantly.
  const isBankTransfer = method === 'bank_transfer';

  async function submit() {
    if (!slot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await collectConsultation(visit!.id, {
        method: method === 'bank_transfer' ? 'BANK_TRANSFER' : 'CASH',
        scheduledAt: slot.start,
        paymentMethod: method,
        transactionRef: ref.trim() || undefined,
      });
      setResult(res);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not collect the consultation fee');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Collect consultation fee"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--sos-bg-overlay)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 16px',
        zIndex: 1000,
        overflowY: 'auto',
      }}
    >
      <div className="sos-glass sos-glass--strong" style={{ width: '100%', maxWidth: 540, borderRadius: 'var(--sos-radius-panel, 20px)', padding: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <div>
            <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)' }}>Paid consultation</div>
            <div className="sos-text-faint" style={{ fontSize: 12 }}>{visit.name}{s?.principal ? ` · with ${s.principal.name}` : ''}</div>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="sos-btn sos-btn--ghost sos-btn--sm"><X size={16} /></button>
        </header>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {result ? (
            result.status === 'pending' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '10px 0' }}>
                <Clock size={40} style={{ color: 'var(--sos-status-warning)' }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Payment recorded · being verified</div>
                <div className="sos-text-secondary" style={{ fontSize: 13, textAlign: 'center' }}>
                  {money(result.feeAmount, result.feeCurrency)} · slot held for {fmtTime(result.scheduledAt)} PKT.
                  <br />Finance will verify the transfer and confirm the consultation.
                </div>
                {payQr ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 4, padding: '14px 16px', borderRadius: 12, border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-1)', width: '100%' }}>
                    <div className="sos-text-faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer uploads their receipt</div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={payQr.qrDataUrl} alt="Scan to upload receipt" width={168} height={168} style={{ borderRadius: 8, background: '#fff', padding: 6 }} />
                    <div className="sos-text-secondary" style={{ fontSize: 12, textAlign: 'center', lineHeight: 1.45 }}>
                      Ask the customer to <strong>scan &amp; upload</strong> their transfer screenshot.
                      <br />Finance verifies it and confirms the consultation.
                    </div>
                  </div>
                ) : null}
                <PrimaryButton onClick={close}>Done</PrimaryButton>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '10px 0' }}>
                <BadgeCheck size={40} style={{ color: 'var(--sos-status-success)' }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Fee collected · consultation confirmed</div>
                <div className="sos-text-secondary" style={{ fontSize: 13, textAlign: 'center' }}>
                  {money(result.feeAmount, result.feeCurrency)} paid · {fmtTime(result.scheduledAt)} PKT
                  {result.receiptNumber ? <><br />Receipt <strong>{result.receiptNumber}</strong> · Invoice {result.invoiceNumber}</> : null}
                </div>
                <PrimaryButton onClick={close}>Done</PrimaryButton>
              </div>
            )
          ) : !configured ? (
            <div className="sos-banner sos-banner--warning" style={{ fontSize: 13 }}>
              The consultation principal and fee aren’t set yet. Ask an admin to configure them in <strong>Admin → Reception settings</strong>.
            </div>
          ) : (
            <>
              {/* Fee */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--sos-brand-primary-soft)', border: '1px solid var(--sos-brand-primary-border)' }}>
                <Wallet size={18} style={{ color: 'var(--sos-brand-primary-strong)' }} />
                <div>
                  <div className="sos-text-faint" style={{ fontSize: 11 }}>Consultation fee</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>{money(s!.feeAmount, s!.feeCurrency)}</div>
                </div>
                <span className="sos-text-faint" style={{ marginLeft: 'auto', fontSize: 11 }}>Creditable to a service fee later</span>
              </div>

              {/* Time */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <CalendarClock size={14} style={{ color: 'var(--sos-brand-accent)' }} />
                  <label className="sos-text-faint" style={{ fontSize: 12, fontWeight: 600 }}>Choose a time {isToday ? '(today — pick the first for “see now”)' : ''}</label>
                  <input type="date" value={date} min={todayPkt()} onChange={(e) => setDate(e.target.value)} className="sos-input" style={{ marginLeft: 'auto', width: 'auto' }} />
                </div>
                {loadingSlots ? (
                  <div className="sos-text-faint" style={{ fontSize: 12 }}><Loader2 size={13} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading times…</div>
                ) : slots.length === 0 ? (
                  <div className="sos-text-faint" style={{ fontSize: 12.5 }}>No free slots on this day — try another date.</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 132, overflowY: 'auto' }}>
                    {slots.map((sl) => {
                      const active = slot?.start === sl.start;
                      return (
                        <button
                          key={sl.start}
                          type="button"
                          onClick={() => setSlot(sl)}
                          style={{
                            padding: '6px 12px',
                            fontSize: 12.5,
                            fontWeight: 600,
                            borderRadius: 8,
                            cursor: 'pointer',
                            border: `1px solid ${active ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                            background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                            color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {fmtTime(sl.start)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Payment */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FormSelect label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} />
                <Field label="Reference (optional)"><FormInput value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Txn / slip #" /></Field>
              </div>

              {method === 'bank_transfer' && s?.bank.iban ? (
                <div style={{ display: 'flex', gap: 8, padding: '9px 11px', borderRadius: 8, border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-1)', fontSize: 12 }}>
                  <Landmark size={15} style={{ color: 'var(--sos-brand-accent)', flexShrink: 0 }} />
                  <div className="sos-text-secondary">
                    {s.bank.name ? <div><strong>{s.bank.name}</strong></div> : null}
                    {s.bank.title ? <div>{s.bank.title}</div> : null}
                    <div style={{ fontVariantNumeric: 'tabular-nums' }}>{s.bank.iban}</div>
                  </div>
                </div>
              ) : null}

              {error ? <div className="sos-banner sos-banner--danger" style={{ fontSize: 12.5 }}>{error}</div> : null}
            </>
          )}
        </div>

        {!result && configured ? (
          <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 18px', borderTop: '1px solid var(--sos-border-subtle)' }}>
            <GhostButton type="button" onClick={close} disabled={submitting}>Cancel</GhostButton>
            <PrimaryButton
              type="button"
              onClick={() => void submit()}
              disabled={!slot || submitting}
              iconLeft={submitting ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Wallet size={15} />}
            >
              {isBankTransfer
                ? `Record ${money(s!.feeAmount, s!.feeCurrency)} · verify later`
                : `Collect ${money(s!.feeAmount, s!.feeCurrency)} & confirm`}
            </PrimaryButton>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
