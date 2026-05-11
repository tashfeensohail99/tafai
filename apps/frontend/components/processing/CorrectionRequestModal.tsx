'use client';
// Correction Request Modal — Phase 1E.
// Lets an officer raise a formal correction request (DOCUMENT or INFORMATION)
// against a case and send it to the client.
// Mirrors the backend CreateCorrectionRequestDto exactly.

import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ClipboardEdit,
  FileText,
  Info,
  X,
} from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import type { MockDocumentItem, MockProcessingCase } from '@/components/processing/mockData';

// ---------------------------------------------------------------------------
// Types (mirrors backend enums)
// ---------------------------------------------------------------------------

type CorrectionType = 'DOCUMENT' | 'INFORMATION';
type RequiredAction = 'REUPLOAD' | 'CONFIRM' | 'CORRECT' | 'CALL_BACK';

// ---------------------------------------------------------------------------
// Default rejection/correction reason catalog
// Must stay in sync with processing-module.md §14 + §15
// ---------------------------------------------------------------------------

const REASON_OPTIONS: { code: string; label: string }[] = [
  { code: 'ILLEGIBLE',              label: 'Document is blurry or unreadable' },
  { code: 'WRONG_DOCUMENT',         label: 'Incorrect document type uploaded' },
  { code: 'EXPIRED',                label: 'Document has passed its expiry date' },
  { code: 'DETAILS_MISMATCH',       label: 'Name, date, or ID number does not match' },
  { code: 'INCOMPLETE',             label: 'Document appears to be missing pages' },
  { code: 'POOR_SCAN_QUALITY',      label: 'Scan quality too low for official use' },
  { code: 'SIGNATURE_MISSING',      label: 'Required signature is absent' },
  { code: 'TRANSLATION_REQUIRED',   label: 'Document is in a non-accepted language' },
  { code: 'CERTIFIED_COPY_REQUIRED','label': 'Original certified copy required' },
  { code: 'FORMAT_NOT_ACCEPTED',    label: 'File format not accepted by authority' },
  { code: 'WRONG_DATE_RANGE',       label: 'Document validity does not cover required period' },
  { code: 'DATA_INCORRECT',         label: 'Application data needs correction' },
  { code: 'DATA_MISSING',           label: 'Required information is missing' },
  { code: 'CONFIRM_DETAILS',        label: 'Client must confirm details' },
  { code: 'OTHER',                  label: 'Other — described in message to client' },
];

const REQUIRED_ACTION_OPTIONS: { value: RequiredAction; label: string; description: string }[] = [
  { value: 'REUPLOAD',   label: 'Re-upload document',     description: 'Client must upload a corrected version' },
  { value: 'CONFIRM',    label: 'Confirm information',    description: 'Client must confirm data is correct' },
  { value: 'CORRECT',    label: 'Correct information',    description: 'Client must update/correct submitted data' },
  { value: 'CALL_BACK',  label: 'Call back office',       description: 'Client must call or visit for resolution' },
];

const SLA_OPTIONS = [
  { hours: 24,  label: '24 hours' },
  { hours: 48,  label: '48 hours' },
  { hours: 72,  label: '3 days' },
  { hours: 120, label: '5 days (default)' },
  { hours: 168, label: '1 week' },
  { hours: 336, label: '2 weeks' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
      {children}
    </div>
  );
}

function FieldWrap({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-text-secondary)' }}>
        {label}{required ? <span style={{ color: 'var(--sos-status-danger)', marginLeft: '3px' }}>*</span> : null}
      </label>
      {children}
    </div>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 11px',
  borderRadius: 'var(--sos-radius-md)',
  border: '1px solid var(--sos-border-default)',
  background: 'var(--sos-bg-surface)',
  color: 'var(--sos-text-primary)',
  fontSize: '13.5px',
  outline: 'none',
  boxSizing: 'border-box',
};

