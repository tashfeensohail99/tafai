'use client';

// Admin · Settings · WhatsApp Hours & SLA — self-serve editor for the org's
// working hours, lunch break, working days, Response-SLA target, breach
// warning + reassign threshold, finance-handover bonus, and the
// auto-acknowledgement toggle + template. Saves via PATCH /whatsapp/settings.

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, BadgeCheck, Clock, Loader2, Save } from 'lucide-react';
import {
  Field,
  FormInput,
  FormTextarea,
  GlassCard,
  PageHeader,
  PrimaryButton,
} from '@/components/sales-v2/ui';
import { apiFetch } from '@/lib/api-client';
import { useAdminSession } from '../layout/AdminShell';
import { PermissionDeniedState } from '../shared/PermissionDeniedState';
import { LoadingState } from '../shared/LoadingState';

interface SlaSettings {
  timezone: string;
  hoursOpen: string;
  hoursClose: string;
  breakStart: string | null;
  breakEnd: string | null;
  workingDays: number[];
  slaResponseSeconds: number;
  slaWarnBeforeSeconds: number;
  slaReassignThreshold: number;
  slaHandoverBonus: number;
  autoAckEnabled: boolean;
  autoAckTemplate: string | null;
  afterHoursTemplate: string | null;
}

const DAYS = [
  { v: 1, label: 'Mon' },
  { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' },
  { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' },
  { v: 6, label: 'Sat' },
  { v: 0, label: 'Sun' },
];

export function WhatsAppSlaSettingsPage() {
  const { user } = useAdminSession();
  const canManage = user.permissions.includes('whatsapp.manage_settings');

  const [s, setS] = useState<SlaSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    apiFetch<SlaSettings>('/whatsapp/settings')
      .then(setS)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, [canManage]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 3500);
    return () => clearTimeout(t);
  }, [success]);

  if (!canManage) return <PermissionDeniedState />;
  if (loading) return <LoadingState message="Loading settings…" />;
  if (!s) {
    return (
      <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>
        {error ?? 'Settings unavailable'}
      </div>
    );
  }

  const set = <K extends keyof SlaSettings>(k: K, v: SlaSettings[K]) =>
    setS((p) => (p ? { ...p, [k]: v } : p));

  const toggleDay = (d: number) =>
    setS((p) =>
      p
        ? {
            ...p,
            workingDays: p.workingDays.includes(d)
              ? p.workingDays.filter((x) => x !== d)
              : [...p.workingDays, d].sort((a, b) => a - b),
          }
        : p,
    );

  async function save() {
    if (!s) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await apiFetch<SlaSettings>('/whatsapp/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          timezone: s.timezone,
          hoursOpen: s.hoursOpen,
          hoursClose: s.hoursClose,
          breakStart: s.breakStart ?? '',
          breakEnd: s.breakEnd ?? '',
          workingDays: s.workingDays,
          slaResponseSeconds: s.slaResponseSeconds,
          slaWarnBeforeSeconds: s.slaWarnBeforeSeconds,
          slaReassignThreshold: s.slaReassignThreshold,
          slaHandoverBonus: s.slaHandoverBonus,
          autoAckEnabled: s.autoAckEnabled,
          autoAckTemplate: s.autoAckTemplate ?? '',
          afterHoursTemplate: s.afterHoursTemplate ?? '',
        }),
      });
      setS(updated);
      setSuccess('Settings saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Seconds ↔ minutes helpers for the human-friendly inputs.
  const respMin = Math.round((s.slaResponseSeconds / 60) * 10) / 10;
  const warnMin = Math.round((s.slaWarnBeforeSeconds / 60) * 10) / 10;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="WhatsApp · Settings"
        title="Working hours & SLA"
        description="Edit your team's hours, lunch break, response-SLA target, breach rules, and the auto-acknowledgement — all self-serve. The SLA clock pauses outside working hours, during the break, and on non-working days."
        actions={
          <PrimaryButton
            iconLeft={saving ? <Loader2 size={15} className="sos-spin" /> : <Save size={15} />}
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </PrimaryButton>
        }
      />

      {success ? (
        <GlassCard variant="soft" padded="sm" style={{ borderLeft: '4px solid var(--sos-status-success)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <BadgeCheck size={16} style={{ color: 'var(--sos-status-success)' }} />
          <span style={{ fontSize: 13.5 }}>{success}</span>
        </GlassCard>
      ) : null}
      {error ? (
        <GlassCard variant="soft" padded="sm" style={{ borderLeft: '4px solid var(--sos-status-danger)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} style={{ color: 'var(--sos-status-danger)' }} />
          <span style={{ fontSize: 13.5 }}>{error}</span>
        </GlassCard>
      ) : null}

      {/* Hours + days */}
      <GlassCard variant="panel" padded="lg">
        <SectionTitle icon={<Clock size={14} />} title="Working hours" />
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field label="Timezone" hint="IANA zone for all clock math">
            <FormInput value={s.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Asia/Karachi" />
          </Field>
          <Field label="Opens" hint="24h HH:MM">
            <FormInput type="time" value={s.hoursOpen} onChange={(e) => set('hoursOpen', e.target.value)} />
          </Field>
          <Field label="Closes" hint="24h HH:MM">
            <FormInput type="time" value={s.hoursClose} onChange={(e) => set('hoursClose', e.target.value)} />
          </Field>
          <Field label="Break starts" hint="Leave blank for no break">
            <FormInput type="time" value={s.breakStart ?? ''} onChange={(e) => set('breakStart', e.target.value || null)} />
          </Field>
          <Field label="Break ends" hint="Leave blank for no break">
            <FormInput type="time" value={s.breakEnd ?? ''} onChange={(e) => set('breakEnd', e.target.value || null)} />
          </Field>
        </div>

        <div style={{ marginTop: 18 }}>
          <Field label="Working days" hint="SLA clock pauses on the days you turn off">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {DAYS.map((d) => {
                const on = s.workingDays.includes(d.v);
                return (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => toggleDay(d.v)}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      padding: '7px 14px',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      border: `1px solid ${on ? 'var(--sos-brand-primary-strong)' : 'var(--sos-border)'}`,
                      background: on ? 'var(--sos-brand-primary-soft)' : 'transparent',
                      color: on ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)',
                    }}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </GlassCard>

      {/* SLA targets */}
      <GlassCard variant="panel" padded="lg">
        <SectionTitle icon={<Clock size={14} />} title="Response SLA" />
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <Field label="Response target (minutes)" hint="Time the agent has to reply while it's their turn">
            <FormInput
              type="number"
              min={0.5}
              step={0.5}
              value={String(respMin)}
              onChange={(e) => set('slaResponseSeconds', Math.max(30, Math.round(Number(e.target.value) * 60)))}
            />
          </Field>
          <Field label="Warn before (minutes)" hint="How early the 'approaching breach' nudge fires">
            <FormInput
              type="number"
              min={0}
              step={0.5}
              value={String(warnMin)}
              onChange={(e) => set('slaWarnBeforeSeconds', Math.max(0, Math.round(Number(e.target.value) * 60)))}
            />
          </Field>
          <Field label="Reassign after N breaches" hint="Shown in the warning copy (deterrent)">
            <FormInput
              type="number"
              min={1}
              step={1}
              value={String(s.slaReassignThreshold)}
              onChange={(e) => set('slaReassignThreshold', Math.max(1, Math.round(Number(e.target.value))))}
            />
          </Field>
          <Field label="Finance-handover bonus" hint="On-time wins banked when a deal reaches finance">
            <FormInput
              type="number"
              min={0}
              step={1}
              value={String(s.slaHandoverBonus)}
              onChange={(e) => set('slaHandoverBonus', Math.max(0, Math.round(Number(e.target.value))))}
            />
          </Field>
        </div>
      </GlassCard>

      {/* Auto-acknowledgement */}
      <GlassCard variant="panel" padded="lg">
        <SectionTitle icon={<BadgeCheck size={14} />} title="Auto-acknowledgement" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={s.autoAckEnabled}
            onChange={(e) => set('autoAckEnabled', e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13.5, color: 'var(--sos-text-primary)' }}>
            Send an instant personalised greeting when a lead first messages
          </span>
        </label>
        <Field label="Greeting template" hint="Placeholders: {firstName}, {agentName}, {businessName}">
          <FormTextarea
            value={s.autoAckTemplate ?? ''}
            onChange={(e) => set('autoAckTemplate', e.target.value)}
            rows={3}
            placeholder="Hey {firstName}! I'm {agentName} from {businessName}…"
          />
        </Field>
        <div style={{ marginTop: 14 }}>
          <Field label="After-hours auto-reply (optional)" hint="Approved template name sent when a lead messages outside hours">
            <FormInput
              value={s.afterHoursTemplate ?? ''}
              onChange={(e) => set('afterHoursTemplate', e.target.value)}
              placeholder="(leave blank for none)"
            />
          </Field>
        </div>
      </GlassCard>

      {/* Sticky save at the bottom too */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <PrimaryButton
          iconLeft={saving ? <Loader2 size={15} className="sos-spin" /> : <Save size={15} />}
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </PrimaryButton>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <span style={{ color: 'var(--sos-brand-primary-strong)' }}>{icon}</span>
      <h3 className="sos-title" style={{ fontSize: 15, margin: 0 }}>{title}</h3>
    </div>
  );
}
