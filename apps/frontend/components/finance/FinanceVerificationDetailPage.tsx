'use client';

/**
 * Screen 3 — Payment Verification Detail
 * Route: /finance/intake/[id]
 *
 * Layout: sticky receipt preview panel (left) + scrollable verification form (right).
 * All styling via --sos-* tokens.  Phase 1 scope: no real OCR, no real
 * file viewer, no maker-checker enforcement, no fraud-rule engine.
 */

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  SecondaryButton,
  GhostButton,
  DangerButton,
  SuccessButton,
  FormInput,
  FormSelect,
  FormTextarea,
  ActionBar,
} from '@/components/sales-v2/ui';
import {
  MOCK_PAYMENTS,
  type PaymentRecord,
  type PaymentMethod,
  fmtAmount,
  fmtRelative,
  METHOD_LABEL,
  STATUS_LABEL,
} from '@/components/finance-v1/mockData';

// ---------- helpers -------------------------------------------------------

function slaColor(s: PaymentRecord['slaStatus']): string {
  switch (s) {
    case 'BREACHED':    return 'var(--sos-status-danger)';
    case 'APPROACHING': return 'var(--sos-status-warning)';
    default:            return 'var(--sos-status-success)';
  }
}

function amountMismatched(p: PaymentRecord): boolean {
  return Math.abs(p.receivedAmount - p.expectedAmount) > 0.01;
}

// ---------- checklist config ---------------------------------------------

const CHECKLIST_ITEMS = [
  { key: 'amountMatch',     label: 'Amount matches expected' },
  { key: 'methodValid',     label: 'Payment method valid for this amount' },
  { key: 'receiptReadable', label: 'Receipt image readable' },
  { key: 'refUnique',       label: 'Transaction reference exists and not a duplicate' },
  { key: 'dateValid',       label: 'Payment date valid (not future, not >30 days old)' },
  { key: 'nameMatch',       label: 'Client name on receipt matches' },
  { key: 'salesNoteRead',   label: 'Sales note reviewed' },
  { key: 'noCompliance',    label: 'No outstanding compliance flag on client' },
] as const;

type ChecklistKey = (typeof CHECKLIST_ITEMS)[number]['key'];
type ChecklistState = Record<ChecklistKey, boolean>;

const DEFAULT_CHECKLIST: ChecklistState = {
  amountMatch:     false,
  methodValid:     false,
  receiptReadable: false,
  refUnique:       false,
  dateValid:       false,
  nameMatch:       false,
  salesNoteRead:   false,
  noCompliance:    false,
};

// ---------- mock fraud flags ---------------------------------------------

function getMockFlags(p: PaymentRecord): { id: string; message: string; severity: 'warn' | 'block' }[] {
  const flags: { id: string; message: string; severity: 'warn' | 'block' }[] = [];
  if (p.correctionBounceCount >= 2) {
    flags.push({
      id: 'bounce',
      message: `This record has been returned to sales ${p.correctionBounceCount} times — review history carefully.`,
      severity: 'warn',
    });
  }
  if (p.transactionReference === 'TFN-2391') {
    flags.push({
      id: 'dup-ref',
      message: 'Same reference TFN-2391 seen 14 days ago on a different client — review.',
      severity: 'warn',
    });
  }
  if (amountMismatched(p)) {
    flags.push({
      id: 'amount',
      message: `Amount on record (${fmtAmount(p.receivedAmount, p.currency)}) differs from expected (${fmtAmount(p.expectedAmount, p.currency)}).`,
      severity: 'block',
    });
  }
  return flags;
}

// ---------- payment method options ---------------------------------------

const METHOD_OPTIONS = Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }));

// ---------- Receipt preview (Phase 1 placeholder) -----------------------

