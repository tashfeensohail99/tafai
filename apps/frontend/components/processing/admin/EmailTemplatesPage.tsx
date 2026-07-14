'use client';
// Client Email Templates — manager-editable wording for the automated
// processing nudges (missing docs / re-submit / expiring / attestation), per
// service (+ optional program override). Backed by
// GET/POST/DELETE /processing/email-templates. When a category has no custom
// template the built-in default is shown (and used) — editing it creates a
// custom override; "Revert to default" deletes it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, Pencil, RotateCcw, X } from 'lucide-react';
import { PICKABLE_SERVICE_TYPES, labelForServiceCode } from '@/lib/service-types';
import {
  EmptyState,
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  deleteEmailTemplate,
  fetchEmailTemplates,
  saveEmailTemplate,
  type ApiEmailTemplate,
  type EmailTemplatesResponse,
} from '@/lib/processing';

const PLACEHOLDERS = ['{{clientName}}', '{{service}}', '{{country}}', '{{documentList}}'];

/** Fill placeholders with sample data so the manager sees what the client gets. */
function preview(str: string, serviceCode: string): string {
  const sample: Record<string, string> = {
    clientName: 'Ali',
    // The sender substitutes the raw service CODE (c.service), so preview it as
    // sent — the manager can type a friendlier name in the body if she prefers.
    service: serviceCode,
    country: 'Canada',
    documentList: '• Passport (bio page)\n• Bank statement (6 months)\n• Photographs',
  };
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => sample[k] ?? m);
}

interface RowModel {
  reminderType: string;
  label: string;
  // Effective wording that actually applies for the selected service + program:
  // the exact-level row, else the inherited service-level row, else the default.
  subject: string;
  body: string;
  // The row at the EXACT selected (service, program) level — what Revert removes.
  ownRow: ApiEmailTemplate | null;
  // 'program' = a program-specific override applies; 'service' = a service-level
  // custom applies; 'default' = built-in wording.
  source: 'program' | 'service' | 'default';
  // Viewing a program, no own row, but a service-level custom is inherited.
  inherited: boolean;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 'var(--sos-radius-md)',
  border: '1px solid var(--sos-border-subtle)',
  background: 'var(--sos-surface-input)',
  color: 'var(--sos-text-primary)',
  fontSize: '13.5px',
  outline: 'none',
};

