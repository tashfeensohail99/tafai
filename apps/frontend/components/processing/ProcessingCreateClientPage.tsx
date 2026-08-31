'use client';

// Processing Manager — manually create a client.
// Second on-ramp into the processing pipeline (no Finance handover). On create
// the client is provisioned a portal login (credentials emailed) and, when the
// optional Finance section is filled, an authentic CAD invoice (+ a verified
// payment + receipt) so a sales/finance-bypassed client is still in the loop.

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  UserPlus,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Info,
  KeyRound,
  Wallet,
  AlertTriangle,
} from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  FormInput,
  FormSelect,
  Field,
} from '@/components/sales-v2/ui';
import { CountrySelect } from '@/components/shared/CountrySelect';
import { ApiClientError } from '@/lib/api-client';
import { PICKABLE_SERVICE_TYPES } from '@/lib/service-types';
import {
  createManualClientCase,
  type ProcessingPriority,
  type ManualClientCreateResult,
} from '@/lib/processing';

const PRIORITIES: ProcessingPriority[] = ['LOW', 'NORMAL', 'URGENT', 'CRITICAL'];
const CURRENCY_OPTIONS = ['PKR', 'CAD', 'USD', 'GBP', 'AED', 'EUR', 'SAR'].map((c) => ({
  value: c,
  label: c,
}));
const METHOD_OPTIONS = ['Cash', 'Bank transfer', 'Card', 'Cheque', 'Online', 'Other'].map((m) => ({
  value: m,
  label: m,
}));

const outcomeRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 'var(--sos-radius-md)',
  background: 'var(--sos-surface-2)',
  border: '1px solid var(--sos-border-subtle)',
};

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Duplicate-guard payload from the backend's ensureUniqueLead 409. */
interface DuplicateDetails {
  error?: string;
  reason?: string;
  match?: {
    kind?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    referenceCode?: string;
    assignedFirst?: string | null;
    assignedLast?: string | null;
  };
}

/**
 * Turn a create failure into something a processing manager can act on.
 * The dedup guard's 409 otherwise surfaces as "Request failed with status 409"
 * — a dead end that got reported as "cannot create client". Spell out WHICH
 * record holds the number/email and what to do about it.
 */
function formatCreateError(e: unknown): string {
  if (e instanceof ApiClientError && e.status === 409) {
    const d = (e.details ?? {}) as DuplicateDetails;
    const m = d.match;
    if ((d.error === 'DUPLICATE_PHONE' || d.error === 'DUPLICATE_EMAIL') && m) {
      const what = d.error === 'DUPLICATE_PHONE' ? 'phone number' : 'email';
      const who = [m.firstName, m.lastName].filter(Boolean).join(' ') || 'an existing record';
      const ref = m.referenceCode ? ` (${m.referenceCode})` : '';
      const rep = [m.assignedFirst, m.assignedLast].filter(Boolean).join(' ');
      const owner = rep ? `, assigned to ${rep}` : '';
      const kind = m.kind === 'client' ? 'client' : 'lead';
      const advice =
        m.kind === 'client'
          ? 'Open that client record instead of creating a new one.'
          : d.error === 'DUPLICATE_PHONE'
            ? 'You can create the client WITHOUT the phone (add it later), or ask an admin to reconcile that lead first.'
            : 'Use a different email, or ask an admin to reconcile that lead first.';
      return `This ${what} already belongs to ${kind} “${who}”${ref}${owner}. ${advice}`;
    }
  }
  if (e instanceof Error && e.message === 'Failed to fetch') {
    return 'Could not reach the server — check your connection and try again in a moment.';
  }
  return e instanceof Error ? e.message : 'Failed to create client';
}

