'use client';
// Authority Submissions Tab — wired to /processing/cases/:id/submissions.
// Each submission row carries: authority, submission ref, tracking number,
// status, response details. New submissions + tracking-number/status
// updates write back via PATCH.

import { useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Globe2,
  Loader2,
  PlusCircle,
  Send,
  XCircle,
} from 'lucide-react';
import {
  GlassCard,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  fmtDate,
  fmtRelative,
} from '@/components/processing/mockData';
import {
  fetchCaseSubmissions,
  createCaseSubmission,
  updateCaseSubmission,
  type ApiAuthoritySubmission,
  type AuthoritySubmissionStatus,
} from '@/lib/processing';

const STATUS_TONE: Record<AuthoritySubmissionStatus, BadgeTone> = {
  SUBMITTED: 'info',
  ACKNOWLEDGED_BY_AUTHORITY: 'cyan',
  UNDER_REVIEW: 'accent',
  INFO_REQUESTED: 'warning',
  DECISION_PENDING: 'warm',
  APPROVED: 'success',
  REJECTED: 'danger',
};

const STATUS_LABEL: Record<AuthoritySubmissionStatus, string> = {
  SUBMITTED: 'Submitted',
  ACKNOWLEDGED_BY_AUTHORITY: 'Acknowledged',
  UNDER_REVIEW: 'Under review',
  INFO_REQUESTED: 'Info requested',
  DECISION_PENDING: 'Decision pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const ALL_STATUSES: AuthoritySubmissionStatus[] = [
  'SUBMITTED',
  'ACKNOWLEDGED_BY_AUTHORITY',
  'UNDER_REVIEW',
  'INFO_REQUESTED',
  'DECISION_PENDING',
  'APPROVED',
  'REJECTED',
];

function SubmissionCard({
  s,
  onUpdate,
}: {
  s: ApiAuthoritySubmission;
  onUpdate: (id: string, body: Partial<{ trackingNumber: string; status: AuthoritySubmissionStatus }>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [tracking, setTracking] = useState(s.trackingNumber ?? '');
  const [status, setStatus] = useState<AuthoritySubmissionStatus>(s.status);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onUpdate(s.id, {
        trackingNumber: tracking || undefined,
        status,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ marginTop: 2, color: 'var(--sos-brand-primary-strong)' }}>
          <Send size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              #{s.submissionNumber} · {s.authority}
            </span>
            <StatusBadge tone={STATUS_TONE[s.status]} size="sm">
              {STATUS_LABEL[s.status]}
            </StatusBadge>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sos-text-muted)' }}>
              {fmtRelative(s.createdAt)}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, fontSize: 12.5, color: 'var(--sos-text-muted)', marginBottom: 8 }}>
            <span><CalendarClock size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Submitted {fmtDate(s.submissionDate)}</span>
            {s.submissionReference ? <span>Ref: <strong style={{ color: 'var(--sos-text-secondary)' }}>{s.submissionReference}</strong></span> : null}
            {s.trackingNumber ? <span>Tracking: <strong style={{ color: 'var(--sos-text-secondary)' }}>{s.trackingNumber}</strong></span> : null}
          </div>

          {s.documentsIncluded.length > 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', marginBottom: 6 }}>
              Included: {s.documentsIncluded.join(', ')}
            </div>
          ) : null}

          {s.responseNotes ? (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--sos-surface-hover)', fontSize: 12.5, color: 'var(--sos-text-primary)' }}>
              <strong>Response:</strong> {s.responseNotes}
            </div>
          ) : null}

          {editing ? (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                className="sos-input"
                placeholder="Tracking number"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
              />
              <select
                className="sos-input"
                value={status}
                onChange={(e) => setStatus(e.target.value as AuthoritySubmissionStatus)}
              >
                {ALL_STATUSES.map((st) => (
                  <option key={st} value={st}>{STATUS_LABEL[st]}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setEditing(false)} style={{ padding: '6px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
                <PrimaryButton onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save update'}</PrimaryButton>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              <SecondaryButton onClick={() => setEditing(true)}>Update tracking / status</SecondaryButton>
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

function NewSubmissionForm({ caseId, onCreated }: { caseId: string; onCreated: (s: ApiAuthoritySubmission) => void }) {
  const [open, setOpen] = useState(false);
  const [authority, setAuthority] = useState('');
  const [submissionDate, setSubmissionDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [tracking, setTracking] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    if (!authority.trim() || !submissionDate) return;
    setSaving(true);
    setErr(null);
    try {
      const saved = await createCaseSubmission(caseId, {
        authority: authority.trim(),
        submissionDate,
        submissionReference: reference.trim() || undefined,
        trackingNumber: tracking.trim() || undefined,
      });
      onCreated(saved);
      setAuthority('');
      setReference('');
      setTracking('');
      setOpen(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <PrimaryButton iconLeft={<PlusCircle size={14} />} onClick={() => setOpen(true)}>
        Record submission
      </PrimaryButton>
    );
  }

  return (
    <GlassCard variant="strong" padded="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input className="sos-input" placeholder="Authority (e.g. IRCC, USCIS)" value={authority} onChange={(e) => setAuthority(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <input className="sos-input" type="date" value={submissionDate} onChange={(e) => setSubmissionDate(e.target.value)} />
          <input className="sos-input" placeholder="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <input className="sos-input" placeholder="Tracking number (optional)" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        {err ? (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>{err}</div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setOpen(false)} style={{ padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <PrimaryButton onClick={handleSubmit} disabled={saving || !authority.trim() || !submissionDate}>
            {saving ? 'Saving…' : 'Record submission'}
          </PrimaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

export function SubmissionsTab({ c }: { c: MockProcessingCase }) {
  const [items, setItems] = useState<ApiAuthoritySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCaseSubmissions(c.id)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load submissions'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [c.id]);

  async function handleUpdate(
    submissionId: string,
    body: Partial<{ trackingNumber: string; status: AuthoritySubmissionStatus }>,
  ) {
    const updated = await updateCaseSubmission(c.id, submissionId, body);
    setItems((prev) => prev.map((s) => (s.id === submissionId ? updated : s)));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <NewSubmissionForm caseId={c.id} onCreated={(s) => setItems((prev) => [s, ...prev])} />
      </div>

      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" />
            <span>Loading submissions…</span>
          </div>
        </GlassCard>
      ) : err ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>
        </GlassCard>
      ) : items.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={Globe2}
            title="No submissions yet"
            description="Record a submission once the case is filed with the authority. Tracking numbers + responses are logged here."
          />
        </GlassCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((s) => <SubmissionCard key={s.id} s={s} onUpdate={handleUpdate} />)}
        </div>
      )}
    </div>
  );
}
