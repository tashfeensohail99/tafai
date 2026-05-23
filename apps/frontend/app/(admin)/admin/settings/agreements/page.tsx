'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FilePlus2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  FormInput,
  PrimaryButton,
  SecondaryButton,
  GhostButton,
} from '@/components/sales-v2/ui';
import {
  createAgreementTemplate,
  getAgreementTokens,
  listAgreementTemplates,
  previewAgreementTemplatePdf,
  updateAgreementTemplate,
  type AgreementTemplate,
  type PaymentStage,
} from '@/lib/agreements';

/**
 * Admin authoring for the category-based service-agreement templates that
 * Sales later picks from. Each template's body is HTML with {{TOKENS}} for
 * applicant bio + a {{PAYMENT_PLAN}} slot. "Preview PDF" renders the real
 * headless-Chrome output with sample data so the author sees the true layout.
 */

interface EditorStage {
  label: string;
  amount: string;
  trigger: string;
}

interface EditorState {
  id: string | null;
  categoryKey: string;
  name: string;
  programTitle: string;
  bodyHtml: string;
  stages: EditorStage[];
  isActive: boolean;
  sortOrder: number;
}

const DEFAULT_BODY = `<h2>1. Parties</h2>
<p>This Service Agreement is made on {{AGREEMENT_DATE}} between Tashfeen Immigration Solutions ("the Company") and {{APPLICANT_NAME}} ("the Applicant"), CNIC {{CNIC}}, residing at {{ADDRESS}}.</p>

<h2>2. Program</h2>
<p>The Company shall provide professional immigration consultancy services for the {{PROGRAM_TITLE}} program.</p>

<h2>3. Professional Fee &amp; Payment Plan</h2>
<p>The total professional fee for the above services is {{TOTAL_AMOUNT}}, payable as per the schedule below:</p>
{{PAYMENT_PLAN}}

<h2>4. Signatures</h2>
<div class="sig">
  <div class="box"><div class="line">For Tashfeen Immigration Solutions</div></div>
  <div class="box"><div class="line">Applicant — {{APPLICANT_NAME}}</div></div>
</div>`;

const BLANK: EditorState = {
  id: null,
  categoryKey: '',
  name: '',
  programTitle: '',
  bodyHtml: DEFAULT_BODY,
  stages: [],
  isActive: true,
  sortOrder: 0,
};

function toEditorStages(stages: PaymentStage[] | null): EditorStage[] {
  return (stages ?? []).map((s) => ({
    label: s.label ?? '',
    amount: s.amount == null ? '' : String(s.amount),
    trigger: s.trigger ?? '',
  }));
}

