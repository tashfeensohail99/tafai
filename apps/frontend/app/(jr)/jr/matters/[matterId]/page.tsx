'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  CalendarClock,
  Pencil,
  User,
  X,
  GitBranch,
  Signpost,
  History,
  Landmark,
  Check,
  Database,
} from 'lucide-react';
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
import { DocumentsPanel } from '@/components/jr/DocumentsPanel';
import { NotesPanel } from '@/components/jr/NotesPanel';
import { JrDatabankTab } from '@/components/jr/JrDatabankTab';
import {
  assignJrMatter,
  changeJrStage,
  determineJrRoute,
  fetchJrArtifacts,
  fetchJrAssociates,
  fetchJrCounsel,
  fetchJrMatter,
  fetchJrMatterDeadlines,
  fetchJrMatterHistory,
  setCounselOfRecord,
  recordMerits,
  updateJrMatter,
  jrDueInfo,
  jrFmtDate,
  jrHumanize,
  jrStageLabel,
  jrStageTone,
  jrCloseReasonLabel,
  jrRouteLabel,
  jrMeritsLabel,
  jrRetainerScopeLabel,
  JR_STAGE_TRANSITIONS,
  JR_CLOSE_REASON_OPTIONS,
  JR_SPONSORSHIP_OPTIONS,
  JR_INADMISSIBILITY_OPTIONS,
  JR_RETAINER_SCOPE_OPTIONS,
  JR_MERITS_OPTIONS,
  type ChangeStagePayload,
  type DetermineRoutePayload,
  type JrArtifactsGrouped,
  type JrAssociate,
  type JrCounsel,
  type JrDeadlineRow,
  type JrHistoryRow,
  type JrMatter,
} from '@/lib/jr';

