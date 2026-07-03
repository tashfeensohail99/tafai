'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, Loader2, Save } from 'lucide-react';
import {
  Field,
  FormInput,
  FormSelect,
  GlassCard,
  PageHeader,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useAdminSession } from '@/components/layout/AdminShell';
import {
  getReceptionSettings,
  listHosts,
  updateReceptionSettings,
  type Host,
} from '@/lib/reception-api';

interface FormState {
  principalEmployeeId: string;
  feeAmount: string;
  feeCurrency: string;
  bankIban: string;
  bankName: string;
  bankTitle: string;
}
const EMPTY: FormState = {
  principalEmployeeId: '',
  feeAmount: '',
  feeCurrency: 'PKR',
  bankIban: '',
  bankName: '',
  bankTitle: '',
};

export function ReceptionSettingsPage() {
  const { user } = useAdminSession();
  const canManage = user.permissions.includes('reception.manage_settings');

  const [form, setForm] = useState<FormState>(EMPTY);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    Promise.all([getReceptionSettings(), listHosts()])
      .then(([s, h]) => {
        setHosts(h.hosts);
        setForm({
          principalEmployeeId: s.principal?.id ?? '',
          feeAmount: s.feeAmount != null ? String(s.feeAmount) : '',
          feeCurrency: s.feeCurrency ?? 'PKR',
          bankIban: s.bank.iban ?? '',
          bankName: s.bank.name ?? '',
          bankTitle: s.bank.title ?? '',
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load reception settings'))
      .finally(() => setLoading(false));
  }, [canManage]);

  const set = useCallback(<K extends keyof FormState>(k: K, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSuccess(null);
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateReceptionSettings({
        principalEmployeeId: form.principalEmployeeId || undefined,
        feeAmount: form.feeAmount.trim() || undefined,
        feeCurrency: form.feeCurrency.trim() || undefined,
        bankIban: form.bankIban.trim() || undefined,
        bankName: form.bankName.trim() || undefined,
        bankTitle: form.bankTitle.trim() || undefined,
      });
      setForm({
        principalEmployeeId: updated.principal?.id ?? '',
        feeAmount: updated.feeAmount != null ? String(updated.feeAmount) : '',
        feeCurrency: updated.feeCurrency ?? 'PKR',
        bankIban: updated.bank.iban ?? '',
        bankName: updated.bank.name ?? '',
        bankTitle: updated.bank.title ?? '',
      });
      setSuccess('Reception settings saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return <PermissionDeniedState message="You need the reception.manage_settings permission to configure reception." />;
  }

  const hostOptions = hosts.map((h) => ({ value: h.id, label: h.department ? `${h.name} · ${h.department}` : h.name }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Settings · Reception"
        title="Reception settings"
        description="The principal who paid consultations book against, the standard consultation fee, and the receiving bank account printed on the consultation receipt."
      />

      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      ) : null}
      {success ? (
        <div className="sos-banner sos-banner--success" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BadgeCheck size={15} /> {success}
        </div>
      ) : null}

      {loading ? (
        <div className="sos-text-muted" style={{ padding: 30, textAlign: 'center' }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading…
        </div>
      ) : (
        <>
          <GlassCard variant="default" padded="lg">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <FormSelect
                label="Consultation principal"
                hint="Paid consultations book against this person's calendar."
                value={form.principalEmployeeId}
                onChange={(e) => set('principalEmployeeId', e.target.value)}
                placeholder="Select a staff member…"
                options={hostOptions}
              />
              <Field label="Standard fee" hint="Amount charged per in-person consultation.">
                <FormInput inputMode="decimal" value={form.feeAmount} onChange={(e) => set('feeAmount', e.target.value)} placeholder="e.g. 5000" />
              </Field>
              <FormInput label="Currency" value={form.feeCurrency} onChange={(e) => set('feeCurrency', e.target.value)} placeholder="PKR" />
            </div>
          </GlassCard>

          <GlassCard variant="default" padded="lg">
            <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', marginTop: 0, marginBottom: 12 }}>Receiving bank account</h2>
            <p className="sos-text-faint" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 14 }}>
              Printed on the consultation receipt so bank-transfer payers know where to send.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <FormInput label="Bank name" value={form.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder="e.g. UBL" />
              <FormInput label="Account title" value={form.bankTitle} onChange={(e) => set('bankTitle', e.target.value)} placeholder="e.g. Tashfeen Immigration Solution" />
              <FormInput label="IBAN / account number" value={form.bankIban} onChange={(e) => set('bankIban', e.target.value)} placeholder="PK.." />
            </div>
          </GlassCard>

          <div>
            <PrimaryButton onClick={() => void save()} disabled={saving} iconLeft={saving ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={15} />}>
              {saving ? 'Saving…' : 'Save settings'}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}
