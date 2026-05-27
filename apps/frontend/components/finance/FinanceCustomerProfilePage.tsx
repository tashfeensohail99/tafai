'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Route } from 'next';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Download,
  FileSignature,
  FileText,
  Loader2,
  MessageSquare,
  Receipt as ReceiptIcon,
  Send,
  Trash2,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react';
import {
  ButtonLink,
  FormInput,
  FormSelect,
  GhostButton,
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  createExpense,
  deleteExpense,
  fetchFinanceCustomerProfile,
  getContractAgreementUrl,
  getExpenseReceiptUrl,
  recordCustomerPayment,
  sendCaseToProcessing,
  uploadSignedAgreement,
  type ExpenseCategory,
  type FinanceCustomerProfile,
} from '@/lib/finance-profile';
import { getAgreementPdfUrl, sendAgreementToClient } from '@/lib/agreements';
import { labelForServiceCode } from '@/lib/service-types';
import { fetchHandoverById, fetchFxRates, fetchReceiptPdfBlob, recognizeInstallment, reviewHandover, sendReceiptToClient, toBaseCAD, verifyPayment, FINANCE_CURRENCIES, type ApiHandover } from '@/lib/finance-api';
import { WhatsAppLeadTab } from '@/components/whatsapp/WhatsAppLeadTab';
import { sendTemplate } from '@/lib/whatsapp';

const CURRENCY_OPTIONS = FINANCE_CURRENCIES.map((c) => ({ value: c, label: c }));

const EXPENSE_CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'GOVERNMENT_FEE', label: 'Government fee' },
  { value: 'EMBASSY', label: 'Embassy / consulate' },
  { value: 'MEDICAL', label: 'Medical / biometrics' },
  { value: 'TRANSLATION', label: 'Translation / attestation' },
  { value: 'COURIER', label: 'Courier / shipping' },
  { value: 'THIRD_PARTY', label: 'Third-party vendor' },
  { value: 'OTHER', label: 'Other' },
];
const expenseCatLabel = (c: string) => EXPENSE_CATEGORIES.find((x) => x.value === c)?.label ?? label(c);

const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'BANK', label: 'Bank Transfer' },
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'MOBILE', label: 'Mobile Payment' },
  { value: 'WIRE', label: 'Wire Transfer' },
  { value: 'ONLINE', label: 'Online' },
  { value: 'OTHER', label: 'Other' },
];

/** Safe base64 encoder — chunked to avoid a stack overflow on large files. */
function fileToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

type TabKey = 'overview' | 'agreement' | 'ledger' | 'invoices' | 'payments' | 'expenses' | 'receipts' | 'whatsapp';
const TABS: Array<[TabKey, string]> = [
  ['overview', 'Overview'],
  ['agreement', 'Agreement'],
  ['ledger', 'Ledger'],
  ['invoices', 'Invoices'],
  ['payments', 'Payments'],
  ['expenses', 'Expenses'],
  ['receipts', 'Receipts'],
  ['whatsapp', 'WhatsApp'],
];

