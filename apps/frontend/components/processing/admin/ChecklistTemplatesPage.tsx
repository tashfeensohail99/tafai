'use client';
// Checklist Templates Admin Page — Phase 2C-3.
// Manage document requirement templates per service/country.
// Backed by GET/POST/PATCH/DELETE /processing/checklist-templates.

import { useState } from 'react';
import { Edit2, FileText, Globe, ToggleLeft, ToggleRight, Plus } from 'lucide-react';
import { labelForServiceCode } from '@/lib/service-types';
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
  type TemplateRecord,
  type Criticality,
  type ValidityRule,
} from './TemplateFormModal';

// ---------- Criticality config ----------------------------------------------

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

// ---------- Mock data -------------------------------------------------------

const INITIAL_TEMPLATES: TemplateRecord[] = [
  {
    id: 'tpl-001',
    service: 'PR Application',
    targetCountry: 'Canada',
    documentName: 'Police Clearance Certificate',
    description: 'National police clearance from country of residence for past 5 years.',
    criticality: 'CRITICAL',
    validityRule: 'MUST_BE_VALID_FOR_N_MONTHS',
    validityMonths: 6,
    validityBufferDays: 30,
    expectedFormats: ['PDF'],
    maxFileSizeMb: 10,
    sortOrder: 1,
    isActive: true,
    guidanceUrl: 'https://www.rcmp-grc.gc.ca/en/criminal-record-checks',
  },
  {
    id: 'tpl-002',
    service: 'PR Application',
    targetCountry: 'Canada',
    documentName: 'Medical Examination Report',
    description: 'IRCC-approved panel physician report (IMM 1017E).',
    criticality: 'CRITICAL',
    validityRule: 'MUST_BE_VALID_FOR_N_MONTHS',
    validityMonths: 12,
    validityBufferDays: 60,
    expectedFormats: ['PDF'],
    maxFileSizeMb: 10,
    sortOrder: 2,
    isActive: true,
    guidanceUrl: '',
  },
  {
    id: 'tpl-003',
    service: 'PR Application',
    targetCountry: 'Canada',
    documentName: 'IELTS Test Result',
    description: 'Academic or General IELTS. Must be within 2 years.',
    criticality: 'REQUIRED',
    validityRule: 'MUST_BE_VALID_FOR_N_MONTHS',
    validityMonths: 24,
    validityBufferDays: 0,
    expectedFormats: ['PDF'],
    maxFileSizeMb: 5,
    sortOrder: 3,
    isActive: true,
    guidanceUrl: '',
  },
  {
    id: 'tpl-004',
    service: 'Student Visa',
    targetCountry: 'UK',
    documentName: 'CAS Letter',
    description: 'Confirmation of Acceptance for Studies from the sponsoring university.',
    criticality: 'CRITICAL',
    validityRule: 'MUST_NOT_EXPIRE',
    validityMonths: null,
    validityBufferDays: null,
    expectedFormats: ['PDF'],
    maxFileSizeMb: 5,
    sortOrder: 1,
    isActive: true,
    guidanceUrl: '',
  },
  {
    id: 'tpl-005',
    service: 'Student Visa',
    targetCountry: 'UK',
    documentName: 'Financial Evidence',
    description: 'Bank statements showing sufficient maintenance funds for the course duration.',
    criticality: 'REQUIRED',
    validityRule: 'MUST_BE_VALID_FOR_N_MONTHS',
    validityMonths: 1,
    validityBufferDays: 0,
    expectedFormats: ['PDF', 'JPG', 'PNG'],
    maxFileSizeMb: 10,
    sortOrder: 2,
    isActive: true,
    guidanceUrl: '',
  },
  {
    id: 'tpl-006',
    service: 'Work Permit',
    targetCountry: 'Australia',
    documentName: 'Skills Assessment',
    description: 'Formal skills assessment from the relevant Australian assessing authority.',
    criticality: 'CRITICAL',
    validityRule: 'MUST_NOT_EXPIRE',
    validityMonths: null,
    validityBufferDays: null,
    expectedFormats: ['PDF'],
    maxFileSizeMb: 10,
    sortOrder: 1,
    isActive: false,
    guidanceUrl: '',
  },
];

const ALL_SERVICES = [...new Set(INITIAL_TEMPLATES.map((t) => t.service))].sort();
const ALL_COUNTRIES = [...new Set(INITIAL_TEMPLATES.map((t) => t.targetCountry))].sort();

// ---------- Template row ----------------------------------------------------

interface TemplateRowProps {
  template: TemplateRecord;
  onEdit: () => void;
  onToggle: () => void;
}

function TemplateRow({ template: t, onEdit, onToggle }: TemplateRowProps) {
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
        <StatusBadge tone={t.isActive ? 'success' : 'neutral'} size="sm">
          {t.isActive ? 'Active' : 'Inactive'}
        </StatusBadge>
      </td>
      <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onEdit}
            title="Edit template"
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: 'var(--sos-radius-sm)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', transition: 'all 100ms' }}
          >
            <Edit2 size={12} /> Edit
          </button>
          <button
            type="button"
            onClick={onToggle}
            title={t.isActive ? 'Deactivate' : 'Activate'}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: 'var(--sos-radius-sm)', border: `1px solid ${t.isActive ? 'var(--sos-status-danger-border)' : 'var(--sos-status-success-border)'}`, background: t.isActive ? 'var(--sos-status-danger-soft)' : 'var(--sos-status-success-soft)', color: t.isActive ? 'var(--sos-status-danger)' : 'var(--sos-status-success)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', transition: 'all 100ms' }}
          >
            {t.isActive ? <ToggleLeft size={12} /> : <ToggleRight size={12} />}
            {t.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------- Main page -------------------------------------------------------

export function ChecklistTemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRecord[]>(INITIAL_TEMPLATES);
  const [filterService, setFilterService] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<TemplateRecord | null>(null);

  const filtered = templates.filter((t) => {
    if (filterService && t.service !== filterService) return false;
    if (filterCountry && t.targetCountry !== filterCountry) return false;
    if (filterStatus === 'active' && !t.isActive) return false;
    if (filterStatus === 'inactive' && t.isActive) return false;
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

  function toggleActive(id: string) {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isActive: !t.isActive } : t)),
    );
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
          description="Define document requirements for each service and target country."
          actions={
            <button
              type="button"
              onClick={openCreate}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '9px 18px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-brand-primary-strong)', color: '#fff', border: 'none', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer', transition: 'opacity 150ms' }}
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
              {ALL_SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select style={selectStyle} value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)}>
              <option value="">All countries</option>
              {ALL_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select style={selectStyle} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
              <option value="all">All</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
            <div style={{ marginLeft: 'auto', fontSize: '12.5px', color: 'var(--sos-text-muted)' }}>
              {filtered.length} template{filtered.length !== 1 ? 's' : ''}
            </div>
          </div>
        </GlassCard>

        {/* Table */}
        <GlassCard variant="panel" padded={false}>
          {filtered.length === 0 ? (
            <EmptyState
              title="No templates found"
              description="Adjust your filters or create a new template."
              action={<SecondaryButton onClick={openCreate}>New template</SecondaryButton>}
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--sos-border-subtle)' }}>
                    {['Document', 'Criticality', 'Service / Country', 'Validity', 'Order', 'Status', ''].map((h) => (
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
                      onToggle={() => toggleActive(t.id)}
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
