'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, FileText, Loader2, CalendarClock, Pencil, User, X } from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  StatusBadge,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  Field,
  FormInput,
  FormSelect,
  FormTextarea,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { useJrSession } from '@/components/layout/JrShell';
import {
  assignJrMatter,
  fetchJrArtifacts,
  fetchJrAssociates,
  fetchJrMatter,
  fetchJrMatterDeadlines,
  updateJrMatter,
  jrDueInfo,
  jrFmtDate,
  jrHumanize,
  jrStageLabel,
  jrStageTone,
  type JrArtifactsGrouped,
  type JrAssociate,
  type JrDeadlineRow,
  type JrMatter,
} from '@/lib/jr';

/**
 * JR matter detail — read-only for v1 (the only mutation is assigning an
 * associate, gated by `jr.matter.assign`). Overview + deadlines + grouped
 * artifacts. All three reads are matter-access-checked server-side.
 */

function deadlineStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'MET':
      return 'success';
    case 'MISSED':
      return 'danger';
    case 'WAIVED':
    case 'SUPERSEDED':
      return 'neutral';
    case 'PENDING':
    default:
      return 'info';
  }
}

function artifactStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'COUNSEL_APPROVED':
    case 'FILED':
    case 'SERVED':
      return 'success';
    case 'COUNSEL_REVIEW':
      return 'info';
    case 'COUNSEL_CHANGES_REQUESTED':
      return 'warning';
    case 'SUPERSEDED':
      return 'neutral';
    case 'INTERNAL_QA':
      return 'accent';
    case 'DRAFT':
    default:
      return 'neutral';
  }
}

// The 9 JrDecisionMaker enum values (backend judicial-review.dto.ts).
const DECISION_MAKER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'VISA_OFFICER', label: 'Visa officer' },
  { value: 'IRCC_IN_CANADA', label: 'IRCC (in Canada)' },
  { value: 'CPC', label: 'CPC (Case Processing Centre)' },
  { value: 'CBSA', label: 'CBSA' },
  { value: 'ID', label: 'Immigration Division (ID)' },
  { value: 'IAD', label: 'Immigration Appeal Division (IAD)' },
  { value: 'RAD', label: 'Refugee Appeal Division (RAD)' },
  { value: 'RPD', label: 'Refugee Protection Division (RPD)' },
  { value: 'OTHER', label: 'Other' },
];

// JrDecidingOfficeLocation — drives the 15/60-day fatal clock.
const DECIDING_OFFICE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'IN_CANADA', label: 'In Canada (15-day clock)' },
  { value: 'OUTSIDE_CANADA', label: 'Outside Canada (60-day clock)' },
  { value: 'UNKNOWN', label: 'Unknown (treated as 15)' },
];

