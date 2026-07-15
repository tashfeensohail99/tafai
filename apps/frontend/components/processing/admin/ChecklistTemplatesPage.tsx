'use client';
// Checklist Templates Admin Page — wired to real backend in P6.3.
// Manage document requirement templates per service/country.
// Backed by GET/POST/PATCH/DELETE /processing/checklist-templates.

import { useCallback, useEffect, useState } from 'react';
import { Edit2, FileText, Globe, Loader2, ToggleLeft, Plus } from 'lucide-react';
import { PICKABLE_SERVICE_TYPES, labelForServiceCode } from '@/lib/service-types';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  SecondaryButton,
  EmptyState,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  TemplateFormModal,
  templateFromApi,
  type TemplateRecord,
  type Criticality,
  type ValidityRule,
} from './TemplateFormModal';
import {
  fetchChecklistTemplates,
  deactivateDocumentTemplate,
} from '@/lib/processing';

const CRITICALITY_TONE: Record<Criticality, BadgeTone> = {
  CRITICAL: 'danger',
  REQUIRED: 'warning',
  CONDITIONAL: 'info',
  SUPPORTING: 'neutral',
  OPTIONAL: 'neutral',
};

const VALIDITY_SHORT: Record<ValidityRule, string> = {
  NONE: 'None',
  MUST_NOT_EXPIRE: 'Must not expire',
  MUST_BE_VALID_FOR_N_MONTHS: 'Valid N months',
};

// ---------- Template row ----------------------------------------------------

interface TemplateRowProps {
  template: TemplateRecord;
  onEdit: () => void;
  onDeactivate: () => void;
  busy: boolean;
}