/**
 * JR matter detail console. Overview + client + gated actions (advance stage,
 * determine route, assign, edit case details) + deadlines + grouped artifacts +
 * notes + a read-only activity timeline. Every mutation control is gated on the
 * same permission the backend endpoint requires, and every read is
 * matter-access-checked server-side.
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
      // Default to Outside Canada (60-day clock) — the norm for this firm's
      // overseas visa refusals. Surfaced in the form so the team consciously
      // confirms it (and switches to In Canada → 15 days) when logging the
      // refusal date, which is what kills the false "fatal in 15 days" alarms.
      decidingOfficeLocation: asStr(matter.decidingOfficeLocation) || 'OUTSIDE_CANADA',
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
              hint="Defaults to Outside Canada = 60-day filing clock (the norm for overseas visa refusals). Switch to In Canada ONLY if the decision was made in Canada — that is a 15-day fatal clock."
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

// A compact checkbox row that pairs the box with a label + optional hint.
function CheckboxField({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: disabled ? 'default' : 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2 }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, color: 'var(--sos-text-primary)' }}>{label}</span>
        {hint ? <span style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{hint}</span> : null}
      </span>
    </label>
  );
}

const errorBoxStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--sos-status-danger-soft)',
  border: '1px solid var(--sos-status-danger-border)',
  color: 'var(--sos-status-danger)',
  fontSize: 12.5,
};

// ---------------------------------------------------------------------------
// Stage advancement — the gated §6.1 stage machine (jr.matter.update_stage).
// Offers ONLY the forward transitions the frozen map allows from the current
// stage; conditionally reveals the gate fields the chosen target needs. The
// per-transition §6.2 GATES live server-side — a rejected move surfaces the
// backend message verbatim; the console never replicates the gate logic.
// ---------------------------------------------------------------------------
function StageAdvanceCard({ matter, onChanged }: { matter: JrMatter; onChanged: () => void }) {
  const targets = JR_STAGE_TRANSITIONS[matter.stage] ?? [];
  const [target, setTarget] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [decidingOfficeLocation, setDecidingOfficeLocation] = useState('');
  const [decidingOfficeSourceNote, setDecidingOfficeSourceNote] = useState('');
  const [hennellyIntention, setHennellyIntention] = useState('');
  const [hennellyMerit, setHennellyMerit] = useState('');
  const [hennellyPrejudice, setHennellyPrejudice] = useState('');
  const [hennellyExplanation, setHennellyExplanation] = useState('');
  const [leaveDecidedAt, setLeaveDecidedAt] = useState('');
  const [leaveOrderAt, setLeaveOrderAt] = useState('');
  const [leaveGranted, setLeaveGranted] = useState(false);
  const [redeterminationDecidedAt, setRedeterminationDecidedAt] = useState('');
  const [redeterminationApproved, setRedeterminationApproved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The IR-1 deciding-office gate only bites when the office is still UNKNOWN.
  const needDecidingOffice = asStr(matter.decidingOfficeLocation) === 'UNKNOWN';
  const fromRedetermination = matter.stage === 'REDETERMINATION';

  function reset() {
    setTarget('');
    setCloseReason('');
    setDecidingOfficeLocation('');
    setDecidingOfficeSourceNote('');
    setHennellyIntention('');
    setHennellyMerit('');
    setHennellyPrejudice('');
    setHennellyExplanation('');
    setLeaveDecidedAt('');
    setLeaveOrderAt('');
    setLeaveGranted(false);
    setRedeterminationDecidedAt('');
    setRedeterminationApproved(false);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!target) {
      setError('Choose a target stage.');
      return;
    }
    if (target === 'CLOSED' && !closeReason) {
      setError('A close reason is required to close a matter.');
      return;
    }
    if (
      target === 'FILED' &&
      needDecidingOffice &&
      (!decidingOfficeLocation || !decidingOfficeSourceNote.trim())
    ) {
      setError('Set the deciding office location and a source note before filing.');
      return;
    }

    const payload: ChangeStagePayload = { targetStage: target as JrMatter['stage'] };
    if (target === 'CLOSED') {
      payload.closeReason = closeReason;
      if (fromRedetermination) {
        if (redeterminationDecidedAt) payload.redeterminationDecidedAt = redeterminationDecidedAt;
        payload.redeterminationApproved = redeterminationApproved;
      }
    }
    if (target === 'FILED' && needDecidingOffice) {
      payload.decidingOfficeLocation = decidingOfficeLocation;
      payload.decidingOfficeSourceNote = decidingOfficeSourceNote;
    }
    if (target === 'REQUIRES_EXTENSION_REQUEST') {
      payload.hennellyIntention = hennellyIntention;
      payload.hennellyMerit = hennellyMerit;
      payload.hennellyPrejudice = hennellyPrejudice;
      payload.hennellyExplanation = hennellyExplanation;
    }
    if (target === 'LEAVE_GRANTED') {
      if (leaveDecidedAt) payload.leaveDecidedAt = leaveDecidedAt;
      if (leaveOrderAt) payload.leaveOrderAt = leaveOrderAt;
      payload.leaveGranted = leaveGranted;
    }

    setSaving(true);
    setError(null);
    try {
      await changeJrStage(matter.id, payload);
      reset();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change stage');
    } finally {
      setSaving(false);
    }
  }

  const targetOptions = targets.map((t) => ({ value: t, label: jrStageLabel(t) }));

  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <GitBranch size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Advance stage</div>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FormSelect
          label="Move to stage"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setError(null);
          }}
          options={targetOptions}
          placeholder="Select a target stage…"
          hint={`Current: ${jrStageLabel(matter.stage)}`}
        />

        {target === 'CLOSED' ? (
          <FormSelect
            label="Close reason"
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            options={JR_CLOSE_REASON_OPTIONS}
            placeholder="Select a close reason…"
            required
          />
        ) : null}

        {target === 'CLOSED' && fromRedetermination ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center' }}>
            <Field label="Redetermination decided (optional)">
              <input
                type="date"
                className="sos-input"
                value={redeterminationDecidedAt}
                onChange={(e) => setRedeterminationDecidedAt(e.target.value)}
              />
            </Field>
            <CheckboxField
              label="Redetermination approved"
              checked={redeterminationApproved}
              onChange={setRedeterminationApproved}
            />
          </div>
        ) : null}

        {target === 'FILED' && needDecidingOffice ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormSelect
              label="Deciding office location"
              value={decidingOfficeLocation}
              onChange={(e) => setDecidingOfficeLocation(e.target.value)}
              options={DECIDING_OFFICE_OPTIONS.filter((o) => o.value !== 'UNKNOWN')}
              placeholder="Select…"
              required
            />
            <FormInput
              label="Deciding office source note"
              value={decidingOfficeSourceNote}
              onChange={(e) => setDecidingOfficeSourceNote(e.target.value)}
              maxLength={400}
              required
            />
          </div>
        ) : null}

        {target === 'REQUIRES_EXTENSION_REQUEST' ? (
          <>
            <FormTextarea
              label="Hennelly — continuing intention"
              value={hennellyIntention}
              onChange={(e) => setHennellyIntention(e.target.value)}
              maxLength={1000}
              rows={2}
            />
            <FormTextarea
              label="Hennelly — arguable merit"
              value={hennellyMerit}
              onChange={(e) => setHennellyMerit(e.target.value)}
              maxLength={1000}
              rows={2}
            />
            <FormTextarea
              label="Hennelly — no prejudice to respondent"
              value={hennellyPrejudice}
              onChange={(e) => setHennellyPrejudice(e.target.value)}
              maxLength={1000}
              rows={2}
            />
            <FormTextarea
              label="Hennelly — reasonable explanation for the delay"
              value={hennellyExplanation}
              onChange={(e) => setHennellyExplanation(e.target.value)}
              maxLength={1000}
              rows={2}
            />
          </>
        ) : null}

        {target === 'LEAVE_GRANTED' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Leave decided date">
                <input
                  type="date"
                  className="sos-input"
                  value={leaveDecidedAt}
                  onChange={(e) => setLeaveDecidedAt(e.target.value)}
                />
              </Field>
              <Field label="Leave order date">
                <input
                  type="date"
                  className="sos-input"
                  value={leaveOrderAt}
                  onChange={(e) => setLeaveOrderAt(e.target.value)}
                />
              </Field>
            </div>
            <CheckboxField label="Leave granted" checked={leaveGranted} onChange={setLeaveGranted} />
          </>
        ) : null}

        {error ? <div style={errorBoxStyle}>{error}</div> : null}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <PrimaryButton
            type="submit"
            disabled={saving || !target}
            iconLeft={saving ? <Loader2 size={14} className="sos-spin" /> : <GitBranch size={14} />}
          >
            {saving ? 'Saving…' : 'Advance stage'}
          </PrimaryButton>
        </div>
      </form>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Route determination — the §6.4 decision tree (jr.route.determine). Shows the
// form while the route is UNDETERMINED; once determined, shows the route +
// reasoning with a "Re-determine" toggle. A citizenship matter is rejected by
// the backend (BadRequest) — that message is surfaced verbatim.
// ---------------------------------------------------------------------------
function RouteDeterminationCard({ matter, onChanged }: { matter: JrMatter; onChanged: () => void }) {
  const determined = asStr(matter.route) !== '' && matter.route !== 'UNDETERMINED';
  const [editing, setEditing] = useState(!determined);
  const [appealRightExhausted, setAppealRightExhausted] = useState(false);
  const [sponsorshipRelationship, setSponsorshipRelationship] = useState('NONE');
  const [inadmissibilityGround, setInadmissibilityGround] = useState('NONE');
  const [rpdS110Exclusion, setRpdS110Exclusion] = useState(false);
  const [hasS63AppealRight, setHasS63AppealRight] = useState(false);
  const [isCitizenshipMatter, setIsCitizenshipMatter] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const payload: DetermineRoutePayload = {
      appealRightExhausted,
      sponsorshipRelationship,
      inadmissibilityGround,
      rpdS110Exclusion,
      hasS63AppealRight,
      isCitizenshipMatter,
    };
    setSaving(true);
    setError(null);
    try {
      await determineJrRoute(matter.id, payload);
      setEditing(false);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to determine route');
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Signpost size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Route determination</div>
        </div>
        {determined ? (
          editing ? (
            <SecondaryButton type="button" onClick={() => setEditing(false)} disabled={saving} iconLeft={<X size={14} />}>
              Cancel
            </SecondaryButton>
          ) : (
            <SecondaryButton type="button" onClick={() => setEditing(true)} iconLeft={<Pencil size={14} />}>
              Re-determine
            </SecondaryButton>
          )
        ) : null}
      </div>

      {determined && !editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <StatusBadge tone="accent" size="sm">{jrRouteLabel(matter.route)}</StatusBadge>
          </div>
          {asStr(matter.routeReasoning) ? (
            <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', lineHeight: 1.5 }}>
              {asStr(matter.routeReasoning)}
            </div>
          ) : null}
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <CheckboxField
            label="Appeal right exhausted"
            checked={appealRightExhausted}
            onChange={setAppealRightExhausted}
            hint="IRPA s.72(2)(a) — filing where an IAD appeal still lies is fatal."
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormSelect
              label="Sponsorship relationship"
              value={sponsorshipRelationship}
              onChange={(e) => setSponsorshipRelationship(e.target.value)}
              options={JR_SPONSORSHIP_OPTIONS}
            />
            <FormSelect
              label="Inadmissibility ground"
              value={inadmissibilityGround}
              onChange={(e) => setInadmissibilityGround(e.target.value)}
              options={JR_INADMISSIBILITY_OPTIONS}
            />
          </div>
          <CheckboxField
            label="RPD s.110(2) exclusion applies"
            checked={rpdS110Exclusion}
            onChange={setRpdS110Exclusion}
            hint="RPD only → Federal Court, not the RAD."
          />
          <CheckboxField
            label="An s.63 appeal right lies"
            checked={hasS63AppealRight}
            onChange={setHasS63AppealRight}
            hint="Visa officer / IRCC / CPC / CBSA."
          />
          <CheckboxField
            label="Citizenship Act matter"
            checked={isCitizenshipMatter}
            onChange={setIsCitizenshipMatter}
            hint="Citizenship matters are rejected in v1 (s.22.1, 30-day, not IRPA 15/60)."
          />

          {error ? <div style={errorBoxStyle}>{error}</div> : null}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            {determined ? (
              <SecondaryButton type="button" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </SecondaryButton>
            ) : null}
            <PrimaryButton
              type="submit"
              disabled={saving}
              iconLeft={saving ? <Loader2 size={14} className="sos-spin" /> : <Signpost size={14} />}
            >
              {saving ? 'Saving…' : 'Determine route'}
            </PrimaryButton>
          </div>
        </form>
      )}
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Counsel & retention — set counsel of record + record merits (jr.counsel.manage)
// and drive the MERITS_REVIEW → RETAINED readiness checklist (§6.2). The five
// rows are the exact server-side gate: merits = FILE_JR, counsel of record set,
// an ENGAGEMENT_LETTER artifact exists, expectations acknowledged, alternatives
// sheet signed. This card only records the inputs — advancing to RETAINED stays
// the Stage card's job (the backend re-checks every gate).
// ---------------------------------------------------------------------------

// One checklist row with a ✓/✗ marker + label + optional detail/control.
function ChecklistItem({
  done,
  label,
  children,
}: {
  done: boolean;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)' }}>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 20,
          height: 20,
          borderRadius: 999,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
          background: done ? 'var(--sos-status-success-soft)' : 'var(--sos-status-danger-soft)',
          color: done ? 'var(--sos-status-success)' : 'var(--sos-status-danger)',
          border: `1px solid ${done ? 'var(--sos-status-success-border)' : 'var(--sos-status-danger-border)'}`,
        }}
      >
        {done ? <Check size={12} /> : <X size={12} />}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--sos-text-primary)' }}>{label}</span>
        {children}
      </div>
    </div>
  );
}

function CounselRetentionCard({
  matter,
  artifacts,
  onChanged,
}: {
  matter: JrMatter;
  artifacts: JrArtifactsGrouped;
  onChanged: () => void;
}) {
  const [counsel, setCounsel] = useState<JrCounsel[]>([]);

  // Set-counsel-of-record form.
  const [counselId, setCounselId] = useState(asStr(matter.counselOfRecordId));
  const [retainerScope, setRetainerScope] = useState(asStr(matter.counselRetainerScope) || 'FULL');
  const [feeQuoted, setFeeQuoted] = useState(
    matter.counselFeeQuoted != null ? String(matter.counselFeeQuoted) : '',
  );
  const [feeCurrency, setFeeCurrency] = useState(asStr(matter.counselFeeCurrency));
  const [retainerSignedAt, setRetainerSignedAt] = useState(toDateInput(matter.counselRetainerSignedAt));
  const [savingCounsel, setSavingCounsel] = useState(false);
  const [counselErr, setCounselErr] = useState<string | null>(null);

  // Record-merits form.
  const [meritsRec, setMeritsRec] = useState(asStr(matter.meritsRecommendation));
  const [meritsCounselId, setMeritsCounselId] = useState(asStr(matter.meritsAssessedByCounselId));
  const [savingMerits, setSavingMerits] = useState(false);
  const [meritsErr, setMeritsErr] = useState<string | null>(null);

  // Expectations / alternatives date setters.
  const [expectationsAt, setExpectationsAt] = useState(toDateInput(matter.expectationsAcknowledgedAt));
  const [alternativesAt, setAlternativesAt] = useState(toDateInput(matter.alternativesSheetSignedAt));
  const [savingDates, setSavingDates] = useState<'expectations' | 'alternatives' | null>(null);
  const [datesErr, setDatesErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJrCounsel(true)
      .then((list) => !cancelled && setCounsel(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const counselOptions = counsel.map((c) => ({
    value: c.id,
    label: `${c.legalName} — ${c.firmName} (${c.lawSocietyProvince} #${c.licenceNumber})`,
  }));

  const currentCounsel = useMemo(
    () => counsel.find((c) => c.id === asStr(matter.counselOfRecordId)) ?? null,
    [counsel, matter.counselOfRecordId],
  );

  // The five RETAINED-gate conditions (§6.2 changeMatterStage, verbatim).
  const hasEngagementLetter = artifacts.folders.some((f) =>
    f.artifacts.some((a) => a.artifactType === 'ENGAGEMENT_LETTER'),
  );
  const meritsIsFileJr = asStr(matter.meritsRecommendation) === 'FILE_JR';
  const counselSet = !!asStr(matter.counselOfRecordId);
  const expectationsDone = !!matter.expectationsAcknowledgedAt;
  const alternativesDone = !!matter.alternativesSheetSignedAt;
  const allReady =
    meritsIsFileJr && counselSet && hasEngagementLetter && expectationsDone && alternativesDone;

  async function submitCounsel(e: React.FormEvent) {
    e.preventDefault();
    if (savingCounsel) return;
    if (!counselId) {
      setCounselErr('Choose a counsel of record.');
      return;
    }
    setSavingCounsel(true);
    setCounselErr(null);
    try {
      const payload: Parameters<typeof setCounselOfRecord>[1] = {
        counselOfRecordId: counselId,
        counselRetainerScope: retainerScope,
      };
      const feeNum = Number(feeQuoted);
      if (feeQuoted.trim() && !Number.isNaN(feeNum)) payload.counselFeeQuoted = feeNum;
      if (feeCurrency.trim()) payload.counselFeeCurrency = feeCurrency.trim().toUpperCase();
      if (retainerSignedAt) payload.counselRetainerSignedAt = retainerSignedAt;
      await setCounselOfRecord(matter.id, payload);
      onChanged();
    } catch (err: unknown) {
      setCounselErr(err instanceof Error ? err.message : 'Failed to set counsel of record');
    } finally {
      setSavingCounsel(false);
    }
  }

  async function submitMerits(e: React.FormEvent) {
    e.preventDefault();
    if (savingMerits) return;
    if (!meritsRec) {
      setMeritsErr('Choose a merits recommendation.');
      return;
    }
    if (!meritsCounselId) {
      setMeritsErr('Choose the assessing counsel.');
      return;
    }
    setSavingMerits(true);
    setMeritsErr(null);
    try {
      await recordMerits(matter.id, {
        meritsRecommendation: meritsRec,
        meritsAssessedByCounselId: meritsCounselId,
      });
      onChanged();
    } catch (err: unknown) {
      setMeritsErr(err instanceof Error ? err.message : 'Failed to record merits');
    } finally {
      setSavingMerits(false);
    }
  }

  async function saveDate(field: 'expectationsAcknowledgedAt' | 'alternativesSheetSignedAt') {
    const value = field === 'expectationsAcknowledgedAt' ? expectationsAt : alternativesAt;
    if (!value) {
      setDatesErr('Pick a date first.');
      return;
    }
    setSavingDates(field === 'expectationsAcknowledgedAt' ? 'expectations' : 'alternatives');
    setDatesErr(null);
    try {
      await updateJrMatter(matter.id, { [field]: value });
      onChanged();
    } catch (err: unknown) {
      setDatesErr(err instanceof Error ? err.message : 'Failed to save date');
    } finally {
      setSavingDates(null);
    }
  }

  const noCounsel = counsel.length === 0;

  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Landmark size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Counsel &amp; retention</div>
      </div>

      {noCounsel ? (
        <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginBottom: 14 }}>
          No counsel in the directory yet. Add counsel on the Counsel page before setting a counsel of record.
        </div>
      ) : null}

      {/* Counsel of record */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--sos-text-secondary)' }}>Counsel of record</div>
        {currentCounsel ? (
          <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>
            <span style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>{currentCounsel.legalName}</span>
            {` · ${currentCounsel.firmName} · ${currentCounsel.lawSocietyProvince} #${currentCounsel.licenceNumber}`}
            {matter.counselRetainerScope ? ` · ${jrRetainerScopeLabel(asStr(matter.counselRetainerScope))}` : ''}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>Not set.</div>
        )}
        <form onSubmit={submitCounsel} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
          <FormSelect
            label={counselSet ? 'Replace counsel of record' : 'Set counsel of record'}
            value={counselId}
            onChange={(e) => setCounselId(e.target.value)}
            options={counselOptions}
            placeholder="Select counsel…"
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormSelect
              label="Retainer scope"
              value={retainerScope}
              onChange={(e) => setRetainerScope(e.target.value)}
              options={JR_RETAINER_SCOPE_OPTIONS}
            />
            <Field label="Retainer signed (optional)">
              <input
                type="date"
                className="sos-input"
                value={retainerSignedAt}
                onChange={(e) => setRetainerSignedAt(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput
              label="Fee quoted (optional)"
              type="number"
              value={feeQuoted}
              onChange={(e) => setFeeQuoted(e.target.value)}
              placeholder="e.g. 6500"
            />
            <FormInput
              label="Fee currency (optional)"
              value={feeCurrency}
              onChange={(e) => setFeeCurrency(e.target.value)}
              maxLength={3}
              placeholder="e.g. CAD"
            />
          </div>
          {counselErr ? <div style={errorBoxStyle}>{counselErr}</div> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <PrimaryButton
              type="submit"
              disabled={savingCounsel || !counselId}
              iconLeft={savingCounsel ? <Loader2 size={14} className="sos-spin" /> : <Landmark size={14} />}
            >
              {savingCounsel ? 'Saving…' : counselSet ? 'Replace counsel' : 'Set counsel'}
            </PrimaryButton>
          </div>
        </form>
      </div>

      {/* Merits recommendation */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--sos-text-secondary)' }}>Merits recommendation</div>
        {asStr(matter.meritsRecommendation) ? (
          <div style={{ fontSize: 12.5 }}>
            <StatusBadge tone={meritsIsFileJr ? 'success' : 'neutral'} size="sm" dot={false}>
              {jrMeritsLabel(asStr(matter.meritsRecommendation))}
            </StatusBadge>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>Not recorded.</div>
        )}
        <form onSubmit={submitMerits} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormSelect
              label="Recommendation"
              value={meritsRec}
              onChange={(e) => setMeritsRec(e.target.value)}
              options={JR_MERITS_OPTIONS}
              placeholder="Select…"
              hint="Only FILE_JR satisfies the RETAINED gate."
            />
            <FormSelect
              label="Assessed by counsel"
              value={meritsCounselId}
              onChange={(e) => setMeritsCounselId(e.target.value)}
              options={counselOptions}
              placeholder="Select counsel…"
            />
          </div>
          {meritsErr ? <div style={errorBoxStyle}>{meritsErr}</div> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <PrimaryButton
              type="submit"
              disabled={savingMerits || !meritsRec || !meritsCounselId}
              iconLeft={savingMerits ? <Loader2 size={14} className="sos-spin" /> : <Check size={14} />}
            >
              {savingMerits ? 'Saving…' : 'Record merits'}
            </PrimaryButton>
          </div>
        </form>
      </div>

      {/* Retention readiness checklist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--sos-text-secondary)' }}>Retention readiness (drives RETAINED)</div>
        <ChecklistItem done={meritsIsFileJr} label="Merits recommendation is FILE_JR" />
        <ChecklistItem done={counselSet} label="Counsel of record set" />
        <ChecklistItem
          done={hasEngagementLetter}
          label="Engagement letter uploaded"
        >
          {!hasEngagementLetter ? (
            <span style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
              Upload an ENGAGEMENT_LETTER artifact in the Documents panel below.
            </span>
          ) : null}
        </ChecklistItem>
        <ChecklistItem done={expectationsDone} label="Expectations acknowledged">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="date"
              className="sos-input"
              value={expectationsAt}
              onChange={(e) => setExpectationsAt(e.target.value)}
              style={{ maxWidth: 190 }}
            />
            <PrimaryButton
              type="button"
              onClick={() => saveDate('expectationsAcknowledgedAt')}
              disabled={savingDates === 'expectations' || !expectationsAt}
              iconLeft={savingDates === 'expectations' ? <Loader2 size={13} className="sos-spin" /> : undefined}
            >
              {savingDates === 'expectations' ? '…' : 'Save'}
            </PrimaryButton>
          </div>
        </ChecklistItem>
        <ChecklistItem done={alternativesDone} label="Alternatives sheet signed">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="date"
              className="sos-input"
              value={alternativesAt}
              onChange={(e) => setAlternativesAt(e.target.value)}
              style={{ maxWidth: 190 }}
            />
            <PrimaryButton
              type="button"
              onClick={() => saveDate('alternativesSheetSignedAt')}
              disabled={savingDates === 'alternatives' || !alternativesAt}
              iconLeft={savingDates === 'alternatives' ? <Loader2 size={13} className="sos-spin" /> : undefined}
            >
              {savingDates === 'alternatives' ? '…' : 'Save'}
            </PrimaryButton>
          </div>
        </ChecklistItem>
        {datesErr ? <div style={errorBoxStyle}>{datesErr}</div> : null}
        {allReady ? (
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--sos-status-success-soft)', border: '1px solid var(--sos-status-success-border)', color: 'var(--sos-status-success)', fontSize: 12.5 }}>
            All retention conditions met — the Advance stage card can now move this matter to Retained.
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Activity timeline — read-only render of the JrAuditLog rows, newest-first.
// A best-effort one-line diff is shown when the row's old/new values carry a
// stage or route change; otherwise just the action + who + when.
// ---------------------------------------------------------------------------
function summarizeHistoryDiff(row: JrHistoryRow): string | null {
  const oldV = (row.oldValues ?? null) as Record<string, unknown> | null;
  const newV = (row.newValues ?? null) as Record<string, unknown> | null;
  const parts: string[] = [];
  const describe = (
    key: 'stage' | 'route',
    label: (v: string) => string,
    heading: string,
  ) => {
    const n = newV?.[key];
    if (n === undefined || n === null) return;
    const o = oldV?.[key];
    if (o != null && String(o) === String(n)) return;
    parts.push(o != null ? `${heading}: ${label(String(o))} → ${label(String(n))}` : `${heading}: ${label(String(n))}`);
  };
  describe('stage', jrStageLabel, 'Stage');
  describe('route', jrRouteLabel, 'Route');
  return parts.length ? parts.join(' · ') : null;
}

function TimelineCard({ history }: { history: JrHistoryRow[] }) {
  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <History size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Activity timeline</div>
      </div>
      {history.length === 0 ? (
        <EmptyState Icon={History} title="No activity yet" description="Stage, route and edit events will appear here." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {history.map((row) => {
            const diff = summarizeHistoryDiff(row);
            return (
              <div
                key={row.id}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                    {jrHumanize(row.action)}
                  </div>
                  {diff ? (
                    <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>{diff}</div>
                  ) : null}
                  <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
                    {row.actorName ?? 'System'} · {jrFmtDate(row.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}

export default function JrMatterDetailPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const { user } = useJrSession();
  const canAssign = user.permissions.includes('jr.matter.assign');
  const canEdit = user.permissions.includes('jr.matter.update_stage');
  const canDetermineRoute = user.permissions.includes('jr.route.determine');
  const canManageCounsel = user.permissions.includes('jr.counsel.manage');
  const canViewDatabank = user.permissions.includes('jr.portal.view');

  const [matter, setMatter] = useState<JrMatter | null>(null);
  const [deadlines, setDeadlines] = useState<JrDeadlineRow[]>([]);
  const [artifacts, setArtifacts] = useState<JrArtifactsGrouped>({ folders: [] });
  const [history, setHistory] = useState<JrHistoryRow[]>([]);
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
      fetchJrMatterHistory(matterId),
    ])
      .then(([m, d, a, h]) => {
        if (cancelled) return;
        setMatter(m);
        setDeadlines(d);
        setArtifacts(a);
        setHistory(h);
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

  // Only blank to the full-page spinner on the INITIAL load. A refetch (a
  // reloadKey bump from a DocumentsPanel action) keeps the loaded content on
  // screen so it never unmounts NotesPanel — which would discard an unsaved
  // voice clip / typed draft / pasted images — or reset scroll.
  if (loading && !matter) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--sos-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Loader2 size={16} className="sos-spin" /> Loading matter…
      </div>
    );
  }
  // Blank to the error card only when there is no matter to show (initial-load
  // failure). A failed refetch after the matter is already loaded keeps the
  // stale-but-valid content rather than wiping the workspace.
  if (!matter) {
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

      {/* Advance stage (gated on jr.matter.update_stage; only when the current
          stage has forward transitions). */}
      {canEdit && (JR_STAGE_TRANSITIONS[matter.stage]?.length ?? 0) > 0 ? (
        <StageAdvanceCard matter={matter} onChanged={() => setReloadKey((k) => k + 1)} />
      ) : null}

      {/* Route determination (gated on jr.route.determine). */}
      {canDetermineRoute ? (
        <RouteDeterminationCard matter={matter} onChanged={() => setReloadKey((k) => k + 1)} />
      ) : null}

      {/* Counsel & retention (gated on jr.counsel.manage) — drives RETAINED. */}
      {canManageCounsel ? (
        <CounselRetentionCard
          matter={matter}
          artifacts={artifacts}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      ) : null}

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

      {/* Documents (authoring + versioning + lifecycle) */}
      <DocumentsPanel
        matterId={matterId}
        artifacts={artifacts}
        canAuthor={user.permissions.includes('jr.artifact.author')}
        canSubmit={user.permissions.includes('jr.artifact.submit_to_counsel')}
        onChanged={() => setReloadKey((k) => k + 1)}
      />

      {/* Databank — the SAME per-client document repository the Processing team
          uses. An escalated client's application docs surface here for the JR
          associate. Shown only when the matter has a client + the user can view
          the JR portal; the tab manages its own state (no reloadKey wiring). */}
      {canViewDatabank && matter.clientId ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Database size={15} style={{ color: 'var(--sos-brand-primary-strong)' }} />
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Databank</div>
          </div>
          <JrDatabankTab
            clientId={matter.clientId}
            clientName={matter.client ? `${matter.client.firstName} ${matter.client.lastName}`.trim() : undefined}
          />
        </GlassCard>
      ) : null}

      {/* Notes (text / voice / image) */}
      <NotesPanel
        matterId={matterId}
        canCreate={user.permissions.includes('jr.note.create')}
        canModerate={user.permissions.includes('jr.matter.view_all')}
        currentUserId={user.id}
      />

      {/* Activity timeline (read-only) */}
      <TimelineCard history={history} />
    </div>
  );
}
