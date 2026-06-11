'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  FileText,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  FormInput,
  FormSelect,
  PrimaryButton,
  SecondaryButton,
  GhostButton,
  ButtonLink,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  AGREEMENT_CURRENCIES,
  composeAgreementDocument,
  composeAgreementTitle,
  getAgreement,
  previewAgreementPdf,
  submitAgreement,
  updateAgreement,
  type AgreementDetail,
  type AgreementStatus,
  type BioDataInput,
  type PaymentInstallmentInput,
  type PaymentPlanInput,
  type PaymentPlanType,
} from '@/lib/agreements';

const EDITABLE: AgreementStatus[] = ['DRAFT', 'CHANGES_REQUESTED', 'EDITED_PENDING_SALES'];

const STATUS_TONE: Record<AgreementStatus, BadgeTone> = {
  DRAFT: 'neutral', SUBMITTED: 'info', FINANCE_REVIEW: 'info', CHANGES_REQUESTED: 'warning',
  APPROVED: 'success', EDITED_PENDING_SALES: 'warning', SENT: 'info', SIGNED: 'success', CANCELLED: 'neutral',
};

// Lifecycle stepper stages + which statuses map to each.
const STEPS = ['Draft', 'Finance review', 'Approved', 'Sent', 'Signed'] as const;
function stepIndex(s: AgreementStatus): number {
  if (s === 'SUBMITTED' || s === 'FINANCE_REVIEW') return 1;
  if (s === 'APPROVED') return 2;
  if (s === 'SENT') return 3;
  if (s === 'SIGNED') return 4;
  return 0; // DRAFT / CHANGES_REQUESTED / EDITED_PENDING_SALES / CANCELLED
}