function TemplateRow({ template: t, onEdit, onDeactivate, busy }: TemplateRowProps) {
  return (
    <tr style={{ borderBottom: '1px solid var(--sos-border-subtle)' }}>
      <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
        <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{t.documentName}</div>
        {t.description ? (
          <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '2px', maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.description}
          </div>
        ) : null}
      </td>
      <td style={{ padding: '12px 14px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
        <StatusBadge tone={CRITICALITY_TONE[t.criticality]} size="sm">
          {t.criticality}
        </StatusBadge>
      </td>
      <td style={{ padding: '12px 14px', verticalAlign: 'middle', fontSize: '13px', color: 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Globe size={12} />
          {labelForServiceCode(t.service)}
        </div>
        <div style={{ fontSize: '12px', marginTop: '1px' }}>{t.targetCountry}</div>
      </td>
      <td style={{ padding: '12px 14px', verticalAlign: 'middle', fontSize: '12.5px', color: 'var(--sos-text-muted)', whiteSpace: 'nowrap' }}>
        {VALIDITY_SHORT[t.validityRule]}
        {t.validityMonths ? <span style={{ color: 'var(--sos-text-primary)', fontWeight: 500 }}> ({t.validityMonths}mo)</span> : null}
      </td>
      <td style={{ padding: '12px 14px', verticalAlign: 'middle', fontSize: '12px', color: 'var(--sos-text-muted)', textAlign: 'center' }}>
        {t.sortOrder}
      </td>
      <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            title="Edit template"
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: 'var(--sos-radius-sm)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: '12px', fontWeight: 500, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.5 : 1 }}
          >
            <Edit2 size={12} /> Edit
          </button>
          <button
            type="button"
            onClick={onDeactivate}
            disabled={busy}
            title="Deactivate template — hides it from new acknowledgments"
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: 'var(--sos-radius-sm)', border: '1px solid var(--sos-status-danger-border)', background: 'var(--sos-status-danger-soft)', color: 'var(--sos-status-danger)', fontSize: '12px', fontWeight: 500, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.5 : 1 }}
          >
            <ToggleLeft size={12} />
            {busy ? 'Saving…' : 'Deactivate'}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------- Main page -------------------------------------------------------

export function ChecklistTemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filterService, setFilterService] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<TemplateRecord | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The backend only ever returns isActive=true rows, so the page shows
      // a clean working set. Deactivated templates stay in the DB for audit
      // but disappear from the admin view; admin can recreate if needed.
      const rows = await fetchChecklistTemplates();
      setTemplates(rows.map(templateFromApi));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // Derived dropdown options — pulled from what actually exists. As admins
  // create templates for new services/countries the filters expand.
  const allCountries = [...new Set(templates.map((t) => t.targetCountry))].sort();

  const filtered = templates.filter((t) => {
    if (filterService && t.service !== filterService) return false;
    if (filterCountry && t.targetCountry !== filterCountry) return false;
    return true;
  });

  function openCreate() {
    setEditTarget(null);
    setShowModal(true);
  }

  function openEdit(t: TemplateRecord) {
    setEditTarget(t);
    setShowModal(true);
  }

  async function handleDeactivate(id: string) {
    const target = templates.find((t) => t.id === id);
    if (!target) return;
    const ok = window.confirm(`Deactivate "${target.documentName}" for ${labelForServiceCode(target.service)} → ${target.targetCountry}? It will no longer be added to new cases. Existing cases keep their copy.`);
    if (!ok) return;
    setBusyId(id);
    // Optimistic: drop from the visible list. Server is source of truth on reload.
    const prev = templates;
    setTemplates((curr) => curr.filter((t) => t.id !== id));
    try {
      await deactivateDocumentTemplate(id);
    } catch (e: unknown) {
      // Restore and surface the error.
      setTemplates(prev);
      setError(e instanceof Error ? e.message : 'Failed to deactivate');
    } finally {
      setBusyId(null);
    }
  }

  function handleSaved(saved: TemplateRecord) {
    setTemplates((prev) => {
      const exists = prev.find((t) => t.id === saved.id);
      if (exists) return prev.map((t) => (t.id === saved.id ? saved : t));
      return [...prev, saved];
    });
  }

  const selectStyle: React.CSSProperties = {
    padding: '7px 12px',
    borderRadius: 'var(--sos-radius-md)',
    border: '1px solid var(--sos-border-subtle)',
    background: 'var(--sos-surface-input)',
    color: 'var(--sos-text-primary)',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
  };

  return (
    <>
      {showModal ? (
        <TemplateFormModal
          template={editTarget}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <PageHeader
          eyebrow="Admin"
          title="Checklist Templates"
          description="Define document requirements per service + target country. Templates marked GLOBAL apply when there's no country-specific override."
          actions={
            <button
              type="button"
              onClick={openCreate}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '9px 18px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-brand-primary-strong)', color: '#fff', border: 'none', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer' }}
            >
              <Plus size={14} /> New template
            </button>
          }
        />

        {/* Filter bar */}
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--sos-text-muted)', fontWeight: 500 }}>
              <FileText size={13} /> Filter:
            </div>
            <select style={selectStyle} value={filterService} onChange={(e) => setFilterService(e.target.value)}>
              <option value="">All services</option>
              {PICKABLE_SERVICE_TYPES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
            <select style={selectStyle} value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)}>
              <option value="">All countries</option>
              {allCountries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ marginLeft: 'auto', fontSize: '12.5px', color: 'var(--sos-text-muted)' }}>
              {filtered.length} template{filtered.length !== 1 ? 's' : ''}
            </div>
          </div>
        </GlassCard>

        {/* Table */}
        <GlassCard variant="panel" padded={false}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Loader2 size={14} className="sos-spin" /> Loading templates…
            </div>
          ) : error ? (
            <div style={{ padding: 24, color: 'var(--sos-status-danger)', fontSize: 13 }}>
              Failed to load templates: {error}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title={templates.length === 0 ? 'No templates yet' : 'No templates match this filter'}
              description={
                templates.length === 0
                  ? 'Create your first template — or rely on the seeded GLOBAL templates per service.'
                  : 'Adjust your filters or create a new template.'
              }
              action={<SecondaryButton onClick={openCreate}>New template</SecondaryButton>}
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--sos-border-subtle)' }}>
                    {['Document', 'Criticality', 'Service / Country', 'Validity', 'Order', ''].map((h) => (
                      <th
                        key={h}
                        style={{ padding: '10px 14px', textAlign: h === '' ? 'right' : 'left', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <TemplateRow
                      key={t.id}
                      template={t}
                      onEdit={() => openEdit(t)}
                      onDeactivate={() => handleDeactivate(t.id)}
                      busy={busyId === t.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </div>
    </>
  );
}