/** Normalise an ISO date/datetime to the YYYY-MM-DD an <input type="date"> wants. */
function toDateInput(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function DefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span style={{ fontSize: 13.5, color: 'var(--sos-text-primary)' }}>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit case details — the non-gated field editor (gated on jr.matter.update_stage).
// Setting decisionCommunicatedAt is what starts the fatal deadline clock, so a
// successful save refetches the matter (bumps reloadKey) and the ALJR deadline
// then appears in the Deadlines section below.
// ---------------------------------------------------------------------------
function EditCaseDetailsCard({
  matter,
  onSaved,
}: {
  matter: JrMatter;
  onSaved: () => void;
}) {
  const init = useMemo(
    () => ({
      styleOfCause: asStr(matter.styleOfCause),
      decisionMaker: asStr(matter.decisionMaker) || 'OTHER',
      applicationType: asStr(matter.applicationType),
      decidingOfficeLocation: asStr(matter.decidingOfficeLocation) || 'UNKNOWN',
      decidingOfficeSourceNote: asStr(matter.decidingOfficeSourceNote),
      decisionCommunicatedAt: toDateInput(matter.decisionCommunicatedAt),
      decisionCommunicatedNote: asStr(matter.decisionCommunicatedNote),
      decisionLetterDate: toDateInput(matter.decisionLetterDate),
      courtFileNumber: asStr(matter.courtFileNumber),
    }),
    [matter],
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(init);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setForm(init);
    setError(null);
    setEditing(true);
  }

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    const patch: Record<string, unknown> = {};
    if (form.styleOfCause !== init.styleOfCause) patch.styleOfCause = form.styleOfCause;
    if (form.decisionMaker !== init.decisionMaker) patch.decisionMaker = form.decisionMaker;
    if (form.applicationType !== init.applicationType) patch.applicationType = form.applicationType;
    if (form.decidingOfficeLocation !== init.decidingOfficeLocation)
      patch.decidingOfficeLocation = form.decidingOfficeLocation;
    if (form.decidingOfficeSourceNote !== init.decidingOfficeSourceNote)
      patch.decidingOfficeSourceNote = form.decidingOfficeSourceNote;
    // Date fields: send the YYYY-MM-DD straight through (backend normalises to the
    // legal calendar day). A cleared date is not sent — the clock anchor can't be
    // nulled from here.
    if (form.decisionCommunicatedAt && form.decisionCommunicatedAt !== init.decisionCommunicatedAt)
      patch.decisionCommunicatedAt = form.decisionCommunicatedAt;
    if (form.decisionCommunicatedNote !== init.decisionCommunicatedNote)
      patch.decisionCommunicatedNote = form.decisionCommunicatedNote;
    if (form.decisionLetterDate && form.decisionLetterDate !== init.decisionLetterDate)
      patch.decisionLetterDate = form.decisionLetterDate;
    if (form.courtFileNumber !== init.courtFileNumber) patch.courtFileNumber = form.courtFileNumber;

    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateJrMatter(matter.id, patch);
      setEditing(false);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: editing ? 14 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Pencil size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Case details</div>
        </div>
        {editing ? (
          <SecondaryButton type="button" onClick={() => setEditing(false)} disabled={saving} iconLeft={<X size={14} />}>
            Cancel
          </SecondaryButton>
        ) : (
          <SecondaryButton type="button" onClick={open} iconLeft={<Pencil size={14} />}>
            Edit case details
          </SecondaryButton>
        )}
      </div>

      {!editing ? (
        <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginTop: 10 }}>
          Set the refusal-notification date, decision maker and other case details. The
          refusal-notification date starts the fatal deadline clock.
        </div>
      ) : (
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormInput
            label="Style of cause"
            value={form.styleOfCause}
            onChange={(e) => set('styleOfCause', e.target.value)}
            maxLength={200}
            placeholder="e.g. NAVID v. MCI"
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormSelect
              label="Decision maker"
              value={form.decisionMaker}
              onChange={(e) => set('decisionMaker', e.target.value)}
              options={DECISION_MAKER_OPTIONS}
            />
            <FormInput
              label="Application type"
              value={form.applicationType}
              onChange={(e) => set('applicationType', e.target.value)}
              maxLength={80}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormSelect
              label="Deciding office location"
              value={form.decidingOfficeLocation}
              onChange={(e) => set('decidingOfficeLocation', e.target.value)}
              options={DECIDING_OFFICE_OPTIONS}
              hint="15 days in-Canada / 60 outside / UNKNOWN treated as 15"
            />
            <FormInput
              label="Deciding office source note"
              value={form.decidingOfficeSourceNote}
              onChange={(e) => set('decidingOfficeSourceNote', e.target.value)}
              maxLength={400}
            />
          </div>
          <Field
            label="Refusal notification date (starts the deadline clock)"
            hint="The day the client was notified of the refusal — this starts the fatal clock."
          >
            <input
              type="date"
              className="sos-input"
              value={form.decisionCommunicatedAt}
              onChange={(e) => set('decisionCommunicatedAt', e.target.value)}
            />
          </Field>
          <FormTextarea
            label="Refusal notification note"
            value={form.decisionCommunicatedNote}
            onChange={(e) => set('decisionCommunicatedNote', e.target.value)}
            maxLength={400}
            rows={3}
            placeholder="e.g. refusal letter dated 2026-08-01, received by client on 2026-08-05 by email."
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Decision letter date (optional)">
              <input
                type="date"
                className="sos-input"
                value={form.decisionLetterDate}
                onChange={(e) => set('decisionLetterDate', e.target.value)}
              />
            </Field>
            <FormInput
              label="Court file number (optional)"
              value={form.courtFileNumber}
              onChange={(e) => set('courtFileNumber', e.target.value)}
              maxLength={30}
              placeholder="IMM-#####-YY"
            />
          </div>

          {error ? (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>
              {error}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <SecondaryButton type="button" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </SecondaryButton>
            <PrimaryButton
              type="submit"
              disabled={saving}
              iconLeft={saving ? <Loader2 size={14} className="sos-spin" /> : undefined}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
          </div>
        </form>
      )}
    </GlassCard>
  );
}