interface Row { stage: string; amount: string; trigger: string; dueDate: string; notes: string; }
const num = (s: string): number => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };
const cents = (n: number) => Math.round(n * 100);
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function AgreementEditorPage({ agreementId }: { agreementId: string }) {
  const [data, setData] = useState<AgreementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'preview' | 'submit' | null>(null);
  const [dirty, setDirty] = useState(false);

  // form state
  const [bio, setBio] = useState<BioDataInput>({ applicantName: '' });
  const [planType, setPlanType] = useState<PaymentPlanType>('INSTALLMENT');
  const [currency, setCurrency] = useState('CAD');
  const [gross, setGross] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [rows, setRows] = useState<Row[]>([]);
  const [salesNotes, setSalesNotes] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // document edit mode
  const [manual, setManual] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);
  const [docKey, setDocKey] = useState(0);
  const [manualHtml, setManualHtml] = useState('');

  const load = useCallback(async () => {
    try {
      const a = await getAgreement(agreementId);
      setData(a);
      const plan = (a.paymentPlan ?? {}) as Partial<PaymentPlanInput>;
      const b = (a.bioData ?? {}) as BioDataInput;
      setBio({ ...b, applicantName: b.applicantName ?? '' });
      setPlanType((plan.planType as PaymentPlanType) ?? 'INSTALLMENT');
      setCurrency(plan.currency ?? a.currency ?? 'CAD');
      setGross(String(plan.grossAmount ?? Number(a.grossAmount) ?? 0));
      setDiscount(String(plan.discountAmount ?? Number(a.discountAmount) ?? 0));
      setRows((plan.installments ?? []).map((i) => ({
        stage: i.stage ?? '', amount: i.amount == null ? '' : String(i.amount),
        trigger: i.trigger ?? '', dueDate: i.dueDate ? i.dueDate.slice(0, 10) : '', notes: i.notes ?? '',
      })));
      setSalesNotes(a.salesNotes ?? '');
      setManual(false);
      setDocKey((k) => k + 1);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agreement');
    } finally {
      setLoading(false);
    }
  }, [agreementId]);

  useEffect(() => { void load(); }, [load]);

  const editable = data ? EDITABLE.includes(data.status) : false;
  const netPayable = Math.max(0, num(gross) - num(discount));
  const installmentSum = rows.reduce((acc, r) => acc + num(r.amount), 0);
  // The schedule balances when the rows sum to the net payable. With no rows,
  // only a single full payment is valid. Plan type is just a label otherwise.
  const balanced = rows.length === 0
    ? planType === 'FULL'
    : cents(installmentSum) === cents(netPayable);
  const diff = cents(installmentSum) - cents(netPayable);

  const installments = useMemo<PaymentInstallmentInput[]>(() =>
    rows.filter((r) => r.stage.trim() || r.amount.trim()).map((r, i) => ({
      sequence: i + 1, stage: r.stage.trim() || `Stage ${i + 1}`, amount: num(r.amount),
      trigger: r.trigger.trim() || null, dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
      notes: r.notes.trim() || null,
    })), [rows]);

  // Live-composed document (matches the PDF). Used for the preview + saved.
  const composedHtml = useMemo(() => {
    if (!data?.template) return data?.contentHtml ?? '';
    return composeAgreementDocument(
      data.template.bodyHtml, bio,
      { currency, netPayable, installments },
      { agreementNumber: data.agreementNumber, programTitle: data.template.programTitle },
    );
  }, [data, bio, currency, netPayable, installments]);

  // What the preview shows: manual edits, else the live composition (or, when
  // locked, the stored document).
  const previewHtml = manual ? manualHtml : editable ? composedHtml : data?.contentHtml || composedHtml;

  // ── form mutators ──
  const touch = () => setDirty(true);
  const setBioField = (k: keyof BioDataInput, v: string) => { setBio((p) => ({ ...p, [k]: v })); touch(); };
  const setRow = (i: number, patch: Partial<Row>) => { setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r))); touch(); };
  const addRow = () => { setRows((p) => [...p, { stage: '', amount: '', trigger: '', dueDate: '', notes: '' }]); touch(); };
  const removeRow = (i: number) => { setRows((p) => p.filter((_, j) => j !== i)); touch(); };

  const validate = (): string | null => {
    if (!bio.applicantName.trim()) return 'Add the applicant name.';
    if (num(discount) > num(gross)) return 'Discount can’t exceed the total agreed amount.';
    if (rows.length === 0 && planType !== 'FULL') return 'Add at least one installment.';
    if (!balanced) return 'Payment amounts must add up to the net payable.';
    return null;
  };
  const validationError = validate();

  const save = useCallback(async (): Promise<boolean> => {
    const v = validate();
    if (v) { setError(v); return false; }
    setBusy('save'); setError(null);
    try {
      const contentHtml = manual ? (docRef.current?.innerHTML ?? manualHtml) : composedHtml;
      await updateAgreement(agreementId, {
        bioData: bio,
        paymentPlan: { planType, currency, grossAmount: num(gross), discountAmount: num(discount), netPayable, installments },
        salesNotes,
        contentHtml,
      });
      setNotice('Saved.'); setDirty(false); await load(); return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed'); return false;
    } finally { setBusy(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementId, bio, planType, currency, gross, discount, netPayable, installments, salesNotes, manual, composedHtml, manualHtml, load]);

  const handlePreview = async () => {
    setError(null);
    if (editable && dirty) { const ok = await save(); if (!ok) return; }
    setBusy('preview');
    try {
      const blob = await previewAgreementPdf(agreementId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Preview failed'); }
    finally { setBusy(null); }
  };

  const handleSubmit = async () => {
    setError(null);
    if (dirty) { const ok = await save(); if (!ok) return; }
    if (!window.confirm('Submit to Finance? You won’t be able to edit until Finance responds.')) return;
    setBusy('submit');
    try { await submitAgreement(agreementId); setNotice('Submitted to Finance.'); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Submit failed'); }
    finally { setBusy(null); }
  };

  const enterManual = () => { setManualHtml(composedHtml); setManual(true); setDocKey((k) => k + 1); touch(); };
  const resetToData = () => { setManual(false); setDocKey((k) => k + 1); touch(); };

  if (loading) return <div className="sos-text-muted" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>;
  if (!data) return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error ?? 'Not found'}</div>;

  const balanceColor = balanced ? 'var(--sos-status-success)' : 'var(--sos-status-danger)';
  const curStep = stepIndex(data.status);
  // SIGNED is terminal — the whole track is complete, so every step (incl.
  // the last "Signed" one) renders green/done rather than the active blue.
  const allDone = data.status === 'SIGNED';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        eyebrow={`Agreement · ${data.agreementNumber} · ${data.categoryKey}`}
        title={data.template?.programTitle ?? data.categoryKey}
        description={data.lead ? `${data.lead.firstName} ${data.lead.lastName} · ${data.lead.referenceCode}` : undefined}
      />

      {/* Stepper + actions */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {STEPS.map((label, i) => {
              const done = allDone || i < curStep;
              const cur = !allDone && i === curStep;
              const finalDone = allDone && i === STEPS.length - 1; // the achieved "Signed" end state
              return (
                <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 999,
                    fontSize: 10, fontWeight: 700,
                    background: done ? 'var(--sos-status-success)' : cur ? 'var(--sos-accent, #6366f1)' : 'var(--sos-surface-1, #e5e7eb)',
                    color: done || cur ? '#fff' : 'var(--sos-text-faint)',
                  }}>{done ? <Check size={11} /> : i + 1}</span>
                  <span style={{ fontSize: 12, fontWeight: cur || finalDone ? 700 : 500, color: cur ? 'var(--sos-text-primary)' : finalDone ? 'var(--sos-status-success)' : 'var(--sos-text-faint)' }}>{label}</span>
                  {i < STEPS.length - 1 ? <span style={{ width: 16, height: 1, background: 'var(--sos-border-subtle)', margin: '0 2px' }} /> : null}
                </span>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge tone={STATUS_TONE[data.status]} dot>{data.status.replace(/_/g, ' ').toLowerCase()}</StatusBadge>
            <ButtonLink href="/sales/agreements" variant="ghost" size="sm">Back</ButtonLink>
            <SecondaryButton size="sm" iconLeft={<Eye size={15} />} onClick={handlePreview} disabled={busy !== null}>
              {busy === 'preview' ? 'Rendering…' : 'Preview PDF'}
            </SecondaryButton>
            {editable ? (
              <>
                <PrimaryButton size="sm" iconLeft={<Save size={15} />} onClick={() => void save()} disabled={busy !== null || !dirty}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </PrimaryButton>
                <PrimaryButton size="sm" iconLeft={<Send size={15} />} onClick={handleSubmit} disabled={busy !== null || !!validationError}>
                  {busy === 'submit' ? 'Submitting…' : 'Submit to Finance'}
                </PrimaryButton>
              </>
            ) : null}
          </div>
        </div>
        {/* What's-next bar */}
        {editable ? (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            {validationError ? (
              <><AlertTriangle size={14} color="var(--sos-status-warning)" /><span className="sos-text-secondary">Next: {validationError}</span></>
            ) : (
              <><CheckCircle2 size={14} color="var(--sos-status-success)" /><span style={{ color: 'var(--sos-status-success)', fontWeight: 600 }}>Ready to submit to Finance.</span></>
            )}
          </div>
        ) : null}
        {error ? <div className="sos-banner sos-banner--danger" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={16} /> {error}</div> : null}
        {notice && !error ? <div className="sos-banner sos-banner--success" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}><CheckCircle2 size={16} /> {notice}</div> : null}
      </GlassCard>

      {/* Finance review — bounce-back note + discussion thread */}
      {(data.status === 'CHANGES_REQUESTED' && data.financeNotes) || data.events.length > 0 ? (
        <GlassCard variant="default" padded={false}>
          {data.status === 'CHANGES_REQUESTED' && data.financeNotes ? (
            <div
              style={{
                padding: '14px 18px',
                borderBottom: data.events.length > 0 ? '1px solid var(--sos-border-subtle)' : undefined,
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                background: 'var(--sos-status-warning-soft)',
              }}
            >
              <AlertTriangle size={18} style={{ color: 'var(--sos-status-warning)', flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
                  Finance requested changes
                </div>
                <div className="sos-text-secondary" style={{ fontSize: 13, marginTop: 3, whiteSpace: 'pre-wrap' }}>
                  {data.financeNotes}
                </div>
                <div className="sos-text-faint" style={{ fontSize: 12, marginTop: 6 }}>
                  Update the agreement below, then <strong>Submit to Finance</strong> again. Use “Notes for Finance”
                  to reply with what you changed.
                </div>
              </div>
            </div>
          ) : null}

          {data.events.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '12px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  color: 'var(--sos-text-secondary)',
                }}
              >
                <MessageSquare size={15} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  Review history &amp; discussion ({data.events.length})
                </span>
                <ChevronDown
                  size={15}
                  style={{ marginLeft: 'auto', transform: showHistory ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
                />
              </button>
              {showHistory ? (
                <div style={{ borderTop: '1px solid var(--sos-border-subtle)' }}>
                  {data.events.map((ev) => (
                    <div
                      key={ev.id}
                      style={{
                        padding: '10px 18px',
                        borderBottom: '1px solid var(--sos-border-subtle)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                      }}
                    >
                      <span style={{ fontSize: 13, color: 'var(--sos-text-secondary)' }}>
                        <strong style={{ fontFamily: 'monospace', fontSize: 11, marginRight: 8, color: 'var(--sos-text-faint)' }}>
                          {ev.type}
                        </strong>
                        {ev.summary}
                      </span>
                      <span className="sos-text-faint" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {new Date(ev.createdAt).toLocaleString('en-GB')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </GlassCard>
      ) : null}

      {/* Studio: form (left) + live preview (right) */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* LEFT — form */}
        <div style={{ flex: '1 1 360px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Applicant */}
          <GlassCard variant="default">
            <SectionHead n={1} title="Applicant details" />
            <FormInput label="Full name" required value={bio.applicantName} disabled={!editable} onChange={(e) => setBioField('applicantName', e.target.value)} />
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 10 }}>
              <FormInput label="CNIC" value={bio.cnic ?? ''} disabled={!editable} onChange={(e) => setBioField('cnic', e.target.value)} />
              <FormInput label="Passport" value={bio.passport ?? ''} disabled={!editable} onChange={(e) => setBioField('passport', e.target.value)} />
              <FormInput label="Nationality" value={bio.nationality ?? ''} disabled={!editable} onChange={(e) => setBioField('nationality', e.target.value)} />
              <FormInput label="Destination country" value={bio.country ?? ''} placeholder="Canada" disabled={!editable} onChange={(e) => setBioField('country', e.target.value)} />
            </div>
            <div style={{ marginTop: 10 }}>
              <FormInput label="Address" value={bio.address ?? ''} disabled={!editable} onChange={(e) => setBioField('address', e.target.value)} />
            </div>
            <button type="button" onClick={() => setShowMore((v) => !v)} className="sos-text-secondary"
              style={{ marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, padding: 0, textDecoration: 'underline' }}>
              {showMore ? 'Hide extra fields' : 'More details (father, DOB, phone, email, file #, date)'}
            </button>
            {showMore ? (
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 10 }}>
                <FormInput label="Father / guardian" value={bio.fatherName ?? ''} disabled={!editable} onChange={(e) => setBioField('fatherName', e.target.value)} />
                <FormInput label="Date of birth" value={bio.dob ?? ''} placeholder="01 Jan 1990" disabled={!editable} onChange={(e) => setBioField('dob', e.target.value)} />
                <FormInput label="Phone" value={bio.phone ?? ''} disabled={!editable} onChange={(e) => setBioField('phone', e.target.value)} />
                <FormInput label="Email" value={bio.email ?? ''} disabled={!editable} onChange={(e) => setBioField('email', e.target.value)} />
                <FormInput label="File number" value={bio.fileNumber ?? ''} disabled={!editable} onChange={(e) => setBioField('fileNumber', e.target.value)} />
                <FormInput label="Agreement date" value={bio.agreementDate ?? ''} placeholder="today" disabled={!editable} onChange={(e) => setBioField('agreementDate', e.target.value)} />
              </div>
            ) : null}
          </GlassCard>

          {/* Payment plan */}
          <GlassCard variant="default">
            <SectionHead n={2} title="Payment plan" />
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
              <FormSelect label="Plan type" value={planType} disabled={!editable}
                onChange={(e) => { setPlanType(e.target.value as PaymentPlanType); touch(); }}
                options={[{ value: 'FULL', label: 'Single payment' }, { value: 'INSTALLMENT', label: 'Installments' }, { value: 'MILESTONE', label: 'Milestone-based' }]} />
              <FormSelect label="Currency" value={currency} disabled={!editable}
                onChange={(e) => { setCurrency(e.target.value); touch(); }}
                options={AGREEMENT_CURRENCIES.map((c) => ({ value: c, label: c }))} />
              <FormInput label="Total agreed" inputMode="decimal" value={gross} disabled={!editable} onChange={(e) => { setGross(e.target.value); touch(); }} />
              <FormInput label="Discount" inputMode="decimal" value={discount} disabled={!editable} onChange={(e) => { setDiscount(e.target.value); touch(); }} />
            </div>
            {/* Net payable highlight */}
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'var(--sos-surface-1, rgba(99,102,241,0.06))', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span className="sos-text-faint" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Net payable</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--sos-text-primary)' }}>{currency} {money(netPayable)}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 6px' }}>
              <label className="sos-label" style={{ margin: 0 }}>{planType === 'MILESTONE' ? 'Milestones' : planType === 'FULL' ? 'Payment' : 'Installments'}</label>
              {editable ? (
                <GhostButton size="sm" iconLeft={<Plus size={14} />} onClick={addRow}>Add</GhostButton>
              ) : null}
            </div>
            {rows.length === 0 ? (
              <div className="sos-text-faint" style={{ fontSize: 12.5, padding: '4px 0' }}>
                {planType === 'FULL' ? 'Full payment uses the net payable.' : 'Add rows that sum to the net payable.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.4fr auto', gap: 6, alignItems: 'center' }}>
                    <input className="sos-input" placeholder="Stage" value={r.stage} disabled={!editable} onChange={(e) => setRow(i, { stage: e.target.value })} />
                    <input className="sos-input" placeholder="Amount" inputMode="decimal" value={r.amount} disabled={!editable} onChange={(e) => setRow(i, { amount: e.target.value })} />
                    <input className="sos-input" placeholder="When (e.g. At signing)" value={r.trigger} disabled={!editable} onChange={(e) => setRow(i, { trigger: e.target.value })} />
                    {editable ? <GhostButton size="sm" onClick={() => removeRow(i)} aria-label="Remove"><Trash2 size={14} /></GhostButton> : <span />}
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              {balanced ? <CheckCircle2 size={14} color={balanceColor} /> : <AlertTriangle size={14} color={balanceColor} />}
              <span style={{ color: balanceColor, fontWeight: 600 }}>Scheduled {currency} {money(installmentSum)} / {currency} {money(netPayable)}</span>
              {!balanced && diff !== 0 ? <span className="sos-text-faint">({diff > 0 ? 'over' : 'short'} {currency} {money(Math.abs(diff) / 100)})</span> : null}
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="sos-label">Notes for Finance (shown during review · not shown to client)</label>
              <textarea className="sos-textarea" value={salesNotes} disabled={!editable}
                onChange={(e) => { setSalesNotes(e.target.value); touch(); }} style={{ width: '100%', minHeight: 60 }} />
            </div>
          </GlassCard>
        </div>

        {/* RIGHT — live preview */}
        <div style={{ flex: '1 1 460px', minWidth: 340, position: 'sticky', top: 12, alignSelf: 'flex-start' }}>
          <GlassCard variant="default" padded={false}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--sos-border-subtle)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Eye size={15} className="sos-text-faint" />
                <span className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>Live preview</span>
                <span className="sos-text-faint" style={{ fontSize: 11 }}>— exactly what the PDF will say</span>
              </div>
              {editable ? (
                manual ? (
                  <GhostButton size="sm" iconLeft={<RotateCcw size={13} />} onClick={resetToData}>Reset to data</GhostButton>
                ) : (
                  <GhostButton size="sm" iconLeft={<Pencil size={13} />} onClick={enterManual}>Edit text</GhostButton>
                )
              ) : null}
            </div>
            {manual ? (
              <div className="sos-text-faint" style={{ fontSize: 11.5, padding: '6px 16px 0' }}>
                Editing text directly. Changes to the form above won’t flow in until you click “Reset to data”.
              </div>
            ) : null}
            <div style={{ padding: 16, maxHeight: '72vh', overflowY: 'auto', background: 'var(--sos-surface-2, #f1f3f9)' }}>
              {/* Paper */}
              <div style={{ background: '#fff', borderRadius: 6, boxShadow: '0 1px 6px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
                <div style={{ background: '#0b1f3a', color: '#f8fafc', padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 800, letterSpacing: '1px', fontSize: 13 }}>TASHFEEN</span>
                  <span style={{ fontSize: 9, letterSpacing: '2px', color: '#cbd5e1' }}>IMMIGRATION SOLUTIONS</span>
                </div>
                <div style={{ height: 3, background: '#d6a84f' }} />
                <div
                  key={docKey}
                  ref={docRef}
                  contentEditable={editable && manual}
                  suppressContentEditableWarning
                  onInput={manual ? () => { setDirty(true); setManualHtml(docRef.current?.innerHTML ?? ''); } : undefined}
                  className="agreement-doc"
                  style={{ padding: '20px 24px', color: '#1a1d29', fontSize: 12.5, lineHeight: 1.6, outline: 'none', minHeight: 200 }}
                  dangerouslySetInnerHTML={{
                    __html: `<h1 class="doc-title">${escapeTitle(composeAgreementTitle(data.template?.programTitle ?? '', bio.country))}</h1>` +
                      (previewHtml || '<p class="sos-text-faint">Fill the form to build the document…</p>'),
                  }}
                />
              </div>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Closing action bar — generate the document / submit */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5 }}>
            {editable && validationError ? (
              <span className="sos-text-secondary"><AlertTriangle size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{validationError}</span>
            ) : (
              <span style={{ color: 'var(--sos-status-success)', fontWeight: 600 }}><CheckCircle2 size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Generate the agreement PDF{editable ? ', then submit to Finance.' : '.'}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <PrimaryButton iconLeft={<FileText size={15} />} onClick={handlePreview} disabled={busy !== null}>
              {busy === 'preview' ? 'Generating…' : 'Generate Agreement'}
            </PrimaryButton>
            {editable ? (
              <PrimaryButton iconLeft={<Send size={15} />} onClick={handleSubmit} disabled={busy !== null || !!validationError}>
                {busy === 'submit' ? 'Submitting…' : 'Submit to Finance'}
              </PrimaryButton>
            ) : null}
          </div>
        </div>
      </GlassCard>

      <style>{`
        .agreement-doc h1.doc-title { font-size: 14px; text-align: center; text-transform: uppercase; letter-spacing: .5px; margin: 4px 0 14px; }
        .agreement-doc h2 { font-size: 13.5px; font-weight: 700; margin: 14px 0 5px; }
        .agreement-doc h3 { font-size: 12.5px; font-weight: 700; margin: 11px 0 4px; }
        .agreement-doc p { margin: 6px 0; }
        .agreement-doc ul, .agreement-doc ol { margin: 6px 0 6px 18px; }
        .agreement-doc li { margin: 3px 0; }
        .agreement-doc table.payplan { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 11.5px; }
        .agreement-doc table.payplan th, .agreement-doc table.payplan td { border: 1px solid #c9cee0; padding: 6px 8px; text-align: left; }
        .agreement-doc table.payplan th { background: #0b1f3a; color: #fff; }
        .agreement-doc table.payplan tr.total td { font-weight: 700; background: #f1f3f9; }
        .agreement-doc .token-missing { background: #fde68a; color: #92400e; padding: 0 3px; border-radius: 2px; }
        .agreement-doc .sig { margin-top: 28px; display: flex; justify-content: space-between; gap: 40px; }
        .agreement-doc .sig .box { flex: 1; }
        .agreement-doc .sig .line { border-top: 1px solid #1a1d29; margin-top: 36px; padding-top: 4px; font-size: 10px; color: #5a6080; }
      `}</style>
    </div>
  );
}

function SectionHead({ n, title }: { n: number; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 999, background: 'var(--sos-accent, #6366f1)', color: '#fff', fontSize: 12, fontWeight: 700 }}>{n}</span>
      <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-lg)', margin: 0 }}>{title}</h2>
    </div>
  );
}

function escapeTitle(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