function ReceiptPreviewPanel({ payment }: { payment: PaymentRecord }) {
  const [activeTab, setActiveTab] = useState(0);
  const count = payment.receiptFileCount;

  return (
    <div style={{ position: 'sticky', top: '80px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* file viewer card */}
      <GlassCard>
        <div style={{ padding: '16px 20px 0' }}>
          <p style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--sos-text-muted)', marginBottom: '3px' }}>
            Receipt files
          </p>
          <p style={{ fontSize: '13px', color: 'var(--sos-text-secondary)', marginBottom: '14px' }}>
            {count} file{count !== 1 ? 's' : ''} attached by {payment.salesUserName}
          </p>
        </div>

        {count > 1 && (
          <div style={{ display: 'flex', borderTop: '1px solid var(--sos-border-subtle)', borderBottom: '1px solid var(--sos-border-subtle)' }}>
            {Array.from({ length: count }).map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveTab(i)}
                style={{
                  flex: 1, padding: '8px', fontSize: '12px',
                  fontWeight: activeTab === i ? 600 : 400,
                  color: activeTab === i ? 'var(--sos-brand-primary)' : 'var(--sos-text-muted)',
                  background: activeTab === i ? 'var(--sos-bg-glass-subtle)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                }}
              >
                Receipt {i + 1}
              </button>
            ))}
          </div>
        )}

        {/* placeholder viewer */}
        <div
          style={{
            margin: '16px',
            borderRadius: '10px',
            background: 'var(--sos-bg-glass-subtle)',
            border: '2px dashed var(--sos-border-subtle)',
            minHeight: '260px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px',
          }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--sos-text-muted)" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <p style={{ fontSize: '13px', color: 'var(--sos-text-muted)', textAlign: 'center' }}>
            Receipt {activeTab + 1} of {count}
            <br />
            <span style={{ fontSize: '11px' }}>Uploaded by {payment.salesUserName}</span>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', padding: '0 16px 16px', flexWrap: 'wrap' }}>
          {(['Zoom', 'Rotate', 'Download'] as const).map((label) => (
            <button
              key={label}
              style={{
                padding: '5px 10px', fontSize: '12px',
                color: 'var(--sos-text-secondary)',
                background: 'var(--sos-bg-glass-subtle)',
                border: '1px solid var(--sos-border-subtle)',
                borderRadius: '6px', cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </GlassCard>

      {/* OCR suggestion (Phase 2) */}
      <GlassCard>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--sos-status-info)', flexShrink: 0 }} />
            <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>OCR suggestion</p>
            <span style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>Phase 2</span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--sos-text-muted)', lineHeight: '1.5' }}>
            Detected amount:{' '}
            <strong style={{ color: 'var(--sos-text-primary)' }}>{fmtAmount(payment.receivedAmount, payment.currency)}</strong>
            <br />
            Auto-fill available in Phase 2.
          </p>
        </div>
      </GlassCard>

      {/* re-upload */}
      <GlassCard>
        <div style={{ padding: '14px 16px' }}>
          <p style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginBottom: '8px' }}>Wrong file uploaded by Sales?</p>
          <button
            style={{
              width: '100%', padding: '8px', fontSize: '12.5px',
              color: 'var(--sos-brand-accent)',
              border: '1px solid var(--sos-brand-accent)',
              borderRadius: '8px', background: 'transparent', cursor: 'pointer', fontWeight: 500,
            }}
          >
            Request re-upload from Sales
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

// ---------- section card -------------------------------------------------

function SectionCard({
  title, children, badge,
}: {
  title: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <GlassCard>
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sos-text-primary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {title}
          </h2>
          {badge}
        </div>
        {children}
      </div>
    </GlassCard>
  );
}

// ---------- InfoRow -------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '2px' }}>{label}</p>
      <p style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--sos-text-primary)' }}>{value}</p>
    </div>
  );
}

// ---------- main component -----------------------------------------------

interface Props {
  paymentId: string;
}

