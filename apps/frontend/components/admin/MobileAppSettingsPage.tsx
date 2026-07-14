'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, Loader2, Save } from 'lucide-react';
import {
  FormSelect,
  GlassCard,
  PageHeader,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import { PermissionDeniedState } from '@/components/shared/PermissionDeniedState';
import { useAdminSession } from '@/components/layout/AdminShell';
import {
  getLeadWhatsappMode,
  setLeadWhatsappMode,
  type LeadWhatsappMode,
} from '@/lib/app-settings';

const MODE_OPTIONS = [
  { value: 'crm', label: 'CRM inbox (in-app) — default' },
  { value: 'personal', label: "Rep's personal WhatsApp" },
];

export function MobileAppSettingsPage() {
  const { user } = useAdminSession();
  const canManage = user.permissions.includes('settings.manage');

  const [mode, setMode] = useState<LeadWhatsappMode>('crm');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    getLeadWhatsappMode()
      .then((s) => setMode(s.leadWhatsappMode))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load mobile app settings'))
      .finally(() => setLoading(false));
  }, [canManage]);

  const set = useCallback((v: string) => {
    setMode(v as LeadWhatsappMode);
    setSuccess(null);
    setError(null);
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await setLeadWhatsappMode(mode);
      setMode(updated.leadWhatsappMode);
      setSuccess('Mobile app settings saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return <PermissionDeniedState message="You need the settings.manage permission to configure the mobile app." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        eyebrow="Settings · Mobile App"
        title="Mobile app settings"
        description="Control what the mobile lead-detail WhatsApp button does on reps' phones."
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
        <GlassCard variant="default" padded="lg">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <FormSelect
              label="Lead WhatsApp button opens"
              hint="Controls what the mobile lead-detail WhatsApp button does. Changes apply within seconds on reps' phones with no app update. 'Personal' is a temporary campaign mode; 'CRM' is the normal behaviour."
              value={mode}
              onChange={(e) => set(e.target.value)}
              options={MODE_OPTIONS}
            />
          </div>
        </GlassCard>
      )}

      {!loading ? (
        <div>
          <PrimaryButton onClick={() => void save()} disabled={saving} iconLeft={saving ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={15} />}>
            {saving ? 'Saving…' : 'Save settings'}
          </PrimaryButton>
        </div>
      ) : null}
    </div>
  );
}
