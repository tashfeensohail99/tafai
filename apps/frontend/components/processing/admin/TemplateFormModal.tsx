'use client';
// Template Form Modal — wired to real backend in P6.3.
// Create or edit a checklist template.
// Calls POST /processing/checklist-templates (create) or
//        PATCH /processing/checklist-templates/:id (edit).

import { useState } from 'react';
import { CheckCircle2, FileText, X } from 'lucide-react';
import { SERVICE_TYPES } from '@/lib/service-types';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  createDocumentTemplate,
  updateDocumentTemplate,
  type ApiDocumentTemplate,
} from '@/lib/processing';

// ---------- Types -----------------------------------------------------------

export type Criticality = 'CRITICAL' | 'REQUIRED' | 'CONDITIONAL' | 'SUPPORTING' | 'OPTIONAL';
export type ValidityRule = 'NONE' | 'MUST_NOT_EXPIRE' | 'MUST_BE_VALID_FOR_N_MONTHS';

export interface TemplateRecord {
  id: string;
  service: string;
  targetCountry: string;
  documentName: string;
  description: string;
  instructions: string;
  criticality: Criticality;
  validityRule: ValidityRule;
  validityMonths: number | null;
  validityBufferDays: number | null;
  expectedFormats: string[];
  maxFileSizeMb: number | null;
  sortOrder: number;
  isActive: boolean;
  guidanceUrl: string;
}

/**
 * Convert the API row (which uses nulls + non-null defaults) into the
 * TemplateRecord shape the page + form expect.
 */
export function templateFromApi(t: ApiDocumentTemplate): TemplateRecord {
  return {
    id: t.id,
    service: t.service,
    targetCountry: t.targetCountry,
    documentName: t.documentName,
    description: t.description ?? '',
    instructions: t.instructions ?? '',
    criticality: t.criticality,
    validityRule: t.validityRule,
    validityMonths: t.validityMonths,
    validityBufferDays: t.validityBufferDays ?? null,
    expectedFormats: t.expectedFormats ?? [],
    maxFileSizeMb: t.maxFileSizeMb ?? null,
    sortOrder: t.sortOrder,
    isActive: t.isActive,
    guidanceUrl: t.guidanceUrl ?? '',
  };
}

// ---------- Config ----------------------------------------------------------

const CRITICALITY_LABELS: Record<Criticality, string> = {
  CRITICAL: 'Critical',
  REQUIRED: 'Required',
  CONDITIONAL: 'Conditional',
  SUPPORTING: 'Supporting',
  OPTIONAL: 'Optional',
};

const CRITICALITY_TONE: Record<Criticality, BadgeTone> = {
  CRITICAL: 'danger',
  REQUIRED: 'warning',
  CONDITIONAL: 'info',
  SUPPORTING: 'neutral',
  OPTIONAL: 'neutral',
};

const VALIDITY_LABELS: Record<ValidityRule, string> = {
  NONE: 'No expiry rule',
  MUST_NOT_EXPIRE: 'Must not be expired',
  MUST_BE_VALID_FOR_N_MONTHS: 'Valid for N months from submission',
};

const FORMAT_OPTIONS = ['PDF', 'JPG', 'PNG', 'DOCX', 'XLSX', 'ZIP'];

// ---------- Field helpers ---------------------------------------------------

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
      {children}
      {required ? <span style={{ color: 'var(--sos-status-danger)', marginLeft: '3px' }}>*</span> : null}
    </div>
  );
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
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

// ---------- Component -------------------------------------------------------

interface TemplateFormModalProps {
  /** null = create mode; defined = edit mode */
  template: TemplateRecord | null;
  onClose: () => void;
  onSaved: (t: TemplateRecord) => void;
}

function blank(): Omit<TemplateRecord, 'id' | 'isActive'> {
  return {
    service: '',
    targetCountry: '',
    documentName: '',
    description: '',
    instructions: '',
    criticality: 'REQUIRED',
    validityRule: 'NONE',
    validityMonths: null,
    validityBufferDays: null,
    expectedFormats: [],
    maxFileSizeMb: null,
    sortOrder: 0,
    guidanceUrl: '',
  };
}

