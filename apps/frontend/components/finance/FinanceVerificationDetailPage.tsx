'use client';

/**
 * Payment Verification Detail
 * Route: /finance/intake/[id]
 *
 * Layout: sticky receipt viewer (left) + scrollable verification form (right).
 * The receipt renders inline (image/PDF). Not yet: OCR auto-read,
 * maker-checker enforcement, fraud-rule engine.
 */

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  SecondaryButton,
  DangerButton,
  SuccessButton,
  FormInput,
  FormSelect,
  FormTextarea,
  ActionBar,
} from '@/components/sales-v2/ui';
import {
  adminDeleteHandover,
  fetchHandoverById,
  fetchReceiptForHandover,
  getReceiptDownloadUrl,
  reviewHandover,
  verifyPayment,
  fmtAmount,
  fmtRelative,
  clientName,
  STATUS_LABEL,
  METHOD_LABEL,
  type ApiHandover,
  type ApiReceipt,
} from '@/lib/finance-api';
import { AdminAuthDeleteModal } from './AdminAuthDeleteModal';

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

// ---------- payment method options ---------------------------------------

const METHOD_OPTIONS = Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }));

// ---------- Receipt viewer (inline image/PDF) ---------------------------

function ReceiptPreviewPanel({ payment }: { payment: ApiHandover }) {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div style={{ position: 'sticky', top: '80px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* file viewer card */}
      <GlassCard>
        <div style={{ padding: '16px 20px 0' }}>
          <p style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--sos-text-muted)', marginBottom: '3px' }}>
            Receipt file
          </p>
          <p style={{ fontSize: '13px', color: 'var(--sos-text-secondary)', marginBottom: '14px' }}>
            {payment.receiptFileName}
          </p>
        </div>

        {/* Inline viewer — the officer must be able to SEE the proof, not
            just download it. Images render directly; PDFs embed; anything
            else (or a missing URL) falls back to the file placeholder. */}
        {payment.receiptDownloadUrl && (payment.receiptMimeType ?? '').startsWith('image/') ? (
          <div style={{ margin: '16px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={payment.receiptDownloadUrl}
              alt={`Receipt — ${payment.receiptFileName}`}
              style={{ width: '100%', maxHeight: '480px', objectFit: 'contain', borderRadius: '10px', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-bg-glass-subtle)' }}
            />
          </div>
        ) : payment.receiptDownloadUrl && payment.receiptMimeType === 'application/pdf' ? (
          <div style={{ margin: '16px' }}>
            <iframe
              src={payment.receiptDownloadUrl}
              title={`Receipt — ${payment.receiptFileName}`}
              style={{ width: '100%', height: '480px', border: '1px solid var(--sos-border-subtle)', borderRadius: '10px', background: '#fff' }}
            />
          </div>
        ) : (
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
              {payment.receiptFileName}
              <br />
              <span style={{ fontSize: '11px' }}>Preview unavailable — use Download to open the file</span>
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', padding: '0 16px 16px', flexWrap: 'wrap' }}>
          {payment.receiptDownloadUrl ? (
            <a
              href={payment.receiptDownloadUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '5px 10px', fontSize: '12px',
                color: 'var(--sos-brand-primary)',
                background: 'var(--sos-bg-glass-subtle)',
                border: '1px solid var(--sos-border-subtle)',
                borderRadius: '6px', cursor: 'pointer',
                textDecoration: 'none',
              }}
            >
              Download
            </a>
          ) : null}
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
            <strong style={{ color: 'var(--sos-text-primary)' }}>{fmtAmount(payment.submittedAmount, payment.currency)}</strong>
            <br />
            Auto-fill available in Phase 2.
          </p>
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
  const [handover, setHandover] = useState<ApiHandover | null>(null);
  const [loadError, setLoadError] = useState(false);

  // form state
  const [checklist, setChecklist]            = useState<ChecklistState>(DEFAULT_CHECKLIST);
  const [verifiedAmount, setVerifiedAmount]  = useState('');
  const [transactionRef, setTransactionRef]  = useState('');
  const [paymentMethod, setPaymentMethod]    = useState('CASH');
  const [receivedDate, setReceivedDate]      = useState('');
  const [serviceFee, setServiceFee]          = useState('');
  const [govtFee, setGovtFee]               = useState('');
  const [financeNote, setFinanceNote]        = useState('');
  const [acknowledgedFlags, setAcknowledgedFlags] = useState<Set<string>>(new Set());
  const [toast, setToast]                    = useState<string | null>(null);
  const [lastSaved, setLastSaved]            = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adminDeleteOpen, setAdminDeleteOpen] = useState(false);
  const [receipt, setReceipt] = useState<ApiReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptDownloading, setReceiptDownloading] = useState(false);

  useEffect(() => {
    fetchHandoverById(paymentId)
      .then((h) => {
        setHandover(h);
        setVerifiedAmount(h.submittedAmount);
        setTransactionRef(h.transactionRef ?? '');
        setPaymentMethod(h.paymentMethod ?? 'CASH');
        setReceivedDate(h.submittedAt.slice(0, 10));
        setFinanceNote(h.financeNotes ?? '');
      })
      .catch(() => setLoadError(true));

    // Receipt is issued only after verifyPayment runs — fetch it
    // alongside the handover so the "Download receipt" button appears
    // automatically when this is a verified case.
    setReceiptLoading(true);
    fetchReceiptForHandover(paymentId)
      .then(setReceipt)
      .catch(() => setReceipt(null))
      .finally(() => setReceiptLoading(false));
  }, [paymentId]);

  /** Refetch the Receipt after verification succeeds so the download
   *  button appears in-place without requiring a page reload. */
  async function reloadReceipt() {
    setReceiptLoading(true);
    try {
      const r = await fetchReceiptForHandover(paymentId);
      setReceipt(r);
    } finally {
      setReceiptLoading(false);
    }
  }

  /** Open the receipt PDF in a new tab using a signed URL. */
  async function handleDownloadReceipt() {
    if (!receipt) return;
    setReceiptDownloading(true);
    try {
      const { url } = await getReceiptDownloadUrl(receipt.id);
      // Open in a new tab; the signed URL is short-lived so we can't
      // stash it in clipboard reliably.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      showToast(
        err instanceof Error
          ? `Receipt download failed: ${err.message}`
          : 'Receipt download failed.',
      );
    } finally {
      setReceiptDownloading(false);
    }
  }

  const checklistDone     = Object.values(checklist).filter(Boolean).length;
  const checklistComplete = checklistDone === CHECKLIST_ITEMS.length;

  function toggleCheck(key: ChecklistKey) {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const taxAmount   = Math.round(((parseFloat(serviceFee) || 0) + (parseFloat(govtFee) || 0)) * 0.05);
  const totalAmount = (parseFloat(serviceFee) || 0) + (parseFloat(govtFee) || 0) + taxAmount;

  const canVerify = checklistComplete;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  /**
   * "Save draft" actually persists the finance note server-side now —
   * previously it just showed a toast and lost the text on refresh.
   * Uses MARK_IN_REVIEW because that's the only existing action that
   * also accepts `financeNotes` without forcing a status transition
   * the operator isn't ready for. If the handover is already past
   * IN_REVIEW (e.g. PAYMENT_RECORDED), MARK_IN_REVIEW also re-opens it
   * so the operator can edit notes mid-flow — that's the right
   * semantic for "I want to keep working on this".
   */
  async function handleSaveDraft() {
    if (!handover) return;
    setSaving(true);
    try {
      const updated = await reviewHandover(handover.id, 'MARK_IN_REVIEW', {
        financeNotes: financeNote,
      });
      setHandover(updated);
      setLastSaved('just now');
      showToast('Note saved · case marked in review.');
    } catch {
      showToast('Failed to save draft.');
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkInReview() {
    if (!handover) return;
    setSaving(true);
    try {
      const updated = await reviewHandover(handover.id, 'MARK_IN_REVIEW', {
        financeNotes: financeNote,
      });
      setHandover(updated);
      showToast('Marked as in review.');
    } catch {
      showToast('Failed to update status.');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Full verification flow. Two backend steps under one button so the
   * operator never has to leave this page and dig through another
   * screen to "finish" a case:
   *
   *   1. POST /finance/handovers/:id/review { action: RECORD_PAYMENT }
   *      Creates the Invoice + an initial Payment row (status SUBMITTED).
   *      Handover → PAYMENT_RECORDED. Skipped if already at this step.
   *
   *   2. POST /finance/payments/:paymentId/verify
   *      Flips Payment to PAID, converts the Lead to a Client (if not
   *      already converted), creates a ProcessingCase, attaches the
   *      client/case back to the Invoice, marks the Handover
   *      PAYMENT_VERIFIED. This is the step that actually pushes the
   *      case forward into Processing.
   *
   * Both steps already existed on the backend and were verified wired
   * in the earlier audit — they were just split across two pages in
   * the UI. This handler runs them sequentially so one click does the
   * whole thing.
   */
  async function handleVerify() {
    if (!handover) return;
    if (!canVerify) {
      showToast('Complete all checklist items first.');
      return;
    }
    setSaving(true);
    try {
      // Step 1 — record payment (skipped if we're already past it).
      let withPayment = handover;
      if (handover.status === 'SUBMITTED' || handover.status === 'IN_REVIEW') {
        withPayment = await reviewHandover(handover.id, 'RECORD_PAYMENT', {
          financeNotes: financeNote,
        });
        setHandover(withPayment);
      }
      const paymentId = withPayment.payment?.id;
      if (!paymentId) {
        showToast('Payment row missing after record step — please reopen the case.');
        return;
      }
      // Step 2 — verify + create Client + create ProcessingCase + issue Receipt.
      await verifyPayment(paymentId, {
        verificationNote: financeNote || undefined,
      });
      // Pull the freshly-issued receipt so the operator can download
      // the PDF right away if they want to before the page navigates.
      await reloadReceipt();
      showToast('Payment verified · client created · receipt issued · case sent to Processing.');
      setTimeout(() => router.push('/finance/intake'), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      showToast(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleReject() {
    if (!handover) return;
    setSaving(true);
    try {
      await reviewHandover(handover.id, 'REJECT', { financeNotes: financeNote });
      showToast('Rejected · visible on lead profile’s Finance tab.');
      setTimeout(() => router.push('/finance/intake'), 1800);
    } catch {
      showToast('Failed to reject handover.');
    } finally {
      setSaving(false);
    }
  }

  function handleRequestCorrection() {
    router.push(`/finance/corrections/${paymentId}` as Route);
  }

  /** Step-up delete — the modal collects admin creds + reason and we
   *  hand them straight to the backend, which is what actually
   *  verifies the admin. We throw on backend failure so the modal
   *  surfaces the error inline rather than us showing a toast over
   *  a still-open modal. */
  async function handleAdminDelete(values: {
    adminEmail: string;
    adminPassword: string;
    reason: string;
  }) {
    if (!handover) return;
    await adminDeleteHandover(handover.id, values);
    setAdminDeleteOpen(false);
    showToast('Handover deleted · audit + lead timeline updated.');
    setTimeout(() => router.push('/finance/intake'), 1500);
  }

  // --- loading/404 ----------------------------------------------------------------
  if (!handover && !loadError) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--sos-text-muted)' }}>
        Loading handover…
      </div>
    );
  }

  if (loadError || !handover) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--sos-text-muted)' }}>
        <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Handover not found</p>
        <p style={{ fontSize: '13px', marginBottom: '20px' }}>
          Record <code>{paymentId}</code> does not exist or you do not have access.
        </p>
        <SecondaryButton onClick={() => router.push('/finance/intake')}>← Back to Intake Queue</SecondaryButton>
      </div>
    );
  }

  const name = clientName(handover);

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
        eyebrow={`Finance intake · ${handover.id.slice(0, 8)}`}
        title={`Verify: ${name}`}
        description={
          <span style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span>{handover.lead.serviceInterest ?? '—'} · {handover.lead.targetCountry ?? '—'}</span>
            <StatusBadge tone="info">
              {STATUS_LABEL[handover.status]}
            </StatusBadge>
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
        <ReceiptPreviewPanel payment={handover} />

        {/* RIGHT — verification form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>

          {/* §1 Client Summary */}
          <SectionCard title="Client summary">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
              <InfoRow label="Client name"    value={name} />
              <InfoRow label="Phone"          value={handover.lead.phone} />
              <InfoRow label="Service"        value={handover.lead.serviceInterest ?? '—'} />
              <InfoRow label="Target country" value={handover.lead.targetCountry ?? '—'} />
              <InfoRow label="Status"         value={handover.lead.status} />
            </div>
            <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--sos-border-subtle)' }}>
              <Link
                href={`/sales/leads/${handover.leadId}`}
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
                <InfoRow label="Submitted at" value={fmtRelative(handover.submittedAt)} />
                <InfoRow label="Receipt file" value={handover.receiptFileName} />
                <InfoRow label="Payment method" value={handover.paymentMethod ? (METHOD_LABEL[handover.paymentMethod] ?? handover.paymentMethod) : '—'} />
                <InfoRow label="Currency" value={handover.currency} />
              </div>

              {handover.notes && (
                <div style={{ background: 'var(--sos-bg-glass-subtle)', borderRadius: '8px', padding: '12px 14px', borderLeft: '3px solid var(--sos-brand-accent)' }}>
                  <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '4px', fontWeight: 600 }}>SALES NOTE</p>
                  <p style={{ fontSize: '13px', color: 'var(--sos-text-primary)', lineHeight: '1.55' }}>{handover.notes}</p>
                </div>
              )}
            </div>
          </SectionCard>

          {/* §3 Expected vs. Received */}
          <SectionCard title="Expected vs. received">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ background: 'var(--sos-bg-glass-subtle)', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '6px', fontWeight: 600 }}>SUBMITTED</p>
                <p style={{ fontSize: '24px', fontWeight: 700, color: 'var(--sos-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtAmount(handover.submittedAmount, handover.currency)}
                </p>
              </div>
              {handover.invoice && (
                <div style={{ background: 'var(--sos-bg-glass-subtle)', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                  <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '6px', fontWeight: 600 }}>INVOICE TOTAL</p>
                  <p style={{ fontSize: '24px', fontWeight: 700, color: 'var(--sos-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtAmount(handover.invoice.totalAmount, handover.currency)}
                  </p>
                </div>
              )}
            </div>
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
                value={handover.currency}
                readOnly
              />
              <FormSelect
                label="Payment method"
                value={paymentMethod}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPaymentMethod(e.target.value)}
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
                  {handover.currency} {taxAmount.toLocaleString()}
                </p>
              </div>
              <div>
                <p style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginBottom: '4px', fontWeight: 500, letterSpacing: '0.04em' }}>TOTAL</p>
                <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
                  {handover.currency} {totalAmount.toLocaleString()}
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

      {/* Four-eyes notice — segregation of duties. Policy-agnostic copy (no
          hard-coded amount) so it stays accurate if the threshold changes. */}
      {handover.status !== 'PAYMENT_VERIFIED' && handover.status !== 'REJECTED' ? (
        <div
          style={{
            display: 'flex', gap: 8, alignItems: 'flex-start',
            padding: '10px 14px', borderRadius: 'var(--sos-radius-md)',
            background: 'var(--sos-bg-glass-subtle)', border: '1px solid var(--sos-border-subtle)',
            fontSize: 12.5, color: 'var(--sos-text-secondary)', lineHeight: 1.5,
          }}
        >
          <span aria-hidden style={{ fontWeight: 700, color: 'var(--sos-text-muted)' }}>⚖︎</span>
          <span>
            <strong>Segregation of duties.</strong> Large payments must be verified by a
            different officer than the one who recorded them. If verification is blocked,
            ask another finance officer to confirm this one.
          </span>
        </div>
      ) : null}

      {/* Sticky action bar — actions are status-aware so the operator
          can't accidentally re-verify a case that's already moved on
          to Processing, or click Reject on a handover that's already
          been paid. Once status === PAYMENT_VERIFIED, only Save draft
          remains (for late-edit notes that need to land on the timeline). */}
      <ActionBar
        left={
          <>
            <SecondaryButton onClick={handleSaveDraft} disabled={saving}>
              Save draft
            </SecondaryButton>
            {lastSaved && (
              <span style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>
                Last saved: {lastSaved}
              </span>
            )}
            {/* Receipt PDF — visible once payment has been verified and
                the Receipt row has been issued by the backend (auto on
                verifyPayment). Clicking opens a signed download URL in
                a new tab. The receipt PDF has the Tashfeen letterhead,
                customer reference code, payment details, and the
                running invoice balance. */}
            {receipt ? (
              <SuccessButton
                onClick={() => void handleDownloadReceipt()}
                disabled={receiptDownloading || receiptLoading}
                title={`Receipt ${receipt.receiptNumber}`}
              >
                {receiptDownloading
                  ? 'Opening…'
                  : `Download receipt (${receipt.receiptNumber})`}
              </SuccessButton>
            ) : null}
            {/* Step-up admin delete — available on every status (including
                already-CANCELLED is the only one we hide it on since
                there'd be nothing to delete). The actual authorisation
                happens server-side after the admin types their password
                in the modal. */}
            {handover.status !== 'CANCELLED' ? (
              <DangerButton
                onClick={() => setAdminDeleteOpen(true)}
                disabled={saving}
              >
                Admin delete
              </DangerButton>
            ) : null}
          </>
        }
        hint={
          handover.status === 'PAYMENT_VERIFIED'
            ? 'Verified · client created · sent to Processing'
            : handover.status === 'REJECTED'
              ? 'Rejected · visible on the lead’s Finance tab'
              : !canVerify
                ? `${CHECKLIST_ITEMS.length - checklistDone} checklist item${CHECKLIST_ITEMS.length - checklistDone !== 1 ? 's' : ''} remaining`
                : undefined
        }
        right={
          handover.status === 'PAYMENT_VERIFIED' || handover.status === 'REJECTED' ? (
            <SecondaryButton onClick={() => router.push('/finance/intake')}>
              Back to queue
            </SecondaryButton>
          ) : (
            <>
              <SecondaryButton onClick={handleRequestCorrection} disabled={saving}>
                Request correction
              </SecondaryButton>
              <DangerButton onClick={handleReject} disabled={saving}>
                Reject
              </DangerButton>
              <SuccessButton onClick={handleVerify} disabled={!canVerify || saving}>
                {handover.status === 'PAYMENT_RECORDED'
                  ? 'Send to Processing'
                  : 'Verify & send to Processing'}
              </SuccessButton>
            </>
          )
        }
      />

      <AdminAuthDeleteModal
        open={adminDeleteOpen}
        onClose={() => setAdminDeleteOpen(false)}
        title="Delete finance handover"
        subject={`${clientName(handover)} · ${fmtAmount(handover.submittedAmount, handover.currency)} · ${STATUS_LABEL[handover.status]}`}
        onConfirm={handleAdminDelete}
      />
    </div>
  );
}