const TEXTAREA_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  resize: 'vertical',
  minHeight: '72px',
  fontFamily: 'inherit',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CorrectionRequestModalProps {
  caseRecord: MockProcessingCase;
  /** Pre-selected document item (e.g. when triggered from the doc checklist row). */
  preselectedDocItemId?: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function CorrectionRequestModal({
  caseRecord: c,
  preselectedDocItemId,
  onClose,
}: CorrectionRequestModalProps) {
  // ---- form state ----
  const [correctionType, setCorrectionType] = useState<CorrectionType>(
    preselectedDocItemId ? 'DOCUMENT' : 'INFORMATION',
  );
  const [documentItemId, setDocumentItemId] = useState<string>(preselectedDocItemId ?? '');
  const [subject, setSubject] = useState('');
  const [reasonCodes, setReasonCodes] = useState<string[]>([]);
  const [officerNote, setOfficerNote] = useState('');
  const [clientMessage, setClientMessage] = useState('');
  const [requiredAction, setRequiredAction] = useState<RequiredAction>('REUPLOAD');
  const [slaHours, setSlaHours] = useState(120);

  // ---- ui state ----
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  // ---- validation ----
  const needsDocItem = correctionType === 'DOCUMENT';
  const canSubmit =
    subject.trim().length > 0 &&
    reasonCodes.length > 0 &&
    clientMessage.trim().length > 0 &&
    (!needsDocItem || documentItemId !== '');

  // Document items eligible for correction request
  const eligibleDocItems: MockDocumentItem[] = c.documentItems.filter(
    (d) => d.status !== 'ACCEPTED' && d.status !== 'WAIVED' && d.status !== 'NOT_APPLICABLE',
  );

  // ---- reason toggle ----
  function toggleReason(code: string) {
    setReasonCodes((prev) =>
      prev.includes(code) ? prev.filter((r) => r !== code) : [...prev, code],
    );
  }

  // ---- submit ----
  function handleSubmit() {
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    // Replace with real API: POST /processing/cases/:caseId/corrections
    setTimeout(() => {
      setDone(true);
      setLoading(false);
    }, 900);
  }

  // ---- backdrop click ----
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  // ---------------------------------------------------------------------------
  // Success state
  // ---------------------------------------------------------------------------

  if (done) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      >
        <div
          className="sos-glass sos-glass--strong"
          style={{ width: '100%', maxWidth: '460px', padding: '32px', borderRadius: 'var(--sos-radius-lg)', textAlign: 'center' }}
        >
          <CheckCircle2 size={44} style={{ color: 'var(--sos-status-success)', marginBottom: '14px' }} />
          <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '8px' }}>
            Correction request sent
          </div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '6px' }}>
            <strong>{c.clientName}</strong> has been notified via portal.
          </div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginBottom: '24px' }}>
            SLA: client must respond within <strong>{SLA_OPTIONS.find((o) => o.hours === slaHours)?.label ?? `${slaHours}h`}</strong>.
          </div>
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main modal
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={handleBackdropClick}
    >
      <div
        className="sos-glass sos-glass--strong"
        style={{ width: '100%', maxWidth: '580px', padding: '28px', borderRadius: 'var(--sos-radius-lg)', position: 'relative', maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}
      >
        {/* Close button */}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer', padding: '6px', borderRadius: 'var(--sos-radius-sm)' }}
        >
          <X size={16} />
        </button>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <ClipboardEdit size={13} /> Correction request
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '4px' }}>
            {c.clientName}
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)' }}>
            {c.service} · {c.targetCountry} · Case #{c.id}
          </div>
        </div>

        {/* ── Step 1: Correction type ────────────────────────────────────── */}
        <div>
          <SectionLabel>1. Correction type</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {([
              { type: 'DOCUMENT' as CorrectionType, Icon: FileText, label: 'Document correction', caption: 'Request client to re-upload or fix a specific document' },
              { type: 'INFORMATION' as CorrectionType, Icon: Info, label: 'Information correction', caption: 'Request client to correct or confirm application data' },
            ] as const).map(({ type, Icon, label, caption }) => (
              <button
                key={type}
                type="button"
                onClick={() => { setCorrectionType(type); if (type === 'INFORMATION') setDocumentItemId(''); }}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--sos-radius-md)',
                  border: `1.5px solid ${correctionType === type ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                  background: correctionType === type ? 'var(--sos-brand-primary-soft)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 150ms',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px' }}>
                  <Icon size={14} style={{ color: correctionType === type ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{label}</span>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)', lineHeight: 1.4 }}>{caption}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Step 2: Document item selector (DOCUMENT type only) ────────── */}
        {correctionType === 'DOCUMENT' && (
          <div>
            <SectionLabel>2. Select document</SectionLabel>
            {eligibleDocItems.length === 0 ? (
              <div style={{ padding: '12px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-success-soft)', border: '1px solid var(--sos-status-success-border)', fontSize: '13px', color: 'var(--sos-status-success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle2 size={15} />
                All documents are accepted or waived — no correction needed
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {eligibleDocItems.map((doc) => (
                  <label
                    key={doc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 12px',
                      borderRadius: 'var(--sos-radius-md)',
                      border: `1px solid ${documentItemId === doc.id ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                      background: documentItemId === doc.id ? 'var(--sos-brand-primary-soft)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 150ms',
                    }}
                  >
                    <input
                      type="radio"
                      name="docItem"
                      value={doc.id}
                      checked={documentItemId === doc.id}
                      onChange={() => setDocumentItemId(doc.id)}
                      style={{ accentColor: 'var(--sos-brand-primary-strong)', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                        {doc.documentName}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>{doc.description}</div>
                    </div>
                    <StatusBadge
                      tone={
                        doc.status === 'REJECTED' ? 'danger' :
                        doc.status === 'EXPIRED' ? 'danger' :
                        doc.status === 'EXPIRING_SOON' ? 'warning' :
                        'neutral'
                      }
                      size="sm"
                    >
                      {doc.status.replace(/_/g, ' ')}
                    </StatusBadge>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Subject + Reason codes ────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <SectionLabel>{correctionType === 'DOCUMENT' ? '3' : '2'}. Subject and reasons</SectionLabel>

          <FieldWrap label="Subject" required>
            <input
              type="text"
              placeholder="e.g. Educational degree needs certified copy"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              style={INPUT_STYLE}
            />
          </FieldWrap>

          <FieldWrap label="Reason codes" required>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {REASON_OPTIONS.map(({ code, label }) => (
                <label
                  key={code}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 10px',
                    borderRadius: 'var(--sos-radius-sm)',
                    border: `1px solid ${reasonCodes.includes(code) ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                    background: reasonCodes.includes(code) ? 'var(--sos-brand-primary-soft)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: 'var(--sos-text-primary)',
                    transition: 'all 120ms',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={reasonCodes.includes(code)}
                    onChange={() => toggleReason(code)}
                    style={{ accentColor: 'var(--sos-brand-primary-strong)', flexShrink: 0 }}
                  />
                  {label}
                </label>
              ))}
            </div>
            {reasonCodes.length === 0 && (
              <div style={{ fontSize: '12px', color: 'var(--sos-status-warning)', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
                <AlertTriangle size={12} /> Select at least one reason
              </div>
            )}
          </FieldWrap>
        </div>

        {/* ── Step 4: Client message + officer note ─────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <SectionLabel>{correctionType === 'DOCUMENT' ? '4' : '3'}. Message and notes</SectionLabel>

          <FieldWrap label="Message to client" required>
            <textarea
              placeholder="This is the message the client will see in their portal. Be clear and professional."
              value={clientMessage}
              onChange={(e) => setClientMessage(e.target.value)}
              maxLength={4000}
              rows={4}
              style={TEXTAREA_STYLE}
            />
            <div style={{ fontSize: '11px', color: 'var(--sos-text-muted)', textAlign: 'right' }}>
              {clientMessage.length} / 4000
            </div>
          </FieldWrap>

          <FieldWrap label="Private officer note (not sent to client)">
            <textarea
              placeholder="Internal notes for the case file — visible to your team only."
              value={officerNote}
              onChange={(e) => setOfficerNote(e.target.value)}
              maxLength={2000}
              rows={2}
              style={{ ...TEXTAREA_STYLE, minHeight: '52px' }}
            />
          </FieldWrap>
        </div>

        {/* ── Step 5: Required action + SLA ─────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <SectionLabel>{correctionType === 'DOCUMENT' ? '5' : '4'}. Required action and SLA</SectionLabel>

          <FieldWrap label="Required action" required>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {REQUIRED_ACTION_OPTIONS.map(({ value, label, description }) => (
                <label
                  key={value}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '9px 12px',
                    borderRadius: 'var(--sos-radius-md)',
                    border: `1px solid ${requiredAction === value ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                    background: requiredAction === value ? 'var(--sos-brand-primary-soft)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 150ms',
                  }}
                >
                  <input
                    type="radio"
                    name="requiredAction"
                    value={value}
                    checked={requiredAction === value}
                    onChange={() => setRequiredAction(value)}
                    style={{ accentColor: 'var(--sos-brand-primary-strong)', marginTop: '2px', flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{label}</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>{description}</div>
                  </div>
                </label>
              ))}
            </div>
          </FieldWrap>

          <FieldWrap label="Client response SLA" required>
            <select
              value={slaHours}
              onChange={(e) => setSlaHours(Number(e.target.value))}
              style={{ ...INPUT_STYLE, cursor: 'pointer' }}
            >
              {SLA_OPTIONS.map(({ hours, label }) => (
                <option key={hours} value={hours}>{label}</option>
              ))}
            </select>
            <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)', marginTop: '3px' }}>
              Client will receive reminders at 1× and 1.5× SLA. Managers see escalation at 2× SLA.
            </div>
          </FieldWrap>
        </div>

        {/* ── Error ─────────────────────────────────────────────────────── */}
        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', fontSize: '13px', color: 'var(--sos-status-danger)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '4px', borderTop: '1px solid var(--sos-border-subtle)' }}>
          <SecondaryButton onClick={onClose} disabled={loading}>
            Cancel
          </SecondaryButton>
          <PrimaryButton onClick={handleSubmit} disabled={!canSubmit || loading}>
            {loading ? 'Sending…' : 'Send correction request'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