export function FinanceVerificationDetailPage({ paymentId }: Props) {
  const router = useRouter();
  const payment = MOCK_PAYMENTS.find((p) => p.id === paymentId);

  // form state
  const [checklist, setChecklist]            = useState<ChecklistState>(DEFAULT_CHECKLIST);
  const [verifiedAmount, setVerifiedAmount]  = useState(payment?.receivedAmount.toString() ?? '');
  const [transactionRef, setTransactionRef]  = useState(payment?.transactionReference ?? '');
  const [paymentMethod, setPaymentMethod]    = useState<PaymentMethod>(payment?.paymentMethod ?? 'CASH');
  const [receivedDate, setReceivedDate]      = useState(payment?.paymentReceivedAt.slice(0, 10) ?? '');
  const [serviceFee, setServiceFee]          = useState(payment ? Math.round(payment.receivedAmount * 0.85).toString() : '');
  const [govtFee, setGovtFee]               = useState(payment ? Math.round(payment.receivedAmount * 0.1).toString() : '');
  const [financeNote, setFinanceNote]        = useState(payment?.financeNote ?? '');
  const [acknowledgedFlags, setAcknowledgedFlags] = useState<Set<string>>(new Set());
  const [toast, setToast]                    = useState<string | null>(null);
  const [lastSaved, setLastSaved]            = useState<string | null>(null);

  const toggleCheck = useCallback((key: ChecklistKey) => {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const checklistDone     = Object.values(checklist).filter(Boolean).length;
  const checklistComplete = checklistDone === CHECKLIST_ITEMS.length;

  const taxAmount   = Math.round(((parseFloat(serviceFee) || 0) + (parseFloat(govtFee) || 0)) * 0.05);
  const totalAmount = (parseFloat(serviceFee) || 0) + (parseFloat(govtFee) || 0) + taxAmount;

  const flags           = payment ? getMockFlags(payment) : [];
  const blockingUnacked = flags.filter((f) => f.severity === 'block' && !acknowledgedFlags.has(f.id)).length;
  const canVerify       = checklistComplete && blockingUnacked === 0;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function handleSaveDraft() {
    setLastSaved('just now');
    showToast('Draft saved.');
  }

  function handleVerify() {
    if (!canVerify) {
      showToast('Complete all checklist items and resolve blocking flags first.');
      return;
    }
    showToast('Payment verified. Moving to Receipt Confirmation.');
    setTimeout(() => router.push('/finance/receipts' as Route), 1800);
  }

  function handleRequestCorrection() {
    router.push(`/finance/corrections/${paymentId}` as Route);
  }

  function handleReject() {
    showToast('Payment rejected. Sales has been notified.');
    setTimeout(() => router.push('/finance/intake'), 1800);
  }

  function handleHold() {
    showToast('Payment placed on hold.');
    setTimeout(() => router.push('/finance/intake'), 1800);
  }

  // --- 404 ----------------------------------------------------------------
  if (!payment) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--sos-text-muted)' }}>
        <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Payment record not found</p>
        <p style={{ fontSize: '13px', marginBottom: '20px' }}>
          Record <code>{paymentId}</code> does not exist.
        </p>
        <SecondaryButton onClick={() => router.push('/finance/intake')}>← Back to Intake Queue</SecondaryButton>
      </div>
    );
  }

  const mismatch = amountMismatched(payment);
  const diff     = payment.receivedAmount - payment.expectedAmount;

  return (
    <div style={{ padding: '0 0 120px' }}>

      {/* toast */}
      {toast && (
        <div
          style={{
            position: 'fixed', bottom: '88px', left: '50%', transform: 'translateX(-50%)',
            background: 'var(--sos-bg-glass)', border: '1px solid var(--sos-border-default)',
            borderRadius: '10px', padding: '12px 20px', fontSize: '13.5px',
            color: 'var(--sos-text-primary)', boxShadow: 'var(--sos-shadow-xl)',
            zIndex: 9999, whiteSpace: 'nowrap',
          }}
        >
          {toast}
        </div>
      )}

      {/* page header */}
      <PageHeader
        eyebrow={`Finance intake · ${payment.id}`}
        title={`Verify: ${payment.clientName}`}
        description={
          <span style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span>{payment.service} · {payment.targetCountry} · {payment.branch}</span>
            <StatusBadge
              tone={
                payment.status === 'UNDER_VERIFICATION' ? 'info'
                : payment.status === 'CORRECTION_REQUIRED' ? 'warning'
                : payment.status === 'REJECTED' ? 'danger'
                : 'neutral'
              }
            >
              {STATUS_LABEL[payment.status]}
            </StatusBadge>
            {payment.slaStatus !== 'CLEARED' && (
              <span style={{ fontSize: '12px', color: slaColor(payment.slaStatus), fontWeight: 600 }}>
                SLA: {fmtRelative(payment.slaDueAt)}
              </span>
            )}
          </span>
        }
        actions={
          <Link href="/finance/intake" style={{ fontSize: '13px', color: 'var(--sos-text-muted)', textDecoration: 'none' }}>
            ← Intake queue
          </Link>
        }
      />

      {/* two-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '20px', alignItems: 'start' }}>

        {/* LEFT — receipt preview (sticky) */}
        <ReceiptPreviewPanel payment={payment} />

        {/* RIGHT — verification form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>

          {/* §1 Client Summary */}
          <SectionCard title="Client summary">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
              <InfoRow label="Client name"    value={payment.clientName} />
              <InfoRow label="Branch"         value={payment.branch} />
              <InfoRow label="Service"        value={payment.service} />
              <InfoRow label="Target country" value={payment.targetCountry} />
              <InfoRow label="Sales person"   value={payment.salesUserName} />
              <InfoRow label="Priority"       value={payment.priority} />
            </div>
            <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--sos-border-subtle)' }}>
              <Link
                href={`/sales/leads/${payment.leadId}`}
                style={{ fontSize: '12.5px', color: 'var(--sos-brand-primary)', textDecoration: 'none', fontWeight: 500 }}
              >
                View lead profile →
              </Link>
            </div>
          </SectionCard>

          {/* §2 Sales Handover Details */}
          <SectionCard title="Sales handover details">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                <InfoRow label="Sent to finance" value={fmtRelative(payment.sentToFinanceAt)} />
                <InfoRow label="Receipts sent"   value={`${payment.receiptFileCount} file${payment.receiptFileCount !== 1 ? 's' : ''}`} />
                <InfoRow label="Payment method"  value={METHOD_LABEL[payment.paymentMethod]} />
                <div>
                  <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '2px' }}>SLA deadline</p>
                  <p style={{ fontSize: '13.5px', fontWeight: 600, color: slaColor(payment.slaStatus) }}>
                    {fmtRelative(payment.slaDueAt)}{' '}
                    <span style={{ fontWeight: 400, fontSize: '11px', color: 'var(--sos-text-muted)' }}>({payment.slaStatus})</span>
                  </p>
                </div>
              </div>

              {payment.salesNote && (
                <div style={{ background: 'var(--sos-bg-glass-subtle)', borderRadius: '8px', padding: '12px 14px', borderLeft: '3px solid var(--sos-brand-accent)' }}>
                  <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '4px', fontWeight: 600 }}>SALES NOTE</p>
                  <p style={{ fontSize: '13px', color: 'var(--sos-text-primary)', lineHeight: '1.55' }}>{payment.salesNote}</p>
                </div>
              )}

              {payment.correctionBounceCount > 0 && (
                <div style={{ background: 'var(--sos-bg-glass-subtle)', borderRadius: '8px', padding: '10px 14px', borderLeft: '3px solid var(--sos-status-warning)' }}>
                  <p style={{ fontSize: '12px', color: 'var(--sos-status-warning)', fontWeight: 600 }}>
                    Returned to sales {payment.correctionBounceCount} time{payment.correctionBounceCount !== 1 ? 's' : ''}
                  </p>
                  {payment.correctionLastReason && (
                    <p style={{ fontSize: '12px', color: 'var(--sos-text-secondary)', marginTop: '3px' }}>
                      Last reason: {payment.correctionLastReason}
                    </p>
                  )}
                </div>
              )}
            </div>
          </SectionCard>

          {/* §3 Expected vs. Received */}
          <SectionCard
            title="Expected vs. received"
            badge={
              <span
                style={{
                  fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
                  color: mismatch ? 'var(--sos-status-danger)' : 'var(--sos-status-success)',
                  background: mismatch
                    ? 'color-mix(in srgb, var(--sos-status-danger) 12%, transparent)'
                    : 'color-mix(in srgb, var(--sos-status-success) 12%, transparent)',
                }}
              >
                {mismatch ? 'MISMATCH' : 'MATCHED'}
              </span>
            }
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: mismatch ? '14px' : 0 }}>
              <div style={{ background: 'var(--sos-bg-glass-subtle)', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '6px', fontWeight: 600 }}>EXPECTED</p>
                <p style={{ fontSize: '24px', fontWeight: 700, color: 'var(--sos-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtAmount(payment.expectedAmount, payment.currency)}
                </p>
              </div>
              <div
                style={{
                  background: mismatch
                    ? 'color-mix(in srgb, var(--sos-status-danger) 8%, var(--sos-bg-glass-subtle))'
                    : 'color-mix(in srgb, var(--sos-status-success) 8%, var(--sos-bg-glass-subtle))',
                  borderRadius: '10px', padding: '16px', textAlign: 'center',
                  border: mismatch ? '1px solid color-mix(in srgb, var(--sos-status-danger) 25%, transparent)' : 'none',
                }}
              >
                <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '6px', fontWeight: 600 }}>RECEIVED</p>
                <p style={{
                  fontSize: '24px', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: mismatch ? 'var(--sos-status-danger)' : 'var(--sos-status-success)',
                }}>
                  {fmtAmount(payment.receivedAmount, payment.currency)}
                </p>
              </div>
            </div>

            {mismatch && (
              <div style={{
                background: 'color-mix(in srgb, var(--sos-status-danger) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--sos-status-danger) 25%, transparent)',
                borderRadius: '8px', padding: '10px 14px',
              }}>
                <p style={{ fontSize: '13px', color: 'var(--sos-status-danger)', fontWeight: 600 }}>
                  Difference: {diff > 0 ? '+' : ''}{fmtAmount(Math.abs(diff), payment.currency)}{' '}
                  <span style={{ fontWeight: 400 }}>({diff < 0 ? 'under-payment' : 'over-payment'})</span>
                </p>
              </div>
            )}
          </SectionCard>

          {/* §4 Payment Details (editable) */}
          <SectionCard title="Payment details">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <FormInput
                label="Verified amount"
                type="number"
                value={verifiedAmount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVerifiedAmount(e.target.value)}
                placeholder="0.00"
              />
              <FormInput
                label="Currency"
                value={payment.currency}
                readOnly
              />
              <FormSelect
                label="Payment method"
                value={paymentMethod}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPaymentMethod(e.target.value as PaymentMethod)}
                options={METHOD_OPTIONS}
              />
              <FormInput
                label="Transaction reference"
                value={transactionRef}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTransactionRef(e.target.value)}
                placeholder="e.g. TFN-4421"
              />
              <FormInput
                label="Payment received date"
                type="date"
                value={receivedDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceivedDate(e.target.value)}
              />
              <FormInput
                label="Collected by (sales)"
                value={payment.salesUserName}
                readOnly
              />
            </div>
          </SectionCard>

          {/* §5 Verification Checklist */}
          <SectionCard
            title="Verification checklist"
            badge={
              <span style={{
                fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
                color: checklistComplete ? 'var(--sos-status-success)' : 'var(--sos-text-muted)',
                background: checklistComplete
                  ? 'color-mix(in srgb, var(--sos-status-success) 12%, transparent)'
                  : 'var(--sos-bg-glass-subtle)',
              }}>
                {checklistDone} / {CHECKLIST_ITEMS.length}
              </span>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {CHECKLIST_ITEMS.map((item) => {
                const checked = checklist[item.key];
                return (
                  <button
                    key={item.key}
                    onClick={() => toggleCheck(item.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '10px 14px', borderRadius: '8px', width: '100%',
                      background: checked
                        ? 'color-mix(in srgb, var(--sos-status-success) 10%, var(--sos-bg-glass-subtle))'
                        : 'var(--sos-bg-glass-subtle)',
                      border: checked
                        ? '1px solid color-mix(in srgb, var(--sos-status-success) 30%, transparent)'
                        : '1px solid var(--sos-border-subtle)',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                  >
                    <span style={{
                      width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0,
                      border: `2px solid ${checked ? 'var(--sos-status-success)' : 'var(--sos-border-default)'}`,
                      background: checked ? 'var(--sos-status-success)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.12s',
                    }}>
                      {checked && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <polyline points="1.5,5 4,7.5 8.5,2" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span style={{
                      fontSize: '13px',
                      color: checked ? 'var(--sos-text-primary)' : 'var(--sos-text-secondary)',
                      fontWeight: checked ? 500 : 400,
                    }}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </SectionCard>

          {/* §6 Duplicate / Fraud Flags */}
          <SectionCard title="Duplicate & fraud flags">
            {flags.length === 0 ? (
              <div style={{
                padding: '18px', textAlign: 'center', fontSize: '13px',
                color: 'var(--sos-status-success)',
                background: 'color-mix(in srgb, var(--sos-status-success) 6%, var(--sos-bg-glass-subtle))',
                borderRadius: '8px',
                border: '1px solid color-mix(in srgb, var(--sos-status-success) 20%, transparent)',
              }}>
                ✓ No flags detected on this record.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {flags.map((flag) => {
                  const acked   = acknowledgedFlags.has(flag.id);
                  const accent  = flag.severity === 'block' ? 'var(--sos-status-danger)' : 'var(--sos-status-warning)';
                  const bgColor = flag.severity === 'block'
                    ? 'color-mix(in srgb, var(--sos-status-danger) 8%, transparent)'
                    : 'color-mix(in srgb, var(--sos-status-warning) 8%, transparent)';
                  return (
                    <div
                      key={flag.id}
                      style={{
                        background: acked ? 'var(--sos-bg-glass-subtle)' : bgColor,
                        border: `1px solid ${acked ? 'var(--sos-border-subtle)' : accent}`,
                        borderRadius: '8px', padding: '12px 14px',
                        display: 'flex', alignItems: 'flex-start', gap: '12px',
                        opacity: acked ? 0.6 : 1, transition: 'opacity 0.2s',
                      }}
                    >
                      <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>
                        {flag.severity === 'block' ? '⛔' : '⚠️'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '13px', color: 'var(--sos-text-primary)', lineHeight: '1.45', marginBottom: '6px' }}>
                          {flag.message}
                        </p>
                        <button
                          onClick={() =>
                            setAcknowledgedFlags((prev) => {
                              const next = new Set(prev);
                              if (next.has(flag.id)) next.delete(flag.id); else next.add(flag.id);
                              return next;
                            })
                          }
                          style={{
                            fontSize: '11.5px', color: acked ? 'var(--sos-text-muted)' : accent,
                            background: 'none',
                            border: `1px solid ${acked ? 'var(--sos-border-subtle)' : accent}`,
                            borderRadius: '5px', padding: '3px 10px',
                            cursor: 'pointer', fontWeight: 500,
                          }}
                        >
                          {acked ? 'Undo acknowledge' : 'Acknowledge'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* §7 Tax & Fee Breakdown */}
          <SectionCard title="Tax & fee breakdown">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <FormInput
                label="Service fee"
                type="number"
                value={serviceFee}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setServiceFee(e.target.value)}
                placeholder="0.00"
              />
              <FormInput
                label="Govt / processing fee"
                type="number"
                value={govtFee}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGovtFee(e.target.value)}
                placeholder="0.00"
              />
              <div>
                <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '4px', fontWeight: 500, letterSpacing: '0.04em' }}>TAX (5% GST, auto)</p>
                <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-secondary)' }}>
                  {payment.currency} {taxAmount.toLocaleString()}
                </p>
              </div>
              <div>
                <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '4px', fontWeight: 500, letterSpacing: '0.04em' }}>TOTAL</p>
                <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
                  {payment.currency} {totalAmount.toLocaleString()}
                </p>
              </div>
            </div>
          </SectionCard>

          {/* §8 Finance Note */}
          <SectionCard title="Finance note">
            <FormTextarea
              label="Officer's note (internal only)"
              value={financeNote}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFinanceNote(e.target.value)}
              placeholder="Add verification notes, observations, or follow-up items here..."
              rows={4}
            />
            <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginTop: '8px' }}>
              Visible to finance staff only. Not shown to Sales or the client.
            </p>
          </SectionCard>

        </div>
      </div>

      {/* Sticky action bar */}
      <ActionBar
        left={
          <>
            <SecondaryButton onClick={handleSaveDraft}>Save draft</SecondaryButton>
            {lastSaved && (
              <span style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>
                Last saved: {lastSaved}
              </span>
            )}
          </>
        }
        hint={
          !canVerify
            ? !checklistComplete
              ? `${CHECKLIST_ITEMS.length - checklistDone} checklist item${CHECKLIST_ITEMS.length - checklistDone !== 1 ? 's' : ''} remaining`
              : `${blockingUnacked} blocking flag${blockingUnacked !== 1 ? 's' : ''} — acknowledge to proceed`
            : undefined
        }
        right={
          <>
            <GhostButton onClick={handleHold}>Place on hold</GhostButton>
            <SecondaryButton onClick={handleRequestCorrection}>Request correction</SecondaryButton>
            <DangerButton onClick={handleReject}>Reject</DangerButton>
            <SuccessButton onClick={handleVerify} disabled={!canVerify}>
              Verify payment
            </SuccessButton>
          </>
        }
      />
    </div>
  );
}
