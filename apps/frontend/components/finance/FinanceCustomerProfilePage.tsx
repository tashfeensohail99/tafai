'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Route } from 'next';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSignature,
  FileText,
  Loader2,
  Receipt as ReceiptIcon,
  Send,
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
  fetchFinanceCustomerProfile,
  getContractAgreementUrl,
  recordCustomerPayment,
  uploadSignedAgreement,
  type FinanceCustomerProfile,
} from '@/lib/finance-profile';
import { getAgreementPdfUrl, sendAgreementToClient } from '@/lib/agreements';

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

type TabKey = 'overview' | 'agreement' | 'ledger' | 'invoices' | 'payments' | 'receipts';
const TABS: Array<[TabKey, string]> = [
  ['overview', 'Overview'],
  ['agreement', 'Agreement'],
  ['ledger', 'Ledger'],
  ['invoices', 'Invoices'],
  ['payments', 'Payments'],
  ['receipts', 'Receipts'],
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
  const [payOpen, setPayOpen] = useState(false);
  const [payFile, setPayFile] = useState<File | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('BANK');
  const [payRef, setPayRef] = useState('');
  const [payNote, setPayNote] = useState('');

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
    if (!data?.contract) { setError('No contract yet — approve the agreement first.'); return; }
    setBusy('upload');
    setError(null);
    try {
      await uploadSignedAgreement(data.contract.id, file);
      setNotice('Signed agreement uploaded — marked as signed.');
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
        currency: data.totals.currency,
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
        description={`${lead.serviceInterest ?? 'Service —'} · ${lead.targetCountry ?? 'Country —'}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge tone={tone(lead.status)} dot>{label(lead.status)}</StatusBadge>
            {data.processingCase ? (
              <StatusBadge tone="violet" dot>In processing · {label(data.processingCase.stage)}</StatusBadge>
            ) : null}
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
            {idTile('Service', lead.serviceInterest)}
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
                ) : contract ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span className="sos-text-muted" style={{ fontSize: 13 }}>No signed copy yet. Upload the client&apos;s signed agreement to mark it signed.</span>
                    <PrimaryButton size="sm" iconLeft={busy === 'upload' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />} onClick={() => fileRef.current?.click()} disabled={busy !== null}>{busy === 'upload' ? 'Uploading…' : 'Upload signed agreement'}</PrimaryButton>
                  </div>
                ) : (
                  <div className="sos-text-muted" style={{ fontSize: 13 }}>Available once the agreement is approved (a contract is created).</div>
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
            head={['#', 'Stage', 'Amount', 'Paid', 'Due', 'Status']}
            empty={contract ? 'No installments.' : 'No service contract yet (created on approval).'}
            rows={data.installments.map((i) => [i.sequence, i.description ?? '—', money(i.amount, totals.currency), money(i.paidAmount, totals.currency), fmtDate(i.dueDate), <StatusBadge key="s" tone={tone(i.paidStatus)} size="sm" dot={false}>{label(i.paidStatus)}</StatusBadge>])}
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
                    hint={totals.installmentsTotal > 0 ? `Next due prefilled · paid ${totals.installmentsPaid}/${totals.installmentsTotal}` : `Currency ${totals.currency}`}
                    required
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

          <GlassCard variant="default" padded={false}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Wallet size={15} className="sos-text-faint" />
              <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Payment submissions</h3>
              <span className="sos-text-faint" style={{ fontSize: 12 }}>· receipts awaiting / past verification</span>
            </div>
            <Table
              head={['Amount', 'Receipt', 'Status', 'Submitted', '']}
              empty="No payment proof submitted yet. When the client pays, the receipt is recorded here for Finance to confirm."
              rows={data.handovers.map((h) => [
                money(h.amount, h.currency),
                h.receiptFileName ?? '—',
                <StatusBadge key="s" tone={tone(h.status)} size="sm" dot={false}>{label(h.status)}</StatusBadge>,
                fmtDate(h.submittedAt),
                <ButtonLink key="a" href={`/finance/intake/${h.id}` as Route} variant={h.verified ? 'ghost' : 'primary'} size="sm">{h.verified ? 'Open' : 'Confirm →'}</ButtonLink>,
              ])}
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

      {/* RECEIPTS */}
      {tab === 'receipts' ? (
        <GlassCard variant="default" padded={false}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ReceiptIcon size={15} className="sos-text-faint" />
            <h3 className="sos-title" style={{ margin: 0, fontSize: 'var(--sos-text-base)' }}>Receipts issued</h3>
          </div>
          <Table
            head={['Receipt', 'Amount', 'Issued']}
            empty="No receipts issued yet."
            rows={data.receipts.map((r) => [<span key="n" style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{r.receiptNumber}</span>, money(r.amount, r.currency), fmtDate(r.issuedAt)])}
          />
        </GlassCard>
      ) : null}
    </div>
  );
}