export function TemplateFormModal({ template, onClose, onSaved }: TemplateFormModalProps) {
  const isEdit = template !== null;

  const [form, setForm] = useState<Omit<TemplateRecord, 'id' | 'isActive'>>(() =>
    isEdit
      ? {
          service: template.service,
          targetCountry: template.targetCountry,
          documentName: template.documentName,
          description: template.description,
          instructions: template.instructions,
          criticality: template.criticality,
          validityRule: template.validityRule,
          validityMonths: template.validityMonths,
          validityBufferDays: template.validityBufferDays,
          expectedFormats: [...template.expectedFormats],
          maxFileSizeMb: template.maxFileSizeMb,
          sortOrder: template.sortOrder,
          guidanceUrl: template.guidanceUrl,
        }
      : blank(),
  );

  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  function toggleFormat(fmt: string) {
    setForm((prev) => ({
      ...prev,
      expectedFormats: prev.expectedFormats.includes(fmt)
        ? prev.expectedFormats.filter((f) => f !== fmt)
        : [...prev.expectedFormats, fmt],
    }));
  }

  const canSave =
    form.service.trim().length > 0 &&
    form.targetCountry.trim().length > 0 &&
    form.documentName.trim().length > 0 &&
    !loading;

  async function handleSave() {
    if (!canSave) return;
    setLoading(true);
    setError(null);
    try {
      // The form drives the body. We send only fields with meaningful
      // content — empty strings get dropped so the backend (which uses
      // ?? undefined to honour Prisma's null vs undefined distinction)
      // doesn't accidentally null out an existing description on edit.
      const body = {
        service: form.service,
        targetCountry: form.targetCountry,
        documentName: form.documentName,
        criticality: form.criticality,
        validityRule: form.validityRule,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.instructions.trim() ? { instructions: form.instructions.trim() } : {}),
        ...(form.expectedFormats.length > 0 ? { expectedFormats: form.expectedFormats } : {}),
        ...(form.maxFileSizeMb != null ? { maxFileSizeMb: form.maxFileSizeMb } : {}),
        ...(form.validityMonths != null ? { validityMonths: form.validityMonths } : {}),
        ...(form.validityBufferDays != null ? { validityBufferDays: form.validityBufferDays } : {}),
        ...(form.guidanceUrl.trim() ? { guidanceUrl: form.guidanceUrl.trim() } : {}),
        sortOrder: form.sortOrder,
      };
      // Service + country are immutable on edit — backend's
      // UpdateDocumentTemplateDto doesn't accept them. Strip on edit.
      const apiResult = isEdit
        ? await updateDocumentTemplate(template!.id, {
            documentName: body.documentName,
            criticality: body.criticality,
            validityRule: body.validityRule,
            description: body.description,
            instructions: body.instructions,
            expectedFormats: body.expectedFormats,
            maxFileSizeMb: body.maxFileSizeMb,
            validityMonths: body.validityMonths,
            validityBufferDays: body.validityBufferDays,
            guidanceUrl: body.guidanceUrl,
            sortOrder: body.sortOrder,
          })
        : await createDocumentTemplate(body);
      onSaved(templateFromApi(apiResult));
      setDone(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setLoading(false);
    }
  }

  /* ---- Done state ---- */
  if (done) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div className="sos-glass sos-glass--strong" style={{ width: '100%', maxWidth: '460px', padding: '28px', borderRadius: 'var(--sos-radius-lg)', textAlign: 'center' }}>
          <CheckCircle2 size={38} style={{ color: 'var(--sos-status-success)', marginBottom: '12px' }} />
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '6px' }}>
            Template {isEdit ? 'updated' : 'created'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '20px' }}>
            {form.documentName} — {form.service} / {form.targetCountry}
          </div>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="sos-glass sos-glass--strong"
        style={{ width: '100%', maxWidth: '600px', padding: '28px', borderRadius: 'var(--sos-radius-lg)', position: 'relative', maxHeight: '92vh', overflowY: 'auto' }}
      >
        {/* Close */}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer', padding: '6px' }}
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <FileText size={13} /> {isEdit ? 'Edit template' : 'New template'}
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
            {isEdit ? template!.documentName : 'Create checklist template'}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Service + Country row.
              Service is locked to the 9 canonical codes (matches Lead.serviceInterest)
              so a checklist template can be looked up at acknowledge-intake time
              with no fuzzy matching. Target country stays free-text — admins
              may target a region label like "Schengen" that isn't a single
              ISO country. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <FieldLabel required>Service</FieldLabel>
              <select
                style={inputStyle}
                value={
                  form.service && SERVICE_TYPES.some((s) => s.code === form.service)
                    ? form.service
                    : ''
                }
                onChange={(e) => set('service', e.target.value)}
              >
                <option value="" disabled>Select a service…</option>
                {SERVICE_TYPES.map((s) => (
                  <option key={s.code} value={s.code}>{s.label}</option>
                ))}
              </select>
              {form.service && !SERVICE_TYPES.some((s) => s.code === form.service) ? (
                <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
                  Legacy value: <strong>{form.service}</strong> — pick a coded type above.
                </div>
              ) : null}
            </div>
            <div>
              <FieldLabel required>Target country</FieldLabel>
              <input
                style={inputStyle}
                placeholder="e.g. Canada"
                value={form.targetCountry}
                onChange={(e) => set('targetCountry', e.target.value)}
              />
            </div>
          </div>

          {/* Document name */}
          <div>
            <FieldLabel required>Document name</FieldLabel>
            <input
              style={inputStyle}
              placeholder="e.g. Police Clearance Certificate"
              value={form.documentName}
              onChange={(e) => set('documentName', e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="Brief description of this document requirement…"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          {/* Criticality + Sort order */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <FieldLabel required>Criticality</FieldLabel>
              <select
                style={selectStyle}
                value={form.criticality}
                onChange={(e) => set('criticality', e.target.value as Criticality)}
              >
                {(Object.keys(CRITICALITY_LABELS) as Criticality[]).map((c) => (
                  <option key={c} value={c}>{CRITICALITY_LABELS[c]}</option>
                ))}
              </select>
              <div style={{ marginTop: '6px' }}>
                <StatusBadge tone={CRITICALITY_TONE[form.criticality]} size="sm">
                  {CRITICALITY_LABELS[form.criticality]}
                </StatusBadge>
              </div>
            </div>
            <div>
              <FieldLabel>Sort order</FieldLabel>
              <input
                type="number"
                style={inputStyle}
                min={0}
                value={form.sortOrder ?? 0}
                onChange={(e) => set('sortOrder', parseInt(e.target.value, 10) || 0)}
              />
              <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)', marginTop: '4px' }}>Lower = shown first</div>
            </div>
          </div>

          {/* Validity rule */}
          <div>
            <FieldLabel required>Validity rule</FieldLabel>
            <select
              style={selectStyle}
              value={form.validityRule}
              onChange={(e) => set('validityRule', e.target.value as ValidityRule)}
            >
              {(Object.keys(VALIDITY_LABELS) as ValidityRule[]).map((r) => (
                <option key={r} value={r}>{VALIDITY_LABELS[r]}</option>
              ))}
            </select>
          </div>

          {/* Validity months + buffer (conditional) */}
          {form.validityRule === 'MUST_BE_VALID_FOR_N_MONTHS' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <FieldLabel required>Valid for (months)</FieldLabel>
                <input
                  type="number"
                  style={inputStyle}
                  min={1}
                  placeholder="e.g. 6"
                  value={form.validityMonths ?? ''}
                  onChange={(e) => set('validityMonths', parseInt(e.target.value, 10) || null)}
                />
              </div>
              <div>
                <FieldLabel>Buffer days</FieldLabel>
                <input
                  type="number"
                  style={inputStyle}
                  min={0}
                  placeholder="e.g. 30"
                  value={form.validityBufferDays ?? ''}
                  onChange={(e) => set('validityBufferDays', parseInt(e.target.value, 10) || null)}
                />
                <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)', marginTop: '4px' }}>Days before expiry to warn</div>
              </div>
            </div>
          ) : null}

          {/* Expected formats */}
          <div>
            <FieldLabel>Accepted file formats</FieldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
              {FORMAT_OPTIONS.map((fmt) => {
                const checked = form.expectedFormats.includes(fmt);
                return (
                  <label
                    key={fmt}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: 'var(--sos-radius-sm)', border: `1px solid ${checked ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`, background: checked ? 'var(--sos-brand-primary-soft)' : 'transparent', cursor: 'pointer', fontSize: '12.5px', fontWeight: checked ? 600 : 400, color: checked ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)', transition: 'all 100ms' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFormat(fmt)}
                      style={{ accentColor: 'var(--sos-brand-primary-strong)' }}
                    />
                    {fmt}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Max file size + Guidance URL */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <FieldLabel>Max file size (MB)</FieldLabel>
              <input
                type="number"
                style={inputStyle}
                min={1}
                placeholder="e.g. 10"
                value={form.maxFileSizeMb ?? ''}
                onChange={(e) => set('maxFileSizeMb', parseInt(e.target.value, 10) || null)}
              />
            </div>
            <div>
              <FieldLabel>Guidance URL</FieldLabel>
              <input
                style={inputStyle}
                type="url"
                placeholder="https://…"
                value={form.guidanceUrl}
                onChange={(e) => set('guidanceUrl', e.target.value)}
              />
            </div>
          </div>
        </div>

        {error ? (
          <div style={{ marginTop: '16px', padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: '12.5px' }}>
            {error}
          </div>
        ) : null}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '22px', borderTop: '1px solid var(--sos-border-subtle)', paddingTop: '16px' }}>
          <SecondaryButton onClick={onClose} disabled={loading}>Cancel</SecondaryButton>
          <PrimaryButton onClick={handleSave} disabled={!canSave} iconLeft={<FileText size={14} />}>
            {loading ? 'Saving…' : isEdit ? 'Save changes' : 'Create template'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