function DetailAssignControl({
  matter,
  associates,
  onAssigned,
}: {
  matter: JrMatter;
  associates: JrAssociate[];
  onAssigned: () => void;
}) {
  const [value, setValue] = useState(matter.assignedAssociateUserId ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!value || value === matter.assignedAssociateUserId) return;
    setSaving(true);
    setErr(null);
    try {
      await assignJrMatter(matter.id, value);
      onAssigned();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to assign');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          className="sos-select"
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Assign associate"
          style={{ fontSize: 12.5, padding: '4px 8px' }}
        >
          <option value="">Unassigned…</option>
          {associates.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <PrimaryButton
          onClick={save}
          disabled={saving || !value || value === matter.assignedAssociateUserId}
          iconLeft={saving ? <Loader2 size={13} className="sos-spin" /> : undefined}
        >
          {saving ? '…' : 'Assign'}
        </PrimaryButton>
      </div>
      {err ? <span style={{ fontSize: 10.5, color: 'var(--sos-status-danger)' }}>{err}</span> : null}
    </div>
  );
}

export default function JrMatterDetailPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const { user } = useJrSession();
  const canAssign = user.permissions.includes('jr.matter.assign');
  const canEdit = user.permissions.includes('jr.matter.update_stage');

  const [matter, setMatter] = useState<JrMatter | null>(null);
  const [deadlines, setDeadlines] = useState<JrDeadlineRow[]>([]);
  const [artifacts, setArtifacts] = useState<JrArtifactsGrouped>({ folders: [] });
  const [associates, setAssociates] = useState<JrAssociate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canAssign) return;
    let cancelled = false;
    fetchJrAssociates()
      .then((list) => !cancelled && setAssociates(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canAssign]);

  useEffect(() => {
    if (!matterId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchJrMatter(matterId),
      fetchJrMatterDeadlines(matterId),
      fetchJrArtifacts(matterId),
    ])
      .then(([m, d, a]) => {
        if (cancelled) return;
        setMatter(m);
        setDeadlines(d);
        setArtifacts(a);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load matter');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [matterId, reloadKey]);

  const assignedName = useMemo(() => {
    if (!matter?.assignedAssociateUserId) return null;
    if (matter.assignedAssociateUserId === user.id) return 'You';
    return associates.find((a) => a.id === matter.assignedAssociateUserId)?.name ?? 'Assigned';
  }, [matter, associates, user.id]);

  const backLink = (
    <Link
      href={'/jr' as Route}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}
    >
      <ArrowLeft size={14} /> Back to matters
    </Link>
  );

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Loader2 size={16} className="sos-spin" /> Loading matter…
      </div>
    );
  }
  if (error || !matter) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PageHeader title="Matter" actions={backLink} />
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13.5 }}>
            {error ?? 'Matter not found.'}
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow={matter.intakeType === 'INTERNAL' ? 'Internal escalation' : 'External matter'}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {matter.matterNumber}
            <StatusBadge tone={jrStageTone(matter.stage)}>{jrStageLabel(matter.stage)}</StatusBadge>
          </span>
        }
        description={matter.styleOfCause ?? undefined}
        actions={backLink}
      />

      {/* Client */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <User size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Client</div>
        </div>
        {matter.client ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: 10 }}>
              {`${matter.client.firstName} ${matter.client.lastName}`.trim() || '—'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <DefRow label="Phone">{matter.client.phone ?? '—'}</DefRow>
              <DefRow label="Email">{matter.client.email ?? '—'}</DefRow>
              <DefRow label="Reference code">{matter.client.referenceCode}</DefRow>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13.5, color: 'var(--sos-text-muted)' }}>Client record not found.</div>
        )}
      </GlassCard>

      {/* Overview */}
      <GlassCard variant="panel" padded="md">
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: 14 }}>Overview</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <DefRow label="Matter number">{matter.matterNumber}</DefRow>
          <DefRow label="Style of cause">{matter.styleOfCause ?? '—'}</DefRow>
          <DefRow label="Intake type">{matter.intakeType === 'INTERNAL' ? 'Internal escalation' : 'External'}</DefRow>
          <DefRow label="Stage">
            <StatusBadge tone={jrStageTone(matter.stage)} size="sm">{jrStageLabel(matter.stage)}</StatusBadge>
          </DefRow>
          <DefRow label="Decision maker">{jrHumanize(matter.decisionMaker) || '—'}</DefRow>
          <DefRow label="Application type">{matter.applicationType || '—'}</DefRow>
          <DefRow label="Route">{jrHumanize(matter.route) || '—'}</DefRow>
          <DefRow label="Decision communicated">
            {matter.decisionCommunicatedAt ? (
              jrFmtDate(matter.decisionCommunicatedAt)
            ) : (
              <span style={{ color: 'var(--sos-text-muted)' }}>Not set — intake pending</span>
            )}
          </DefRow>
          <DefRow label="Court file number">{matter.courtFileNumber ?? '—'}</DefRow>
          <DefRow label="Assigned associate">
            {canAssign && associates.length > 0 ? (
              // Always assignable/RE-assignable for a Head (control pre-selects current).
              <DetailAssignControl matter={matter} associates={associates} onAssigned={() => setReloadKey((k) => k + 1)} />
            ) : assignedName ? (
              assignedName
            ) : canAssign ? (
              <span style={{ color: 'var(--sos-text-muted)' }}>No associates — create JR logins</span>
            ) : (
              <StatusBadge tone="warning" size="sm">Unassigned</StatusBadge>
            )}
          </DefRow>
        </div>
      </GlassCard>

      {/* Edit case details (gated) */}
      {canEdit ? (
        <EditCaseDetailsCard matter={matter} onSaved={() => setReloadKey((k) => k + 1)} />
      ) : null}

      {/* Deadlines */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <CalendarClock size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Deadlines</div>
        </div>
        {deadlines.length === 0 ? (
          <EmptyState
            Icon={CalendarClock}
            title="No deadlines computed yet"
            description="Set the notification date to start the clock."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {deadlines.map((d) => {
              const due = jrDueInfo(d.effectiveDueAt);
              return (
                <div
                  key={d.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)' }}
                >
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                      {d.label || jrHumanize(d.milestoneKey)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
                      Due {jrFmtDate(d.effectiveDueAt)}
                      {!d.quotableToClient ? ' · not quotable / provisional' : ''}
                    </div>
                  </div>
                  {d.isFatal ? (
                    <StatusBadge tone="danger" size="sm" icon={<AlertTriangle size={11} />} dot={false}>
                      Fatal
                    </StatusBadge>
                  ) : null}
                  <StatusBadge tone={due.tone} size="sm">{due.label}</StatusBadge>
                  <StatusBadge tone={deadlineStatusTone(d.status)} size="sm" dot={false}>
                    {jrHumanize(d.status)}
                  </StatusBadge>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Artifacts */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <FileText size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Artifacts</div>
        </div>
        {artifacts.folders.length === 0 ? (
          <EmptyState
            Icon={FileText}
            title="No artifacts yet"
            description="Documents and court filings will appear here as they are authored."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {artifacts.folders.map((folder) => (
              <div key={folder.folder}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  {jrHumanize(folder.folder)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {folder.artifacts.map((a) => (
                    <div
                      key={a.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)' }}
                    >
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--sos-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{jrHumanize(a.artifactType)}</span>
                      <StatusBadge tone={artifactStatusTone(a.status)} size="sm" dot={false}>
                        {jrHumanize(a.status)}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