export default function AgreementTemplatesPage() {
  const [templates, setTemplates] = useState<AgreementTemplate[]>([]);
  const [tokens, setTokens] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState>(BLANK);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const reload = useCallback(async () => {
    try {
      const list = await listAgreementTemplates(true);
      setTemplates(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    getAgreementTokens()
      .then((r) => setTokens(r.tokens))
      .catch(() => undefined);
  }, [reload]);

  const isNew = editor.id === null;

  const selectTemplate = useCallback((t: AgreementTemplate) => {
    setError(null);
    setNotice(null);
    setEditor({
      id: t.id,
      categoryKey: t.categoryKey,
      name: t.name,
      programTitle: t.programTitle,
      bodyHtml: t.bodyHtml,
      stages: toEditorStages(t.defaultStages),
      isActive: t.isActive,
      sortOrder: t.sortOrder,
    });
  }, []);

  const startNew = useCallback(() => {
    setError(null);
    setNotice(null);
    setEditor(BLANK);
  }, []);

  const insertToken = useCallback(
    (token: string) => {
      const snippet = `{{${token}}}`;
      const ta = bodyRef.current;
      setEditor((prev) => {
        if (!ta) return { ...prev, bodyHtml: prev.bodyHtml + snippet };
        const start = ta.selectionStart ?? prev.bodyHtml.length;
        const end = ta.selectionEnd ?? prev.bodyHtml.length;
        const next =
          prev.bodyHtml.slice(0, start) + snippet + prev.bodyHtml.slice(end);
        requestAnimationFrame(() => {
          ta.focus();
          const pos = start + snippet.length;
          ta.setSelectionRange(pos, pos);
        });
        return { ...prev, bodyHtml: next };
      });
    },
    [],
  );

  // ── Stage helpers ──────────────────────────────────────────────────────
  const setStage = (i: number, patch: Partial<EditorStage>) =>
    setEditor((p) => ({
      ...p,
      stages: p.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    }));
  const addStage = () =>
    setEditor((p) => ({ ...p, stages: [...p.stages, { label: '', amount: '', trigger: '' }] }));
  const removeStage = (i: number) =>
    setEditor((p) => ({ ...p, stages: p.stages.filter((_, j) => j !== i) }));

  const buildPayload = useCallback(():
    | { stages: PaymentStage[] }
    | { error: string } => {
    const stages: PaymentStage[] = [];
    for (const s of editor.stages) {
      if (!s.label.trim()) continue;
      let amount: number | null = null;
      if (s.amount.trim() !== '') {
        const n = Number(s.amount);
        if (Number.isNaN(n) || n < 0) {
          return { error: `Stage "${s.label}" has an invalid amount.` };
        }
        amount = n;
      }
      stages.push({ label: s.label.trim(), amount, trigger: s.trigger.trim() || null });
    }
    return { stages };
  }, [editor.stages]);

  const validate = (): string | null => {
    if (isNew && !/^[A-Za-z0-9_-]+$/.test(editor.categoryKey.trim()))
      return 'Category key is required (letters, numbers, _ or - only).';
    if (!editor.name.trim()) return 'Name is required.';
    if (!editor.programTitle.trim()) return 'Program title is required.';
    if (!editor.bodyHtml.trim()) return 'Body is required.';
    return null;
  };

  const handleSave = async () => {
    setError(null);
    setNotice(null);
    const v = validate();
    if (v) return setError(v);
    const built = buildPayload();
    if ('error' in built) return setError(built.error);

    setSaving(true);
    try {
      if (isNew) {
        const created = await createAgreementTemplate({
          categoryKey: editor.categoryKey.trim(),
          name: editor.name.trim(),
          programTitle: editor.programTitle.trim(),
          bodyHtml: editor.bodyHtml,
          defaultStages: built.stages,
          isActive: editor.isActive,
          sortOrder: editor.sortOrder,
        });
        setNotice(`Created "${created.name}".`);
        setEditor((p) => ({ ...p, id: created.id }));
      } else {
        const updated = await updateAgreementTemplate(editor.id!, {
          name: editor.name.trim(),
          programTitle: editor.programTitle.trim(),
          bodyHtml: editor.bodyHtml,
          defaultStages: built.stages,
          isActive: editor.isActive,
          sortOrder: editor.sortOrder,
        });
        setNotice(`Saved "${updated.name}".`);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    setError(null);
    const built = buildPayload();
    if ('error' in built) return setError(built.error);
    if (!editor.programTitle.trim() || !editor.bodyHtml.trim())
      return setError('Add a program title and body before previewing.');

    setPreviewing(true);
    try {
      const blob = await previewAgreementTemplatePdf({
        programTitle: editor.programTitle.trim(),
        bodyHtml: editor.bodyHtml,
        defaultStages: built.stages,
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const sortedTemplates = useMemo(
    () =>
      [...templates].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      ),
    [templates],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Finance · Agreements"
        title="Agreement templates"
        description="Category-based service-agreement drafts Sales picks from. Bodies are HTML with {{TOKENS}} for applicant data and a {{PAYMENT_PLAN}} slot. Preview renders the real PDF with sample data."
      />

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'minmax(260px, 320px) 1fr',
          alignItems: 'start',
        }}
      >
        {/* Left — template list */}
        <GlassCard variant="default" padded={false}>
          <div
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--sos-border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-base)', margin: 0 }}>
              Templates
            </h2>
            <GhostButton size="sm" iconLeft={<FilePlus2 size={15} />} onClick={startNew}>
              New
            </GhostButton>
          </div>
          {loading ? (
            <div className="sos-text-muted" style={{ padding: 20, textAlign: 'center' }}>
              Loading…
            </div>
          ) : sortedTemplates.length === 0 ? (
            <div className="sos-text-muted" style={{ padding: 20, textAlign: 'center', fontSize: 13 }}>
              No templates yet. Click <strong>New</strong> to author the first one.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {sortedTemplates.map((t) => {
                const active = editor.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTemplate(t)}
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      border: 'none',
                      borderBottom: '1px solid var(--sos-border-subtle)',
                      borderLeft: active
                        ? '3px solid var(--sos-accent, #6366f1)'
                        : '3px solid transparent',
                      background: active ? 'var(--sos-surface-hover, rgba(99,102,241,0.06))' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                        {t.name}
                      </span>
                      <StatusBadge tone={t.isActive ? 'success' : 'neutral'} size="sm">
                        {t.isActive ? 'active' : 'inactive'}
                      </StatusBadge>
                    </div>
                    <div className="sos-text-faint" style={{ fontSize: 11, marginTop: 3, fontFamily: 'monospace' }}>
                      {t.categoryKey}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Right — editor */}
        <GlassCard variant="default">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2 className="sos-title" style={{ fontSize: 'var(--sos-text-lg)', margin: 0 }}>
                {isNew ? 'New template' : `Edit · ${editor.name || editor.categoryKey}`}
              </h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <SecondaryButton size="sm" iconLeft={<Eye size={15} />} onClick={handlePreview} disabled={previewing}>
                  {previewing ? 'Rendering…' : 'Preview PDF'}
                </SecondaryButton>
                <PrimaryButton size="sm" iconLeft={<Save size={15} />} onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </PrimaryButton>
              </div>
            </div>

            {error ? (
              <div className="sos-banner sos-banner--danger" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <AlertTriangle size={16} /> {error}
              </div>
            ) : null}
            {notice ? (
              <div className="sos-banner sos-banner--success" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CheckCircle2 size={16} /> {notice}
              </div>
            ) : null}

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <FormInput
                label="Category key"
                required
                value={editor.categoryKey}
                disabled={!isNew}
                placeholder="e.g. EB2_NIW"
                hint={isNew ? 'Stable identifier — cannot change later.' : 'Locked once created.'}
                onChange={(e) => setEditor((p) => ({ ...p, categoryKey: e.target.value }))}
              />
              <FormInput
                label="Name"
                required
                value={editor.name}
                placeholder="EB-2 NIW — USA"
                onChange={(e) => setEditor((p) => ({ ...p, name: e.target.value }))}
              />
              <FormInput
                label="Sort order"
                type="number"
                value={String(editor.sortOrder)}
                onChange={(e) => setEditor((p) => ({ ...p, sortOrder: Number(e.target.value) || 0 }))}
              />
            </div>

            <FormInput
              label="Program title"
              required
              value={editor.programTitle}
              placeholder="EB-2 NATIONAL INTEREST WAIVER PROGRAM — UNITED STATES"
              hint="Shown as the document heading."
              onChange={(e) => setEditor((p) => ({ ...p, programTitle: e.target.value }))}
            />

            {/* Token palette */}
            {tokens.length > 0 ? (
              <div>
                <label className="sos-label">Insert token</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {tokens.map((tok) => (
                    <button
                      key={tok}
                      type="button"
                      onClick={() => insertToken(tok)}
                      className="sos-text-secondary"
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--sos-border-subtle)',
                        background: 'var(--sos-surface, transparent)',
                        cursor: 'pointer',
                      }}
                      title={`Insert {{${tok}}}`}
                    >
                      {tok}
                    </button>
                  ))}
                </div>
                <div className="sos-help" style={{ marginTop: 4 }}>
                  Click to insert at the cursor. <code>{'{{PAYMENT_PLAN}}'}</code> becomes the schedule table.
                </div>
              </div>
            ) : null}

            {/* Body editor */}
            <div>
              <label className="sos-label">Body (HTML)</label>
              <textarea
                ref={bodyRef}
                className="sos-textarea"
                value={editor.bodyHtml}
                onChange={(e) => setEditor((p) => ({ ...p, bodyHtml: e.target.value }))}
                spellCheck={false}
                style={{
                  width: '100%',
                  minHeight: 360,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12.5,
                  lineHeight: 1.55,
                }}
              />
            </div>

            {/* Default payment stages */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="sos-label" style={{ margin: 0 }}>
                  Default payment stages
                </label>
                <GhostButton size="sm" iconLeft={<Plus size={14} />} onClick={addStage}>
                  Add stage
                </GhostButton>
              </div>
              <div className="sos-help" style={{ marginBottom: 8 }}>
                Default schedule shown in <code>{'{{PAYMENT_PLAN}}'}</code>. Sales can adjust per applicant later.
              </div>
              {editor.stages.length === 0 ? (
                <div className="sos-text-faint" style={{ fontSize: 12.5, padding: '6px 0' }}>
                  No stages — the preview uses a sample schedule.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {editor.stages.map((s, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr auto', gap: 8, alignItems: 'center' }}>
                      <input
                        className="sos-input"
                        placeholder="Stage label"
                        value={s.label}
                        onChange={(e) => setStage(i, { label: e.target.value })}
                      />
                      <input
                        className="sos-input"
                        placeholder="Amount"
                        inputMode="decimal"
                        value={s.amount}
                        onChange={(e) => setStage(i, { amount: e.target.value })}
                      />
                      <input
                        className="sos-input"
                        placeholder="Trigger (e.g. At signing)"
                        value={s.trigger}
                        onChange={(e) => setStage(i, { trigger: e.target.value })}
                      />
                      <GhostButton size="sm" onClick={() => removeStage(i)} aria-label="Remove stage">
                        <Trash2 size={15} />
                      </GhostButton>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--sos-text-secondary)' }}>
              <input
                type="checkbox"
                checked={editor.isActive}
                onChange={(e) => setEditor((p) => ({ ...p, isActive: e.target.checked }))}
              />
              Active (visible to Sales when authoring agreements)
            </label>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
