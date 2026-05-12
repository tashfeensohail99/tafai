'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, Search, Send } from 'lucide-react';
import {
  Field,
  FormInput,
  GhostButton,
  PrimaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  buildTemplateComponents,
  countTemplateBodyParams,
  listTemplates,
  sendTemplate,
  type WhatsAppTemplate,
} from '@/lib/whatsapp';
import { Modal } from './Modal';

/**
 * Template picker — opens from the chat composer when the 24-hour customer-
 * service window has expired (templates required) or whenever the agent
 * wants to send an approved template.
 *
 * Flow:
 *   1. Fetch approved templates for the thread's channel.
 *   2. Agent searches by name, picks one.
 *   3. We detect `{{1}}, {{2}}, …` body placeholders and render one input
 *      per parameter. Header parameters are not exposed in MVP — header text
 *      is rendered as-is to keep the picker simple.
 *   4. On submit, build the `components` payload and POST to the existing
 *      `sendTemplate` API. Parent reloads the thread.
 */
export function TemplatePickerModal(props: {
  open: boolean;
  onClose: () => void;
  threadId: string;
  channelId: string;
  onSent: () => void;
}) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setTemplates(null);
    setLoadError(null);
    setSearch('');
    setSelectedId(null);
    setParams([]);
    setSendError(null);
    setSending(false);
    listTemplates(props.channelId)
      .then((rows) => setTemplates(rows))
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : 'Failed to load templates'),
      );
  }, [props.open, props.channelId]);

  const filtered = useMemo(() => {
    if (!templates) return [];
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        bodyOf(t)?.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }, [templates, search]);

  const selected = useMemo(
    () => templates?.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const expectedParams = selected ? countTemplateBodyParams(selected) : 0;

  useEffect(() => {
    setParams(Array.from({ length: expectedParams }, () => ''));
  }, [expectedParams, selectedId]);

  const allParamsFilled = params.slice(0, expectedParams).every((v) => v.trim().length > 0);

  const onSend = async () => {
    if (!selected) return;
    if (expectedParams > 0 && !allParamsFilled) {
      setSendError('Fill in all template parameters before sending');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await sendTemplate(props.threadId, {
        templateName: selected.name,
        language: selected.language,
        components: buildTemplateComponents(selected, params),
      });
      props.onSent();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send template');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Send template message"
      width={720}
      footer={
        <>
          <GhostButton onClick={props.onClose}>Cancel</GhostButton>
          <PrimaryButton
            onClick={onSend}
            disabled={!selected || sending || (expectedParams > 0 && !allParamsFilled)}
            iconLeft={<Send size={14} />}
          >
            {sending ? 'Sending…' : 'Send template'}
          </PrimaryButton>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
        {/* Left: list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <FormInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, body, category…"
            iconLeft={<Search size={14} />}
          />
          {loadError ? (
            <div className="sos-banner sos-banner--danger">
              <AlertTriangle size={14} /> <span>{loadError}</span>
            </div>
          ) : !templates ? (
            <div className="sos-text-muted" style={{ padding: 16, textAlign: 'center' }}>
              Loading templates…
            </div>
          ) : filtered.length === 0 ? (
            <div className="sos-text-muted" style={{ padding: 16, textAlign: 'center' }}>
              {templates.length === 0
                ? 'No approved templates for this channel yet.'
                : 'No templates match your search.'}
            </div>
          ) : (
            <div
              className="sos-scroll"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 320,
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    borderRadius: 'var(--sos-radius-sm)',
                    border: '1px solid',
                    borderColor:
                      selectedId === t.id ? 'var(--sos-brand-primary)' : 'var(--sos-border-subtle)',
                    background:
                      selectedId === t.id
                        ? 'var(--sos-brand-primary-soft, var(--sos-surface-1))'
                        : 'var(--sos-surface-1)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                      <FileText size={13} style={{ flexShrink: 0 }} />
                      <strong
                        style={{
                          fontSize: 'var(--sos-text-sm)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t.name}
                      </strong>
                    </span>
                    <StatusBadge tone={categoryTone(t.category)} size="sm">
                      {t.category}
                    </StatusBadge>
                  </div>
                  <div
                    className="sos-text-muted"
                    style={{
                      fontSize: 'var(--sos-text-xs)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.language} · {bodyOf(t)?.slice(0, 90) ?? '(no body)'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: preview + params */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          {!selected ? (
            <div
              className="sos-text-muted"
              style={{
                padding: 24,
                textAlign: 'center',
                border: '1px dashed var(--sos-border-subtle)',
                borderRadius: 'var(--sos-radius-sm)',
                fontSize: 'var(--sos-text-sm)',
              }}
            >
              Pick a template to preview and fill in placeholders.
            </div>
          ) : (
            <>
              <div className="sos-eyebrow">Preview</div>
              <div
                style={{
                  padding: 12,
                  borderRadius: 'var(--sos-radius-sm)',
                  background: 'var(--sos-surface-1)',
                  border: '1px solid var(--sos-border-subtle)',
                  fontSize: 'var(--sos-text-sm)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {renderPreview(selected, params)}
              </div>
              {expectedParams > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="sos-eyebrow">Parameters</div>
                  {Array.from({ length: expectedParams }).map((_, i) => (
                    <Field key={i} label={`{{${i + 1}}}`} required>
                      <FormInput
                        value={params[i] ?? ''}
                        onChange={(e) => {
                          const next = [...params];
                          next[i] = e.target.value;
                          setParams(next);
                        }}
                        placeholder={`Value for placeholder ${i + 1}`}
                      />
                    </Field>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {sendError && (
        <div className="sos-banner sos-banner--danger" style={{ marginTop: 12 }}>
          <AlertTriangle size={14} /> <span>{sendError}</span>
        </div>
      )}
    </Modal>
  );
}

// ---- helpers ------------------------------------------------------------

function bodyOf(t: WhatsAppTemplate): string | null {
  return t.components.find((c) => c.type === 'BODY')?.text ?? null;
}

function categoryTone(
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION',
): 'info' | 'violet' | 'warning' {
  switch (category) {
    case 'UTILITY':
      return 'info';
    case 'AUTHENTICATION':
      return 'violet';
    case 'MARKETING':
      return 'warning';
  }
}

function renderPreview(t: WhatsAppTemplate, params: string[]): string {
  const lines: string[] = [];
  for (const c of t.components) {
    if (c.type === 'HEADER' && c.format === 'TEXT' && c.text) lines.push(c.text);
    else if (c.type === 'HEADER' && c.format && c.format !== 'TEXT')
      lines.push(`[${c.format.toLowerCase()} header]`);
    else if (c.type === 'BODY' && c.text) lines.push(substitute(c.text, params));
    else if (c.type === 'FOOTER' && c.text) lines.push(c.text);
    else if (c.type === 'BUTTONS' && c.buttons?.length) {
      lines.push('');
      for (const b of c.buttons) lines.push(`[ ${b.text} ]`);
    }
  }
  return lines.join('\n\n');
}

function substitute(text: string, params: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_, idx: string) => {
    const i = Number(idx) - 1;
    const v = params[i];
    return v && v.length > 0 ? v : `{{${idx}}}`;
  });
}