const money = (n: number, ccy: string) =>
  `${ccy} ${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function tone(status: string): BadgeTone {
  const s = status.toUpperCase();
  if (['SIGNED', 'APPROVED', 'PAID', 'PAYMENT_VERIFIED', 'ACTIVE', 'COMPLETED', 'CONVERTED'].includes(s)) return 'success';
  if (['SENT', 'SUBMITTED', 'FINANCE_REVIEW', 'INVOICED', 'PARTIALLY_PAID', 'PARTIAL', 'IN_REVIEW'].includes(s)) return 'info';
  if (['CHANGES_REQUESTED', 'OVERDUE', 'PENDING', 'DRAFT'].includes(s)) return 'warning';
  if (['CANCELLED', 'REJECTED', 'LOST', 'DISPUTED', 'REFUNDED', 'VOID'].includes(s)) return 'danger';
  return 'neutral';
}
const label = (s: string) => s.replace(/_/g, ' ').toLowerCase();

const th: CSSProperties = { textAlign: 'left', padding: '9px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--sos-text-faint)', borderBottom: '1px solid var(--sos-border-subtle)', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '10px 14px', fontSize: 13, color: 'var(--sos-text-secondary)', borderBottom: '1px solid var(--sos-border-subtle)' };

/**
 * One-click "Send consultation reminder" button on the Finance WhatsApp tab.
 *
 * Calls the approved `finance_consultation_today` template (UTILITY, en) with
 * the client's first name as `{{1}}`. Sending an approved template is allowed
 * even when the 24-hour customer-service window is closed — that's the whole
 * point: this is the "door opener" finance uses to get the client to reply, at
 * which point the window reopens and finance can send the receipt PDF / talk
 * freely. Template approval lives in Meta; until they flip it to APPROVED,
 * this button returns Meta's "template not approved" error which the chat
 * panel surfaces inline.
 */
function ConsultationReminderButton({
  threadId,
  clientFirstName,
  onSent,
  onError,
}: {
  threadId: string;
  clientFirstName: string;
  onSent: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const handleClick = async () => {
    setBusy(true);
    try {
      await sendTemplate(threadId, {
        templateName: 'finance_consultation_today',
        language: 'en',
        components: [
          { type: 'body', parameters: [{ type: 'text', text: clientFirstName }] },
        ],
      });
      onSent();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not send the consultation reminder');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', borderRadius: 8, border: '1px dashed var(--sos-border-subtle)', background: 'var(--sos-bg-glass-subtle)' }}>
      <span className="sos-text-faint" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <MessageSquare size={13} /> 24-hour window closed? Re-open it with one tap:
      </span>
      <PrimaryButton size="sm" iconLeft={busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />} onClick={() => void handleClick()} disabled={busy}>
        {busy ? 'Sending…' : 'Send consultation reminder'}
      </PrimaryButton>
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>{empty}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead><tr>{head.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function FinanceCustomerProfilePage({ leadId }: { leadId: string }) {
  const [data, setData] = useState<FinanceCustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const payFileRef = useRef<HTMLInputElement>(null);

  // Record-payment form (Payments tab)
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [payCurrency, setPayCurrency] = useState('CAD');
  const [expCurrency, setExpCurrency] = useState('CAD');
  const [payOpen, setPayOpen] = useState(false);
  const [payFile, setPayFile] = useState<File | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('BANK');
  const [payRef, setPayRef] = useState('');
  const [payNote, setPayNote] = useState('');

  // Inline payment verification (Payments tab)
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [verifyDetail, setVerifyDetail] = useState<ApiHandover | null>(null);
  const [verifyNote, setVerifyNote] = useState('');

  // Add-expense form (Expenses tab)
  const [expOpen, setExpOpen] = useState(false);
  const [expFile, setExpFile] = useState<File | null>(null);
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('GOVERNMENT_FEE');
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expTax, setExpTax] = useState('');
  const [expBillable, setExpBillable] = useState(false);
  const expFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchFinanceCustomerProfile(leadId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { void load(); }, [load]);

  // Live FX rates (1 CAD = rates[ccy]) for the currency pickers + CAD preview.
  useEffect(() => { fetchFxRates().then((r) => setFxRates(r.rates)).catch(() => {}); }, []);

  // CAD equivalent of a typed foreign amount, or null when not convertible yet.
  const cadOf = (amountStr: string, ccy: string): number | null => {
    const n = Number(amountStr);
    if (!Number.isFinite(n) || n <= 0) return null;
    return toBaseCAD(n, ccy, fxRates);
  };

  const openUrl = async (kind: 'agreement-pdf' | 'signed') => {
    if (!data) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'agreement-pdf' && data.agreement) {
        const { url } = await getAgreementPdfUrl(data.agreement.id);
        window.open(url, '_blank', 'noopener');
      } else if (kind === 'signed' && data.contract) {
        const { url } = await getContractAgreementUrl(data.contract.id);
        window.open(url, '_blank', 'noopener');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open file');
    } finally {
      setBusy(null);
    }
  };

  const handleUpload = async (file: File) => {
    // Keyed by **agreement** id, not contract id — the ServiceContract +
    // Installments only get materialised the moment the signed copy lands
    // (per the finance team's rule: no ledger before signing).
    if (!data?.agreement) { setError('No agreement yet — Sales needs to draft one first.'); return; }
    setBusy('upload');
    setError(null);
    try {
      await uploadSignedAgreement(data.agreement.id, file);
      setNotice('Signed agreement uploaded — ledger materialised; agreement marked signed.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if (!data?.agreement) return;
    setBusy('send');
    setError(null);
    try {
      await sendAgreementToClient(data.agreement.id);
      setNotice('Agreement emailed to the client.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBusy(null);
    }
  };

  const resetPayForm = () => {
    setPayOpen(false);
    setPayFile(null);
    setPayAmount('');
    setPayCurrency('CAD');
    setPayMethod('BANK');
    setPayRef('');
    setPayNote('');
  };

  // Open the form, prefilling the amount with the next unpaid installment.
  const openPayForm = () => {
    if (!data) return;
    const nextDue = data.installments.find((i) => i.paidStatus !== 'PAID');
    setPayAmount(nextDue ? String(nextDue.amount) : '');
    setPayOpen(true);
  };

  const handleRecordPayment = async () => {
    if (!data || !payFile) { setError('Choose a receipt file first.'); return; }
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter a valid payment amount.'); return; }
    setBusy('record');
    setError(null);
    try {
      const base64 = fileToBase64(await payFile.arrayBuffer());
      await recordCustomerPayment({
        leadId: data.lead.id,
        submittedAmount: String(amount),
        currency: payCurrency,
        paymentMethod: payMethod,
        transactionRef: payRef.trim() || undefined,
        notes: payNote.trim() || undefined,
        receiptFileName: payFile.name,
        receiptMimeType: payFile.type || 'application/octet-stream',
        receiptContentBase64: base64,
      });
      resetPayForm();
      setNotice('Payment recorded. Confirm it below to verify and update the ledger.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payment');
    } finally {
      setBusy(null);
    }
  };

  // ── Inline payment verification ──────────────────────────────────────────
  const openVerify = async (id: string) => {
    setVerifyId(id);
    setVerifyDetail(null);
    setVerifyNote('');
    setError(null);
    try {
      setVerifyDetail(await fetchHandoverById(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this payment');
    }
  };
  const closeVerify = () => { setVerifyId(null); setVerifyDetail(null); setVerifyNote(''); };

  const doVerify = async () => {
    const h = verifyDetail;
    if (!h) return;
    setBusy('verify');
    setError(null);
    try {
      // Record the payment first if it hasn't been (one click does both),
      // then verify → converts the client, issues the receipt, updates ledger.
      let paymentId = h.payment?.id;
      if (h.status === 'SUBMITTED' || h.status === 'IN_REVIEW') {
        const updated = await reviewHandover(h.id, 'RECORD_PAYMENT', { financeNotes: verifyNote || undefined });
        paymentId = updated.payment?.id ?? undefined;
      }
      if (!paymentId) throw new Error('No payment row to verify — reopen the case.');
      await verifyPayment(paymentId, { verificationNote: verifyNote || undefined });
      setNotice('Payment verified — client, receipt and ledger updated.');
      closeVerify();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(null);
    }
  };

  const doReject = async () => {
    const h = verifyDetail;
    if (!h) return;
    setBusy('reject');
    setError(null);
    try {
      await reviewHandover(h.id, 'REJECT', { financeNotes: verifyNote || undefined });
      setNotice('Payment proof rejected.');
      closeVerify();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reject');
    } finally {
      setBusy(null);
    }
  };

  const resetExpForm = () => {
    setExpOpen(false);
    setExpFile(null);
    setExpCategory('GOVERNMENT_FEE');
    setExpDesc('');
    setExpAmount('');
    setExpTax('');
    setExpCurrency('CAD');
    setExpBillable(false);
  };

  // Revenue recognition (#1): mark a milestone delivered → its amount becomes
  // EARNED revenue; cash collected ahead of this is deferred (a liability).
  const handleRecognize = async (installmentId: string, recognize: boolean) => {
    setBusy('recognize');
    setError(null);
    try {
      await recognizeInstallment(installmentId, recognize);
      setNotice(recognize ? 'Milestone marked delivered — revenue recognized.' : 'Recognition reversed.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update recognition');
    } finally {
      setBusy(null);
    }
  };

  const handleReceiptDownload = async (id: string) => {
    // Open the tab SYNCHRONOUSLY in the click handler so we keep the user
    // gesture (browsers block window.open if called after an await).
    const tab = window.open('about:blank', '_blank');
    setBusy('rcpt-dl');
    setError(null);
    try {
      // Stream the PDF bytes from OUR backend (same-origin) — Supabase's
      // signed URLs carry a CSP `sandbox` header that makes Chrome's PDF
      // viewer refuse to render them inline. Same-origin bytes wrapped in
      // a blob URL render normally.
      const blob = await fetchReceiptPdfBlob(id);
      const blobUrl = URL.createObjectURL(blob);
      if (tab && !tab.closed) {
        tab.location.href = blobUrl;
      } else {
        window.location.href = blobUrl;
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      if (tab && !tab.closed) tab.close();
      setError(e instanceof Error ? e.message : 'Could not open the receipt');
    } finally {
      setBusy(null);
    }
  };

  const handleReceiptSend = async (id: string) => {
    setBusy('rcpt-send');
    setError(null);
    setNotice(null);
    try {
      const { to } = await sendReceiptToClient(id);
      setNotice(`Receipt emailed to ${to}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the receipt');
    } finally {
      setBusy(null);
    }
  };

  // Finance manually hands the file over to Processing once payment has been
  // verified. The button only fires when `sendToProcessing.ready` is true (a
  // PAYMENT_VERIFIED handover exists and no ProcessingCase has been opened
  // yet) — disabled otherwise so it visibly "turns on" the moment the payment
  // verification step completes.
  const handleSendToProcessing = async () => {
    if (!data?.sendToProcessing.handoverId) return;
    setBusy('to-processing');
    setError(null);
    setNotice(null);
    try {
      await sendCaseToProcessing({ financeHandoverId: data.sendToProcessing.handoverId });
      setNotice('Sent to Processing — the case is now in the processing queue.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hand the file over to Processing');
    } finally {
      setBusy(null);
    }
  };

  const handleAddExpense = async () => {
    if (!data) return;
    if (!expDesc.trim()) { setError('Add a short description for the expense.'); return; }
    const amount = Number(expAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter a valid expense amount.'); return; }
    setBusy('expense');
    setError(null);
    try {
      const receipt = expFile
        ? {
            receiptFileName: expFile.name,
            receiptMimeType: expFile.type || 'application/octet-stream',
            receiptContentBase64: fileToBase64(await expFile.arrayBuffer()),
          }
        : {};
      await createExpense({
        leadId: data.lead.id,
        category: expCategory,
        description: expDesc.trim(),
        amount: String(amount),
        ...(expTax && Number(expTax) > 0 ? { taxAmount: String(Number(expTax)) } : {}),
        currency: expCurrency,
        billable: expBillable,
        ...receipt,
      });
      resetExpForm();
      setNotice('Expense recorded.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record expense');
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    setBusy(`expense-del:${id}`);
    setError(null);
    try {
      await deleteExpense(id);
      setNotice('Expense removed.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove expense');
    } finally {
      setBusy(null);
    }
  };

  const openExpenseReceipt = async (id: string) => {
    setBusy(`expense-receipt:${id}`);
    setError(null);
    try {
      const { url } = await getExpenseReceiptUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open receipt');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center' }}>Loading customer…</div>;
  if (!data) return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error ?? 'Not found'}</div>;

  const { lead, agreement, contract, totals } = data;
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  const agent = lead.assignedEmployee ? `${lead.assignedEmployee.firstName ?? ''} ${lead.assignedEmployee.lastName ?? ''}`.trim() : '—';
  const reviewable = agreement && ['SUBMITTED', 'FINANCE_REVIEW', 'CHANGES_REQUESTED'].includes(agreement.status);

  const idTile = (k: string, v: ReactNode) => (
    <div>
      <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
      <div style={{ color: 'var(--sos-text-secondary)', fontSize: 13.5 }}>{v || '—'}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow={`Customer · ${lead.referenceCode}`}
        title={name}
        description={`${labelForServiceCode(lead.serviceInterest)} · ${lead.targetCountry ?? 'Country —'}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusBadge tone={tone(lead.status)} dot>{label(lead.status)}</StatusBadge>
            {data.processingCase ? (
              <StatusBadge tone="violet" dot>In processing · {label(data.processingCase.stage)}</StatusBadge>
            ) : null}
            {/* "Send to Processing" — the manual handover finance triggers
                once payment has been verified. Stays disabled (greyed)
                until `ready` flips to true; disappears once the file is
                already in Processing (the badge above takes over). */}
            {data.sendToProcessing.alreadySent ? null : (
              <span title={data.sendToProcessing.reason ?? 'Send this file to Processing'}>
                <PrimaryButton
                  size="sm"
                  iconLeft={busy === 'to-processing' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                  onClick={() => void handleSendToProcessing()}
                  disabled={!data.sendToProcessing.ready || busy !== null}
                >
                  {busy === 'to-processing' ? 'Sending…' : 'Send to Processing'}
                </PrimaryButton>
              </span>
            )}
          </span>
        }
      />

      {error ? <div className="sos-banner sos-banner--danger" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={16} /> {error}</div> : null}
      {notice && !error ? <div className="sos-banner sos-banner--success" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><CheckCircle2 size={16} /> {notice}</div> : null}

      {/* Money strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <MetricCard label="Total fee" value={money(totals.fee, totals.currency)} tone="accent" Icon={Wallet} />
        <MetricCard label="Paid" value={money(totals.paid, totals.currency)} tone="success" Icon={CheckCircle2} hint={totals.installmentsTotal > 0 ? `${totals.installmentsPaid} of ${totals.installmentsTotal} installments paid` : `${data.receipts.length} receipt(s)`} />
        <MetricCard label="Outstanding" value={money(totals.outstanding, totals.currency)} tone={totals.outstanding > 0 ? 'warning' : 'success'} Icon={AlertTriangle} />
        <MetricCard label="Spent on client" value={money(totals.expenses, totals.currency)} tone={totals.expenses > 0 ? 'warning' : 'neutral'} Icon={Coins} hint={totals.billableExpenses > 0 ? `${money(totals.absorbedExpenses, totals.currency)} absorbed · ${money(totals.billableExpenses, totals.currency)} billable` : `${data.expenses.length} expense(s)`} />
        <MetricCard label="Margin" value={money(totals.margin, totals.currency)} tone={totals.margin >= 0 ? 'success' : 'danger'} Icon={TrendingUp} hint="fee − absorbed costs" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--sos-border-subtle)' }}>
        {TABS.map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5,
              fontWeight: tab === k ? 700 : 500,
              color: tab === k ? 'var(--sos-text-primary)' : 'var(--sos-text-faint)',
              borderBottom: `2px solid ${tab === k ? 'var(--sos-brand-primary)' : 'transparent'}`,
            }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' ? (
        <GlassCard variant="default">
          <h3 className="sos-title" style={{ marginTop: 0, fontSize: 'var(--sos-text-base)' }}>Bio</h3>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            {idTile('Reference', lead.referenceCode)}
            {idTile('Phone', lead.phone)}
            {idTile('Email', lead.email)}
            {idTile('Nationality', lead.nationality)}
            {idTile('Target country', lead.targetCountry)}
            {idTile('Service', labelForServiceCode(lead.serviceInterest))}
            {idTile('Source', lead.sourceChannel)}
            {idTile('Assigned agent', agent)}
            {idTile('Lead since', fmtDate(lead.createdAt))}
            {idTile('Stage', label(lead.status))}
            {data.processingCase ? idTile('Processing', `${label(data.processingCase.stage)} · ${data.processingCase.service}`) : null}
          </div>
        </GlassCard>
      ) : null}

      {/* AGREEMENT */}
      {tab === 'agreement' ? (
        <GlassCard variant="default">
          {!agreement ? (
            <div className="sos-text-muted" style={{ padding: 16, textAlign: 'center' }}>No agreement for this customer yet.</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--sos-text-primary)' }}>{agreement.agreementNumber}</div>
                  <div className="sos-text-faint" style={{ fontSize: 12, marginTop: 2 }}>{money(agreement.totalAmount, agreement.currency)} net</div>
                  {agreement.sentAt ? <div className="sos-text-faint" style={{ fontSize: 11, marginTop: 2 }}>Sent to client {fmtDate(agreement.sentAt)}</div> : null}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <StatusBadge tone={tone(agreement.status)} dot>{label(agreement.status)}</StatusBadge>
                  {reviewable ? (
                    <ButtonLink href={`/finance/agreements/${agreement.id}` as Route} variant="primary" size="sm" iconLeft={<FileText size={14} />}>Review &amp; approve</ButtonLink>
                  ) : null}
                  {agreement.hasPdf ? (
                    <SecondaryButton size="sm" iconLeft={busy === 'agreement-pdf' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />} onClick={() => void openUrl('agreement-pdf')} disabled={busy !== null}>Final PDF</SecondaryButton>
                  ) : null}
                  {agreement.status === 'APPROVED' || agreement.status === 'SENT' ? (
                    <PrimaryButton size="sm" iconLeft={busy === 'send' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />} onClick={() => void handleSend()} disabled={busy !== null}>
                      {busy === 'send' ? 'Sending…' : agreement.status === 'SENT' ? 'Resend to client' : 'Send to client'}
                    </PrimaryButton>
                  ) : null}
                </div>
              </div>

              {/* Signed agreement */}
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--sos-border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <FileSignature size={16} className="sos-text-faint" />
                  <h4 className="sos-title" style={{ margin: 0, fontSize: 14 }}>Signed agreement</h4>
                </div>
                {contract?.hasSignedAgreement ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <StatusBadge tone="success" size="sm" dot={false}>Signed on file</StatusBadge>
                    <span className="sos-text-faint" style={{ fontSize: 12 }}>{contract.agreementFileName}</span>
                    <SecondaryButton size="sm" iconLeft={<Download size={14} />} onClick={() => void openUrl('signed')} disabled={busy !== null}>Download signed</SecondaryButton>
                    <PrimaryButton size="sm" iconLeft={<Upload size={14} />} onClick={() => fileRef.current?.click()} disabled={busy !== null}>Replace</PrimaryButton>
                  </div>
                ) : ['APPROVED', 'SENT', 'SIGNED'].includes(agreement.status) ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span className="sos-text-muted" style={{ fontSize: 13 }}>No signed copy yet. Uploading it creates the ledger and marks the agreement signed.</span>
                    <PrimaryButton size="sm" iconLeft={busy === 'upload' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />} onClick={() => fileRef.current?.click()} disabled={busy !== null}>{busy === 'upload' ? 'Uploading…' : 'Upload signed agreement'}</PrimaryButton>
                  </div>
                ) : (
                  <div className="sos-text-muted" style={{ fontSize: 13 }}>Available once Finance approves the agreement.</div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }}
                />
              </div>
            </>
          )}
        </GlassCard>
      ) : null}

      {/* LEDGER */}
      {tab === 'ledger' ? (
        <GlassCard variant="default" padded={false}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={15} className="sos-text-faint" />
            <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>
              Installment ledger {contract ? `· ${contract.contractNumber}` : ''}
              {totals.installmentsTotal > 0 ? <span className="sos-text-faint" style={{ fontWeight: 400 }}> · paid {totals.installmentsPaid}/{totals.installmentsTotal}</span> : null}
            </h3>
          </div>
          <Table
            head={['#', 'Stage', 'Amount', 'Paid', 'Due', 'Status', 'Revenue']}
            empty={
              contract
                ? 'No installments.'
                : agreement
                  ? 'Awaiting client signature — the ledger materialises once the signed agreement is uploaded.'
                  : 'No agreement yet.'
            }
            rows={data.installments.map((i) => [
              i.sequence,
              i.description ?? '—',
              money(i.amount, totals.currency),
              money(i.paidAmount, totals.currency),
              fmtDate(i.dueDate),
              <StatusBadge key="s" tone={tone(i.paidStatus)} size="sm" dot={false}>{label(i.paidStatus)}</StatusBadge>,
              i.recognizedAt ? (
                <SecondaryButton key="r" size="sm" onClick={() => void handleRecognize(i.id, false)} disabled={busy !== null}>
                  Earned ✓
                </SecondaryButton>
              ) : (
                <SecondaryButton key="r" size="sm" onClick={() => void handleRecognize(i.id, true)} disabled={busy !== null}>
                  Mark delivered
                </SecondaryButton>
              ),
            ])}
          />
        </GlassCard>
      ) : null}

      {/* INVOICES */}
      {tab === 'invoices' ? (
        <GlassCard variant="default" padded={false}>
          <Table
            head={['Invoice', 'Total', 'Paid', 'Status', 'Created']}
            empty="No invoices yet."
            rows={data.invoices.map((i) => [<span key="n" style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{i.invoiceNumber}</span>, money(i.totalAmount, i.currency), money(i.paidAmount, i.currency), <StatusBadge key="s" tone={tone(i.status)} size="sm" dot={false}>{label(i.status)}</StatusBadge>, fmtDate(i.createdAt)])}
          />
        </GlassCard>
      ) : null}

      {/* PAYMENTS */}
      {tab === 'payments' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Record payment */}
          <GlassCard variant="default">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Upload size={16} className="sos-text-faint" />
                <div>
                  <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Record a payment</h3>
                  <div className="sos-text-faint" style={{ fontSize: 12, marginTop: 2 }}>
                    Upload the client&apos;s receipt + amount. It lands in the queue below to confirm.
                  </div>
                </div>
              </div>
              {payOpen ? (
                <GhostButton size="sm" onClick={resetPayForm} disabled={busy !== null}>Cancel</GhostButton>
              ) : (
                <PrimaryButton size="sm" iconLeft={<Upload size={14} />} onClick={openPayForm}>Record payment</PrimaryButton>
              )}
            </div>
            {payOpen ? (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--sos-border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                  <FormInput
                    label="Amount"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    hint={totals.installmentsTotal > 0 ? `Next due prefilled · paid ${totals.installmentsPaid}/${totals.installmentsTotal}` : 'Amount received (as on the bank slip)'}
                    required
                  />
                  <FormSelect
                    label="Currency received"
                    value={payCurrency}
                    onChange={(e) => setPayCurrency(e.target.value)}
                    options={CURRENCY_OPTIONS}
                  />
                  <FormSelect
                    label="Method"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    options={PAYMENT_METHODS}
                  />
                  <FormInput
                    label="Reference (optional)"
                    placeholder="Txn / cheque no."
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                  />
                  <FormInput
                    label="Note (optional)"
                    placeholder="Anything Finance should know"
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                  />
                </div>
                {payCurrency !== 'CAD' && cadOf(payAmount, payCurrency) != null ? (
                  <div className="sos-banner sos-banner--info" style={{ fontSize: 12.5 }}>
                    ≈ <strong>CAD {cadOf(payAmount, payCurrency)!.toLocaleString()}</strong>
                    {fxRates[payCurrency] ? ` · live rate 1 CAD = ${fxRates[payCurrency].toLocaleString()} ${payCurrency}` : ''} — booked to the ledger in CAD.
                  </div>
                ) : null}
                <div>
                  <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Receipt</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <SecondaryButton size="sm" iconLeft={<FileText size={14} />} onClick={() => payFileRef.current?.click()} disabled={busy !== null}>
                      {payFile ? 'Change file' : 'Choose receipt'}
                    </SecondaryButton>
                    <span className="sos-text-muted" style={{ fontSize: 13 }}>{payFile ? payFile.name : 'PDF or image of the proof of payment'}</span>
                    <input
                      ref={payFileRef}
                      type="file"
                      accept="application/pdf,image/png,image/jpeg,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) setPayFile(f); }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <PrimaryButton
                    size="sm"
                    iconLeft={busy === 'record' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />}
                    onClick={() => void handleRecordPayment()}
                    disabled={busy !== null || !payFile || !payAmount}
                  >
                    {busy === 'record' ? 'Recording…' : 'Record payment'}
                  </PrimaryButton>
                </div>
              </div>
            ) : null}
          </GlassCard>

          {/* Inline verification — review the receipt + confirm the money,
              right here on the customer's profile. */}
          {verifyId ? (
            <GlassCard variant="default">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Verify payment</h3>
                <GhostButton size="sm" onClick={closeVerify} disabled={busy !== null}>Cancel</GhostButton>
              </div>
              {!verifyDetail ? (
                <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>Loading receipt…</div>
              ) : (
                <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
                  {/* Receipt viewer */}
                  <div>
                    <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Receipt · {verifyDetail.receiptFileName}</div>
                    {verifyDetail.receiptDownloadUrl && (verifyDetail.receiptMimeType ?? '').startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={verifyDetail.receiptDownloadUrl} alt={`Receipt — ${verifyDetail.receiptFileName}`} style={{ width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-bg-glass-subtle)' }} />
                    ) : verifyDetail.receiptDownloadUrl && verifyDetail.receiptMimeType === 'application/pdf' ? (
                      <iframe src={verifyDetail.receiptDownloadUrl} title="Receipt" style={{ width: '100%', height: 420, border: '1px solid var(--sos-border-subtle)', borderRadius: 8, background: '#fff' }} />
                    ) : verifyDetail.receiptDownloadUrl ? (
                      <a href={verifyDetail.receiptDownloadUrl} target="_blank" rel="noreferrer" className="sos-text-link" style={{ fontSize: 13 }}>Download receipt</a>
                    ) : (
                      <div className="sos-text-muted" style={{ fontSize: 13 }}>No receipt file.</div>
                    )}
                  </div>
                  {/* Details + actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {idTile('Amount', money(Number(verifyDetail.submittedAmount), verifyDetail.currency))}
                    {idTile('Method', verifyDetail.paymentMethod ?? '—')}
                    {idTile('Submitted', fmtDate(verifyDetail.submittedAt))}
                    {verifyDetail.notes ? idTile('Note', verifyDetail.notes) : null}
                    <div>
                      <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Finance note (optional)</div>
                      <textarea value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} rows={2} placeholder="Anything to record with this verification" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--sos-border)', background: 'var(--sos-input-bg)', color: 'var(--sos-text-primary)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--sos-text-faint)', lineHeight: 1.5 }}>⚖︎ Large payments must be verified by a different officer than the one who recorded them.</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <PrimaryButton size="sm" iconLeft={busy === 'verify' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={14} />} onClick={() => void doVerify()} disabled={busy !== null}>
                        {busy === 'verify' ? 'Verifying…' : 'Verify payment'}
                      </PrimaryButton>
                      <SecondaryButton size="sm" onClick={() => void doReject()} disabled={busy !== null}>{busy === 'reject' ? 'Rejecting…' : 'Reject'}</SecondaryButton>
                    </div>
                  </div>
                </div>
              )}
            </GlassCard>
          ) : null}

          <GlassCard variant="default" padded={false}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Wallet size={15} className="sos-text-faint" />
              <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Payment submissions</h3>
              <span className="sos-text-faint" style={{ fontSize: 12 }}>· awaiting / past verification</span>
            </div>
            <Table
              head={['Amount', 'Receipt', 'Status', 'Submitted', '']}
              empty="No payment recorded yet. When the client pays, record the receipt above, then verify it here."
              rows={data.handovers.map((h) => {
                const done = ['PAYMENT_VERIFIED', 'SENT_TO_PROCESSING'].includes(h.status);
                const action = done
                  ? <StatusBadge key="a" tone="success" size="sm" dot={false}>Verified</StatusBadge>
                  : h.status === 'REJECTED'
                    ? <StatusBadge key="a" tone="danger" size="sm" dot={false}>Rejected</StatusBadge>
                    : h.status === 'CANCELLED'
                      ? <span key="a" className="sos-text-faint">—</span>
                      : <PrimaryButton key="a" size="sm" onClick={() => void openVerify(h.id)} disabled={busy !== null}>Review &amp; verify</PrimaryButton>;
                return [
                  money(h.amount, h.currency),
                  h.receiptFileName ?? '—',
                  <StatusBadge key="s" tone={tone(h.status)} size="sm" dot={false}>{label(h.status)}</StatusBadge>,
                  fmtDate(h.submittedAt),
                  action,
                ];
              })}
            />
          </GlassCard>
          <GlassCard variant="default" padded={false}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
              <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Verified payments</h3>
            </div>
            <Table
              head={['Amount', 'Method', 'Status', 'Paid', 'Verified']}
              empty="No verified payments yet."
              rows={data.payments.map((p) => [money(p.amount, p.currency), p.paymentMethod ?? '—', <StatusBadge key="s" tone={tone(p.status)} size="sm" dot={false}>{label(p.status)}</StatusBadge>, fmtDate(p.paidAt), fmtDate(p.verifiedAt)])}
            />
          </GlassCard>
        </div>
      ) : null}

      {/* EXPENSES */}
      {tab === 'expenses' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Add expense */}
          <GlassCard variant="default">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Coins size={16} className="sos-text-faint" />
                <div>
                  <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Record an expense</h3>
                  <div className="sos-text-faint" style={{ fontSize: 12, marginTop: 2 }}>
                    Costs paid on the client&apos;s behalf — government fees, medical, courier, etc.
                  </div>
                </div>
              </div>
              {expOpen ? (
                <GhostButton size="sm" onClick={resetExpForm} disabled={busy !== null}>Cancel</GhostButton>
              ) : (
                <PrimaryButton size="sm" iconLeft={<Coins size={14} />} onClick={() => setExpOpen(true)}>Add expense</PrimaryButton>
              )}
            </div>
            {expOpen ? (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--sos-border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                  <FormSelect
                    label="Category"
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
                    options={EXPENSE_CATEGORIES}
                  />
                  <FormInput
                    label="Amount"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    hint="Amount spent"
                    required
                  />
                  <FormSelect
                    label="Currency"
                    value={expCurrency}
                    onChange={(e) => setExpCurrency(e.target.value)}
                    options={CURRENCY_OPTIONS}
                  />
                  <FormInput
                    label="Input tax (optional)"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={expTax}
                    onChange={(e) => setExpTax(e.target.value)}
                    hint="recoverable GST/HST (ITC)"
                  />
                  <FormInput
                    label="Description"
                    placeholder="What was this for?"
                    value={expDesc}
                    onChange={(e) => setExpDesc(e.target.value)}
                    required
                  />
                </div>
                {expCurrency !== 'CAD' && cadOf(expAmount, expCurrency) != null ? (
                  <div className="sos-banner sos-banner--info" style={{ fontSize: 12.5 }}>
                    ≈ <strong>CAD {cadOf(expAmount, expCurrency)!.toLocaleString()}</strong>
                    {fxRates[expCurrency] ? ` · live rate 1 CAD = ${fxRates[expCurrency].toLocaleString()} ${expCurrency}` : ''} — recorded in CAD.
                  </div>
                ) : null}
                <div>
                  <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Receipt (optional)</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <SecondaryButton size="sm" iconLeft={<FileText size={14} />} onClick={() => expFileRef.current?.click()} disabled={busy !== null}>
                      {expFile ? 'Change file' : 'Attach receipt'}
                    </SecondaryButton>
                    <span className="sos-text-muted" style={{ fontSize: 13 }}>{expFile ? expFile.name : 'PDF or image of the proof of spend'}</span>
                    <input
                      ref={expFileRef}
                      type="file"
                      accept="application/pdf,image/png,image/jpeg,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) setExpFile(f); }}
                    />
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sos-text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={expBillable} onChange={(e) => setExpBillable(e.target.checked)} />
                  Billable to client — client reimburses this (recoverable; doesn&apos;t reduce margin)
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <PrimaryButton
                    size="sm"
                    iconLeft={busy === 'expense' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Coins size={14} />}
                    onClick={() => void handleAddExpense()}
                    disabled={busy !== null || !expDesc || !expAmount}
                  >
                    {busy === 'expense' ? 'Saving…' : 'Save expense'}
                  </PrimaryButton>
                </div>
              </div>
            ) : null}
          </GlassCard>

          <GlassCard variant="default" padded={false}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Coins size={15} className="sos-text-faint" />
              <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>
                Expense ledger
                {totals.expenses > 0 ? <span className="sos-text-faint" style={{ fontWeight: 400 }}> · {money(totals.expenses, totals.currency)} total</span> : null}
              </h3>
            </div>
            <Table
              head={['Date', 'Category', 'Description', 'Amount', 'Receipt', '']}
              empty="No expenses recorded for this client yet."
              rows={data.expenses.map((e) => [
                fmtDate(e.incurredAt),
                <span key="c" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <StatusBadge tone="neutral" size="sm" dot={false}>{expenseCatLabel(e.category)}</StatusBadge>
                  {e.billable ? <StatusBadge tone="info" size="sm" dot={false}>billable</StatusBadge> : null}
                </span>,
                e.description,
                money(e.amount, e.currency),
                e.hasReceipt ? (
                  <SecondaryButton key="r" size="sm" iconLeft={busy === `expense-receipt:${e.id}` ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />} onClick={() => void openExpenseReceipt(e.id)} disabled={busy !== null}>Receipt</SecondaryButton>
                ) : <span className="sos-text-faint" style={{ fontSize: 12 }}>—</span>,
                <GhostButton key="d" size="sm" iconLeft={busy === `expense-del:${e.id}` ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />} onClick={() => void handleDeleteExpense(e.id)} disabled={busy !== null}>Remove</GhostButton>,
              ])}
            />
          </GlassCard>
        </div>
      ) : null}

      {/* RECEIPTS */}
      {tab === 'receipts' ? (
        <GlassCard variant="default" padded={false}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ReceiptIcon size={15} className="sos-text-faint" />
            <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Receipts issued</h3>
          </div>
          <Table
            head={['Receipt', 'Amount', 'Issued', '']}
            empty="No receipts issued yet."
            rows={data.receipts.map((r) => [
              <span key="n" style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{r.receiptNumber}</span>,
              money(r.amount, r.currency),
              fmtDate(r.issuedAt),
              <div key="a" style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end', width: '100%' }}>
                <SecondaryButton size="sm" iconLeft={<Download size={13} />} onClick={() => void handleReceiptDownload(r.id)} disabled={busy !== null}>
                  PDF
                </SecondaryButton>
                <SecondaryButton size="sm" iconLeft={busy === 'rcpt-send' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />} onClick={() => void handleReceiptSend(r.id)} disabled={busy !== null}>
                  Send to client
                </SecondaryButton>
              </div>,
            ])}
          />
        </GlassCard>
      ) : null}

      {/* WHATSAPP — closed-loop client comms right next to the ledger so
          finance can verify a payment, share the receipt PDF and pick up
          the client's "got it, thanks" reply without leaving the page. */}
      {tab === 'whatsapp' ? (
        <div style={{ minHeight: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <MessageSquare size={16} className="sos-text-faint" />
            <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>
              WhatsApp conversation
            </h3>
            <span className="sos-text-faint" style={{ fontSize: 12 }}>
              · share the agreement / receipt, pick up replies
            </span>
          </div>
          <WhatsAppLeadTab
            leadId={lead.id}
            leadPhone={lead.phone ?? null}
            renderHeaderActions={(threadId) => (
              <ConsultationReminderButton
                threadId={threadId}
                clientFirstName={lead.firstName}
                onSent={() => setNotice('Consultation reminder sent — waiting for the client to reply to open the 24-hour chat window.')}
                onError={(msg) => setError(msg)}
              />
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
