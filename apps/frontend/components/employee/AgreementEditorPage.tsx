'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Lock,
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
  getAgreement,
  previewAgreementPdf,
  regenerateAgreement,
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

interface Row {
  stage: string;
  amount: string;
  trigger: string;
  dueDate: string;
  notes: string;
}

const num = (s: string): number => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const cents = (n: number) => Math.round(n * 100);
const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function AgreementEditorPage({ agreementId }: { agreementId: string }) {
  const [data, setData] = useState<AgreementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'preview' | 'submit' | 'regen' | null>(null);
  const [dirty, setDirty] = useState(false);

  // editor state
  const [bio, setBio] = useState<BioDataInput>({ applicantName: '' });
  const [planType, setPlanType] = useState<PaymentPlanType>('INSTALLMENT');
  const [currency, setCurrency] = useState('CAD');
  const [gross, setGross] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [rows, setRows] = useState<Row[]>([]);
  const [salesNotes, setSalesNotes] = useState('');
  // Document editor (uncontrolled contentEditable — remounted via docKey).
  const docRef = useRef<HTMLDivElement>(null);
  const [initialDoc, setInitialDoc] = useState('');
  const [docKey, setDocKey] = useState(0);
  const [docDirty, setDocDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const a = await getAgreement(agreementId);
      setData(a);
      const plan = (a.paymentPlan ?? {}) as Partial<PaymentPlanInput>;
      const incomingBio = (a.bioData ?? {}) as BioDataInput;
      setBio({ ...incomingBio, applicantName: incomingBio.applicantName ?? '' });
      setPlanType((plan.planType as PaymentPlanType) ?? 'INSTALLMENT');
      setCurrency(plan.currency ?? a.currency ?? 'CAD');
      setGross(String(plan.grossAmount ?? Number(a.grossAmount) ?? 0));
      setDiscount(String(plan.discountAmount ?? Number(a.discountAmount) ?? 0));
      setRows(
        (plan.installments ?? []).map((i) => ({
          stage: i.stage ?? '',
          amount: i.amount == null ? '' : String(i.amount),
          trigger: i.trigger ?? '',
          dueDate: i.dueDate ? i.dueDate.slice(0, 10) : '',
          notes: i.notes ?? '',
        })),
      );
      setSalesNotes(a.salesNotes ?? '');
      setInitialDoc(a.contentHtml ?? '');
      setDocDirty(false);
      setDocKey((k) => k + 1);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agreement');
    } finally {
      setLoading(false);
    }
  }, [agreementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = data ? EDITABLE.includes(data.status) : false;
  const netPayable = Math.max(0, num(gross) - num(discount));
  const installmentSum = rows.reduce((acc, r) => acc + num(r.amount), 0);
  const balanced =
    planType === 'FULL'
      ? rows.length <= 1 && (rows.length === 0 || cents(installmentSum) === cents(netPayable))
      : rows.length >= 1 && cents(installmentSum) === cents(netPayable);
  const diff = cents(installmentSum) - cents(netPayable);

  // ── mutate helpers (mark dirty) ─────────────────────────────────────────
  const touch = () => setDirty(true);
  const setBioField = (k: keyof BioDataInput, v: string) => {
    setBio((p) => ({ ...p, [k]: v }));
    touch();
  };
  const setRow = (i: number, patch: Partial<Row>) => {
    setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    touch();
  };
  const addRow = () => {
    setRows((p) => [...p, { stage: '', amount: '', trigger: '', dueDate: '', notes: '' }]);
    touch();
  };
  const removeRow = (i: number) => {
    setRows((p) => p.filter((_, j) => j !== i));
    touch();
  };

  const buildPlan = useCallback((): PaymentPlanInput => {
    const installments: PaymentInstallmentInput[] = rows
      .filter((r) => r.stage.trim() || r.amount.trim())
      .map((r, i) => ({
        sequence: i + 1,
        stage: r.stage.trim() || `Stage ${i + 1}`,
        amount: num(r.amount),
        trigger: r.trigger.trim() || null,
        dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
        notes: r.notes.trim() || null,
      }));
    return {
      planType,
      currency,
      grossAmount: num(gross),
      discountAmount: num(discount),
      netPayable,
      installments,
    };
  }, [rows, planType, currency, gross, discount, netPayable]);

  const validate = (): string | null => {
    if (!bio.applicantName.trim()) return 'Applicant name is required.';
    if (num(discount) > num(gross)) return 'Discount cannot exceed the gross amount.';
    if (planType === 'FULL') {
      if (rows.length > 1) return 'A full-payment plan can have at most one installment.';
    } else if (rows.filter((r) => r.stage.trim() || r.amount.trim()).length < 1) {
      return 'Add at least one installment / milestone.';
    }
    if (!balanced) {
      return planType === 'FULL'
        ? 'The single payment must equal the net payable.'
        : 'Installment amounts must add up to the net payable.';
    }
    return null;
  };

  const save = useCallback(async (): Promise<boolean> => {
    const v = validate();
    if (v) {
      setError(v);
      return false;
    }
    setBusy('save');
    setError(null);
    try {
      await updateAgreement(agreementId, {
        bioData: bio,
        paymentPlan: buildPlan(),
        salesNotes,
        // Only send the document when Sales actually edited it; otherwise
        // let the backend regenerate it from the (possibly changed) plan.
        ...(docDirty ? { contentHtml: docRef.current?.innerHTML ?? '' } : {}),
      });
      setNotice('Saved.');
      setDirty(false);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      return false;
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementId, bio, buildPlan, salesNotes, load, docDirty]);

  const handlePreview = async () => {
    setError(null);
    if (editable && dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setBusy('preview');
    try {
      const blob = await previewAgreementPdf(agreementId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(null);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    if (!window.confirm('Submit this agreement to Finance for review? You won’t be able to edit it until Finance responds.')) {
      return;
    }
    setBusy('submit');
    try {
      await submitAgreement(agreementId);
      setNotice('Submitted to Finance.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setBusy(null);
    }
  };

  const handleRegenerate = async () => {
    if (!window.confirm('Rebuild the document from the template and the current payment plan? This discards manual text edits.')) {
      return;
    }
    setError(null);
    setBusy('regen');
    try {
      // Persist current bio/plan first so regeneration uses the latest data.
      if (dirty) {
        const ok = await save();
        if (!ok) return;
      }
      await regenerateAgreement(agreementId);
      setNotice('Document rebuilt from template + data.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regenerate failed');
    } finally {
      setBusy(null);
    }
  };

  const balanceColor = balanced ? 'var(--sos-status-success)' : 'var(--sos-status-danger)';

  if (loading) {
    return <div className="sos-text-muted" style={{ padding: 32, textAlign: 'center' }}>Loading…</div>;
  }
  if (!data) {
    return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error ?? 'Not found'}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow={`Agreement · ${data.agreementNumber}`}
        title={data.template?.programTitle ?? data.categoryKey}
        description={
          data.lead
            ? `Applicant lead: ${data.lead.firstName} ${data.lead.lastName} · ${data.lead.referenceCode}`
            : undefined
        }
      />

      {/* Action bar */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusBadge tone={STATUS_TONE[data.status]} dot>
              {data.status.replace(/_/g, ' ').toLowerCase()}
            </StatusBadge>
            {!editable ? (
              <span className="sos-text-faint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                <Lock size={13} /> Locked — read-only at this stage
              </span>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ButtonLink href="/sales/agreements" variant="ghost" size="sm">Back</ButtonLink>
            <SecondaryButton size="sm" iconLeft={<Eye size={15} />} onClick={handlePreview} disabled={busy !== null}>
              {busy === 'preview' ? 'Rendering…' : 'Preview PDF'}
            </SecondaryButton>
            {editable ? (
              <>
                <PrimaryButton size="sm" iconLeft={<Save size={15} />} onClick={() => void save()} disabled={busy !== null}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </PrimaryButton>
                <PrimaryButton size="sm" iconLeft={<Send size={15} />} onClick={handleSubmit} disabled={busy !== null || !balanced}>
                  {busy === 'submit' ? 'Submitting…' : 'Submit to Finance'}
                </PrimaryButton>
              </>
            ) : null}
          </div>
        </div>
        {error ? (
          <div className="sos-banner sos-banner--danger" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <AlertTriangle size={16} /> {error}
          </div>
        ) : null}
        {notice && !error ? (
          <div className="sos-banner sos-banner--success" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <CheckCircle2 size={16} /> {notice}
          </div>
        ) : null}
      </GlassCard>

      {/* Applicant bio */}
      <GlassCard variant="default">
        <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-lg)', marginTop: 0 }}>Applicant</h2>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <FormInput label="Full name" required value={bio.applicantName} disabled={!editable} onChange={(e) => setBioField('applicantName', e.target.value)} />
          <FormInput label="Father / guardian" value={bio.fatherName ?? ''} disabled={!editable} onChange={(e) => setBioField('fatherName', e.target.value)} />
          <FormInput label="CNIC" value={bio.cnic ?? ''} disabled={!editable} onChange={(e) => setBioField('cnic', e.target.value)} />
          <FormInput label="Passport" value={bio.passport ?? ''} disabled={!editable} onChange={(e) => setBioField('passport', e.target.value)} />
          <FormInput label="Date of birth" value={bio.dob ?? ''} disabled={!editable} placeholder="01 Jan 1990" onChange={(e) => setBioField('dob', e.target.value)} />
          <FormInput label="Nationality" value={bio.nationality ?? ''} disabled={!editable} onChange={(e) => setBioField('nationality', e.target.value)} />
          <FormInput label="Phone" value={bio.phone ?? ''} disabled={!editable} onChange={(e) => setBioField('phone', e.target.value)} />
          <FormInput label="Email" value={bio.email ?? ''} disabled={!editable} onChange={(e) => setBioField('email', e.target.value)} />
          <FormInput label="File number" value={bio.fileNumber ?? ''} disabled={!editable} onChange={(e) => setBioField('fileNumber', e.target.value)} />
          <FormInput label="Agreement date" value={bio.agreementDate ?? ''} disabled={!editable} placeholder="leave blank for today" onChange={(e) => setBioField('agreementDate', e.target.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <FormInput label="Address" value={bio.address ?? ''} disabled={!editable} onChange={(e) => setBioField('address', e.target.value)} />
        </div>
      </GlassCard>

      {/* Payment plan */}
      <GlassCard variant="default">
        <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-lg)', marginTop: 0 }}>Payment plan</h2>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <FormSelect
            label="Plan type"
            value={planType}
            disabled={!editable}
            onChange={(e) => { setPlanType(e.target.value as PaymentPlanType); touch(); }}
            options={[
              { value: 'FULL', label: 'Full payment' },
              { value: 'INSTALLMENT', label: 'Installments' },
              { value: 'MILESTONE', label: 'Milestone-based' },
            ]}
          />
          <FormSelect
            label="Currency"
            value={currency}
            disabled={!editable}
            onChange={(e) => { setCurrency(e.target.value); touch(); }}
            options={AGREEMENT_CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
          <FormInput label="Total agreed (gross)" inputMode="decimal" value={gross} disabled={!editable} onChange={(e) => { setGross(e.target.value); touch(); }} />
          <FormInput label="Discount" inputMode="decimal" value={discount} disabled={!editable} onChange={(e) => { setDiscount(e.target.value); touch(); }} />
          <FormInput label="Net payable" value={`${currency} ${money(netPayable)}`} disabled hint="Auto: gross − discount" />
        </div>

        {/* Installments */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label className="sos-label" style={{ margin: 0 }}>
              {planType === 'MILESTONE' ? 'Milestones' : planType === 'FULL' ? 'Payment' : 'Installments'}
            </label>
            {editable && !(planType === 'FULL' && rows.length >= 1) ? (
              <GhostButton size="sm" iconLeft={<Plus size={14} />} onClick={addRow}>Add {planType === 'MILESTONE' ? 'milestone' : 'installment'}</GhostButton>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <div className="sos-text-faint" style={{ fontSize: 12.5, padding: '6px 0' }}>
              No rows yet. {planType === 'FULL' ? 'Full payment uses the net payable.' : 'Add at least one row that sums to the net payable.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1.4fr 1fr auto', gap: 8, alignItems: 'center' }}>
                  <input className="sos-input" placeholder="Stage / label" value={r.stage} disabled={!editable} onChange={(e) => setRow(i, { stage: e.target.value })} />
                  <input className="sos-input" placeholder="Amount" inputMode="decimal" value={r.amount} disabled={!editable} onChange={(e) => setRow(i, { amount: e.target.value })} />
                  <input className="sos-input" placeholder="Trigger (e.g. At signing)" value={r.trigger} disabled={!editable} onChange={(e) => setRow(i, { trigger: e.target.value })} />
                  <input className="sos-input" type="date" value={r.dueDate} disabled={!editable} onChange={(e) => setRow(i, { dueDate: e.target.value })} />
                  {editable ? (
                    <GhostButton size="sm" onClick={() => removeRow(i)} aria-label="Remove">
                      <Trash2 size={15} />
                    </GhostButton>
                  ) : <span />}
                </div>
              ))}
            </div>
          )}

          {/* Balance indicator */}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            {balanced ? <CheckCircle2 size={15} color={balanceColor} /> : <AlertTriangle size={15} color={balanceColor} />}
            <span style={{ color: balanceColor, fontWeight: 600 }}>
              Scheduled {currency} {money(installmentSum)} / {currency} {money(netPayable)}
            </span>
            {!balanced && diff !== 0 ? (
              <span className="sos-text-faint">
                ({diff > 0 ? 'over' : 'short'} by {currency} {money(Math.abs(diff) / 100)})
              </span>
            ) : null}
          </div>
        </div>

        {/* Sales notes */}
        <div style={{ marginTop: 16 }}>
          <label className="sos-label">Sales notes (internal)</label>
          <textarea
            className="sos-textarea"
            value={salesNotes}
            disabled={!editable}
            onChange={(e) => { setSalesNotes(e.target.value); touch(); }}
            style={{ width: '100%', minHeight: 80 }}
          />
        </div>
      </GlassCard>

      {/* Document editor */}
      <GlassCard variant="default">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-lg)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={17} /> Agreement document
          </h2>
          {editable ? (
            <SecondaryButton size="sm" iconLeft={<RotateCcw size={14} />} onClick={handleRegenerate} disabled={busy !== null}>
              {busy === 'regen' ? 'Rebuilding…' : 'Regenerate from template + data'}
            </SecondaryButton>
          ) : null}
        </div>
        <div className="sos-help" style={{ marginBottom: 10 }}>
          {editable
            ? 'Edit the wording directly below — your edits become the PDF. The payment table comes from the plan above; if you change the plan, click “Regenerate” to refresh the figures (rebuilds the document and discards manual edits).'
            : 'Read-only at this stage.'}
        </div>
        <div
          key={docKey}
          ref={docRef}
          contentEditable={editable}
          suppressContentEditableWarning
          onInput={() => {
            setDirty(true);
            setDocDirty(true);
          }}
          dangerouslySetInnerHTML={{
            __html: initialDoc || '<p>No document yet — set the payment plan and save, or click Regenerate.</p>',
          }}
          className="agreement-doc"
          style={{
            border: '1px solid var(--sos-border-subtle)',
            borderRadius: 8,
            padding: '20px 22px',
            minHeight: 300,
            maxHeight: 560,
            overflowY: 'auto',
            background: 'var(--sos-surface, #fff)',
            color: 'var(--sos-text-primary)',
            fontSize: 13.5,
            lineHeight: 1.6,
            outline: 'none',
          }}
        />
        <style>{`
          .agreement-doc h1 { font-size: 16px; font-weight: 700; margin: 14px 0 8px; }
          .agreement-doc h2 { font-size: 15px; font-weight: 700; margin: 16px 0 6px; }
          .agreement-doc h3 { font-size: 13.5px; font-weight: 700; margin: 12px 0 4px; }
          .agreement-doc p { margin: 6px 0; }
          .agreement-doc ul, .agreement-doc ol { margin: 6px 0 6px 20px; }
          .agreement-doc li { margin: 3px 0; }
          .agreement-doc table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12.5px; }
          .agreement-doc th, .agreement-doc td { border: 1px solid var(--sos-border-subtle); padding: 6px 8px; text-align: left; }
          .agreement-doc .sig { margin-top: 28px; display: flex; gap: 40px; }
          .agreement-doc .sig .box { flex: 1; }
          .agreement-doc .sig .line { border-top: 1px solid currentColor; margin-top: 36px; padding-top: 4px; font-size: 11px; }
          .agreement-doc .token-missing { background: #fde68a; color: #92400e; padding: 0 3px; border-radius: 2px; }
        `}</style>
      </GlassCard>

      {/* History */}
      {data.events.length > 0 ? (
        <GlassCard variant="default" padded={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
            <h3 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>History</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {data.events.map((ev) => (
              <div key={ev.id} style={{ padding: '10px 18px', borderBottom: '1px solid var(--sos-border-subtle)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--sos-text-secondary)' }}>
                  <strong style={{ fontFamily: 'monospace', fontSize: 11, marginRight: 8 }}>{ev.type}</strong>
                  {ev.summary}
                </span>
                <span className="sos-text-faint" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {new Date(ev.createdAt).toLocaleString('en-GB')}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}