export function ProcessingCreateClientPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [service, setService] = useState('');
  const [targetCountry, setTargetCountry] = useState('');
  const [nationality, setNationality] = useState('');
  const [priority, setPriority] = useState<ProcessingPriority>('NORMAL');

  // Optional finance section
  const [showFinance, setShowFinance] = useState(false);
  const [currency, setCurrency] = useState('PKR');
  const [totalFee, setTotalFee] = useState('');
  const [amountReceived, setAmountReceived] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Bank transfer');
  const [paidAt, setPaidAt] = useState('');
  const [transactionRef, setTransactionRef] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: ManualClientCreateResult; name: string } | null>(null);

  const feeNum = Number(totalFee);
  const recvNum = amountReceived.trim() ? Number(amountReceived) : 0;
  const overFee = showFinance && totalFee.trim().length > 0 && Number.isFinite(feeNum) && recvNum > feeNum;
  const financeValid =
    !showFinance ||
    (totalFee.trim().length > 0 &&
      Number.isFinite(feeNum) &&
      feeNum > 0 &&
      Number.isFinite(recvNum) &&
      recvNum >= 0 &&
      recvNum <= feeNum);

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    isValidEmail(email) &&
    !!service &&
    targetCountry.trim().length > 0 &&
    financeValid &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createManualClientCase({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        service,
        targetCountry: targetCountry.trim(),
        ...(nationality.trim() ? { nationality: nationality.trim() } : {}),
        priority,
        ...(showFinance && totalFee.trim()
          ? {
              finance: {
                totalFee: totalFee.trim(),
                currency,
                ...(amountReceived.trim() ? { amountReceived: amountReceived.trim() } : {}),
                ...(amountReceived.trim() ? { paymentMethod } : {}),
                ...(paidAt ? { paidAt: new Date(paidAt).toISOString() } : {}),
                ...(transactionRef.trim() ? { transactionRef: transactionRef.trim() } : {}),
              },
            }
          : {}),
      });
      setDone({ result, name: `${firstName.trim()} ${lastName.trim()}` });
    } catch (e: unknown) {
      setError(formatCreateError(e));
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setDone(null);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setService('');
    setTargetCountry('');
    setNationality('');
    setPriority('NORMAL');
    setShowFinance(false);
    setCurrency('PKR');
    setTotalFee('');
    setAmountReceived('');
    setPaymentMethod('Bank transfer');
    setPaidAt('');
    setTransactionRef('');
  }

  // ---- Success state ----
  if (done) {
    const { result } = done;
    const login = result.portalLogin;
    const fin = result.finance;
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <GlassCard variant="strong" padded="lg">
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <CheckCircle2 size={42} style={{ color: 'var(--sos-status-success)', marginBottom: 12 }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
              Client created
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--sos-text-muted)', marginTop: 6, lineHeight: 1.55 }}>
              <strong>{done.name}</strong> has been added with a ready document checklist, and a
              case is now in the <strong>intake queue</strong>. Acknowledge it to assign an
              associate.
            </div>

            {/* Outcome chips */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
              {/* Portal login */}
              <div style={outcomeRowStyle}>
                <KeyRound size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--sos-brand-primary)' }} />
                <span style={{ fontSize: 12.5, color: 'var(--sos-text-secondary)', textAlign: 'left' }}>
                  {login.provisioned ? (
                    <>
                      Portal login created — credentials emailed to <strong>{login.email}</strong>.
                    </>
                  ) : login.alreadyHadLogin ? (
                    <>This person already had a portal login — no new email was sent.</>
                  ) : (
                    <>Portal login could not be created (client role missing) — contact an admin.</>
                  )}
                </span>
              </div>

              {/* Finance */}
              {fin ? (
                <div style={outcomeRowStyle}>
                  {fin.recorded ? (
                    <Wallet size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--sos-status-success)' }} />
                  ) : (
                    <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--sos-status-warning)' }} />
                  )}
                  <span style={{ fontSize: 12.5, color: 'var(--sos-text-secondary)', textAlign: 'left' }}>
                    {fin.recorded ? (
                      <>
                        Fee recorded:{' '}
                        <strong>
                          {fin.feeAmount.toLocaleString()} {fin.currency}
                        </strong>
                        {fin.invoiceNumber ? <> (invoice {fin.invoiceNumber})</> : null}
                        {fin.receivedAmount > 0 ? (
                          <>
                            {' '}
                            · received{' '}
                            <strong>
                              {fin.receivedAmount.toLocaleString()} {fin.currency}
                            </strong>
                            {fin.receiptNumber ? <> — receipt {fin.receiptNumber}</> : null}.
                          </>
                        ) : (
                          <> · no payment recorded yet.</>
                        )}
                      </>
                    ) : (
                      <>
                        Finance was not recorded: {fin.error ?? 'unknown error'}.
                        {fin.invoiceNumber ? <> (invoice {fin.invoiceNumber} was created)</> : null}
                      </>
                    )}
                  </span>
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' }}>
              <PrimaryButton
                iconLeft={<ArrowRight size={14} />}
                onClick={() => router.push(`/processing/cases/${result.id}` as Route)}
              >
                Open case
              </PrimaryButton>
              <SecondaryButton onClick={() => router.push('/processing/intake' as Route)}>
                Go to intake queue
              </SecondaryButton>
              <SecondaryButton onClick={resetForm}>Create another</SecondaryButton>
            </div>
          </div>
        </GlassCard>
      </div>
    );
  }

  // ---- Form ----
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--sos-brand-primary-strong)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <UserPlus size={13} /> New client
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sos-text-primary)', margin: 0 }}>
          Create a client
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--sos-text-muted)', marginTop: 4, lineHeight: 1.5 }}>
          Add a client directly into processing — for onboarding existing clients or preparing a
          case. They get a portal login (credentials emailed) and enter the intake queue just like a
          finance-sent case.
        </p>
      </div>

      <GlassCard variant="strong" padded="lg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput label="First name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Muhammad" />
            <FormInput label="Last name" required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Ali" />
          </div>

          {/* Contact */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
              hint="Portal login details are emailed here"
            />
            <FormInput
              label="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+92 300 1234567"
              hint="Optional — add later for WhatsApp"
            />
          </div>

          {/* Service */}
          <Field label="Service" required>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginTop: 4 }}>
              {PICKABLE_SERVICE_TYPES.map((s) => {
                const active = service === s.code;
                return (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => setService(s.code)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 'var(--sos-radius-md)',
                      border: `1.5px solid ${active ? 'var(--sos-brand-primary)' : 'var(--sos-border-subtle)'}`,
                      background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                      cursor: 'pointer',
                      transition: 'all 150ms',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{s.label}</div>
                    {s.caption ? <div style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginTop: 2 }}>{s.caption}</div> : null}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Country + nationality */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Target country" required>
              <CountrySelect value={targetCountry} onChange={setTargetCountry} placeholder="Destination country…" />
            </Field>
            <FormInput label="Nationality" value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Pakistan" hint="Optional" />
          </div>

          {/* Priority */}
          <Field label="Priority">
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {PRIORITIES.map((p) => {
                const active = priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    style={{
                      padding: '7px 16px',
                      borderRadius: 999,
                      fontSize: 12.5,
                      fontWeight: 600,
                      border: `1.5px solid ${active ? 'var(--sos-brand-primary)' : 'var(--sos-border-subtle)'}`,
                      background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                      color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)',
                      cursor: 'pointer',
                      transition: 'all 150ms',
                    }}
                  >
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Finance (optional) */}
          <div style={{ borderTop: '1px solid var(--sos-border-subtle)', paddingTop: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showFinance}
                onChange={(e) => setShowFinance(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--sos-brand-primary)', cursor: 'pointer' }}
              />
              <Wallet size={14} style={{ color: 'var(--sos-brand-primary)' }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>Add finance details</span>
              <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>(optional)</span>
            </label>

            {showFinance ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12 }}>
                  <FormSelect
                    label="Currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    options={CURRENCY_OPTIONS}
                  />
                  <FormInput
                    label="Total service fee"
                    required
                    value={totalFee}
                    onChange={(e) => setTotalFee(e.target.value)}
                    placeholder="e.g. 500000"
                    inputMode="decimal"
                    hint={`Agreed fee in ${currency}`}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormInput
                    label="Amount received"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(e.target.value)}
                    placeholder="0"
                    inputMode="decimal"
                    hint="Leave blank if nothing paid yet"
                  />
                  <FormSelect
                    label="Payment method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    options={METHOD_OPTIONS}
                    disabled={!amountReceived.trim()}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FormInput
                    label="Payment date"
                    type="date"
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                    hint="Optional — defaults to today"
                  />
                  <FormInput
                    label="Transaction ref"
                    value={transactionRef}
                    onChange={(e) => setTransactionRef(e.target.value)}
                    placeholder="Optional"
                  />
                </div>

                {overFee ? (
                  <div className="sos-banner sos-banner--danger">Amount received cannot exceed the total fee.</div>
                ) : null}

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, color: 'var(--sos-text-muted)', lineHeight: 1.5 }}>
                  <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    Recorded as a real invoice. The firm books in CAD — {currency} amounts convert at
                    today&apos;s rate. When an amount received is entered, the payment is verified and a
                    receipt is issued automatically.
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: 'var(--sos-text-muted)',
              padding: '10px 12px',
              borderRadius: 'var(--sos-radius-md)',
              background: 'var(--sos-surface-2)',
              border: '1px solid var(--sos-border-subtle)',
            }}
          >
            <Info size={14} style={{ flexShrink: 0 }} />
            The document checklist + milestones are created automatically, so the client can start
            uploading right away. Acknowledge the case in the intake queue to assign an associate
            (and confirm the program, e.g. C11 / LMIA).
          </div>

          {error ? <div className="sos-banner sos-banner--danger">{error}</div> : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <SecondaryButton onClick={() => router.push('/processing' as Route)} disabled={submitting}>
              Cancel
            </SecondaryButton>
            <PrimaryButton onClick={handleSubmit} disabled={!canSubmit} iconLeft={submitting ? <Loader2 size={14} /> : <UserPlus size={14} />}>
              {submitting ? 'Creating…' : 'Create client'}
            </PrimaryButton>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
