'use client';

// Admin · Settings · WhatsApp Template routing — tag each approved template with
// the department(s) allowed to pick it in the inbox composer. No tags = shared
// (everyone sees it). The picker filters by the agent's role; admins see all.

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, MessageSquare } from 'lucide-react';
import { EmptyState, GlassCard, PageHeader, StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';
import {
  listAdminTemplates,
  setTemplateDepartments,
  type AdminTemplate,
  type TemplateDepartment,
} from '@/lib/whatsapp-admin';

const DEPARTMENTS: { key: TemplateDepartment; label: string }[] = [
  { key: 'SALES', label: 'Sales' },
  { key: 'FINANCE', label: 'Finance' },
  { key: 'PROCESSING', label: 'Processing' },
];

function statusTone(status: AdminTemplate['status']): BadgeTone {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED' || status === 'DISABLED') return 'danger';
  return 'warning';
}

export default function WhatsAppTemplateRoutingPage() {
  const [templates, setTemplates] = useState<AdminTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await listAdminTemplates());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="WhatsApp · Settings"
        title="Template routing"
        description="Choose which department sees each approved template in the inbox composer. A template with no department selected is shared — everyone sees it. Admins always see every template."
      />

      <div
        className="sos-banner sos-banner--info"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5 }}
      >
        <MessageSquare size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Agents see only the templates tagged for their team (Sales / Finance / Processing), plus any
          left untagged (shared). Changes save instantly — no re-sync needed. This only affects the
          human picker; the AI bot and automated sends are unaffected.
        </span>
      </div>

      <GlassCard variant="default" padded="lg">
        {loading ? (
          <div className="sos-text-muted" style={{ padding: 24, textAlign: 'center' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading templates…
          </div>
        ) : error ? (
          <div className="sos-banner sos-banner--danger">
            <span>{error}</span>
          </div>
        ) : templates.length === 0 ? (
          <EmptyState
            Icon={MessageSquare}
            title="No templates yet"
            description="Approved templates from Meta appear here after a sync (Settings → WhatsApp Channels → Sync templates)."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {templates.map((t) => (
              <TemplateRow key={t.id} template={t} />
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function TemplateRow({ template }: { template: AdminTemplate }) {
  const [depts, setDepts] = useState<TemplateDepartment[]>(template.departments);
  const [saving, setSaving] = useState<TemplateDepartment | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(key: TemplateDepartment) {
    const next = depts.includes(key) ? depts.filter((d) => d !== key) : [...depts, key];
    const prev = depts;
    setDepts(next);
    setSaving(key);
    setErr(null);
    try {
      await setTemplateDepartments(template.id, next);
    } catch (e) {
      setDepts(prev); // revert on failure
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: 14,
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="sos-title" style={{ fontSize: 'var(--sos-text-base)' }}>{template.name}</span>
          <StatusBadge tone={statusTone(template.status)} size="sm">{template.status.toLowerCase()}</StatusBadge>
          <StatusBadge tone="info" size="sm">{template.category.toLowerCase()}</StatusBadge>
        </div>
        <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>
          {template.language}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {DEPARTMENTS.map((d) => {
          const active = depts.includes(d.key);
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => void toggle(d.key)}
              disabled={saving !== null}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 12px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 500,
                cursor: saving !== null ? 'default' : 'pointer',
                border: `1px solid ${active ? 'var(--sos-border-accent)' : 'var(--sos-border)'}`,
                background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface)',
                color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
              }}
            >
              {saving === d.key ? (
                <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              ) : active ? (
                <Check size={12} />
              ) : null}
              {d.label}
            </button>
          );
        })}
        <span style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', minWidth: 96 }}>
          {depts.length === 0 ? 'Shared — everyone' : `${depts.length} team${depts.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {err ? (
        <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--sos-status-danger)' }}>{err}</div>
      ) : null}
    </div>
  );
}
