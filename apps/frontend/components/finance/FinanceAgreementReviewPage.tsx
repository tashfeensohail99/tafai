'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  ThumbsUp,
  Undo2,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  PrimaryButton,
  SecondaryButton,
  GhostButton,
  ButtonLink,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  approveAgreement,
  getAgreement,
  getAgreementPdfUrl,
  previewAgreementPdf,
  requestAgreementChanges,
  type AgreementDetail,
  type AgreementStatus,
  type PaymentPlanInput,
} from '@/lib/agreements';

const STATUS_TONE: Record<AgreementStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  FINANCE_REVIEW: 'info',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  EDITED_PENDING_SALES: 'warning',
  SENT: 'info',
  SIGNED: 'success',
  CANCELLED: 'neutral',
};

const ACTIONABLE: AgreementStatus[] = ['SUBMITTED', 'FINANCE_REVIEW'];

export function FinanceAgreementReviewPage({ agreementId }: { agreementId: string }) {
  const [data, setData] = useState<AgreementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getAgreement(agreementId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [agreementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePreview = async () => {
    setBusy('preview');
    setError(null);
    try {
      const blob = await previewAgreementPdf(agreementId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    setBusy('download');
    setError(null);
    try {
      const { url } = await getAgreementPdfUrl(agreementId);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  };

  const handleApprove = async () => {
    if (!window.confirm('Approve this agreement? This locks the payment plan and creates the service contract + installment ledger.')) return;
    setBusy('approve');
    setError(null);
    try {
      await approveAgreement(agreementId);
      setNotice('Approved — contract + ledger created.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed');
    } finally {
      setBusy(null);
    }
  };

  const handleRequestChanges = async () => {
    if (!note.trim()) { setError('Add a note describing the changes needed.'); return; }
    setBusy('changes');
    setError(null);
    try {
      await requestAgreementChanges(agreementId, note.trim());
      setNotice('Sent back to Sales.');
      setShowNote(false);
      setNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="sos-text-muted" style={{ padding: 32, textAlign: 'center' }}>Loading…</div>;
  if (!data) return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error ?? 'Not found'}</div>;

  const plan = (data.paymentPlan ?? {}) as Partial<PaymentPlanInput>;
  const actionable = ACTIONABLE.includes(data.status);
  const hasPdf = ['APPROVED', 'SENT', 'SIGNED'].includes(data.status);
  const money = (n: number | undefined) =>
    (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow={`Agreement · ${data.agreementNumber}`}
        title={data.template?.programTitle ?? data.categoryKey}
        description={data.lead ? `${data.lead.firstName} ${data.lead.lastName} · ${data.lead.referenceCode}` : undefined}
      />

      <GlassCard variant="default">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <StatusBadge tone={STATUS_TONE[data.status]} dot>{data.status.replace(/_/g, ' ').toLowerCase()}</StatusBadge>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ButtonLink href="/finance/agreements" variant="ghost" size="sm">Back</ButtonLink>
            <SecondaryButton size="sm" iconLeft={<Eye size={15} />} onClick={handlePreview} disabled={busy !== null}>
              {busy === 'preview' ? 'Rendering…' : 'Preview'}
            </SecondaryButton>
            {hasPdf ? (
              <SecondaryButton size="sm" iconLeft={<Download size={15} />} onClick={handleDownload} disabled={busy !== null}>
                {busy === 'download' ? '…' : 'Final PDF'}
              </SecondaryButton>
            ) : null}
            {actionable ? (
              <>
                <GhostButton size="sm" iconLeft={<Undo2 size={15} />} onClick={() => setShowNote((v) => !v)} disabled={busy !== null}>
                  Request changes
                </GhostButton>
                <PrimaryButton size="sm" iconLeft={<ThumbsUp size={15} />} onClick={handleApprove} disabled={busy !== null}>
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </PrimaryButton>
              </>
            ) : null}
          </div>
        </div>

        {showNote && actionable ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <textarea className="sos-textarea" placeholder="What needs to change?" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minHeight: 60 }} />
            <PrimaryButton size="sm" onClick={handleRequestChanges} disabled={busy !== null}>Send back</PrimaryButton>
          </div>
        ) : null}

        {error ? <div className="sos-banner sos-banner--danger" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={16} /> {error}</div> : null}
        {notice && !error ? <div className="sos-banner sos-banner--success" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}><CheckCircle2 size={16} /> {notice}</div> : null}
        {data.financeNotes ? <div className="sos-banner sos-banner--warning" style={{ marginTop: 12 }}>Finance note: {data.financeNotes}</div> : null}
      </GlassCard>

      {/* Applicant */}
      <GlassCard variant="default">
        <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', marginTop: 0 }}>Applicant</h2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', fontSize: 13 }}>
          {([
            ['Name', data.bioData?.applicantName],
            ['Father', data.bioData?.fatherName],
            ['CNIC', data.bioData?.cnic],
            ['Passport', data.bioData?.passport],
            ['Nationality', data.bioData?.nationality],
            ['Phone', data.bioData?.phone],
            ['Email', data.bioData?.email],
            ['File #', data.bioData?.fileNumber],
          ] as Array<[string, string | undefined]>).map(([k, v]) => (
            <div key={k}>
              <div className="sos-text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
              <div style={{ color: 'var(--sos-text-secondary)' }}>{v || '—'}</div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Payment plan */}
      <GlassCard variant="default">
        <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', marginTop: 0 }}>Payment plan</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
          <div><span className="sos-text-faint">Type: </span>{plan.planType ?? '—'}</div>
          <div><span className="sos-text-faint">Gross: </span>{plan.currency} {money(plan.grossAmount)}</div>
          <div><span className="sos-text-faint">Discount: </span>{plan.currency} {money(plan.discountAmount)}</div>
          <div style={{ fontWeight: 700 }}><span className="sos-text-faint" style={{ fontWeight: 400 }}>Net payable: </span>{plan.currency} {money(plan.netPayable)}</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 480 }}>
            <thead>
              <tr>
                {['#', 'Stage', 'Amount', 'Trigger / due'].map((c) => (
                  <th key={c} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--sos-text-faint)', borderBottom: '1px solid var(--sos-border-subtle)' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(plan.installments ?? []).map((i, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--sos-border-subtle)' }}>
                  <td style={{ padding: '8px 12px' }}>{i.sequence ?? idx + 1}</td>
                  <td style={{ padding: '8px 12px' }}>{i.stage}</td>
                  <td style={{ padding: '8px 12px' }}>{plan.currency} {money(i.amount)}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--sos-text-faint)' }}>{i.trigger || (i.dueDate ? new Date(i.dueDate).toLocaleDateString('en-GB') : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.salesNotes ? <div className="sos-text-muted" style={{ marginTop: 12, fontSize: 12.5 }}>Sales notes: {data.salesNotes}</div> : null}
      </GlassCard>

      {/* History */}
      {data.events.length > 0 ? (
        <GlassCard variant="default" padded={false}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
            <h3 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>History</h3>
          </div>
          {data.events.map((ev) => (
            <div key={ev.id} style={{ padding: '10px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--sos-text-secondary)' }}>
                <strong style={{ fontFamily: 'monospace', fontSize: 11, marginRight: 8 }}>{ev.type}</strong>{ev.summary}
              </span>
              <span className="sos-text-faint" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(ev.createdAt).toLocaleString('en-GB')}</span>
            </div>
          ))}
        </GlassCard>
      ) : null}
    </div>
  );
}