export function EmailTemplatesPage() {
  const [data, setData] = useState<EmailTemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState(PICKABLE_SERVICE_TYPES[0]?.code ?? '');
  const [program, setProgram] = useState('');
  const [edit, setEdit] = useState<RowModel | null>(null);
  const [busyType, setBusyType] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchEmailTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load email templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Canonical form matches how the backend stores + resolves program codes.
  const prog = program.trim().toUpperCase();

  // For the chosen service + program, the wording each nudge type ACTUALLY uses
  // at send time — mirroring the backend's fallback ladder: a program-specific
  // override, else the service-level custom, else the built-in default.
  const rows = useMemo<RowModel[]>(() => {
    if (!data) return [];
    return data.types.map((type) => {
      const byLevel = (pc: string) =>
        data.templates.find(
          (t) => t.reminderType === type && t.service === service && t.programCode === pc,
        ) ?? null;
      const ownRow = byLevel(prog);
      const serviceRow = prog ? byLevel('') : null;
      const effective = ownRow ?? serviceRow;
      const def = data.defaults[type] ?? { subject: '', body: '' };
      const source: RowModel['source'] = ownRow
        ? prog
          ? 'program'
          : 'service'
        : serviceRow
          ? 'service'
          : 'default';
      return {
        reminderType: type,
        label: data.typeLabels[type] ?? type,
        subject: effective?.subject ?? def.subject,
        body: effective?.body ?? def.body,
        ownRow,
        source,
        inherited: !ownRow && !!serviceRow,
      };
    });
  }, [data, service, prog]);

  async function handleRevert(row: RowModel) {
    if (!row.ownRow) return;
    const ok = window.confirm(
      `Remove the custom "${row.label}" wording for ${labelForServiceCode(service)}${prog ? ` · ${prog}` : ''}? ${prog ? 'It will fall back to the service-level (or default) wording.' : 'It will revert to the built-in default.'}`,
    );
    if (!ok) return;
    setBusyType(row.reminderType);
    try {
      await deleteEmailTemplate(row.ownRow.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revert');
    } finally {
      setBusyType(null);
    }
  }

  return (
    <>
      {edit ? (
        <EditModal
          row={edit}
          service={service}
          program={prog}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            setEdit(null);
            await reload();
          }}
          onError={setError}
        />
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <PageHeader
          eyebrow="Admin"
          title="Client Email Templates"
          description="Edit the wording of the automatic reminders sent to clients about their documents, per service. Leave a category on the default, or customise it — you can also add a program-specific override (e.g. C11)."
        />

        {/* Category selector */}
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: '12.5px', color: 'var(--sos-text-muted)', fontWeight: 500 }}>
              Service (category)
              <select style={{ ...inputStyle, cursor: 'pointer', width: 'auto', minWidth: 200 }} value={service} onChange={(e) => setService(e.target.value)}>
                {PICKABLE_SERVICE_TYPES.map((s) => (
                  <option key={s.code} value={s.code}>{s.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: '12.5px', color: 'var(--sos-text-muted)', fontWeight: 500 }}>
              Program override (optional)
              <input
                style={{ ...inputStyle, width: 180 }}
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                placeholder="e.g. C11 — blank = all"
              />
            </label>
            <div style={{ fontSize: '12px', color: 'var(--sos-text-faint)', maxWidth: 320, lineHeight: 1.5 }}>
              A program override applies only to clients on that program; blank covers the whole service.
            </div>
          </div>
        </GlassCard>

        {loading ? (
          <GlassCard variant="panel" padded="lg">
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Loader2 size={14} className="sos-spin" /> Loading templates…
            </div>
          </GlassCard>
        ) : error && !data ? (
          <GlassCard variant="panel" padded="lg">
            <EmptyState title="Couldn’t load templates" description={error} action={<SecondaryButton onClick={() => void reload()}>Retry</SecondaryButton>} />
          </GlassCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {error ? <div className="sos-banner sos-banner--danger" style={{ fontSize: 12.5 }}>{error}</div> : null}
            {rows.map((row) => (
              <GlassCard key={row.reminderType} variant="panel" padded="md">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flexShrink: 0, marginTop: 2, color: 'var(--sos-brand-accent)' }}>
                    <Mail size={18} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{row.label}</span>
                      <StatusBadge tone={row.source === 'default' ? 'neutral' : row.inherited ? 'info' : 'success'} size="sm">
                        {row.source === 'program'
                          ? 'Customised (this program)'
                          : row.inherited
                            ? 'Inherits service-level'
                            : row.source === 'service'
                              ? 'Customised'
                              : 'Default'}
                      </StatusBadge>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginTop: 4 }}>
                      <strong style={{ color: 'var(--sos-text-secondary)' }}>Subject:</strong> {preview(row.subject, service)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--sos-text-faint)', marginTop: 3, whiteSpace: 'pre-wrap', maxHeight: 44, overflow: 'hidden' }}>
                      {preview(row.body, service).slice(0, 160)}…
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    <button type="button" onClick={() => setEdit(row)} style={rowBtn}>
                      <Pencil size={12} /> Edit
                    </button>
                    {row.ownRow ? (
                      <button type="button" onClick={() => void handleRevert(row)} disabled={busyType === row.reminderType} style={{ ...rowBtn, color: 'var(--sos-text-faint)' }}>
                        <RotateCcw size={12} /> {busyType === row.reminderType ? '…' : 'Revert'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const rowBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 'var(--sos-radius-sm)',
  border: '1px solid var(--sos-border-subtle)',
  background: 'transparent',
  color: 'var(--sos-text-secondary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

// ---------- Edit modal ------------------------------------------------------

function EditModal({
  row,
  service,
  program,
  onClose,
  onSaved,
  onError,
}: {
  row: RowModel;
  service: string;
  program: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [subject, setSubject] = useState(row.subject);
  const [body, setBody] = useState(row.body);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!subject.trim() || !body.trim()) {
      onError('Subject and body are both required.');
      return;
    }
    setSaving(true);
    try {
      await saveEmailTemplate({
        reminderType: row.reminderType,
        service,
        programCode: program || undefined,
        subject: subject.trim(),
        body,
      });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to save template');
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'var(--sos-bg-overlay)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', zIndex: 1000, overflowY: 'auto' }}
    >
      <div className="sos-glass sos-glass--strong" style={{ width: '100%', maxWidth: 720, borderRadius: 'var(--sos-radius-panel, 20px)', padding: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <div>
            <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)' }}>{row.label}</div>
            <div className="sos-text-faint" style={{ fontSize: 12 }}>
              {labelForServiceCode(service)}{program ? ` · ${program}` : ''} — client email
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="sos-btn sos-btn--ghost sos-btn--sm"><X size={16} /></button>
        </header>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-text-secondary)' }}>
            Subject
            <input style={inputStyle} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-text-secondary)' }}>
            Body
            <textarea style={{ ...inputStyle, minHeight: 180, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>

          <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
            Placeholders (filled in automatically per client):{' '}
            {PLACEHOLDERS.map((p) => (
              <code key={p} style={{ background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', borderRadius: 4, padding: '1px 5px', margin: '0 3px', fontSize: 11.5 }}>{p}</code>
            ))}
          </div>

          {/* Live preview */}
          <div style={{ border: '1px solid var(--sos-border-subtle)', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-1)', overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--sos-border-subtle)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sos-text-faint)' }}>
              Preview (sample data)
            </div>
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>{preview(subject, service)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--sos-text-secondary)', marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{preview(body, service)}</div>
            </div>
          </div>
        </div>

        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 18px', borderTop: '1px solid var(--sos-border-subtle)' }}>
          <SecondaryButton onClick={onClose} disabled={saving}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => void save()} disabled={saving} iconLeft={saving ? <Loader2 size={15} className="sos-spin" /> : undefined}>
            {saving ? 'Saving…' : 'Save template'}
          </PrimaryButton>
        </footer>
      </div>
    </div>
  );
}
