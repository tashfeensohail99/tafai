'use client';
// Authority Submissions Tab — Phase 2B.
// Tracks each submission to the immigration authority:
//   - Submission reference, tracking number, status
//   - Response recording (type, notes)
//   - Appeal flow banner (REJECTED stage only)

import { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  FileText,
  Flag,
  Info,
  MessageSquare,
  PlusCircle,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
import {
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  EmptyState,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  type MockAuthoritySubmission,
  fmtDate,
} from '@/components/processing/mockData';

// ---------- Status / response tone helpers --------------------------------

type SubmissionStatus = MockAuthoritySubmission['status'];
type ResponseType = NonNullable<MockAuthoritySubmission['responseType']>;

function submissionStatusTone(status: SubmissionStatus): BadgeTone {
  switch (status) {
    case 'SUBMITTED':    return 'info';
    case 'ACKNOWLEDGED': return 'accent';
    case 'UNDER_REVIEW': return 'warning';
    case 'RESPONDED':    return 'success';
    case 'WITHDRAWN':    return 'neutral';
    default:             return 'neutral';
  }
}

function submissionStatusLabel(status: SubmissionStatus): string {
  switch (status) {
    case 'SUBMITTED':    return 'Submitted';
    case 'ACKNOWLEDGED': return 'Acknowledged';
    case 'UNDER_REVIEW': return 'Under Review';
    case 'RESPONDED':    return 'Response Received';
    case 'WITHDRAWN':    return 'Withdrawn';
    default:             return status;
  }
}

function responseTypeTone(type: ResponseType): BadgeTone {
  switch (type) {
    case 'APPROVAL':            return 'success';
    case 'REJECTION':           return 'danger';
    case 'INFO_REQUEST':        return 'warning';
    case 'BIOMETRICS_REQUEST':  return 'accent';
    case 'OTHER':               return 'neutral';
    default:                    return 'neutral';
  }
}

function responseTypeLabel(type: ResponseType): string {
  switch (type) {
    case 'APPROVAL':            return 'Approved';
    case 'REJECTION':           return 'Rejected';
    case 'INFO_REQUEST':        return 'Info Requested';
    case 'BIOMETRICS_REQUEST':  return 'Biometrics Required';
    case 'OTHER':               return 'Other';
    default:                    return type;
  }
}

// ---------- Submission record row ----------------------------------------

interface SubmissionRowProps {
  submission: MockAuthoritySubmission;
  onUpdate: (id: string, patch: Partial<MockAuthoritySubmission>) => void;
}

function SubmissionRow({ submission, onUpdate }: SubmissionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [trackingDraft, setTrackingDraft] = useState(submission.trackingNumber ?? '');
  const [statusDraft, setStatusDraft] = useState<SubmissionStatus>(submission.status);
  const [responseTypeDraft, setResponseTypeDraft] = useState<ResponseType | ''>(submission.responseType ?? '');
  const [responseNotesDraft, setResponseNotesDraft] = useState(submission.responseNotes ?? '');
  const [nextActionDraft, setNextActionDraft] = useState(submission.nextAction ?? '');
  const [saving, setSaving] = useState(false);

  function handleSave() {
    setSaving(true);
    // Optimistic update — in production calls PATCH /processing/cases/:id/submissions/:subId
    setTimeout(() => {
      onUpdate(submission.id, {
        trackingNumber: trackingDraft || null,
        status: statusDraft,
        responseType: responseTypeDraft || null,
        responseNotes: responseNotesDraft || null,
        nextAction: nextActionDraft || null,
        responseReceivedAt: responseTypeDraft && !submission.responseReceivedAt
          ? new Date().toISOString()
          : submission.responseReceivedAt,
      });
      setSaving(false);
      setExpanded(false);
    }, 400);
  }

  return (
    <div
      style={{
        borderRadius: 'var(--sos-radius-lg)',
        border: '1px solid var(--sos-border-subtle)',
        background: 'var(--sos-surface-base)',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '32px 1fr auto',
          gap: '10px',
          padding: '14px 16px',
          alignItems: 'flex-start',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Submission number badge */}
        <div style={{
          width: '32px', height: '32px', borderRadius: 'var(--sos-radius-md)',
          background: 'var(--sos-surface-hover)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '13px', fontWeight: 700, color: 'var(--sos-text-primary)',
          flexShrink: 0,
        }}>
          #{submission.submissionNumber}
        </div>

        {/* Main content */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {submission.authority}
            </span>
            <StatusBadge tone={submissionStatusTone(submission.status)} size="sm">
              {submissionStatusLabel(submission.status)}
            </StatusBadge>
            {submission.responseType ? (
              <StatusBadge tone={responseTypeTone(submission.responseType)} size="sm" dot={false}>
                {responseTypeLabel(submission.responseType)}
              </StatusBadge>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Calendar size={12} /> Filed {fmtDate(submission.submissionDate)}
            </span>
            {submission.submissionReference ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <FileText size={12} /> Ref: {submission.submissionReference}
              </span>
            ) : null}
            {submission.trackingNumber ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ClipboardList size={12} /> Tracking: {submission.trackingNumber}
              </span>
            ) : null}
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} /> By {submission.submittedByName}
            </span>
          </div>

          {submission.nextAction ? (
            <div style={{ marginTop: '6px', display: 'flex', alignItems: 'flex-start', gap: '5px', fontSize: '12px', color: 'var(--sos-status-info)', fontStyle: 'italic' }}>
              <Flag size={11} style={{ marginTop: '2px', flexShrink: 0 }} /> {submission.nextAction}
            </div>
          ) : null}

          {submission.responseNotes ? (
            <div style={{ marginTop: '6px', padding: '6px 10px', borderRadius: 'var(--sos-radius-sm)', background: 'var(--sos-surface-hover)', fontSize: '12px', color: 'var(--sos-text-secondary)' }}>
              <Info size={11} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              {submission.responseNotes}
            </div>
          ) : null}
        </div>

        {/* Expand/collapse */}
        <div style={{ color: 'var(--sos-text-muted)', paddingTop: '6px' }}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Inline update form */}
      {expanded ? (
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Update Submission
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {/* Tracking number */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Tracking Number</label>
              <input
                type="text"
                value={trackingDraft}
                onChange={(e) => setTrackingDraft(e.target.value)}
                placeholder="e.g. TRK-00381-A"
                style={{
                  padding: '7px 10px', borderRadius: 'var(--sos-radius-sm)',
                  border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-base)',
                  color: 'var(--sos-text-primary)', fontSize: '13px', outline: 'none',
                }}
              />
            </div>

            {/* Status */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Submission Status</label>
              <select
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value as SubmissionStatus)}
                style={{
                  padding: '7px 10px', borderRadius: 'var(--sos-radius-sm)',
                  border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-base)',
                  color: 'var(--sos-text-primary)', fontSize: '13px', outline: 'none',
                }}
              >
                <option value="SUBMITTED">Submitted</option>
                <option value="ACKNOWLEDGED">Acknowledged</option>
                <option value="UNDER_REVIEW">Under Review</option>
                <option value="RESPONDED">Response Received</option>
                <option value="WITHDRAWN">Withdrawn</option>
              </select>
            </div>

            {/* Response type */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Authority Response</label>
              <select
                value={responseTypeDraft}
                onChange={(e) => setResponseTypeDraft(e.target.value as ResponseType | '')}
                style={{
                  padding: '7px 10px', borderRadius: 'var(--sos-radius-sm)',
                  border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-base)',
                  color: 'var(--sos-text-primary)', fontSize: '13px', outline: 'none',
                }}
              >
                <option value="">— no response yet —</option>
                <option value="APPROVAL">Approved</option>
                <option value="REJECTION">Rejected</option>
                <option value="INFO_REQUEST">Additional Info Requested</option>
                <option value="BIOMETRICS_REQUEST">Biometrics Required</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            {/* Next action */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Next Action</label>
              <input
                type="text"
                value={nextActionDraft}
                onChange={(e) => setNextActionDraft(e.target.value)}
                placeholder="e.g. Await biometrics appointment"
                style={{
                  padding: '7px 10px', borderRadius: 'var(--sos-radius-sm)',
                  border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-base)',
                  color: 'var(--sos-text-primary)', fontSize: '13px', outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Response notes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Response Notes (from authority letter/email)</label>
            <textarea
              rows={3}
              value={responseNotesDraft}
              onChange={(e) => setResponseNotesDraft(e.target.value)}
              placeholder="Paste or type the authority's response details here…"
              style={{
                padding: '8px 10px', borderRadius: 'var(--sos-radius-sm)',
                border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-base)',
                color: 'var(--sos-text-primary)', fontSize: '13px', outline: 'none', resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <SecondaryButton size="sm" onClick={() => setExpanded(false)}>Cancel</SecondaryButton>
            <PrimaryButton size="sm" onClick={handleSave} disabled={saving} iconLeft={saving ? <RefreshCw size={13} /> : undefined}>
              {saving ? 'Saving…' : 'Save Update'}
            </PrimaryButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Log new submission inline form --------------------------------

interface NewSubmissionFormProps {
  onSave: (data: Omit<MockAuthoritySubmission, 'id' | 'createdAt' | 'submissionNumber'>) => void;
  onCancel: () => void;
  nextNumber: number;
}

function NewSubmissionForm({ onSave, onCancel, nextNumber }: NewSubmissionFormProps) {
  const [authority, setAuthority] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [tracking, setTracking] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [saving, setSaving] = useState(false);

  function handleSubmit() {
    if (!authority || !date) return;
    setSaving(true);
    setTimeout(() => {
      onSave({
        submittedByName: 'Sara Malik', // In production: current user name
        submissionDate: date,
        submissionReference: reference || null,
        authority,
        documentsIncluded: [],
        trackingNumber: tracking || null,
        status: 'SUBMITTED',
        responseReceivedAt: null,
        responseType: null,
        responseNotes: null,
        nextAction: nextAction || null,
      });
      setSaving(false);
    }, 400);
  }

  const valid = authority.trim() !== '' && date !== '';

  return (
    <GlassCard variant="soft" padded="md">
      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Send size={14} style={{ color: 'var(--sos-brand-primary)' }} />
        Log Submission #{nextNumber}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Authority / Embassy <span style={{ color: 'var(--sos-status-danger)' }}>*</span></label>
          <input
            type="text"
            value={authority}
            onChange={(e) => setAuthority(e.target.value)}
            placeholder="e.g. UK Visas and Immigration (UKVI)"
            style={{
              padding: '8px 10px', borderRadius: 'var(--sos-radius-sm)',
              border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-base)',
              color: 'var(--sos-text-primary)', fontSize: '13px', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Submission Date <span style={{ color: 'var(--sos-status-danger)' }}>*</span></label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              padding: '8px 10px', borderRadius: 'var(--sos-radius-sm)',
              border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-base)',
              color: 'var(--sos-text-primary)', fontSize: '13px', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Submission Reference</label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. GWF-2026-0052871"
            style={{
              padding: '8px 10px', borderRadius: 'var(--sos-radius-sm)',
              border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-base)',
              color: 'var(--sos-text-primary)', fontSize: '13px', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Tracking Number</label>
          <input
            type="text"
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            placeholder="e.g. TRK-00381-A"
            style={{
              padding: '8px 10px', borderRadius: 'var(--sos-radius-sm)',
              border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-base)',
              color: 'var(--sos-text-primary)', fontSize: '13px', outline: 'none',
            }}
          />
        </div>

        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>Next Action</label>
          <input
            type="text"
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder="e.g. Await acknowledgement within 5 working days"
            style={{
              padding: '8px 10px', borderRadius: 'var(--sos-radius-sm)',
              border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-base)',
              color: 'var(--sos-text-primary)', fontSize: '13px', outline: 'none',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
        <SecondaryButton size="sm" onClick={onCancel}>Cancel</SecondaryButton>
        <PrimaryButton size="sm" onClick={handleSubmit} disabled={!valid || saving} iconLeft={<Send size={13} />}>
          {saving ? 'Saving…' : 'Log Submission'}
        </PrimaryButton>
      </div>
    </GlassCard>
  );
}

// ---------- Appeal banner (REJECTED stage) --------------------------------

function AppealBanner({ onFileAppeal }: { onFileAppeal: () => void }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 'var(--sos-radius-lg)',
      background: 'var(--sos-status-warning-soft)',
      border: '1px solid var(--sos-status-warning-border)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
    }}>
      <AlertTriangle size={18} style={{ color: 'var(--sos-status-warning)', flexShrink: 0, marginTop: '1px' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: '4px' }}>
          Case Rejected — Appeal Available
        </div>
        <div style={{ fontSize: '13px', color: 'var(--sos-text-secondary)', marginBottom: '10px' }}>
          The authority has rejected this application. If there are grounds for appeal, a manager can approve filing an appeal. This will move the case to <strong>Appeal In Progress</strong>.
        </div>
        <PrimaryButton size="sm" onClick={onFileAppeal} iconLeft={<Flag size={13} />}>
          File Appeal (Requires Manager Approval)
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---------- Main tab component --------------------------------------------

export function SubmissionsTab({ c }: { c: MockProcessingCase }) {
  const [submissions, setSubmissions] = useState<MockAuthoritySubmission[]>(c.submissions);
  const [showNewForm, setShowNewForm] = useState(false);
  const [appealFiled, setAppealFiled] = useState(false);

  function handleUpdate(id: string, patch: Partial<MockAuthoritySubmission>) {
    setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function handleNewSubmission(data: Omit<MockAuthoritySubmission, 'id' | 'createdAt' | 'submissionNumber'>) {
    const newSub: MockAuthoritySubmission = {
      ...data,
      id: `sub-new-${Date.now()}`,
      submissionNumber: submissions.length + 1,
      createdAt: new Date().toISOString(),
    };
    setSubmissions((prev) => [...prev, newSub]);
    setShowNewForm(false);
  }

  const canLogSubmission = c.stage === 'READY_FOR_SUBMISSION' || c.stage === 'SUBMITTED'
    || c.stage === 'UNDER_AUTHORITY_REVIEW' || c.stage === 'APPEAL_IN_PROGRESS';

  const showAppealBanner = c.stage === 'REJECTED' && !appealFiled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
            Authority Submissions
          </div>
          <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>
            {submissions.length} submission{submissions.length !== 1 ? 's' : ''} on record
          </div>
        </div>
        {canLogSubmission && !showNewForm ? (
          <PrimaryButton size="sm" onClick={() => setShowNewForm(true)} iconLeft={<PlusCircle size={13} />}>
            Log Submission
          </PrimaryButton>
        ) : null}
      </div>

      {/* Appeal banner */}
      {showAppealBanner ? (
        <AppealBanner onFileAppeal={() => setAppealFiled(true)} />
      ) : null}

      {/* Appeal filed confirmation */}
      {appealFiled ? (
        <div style={{ padding: '12px 16px', borderRadius: 'var(--sos-radius-lg)', background: 'var(--sos-status-info-soft)', border: '1px solid var(--sos-status-info-border)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--sos-status-info)' }}>
          <CheckCircle2 size={16} /> Appeal filed — case has been moved to <strong>Appeal In Progress</strong>. Log the appeal submission details below.
        </div>
      ) : null}

      {/* New submission form */}
      {showNewForm ? (
        <NewSubmissionForm
          nextNumber={submissions.length + 1}
          onSave={handleNewSubmission}
          onCancel={() => setShowNewForm(false)}
        />
      ) : null}

      {/* Submission list */}
      {submissions.length === 0 && !showNewForm ? (
        <GlassCard variant="panel" padded="md">
          <EmptyState
            Icon={Send}
            title="No submissions recorded"
            description={
              canLogSubmission
                ? 'Use the "Log Submission" button to record the first submission to the authority.'
                : 'Submissions will be logged once the case reaches Ready for Submission stage.'
            }
          />
        </GlassCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {submissions.map((sub) => (
            <SubmissionRow key={sub.id} submission={sub} onUpdate={handleUpdate} />
          ))}
        </div>
      )}

      {/* Summary counts (if submissions exist) */}
      {submissions.length > 0 ? (
        <GlassCard variant="soft" padded="sm">
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {[
              { label: 'Total', value: submissions.length, icon: <ClipboardList size={12} />, tone: 'info' as BadgeTone },
              { label: 'Awaiting Response', value: submissions.filter((s) => s.status !== 'RESPONDED' && s.status !== 'WITHDRAWN').length, icon: <Clock size={12} />, tone: 'warning' as BadgeTone },
              { label: 'Responded', value: submissions.filter((s) => s.status === 'RESPONDED').length, icon: <MessageSquare size={12} />, tone: 'accent' as BadgeTone },
              { label: 'Approvals', value: submissions.filter((s) => s.responseType === 'APPROVAL').length, icon: <CheckCircle2 size={12} />, tone: 'success' as BadgeTone },
              { label: 'Rejections', value: submissions.filter((s) => s.responseType === 'REJECTION').length, icon: <XCircle size={12} />, tone: 'danger' as BadgeTone },
            ].map((stat) => (
              <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '70px' }}>
                <div style={{ fontSize: '10px', color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {stat.icon} {stat.label}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--sos-text-primary)', letterSpacing: '-0.02em' }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}
