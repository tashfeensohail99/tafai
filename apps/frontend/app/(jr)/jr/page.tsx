'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  FilePlus2,
  FolderKanban,
  Loader2,
  Scale,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import {
  GlassCard,
  PageHeader,
  MetricCard,
  StatusBadge,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  Field,
  FormInput,
  FormSelect,
  FormTextarea,
} from '@/components/sales-v2/ui';
import { useJrSession } from '@/components/layout/JrShell';
import {
  assignJrMatter,
  createJrMatter,
  fetchJrAssociates,
  fetchJrBoard,
  fetchJrMatters,
  jrDueInfo,
  jrFmtDate,
  jrHumanize,
  jrStageLabel,
  jrStageTone,
  type CreateJrMatterInput,
  type JrAssociate,
  type JrBoardRow,
  type JrMatter,
  type JrMatterStage,
  type JrIntakeType,
  type ListMattersQuery,
} from '@/lib/jr';

/**
 * Judicial Review — Matters. The Head console (view_all: every matter, plus the
 * awaiting-assignment queue + inline Assign control) and the Associate workspace
 * (their own scoped matters). Backend scopes the list server-side; the assign
 * control only renders for callers with `jr.matter.assign`.
 */

const STAGES: JrMatterStage[] = [
  'INTAKE',
  'ROUTE_DETERMINED',
  'MERITS_REVIEW',
  'COUNSEL_DECLINED',
  'RETAINED',
  'REQUIRES_EXTENSION_REQUEST',
  'FILED',
  'LEAVE_GRANTED',
  'CLIENT_UNRESPONSIVE',
  'REDETERMINATION',
  'CLOSED',
];

const INTAKE_TYPES: JrIntakeType[] = ['EXTERNAL', 'INTERNAL'];

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

const GRID =
  'minmax(150px, 1.2fr) minmax(200px, 2fr) minmax(140px, 1.1fr) 120px minmax(180px, 1.4fr) 120px';

function intakeTone(t: JrIntakeType): 'cyan' | 'violet' {
  return t === 'INTERNAL' ? 'violet' : 'cyan';
}

// ---------------------------------------------------------------------------
// Inline assign control (Head console only) — pick an associate, save, refetch.
// ---------------------------------------------------------------------------
function AssignControl({
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

  async function save(next: string) {
    if (!next || next === matter.assignedAssociateUserId) return;
    setSaving(true);
    setErr(null);
    try {
      await assignJrMatter(matter.id, next);
      onAssigned();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to assign');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          className="sos-select"
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Assign associate"
          style={{ fontSize: 12.5, padding: '4px 8px', minWidth: 0, flex: 1 }}
        >
          <option value="">Unassigned…</option>
          {associates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <PrimaryButton
          onClick={() => save(value)}
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

// ---------------------------------------------------------------------------
// New Matter modal (Head only) — opens a NEW EXTERNAL matter for a decision the
// client brings in from outside our processing. v1 supports the new-client path
// only; a duplicate phone/email 409s and the message surfaces inline.
// ---------------------------------------------------------------------------
function NewMatterModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [decisionMaker, setDecisionMaker] = useState('OTHER');
  const [applicationType, setApplicationType] = useState('Judicial Review');
  const [decidingOfficeLocation, setDecidingOfficeLocation] = useState('UNKNOWN');
  const [decisionCommunicatedAt, setDecisionCommunicatedAt] = useState('');
  const [decisionCommunicatedNote, setDecisionCommunicatedNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    phone.trim() !== '' &&
    decisionMaker !== '' &&
    applicationType.trim() !== '' &&
    decisionCommunicatedAt !== '' &&
    decisionCommunicatedNote.trim() !== '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    const input: CreateJrMatterInput = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      decisionMaker,
      applicationType: applicationType.trim(),
      decisionCommunicatedAt,
      decisionCommunicatedNote: decisionCommunicatedNote.trim(),
      decidingOfficeLocation,
      ...(email.trim() ? { email: email.trim() } : {}),
    };
    try {
      await createJrMatter(input);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create matter');
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <GlassCard
        variant="strong"
        padded="lg"
        style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={saving}
          style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: saving ? 'not-allowed' : 'pointer', padding: 6, zIndex: 1 }}
        >
          <X size={16} />
        </button>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-brand-primary-strong)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
            <FilePlus2 size={13} /> New judicial review matter
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Open a matter</div>
          <div style={{ fontSize: 13, color: 'var(--sos-text-muted)', marginTop: 3 }}>
            External decision the client brings in from outside our processing.
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Client */}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Client
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormInput label="First name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={120} />
            <FormInput label="Last name" required value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={120} />
          </div>
          <FormInput
            label="Phone"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={40}
            hint="If this client already exists you'll get a 'duplicate' message — that path comes later."
          />
          <FormInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

          {/* Matter */}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>
            Matter
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormSelect
              label="Decision maker"
              required
              value={decisionMaker}
              onChange={(e) => setDecisionMaker(e.target.value)}
              options={DECISION_MAKER_OPTIONS}
            />
            <FormInput label="Application type" required value={applicationType} onChange={(e) => setApplicationType(e.target.value)} maxLength={80} />
          </div>
          <FormSelect
            label="Deciding office location"
            value={decidingOfficeLocation}
            onChange={(e) => setDecidingOfficeLocation(e.target.value)}
            options={DECIDING_OFFICE_OPTIONS}
            hint="15 days in-Canada / 60 outside / UNKNOWN treated as 15"
          />
          <Field
            label="Decision communicated to client"
            required
            hint="The day the client was notified of the refusal — this starts the fatal clock."
          >
            <input
              type="date"
              className="sos-input"
              value={decisionCommunicatedAt}
              onChange={(e) => setDecisionCommunicatedAt(e.target.value)}
            />
          </Field>
          <FormTextarea
            label="Chain of custody note"
            required
            value={decisionCommunicatedNote}
            onChange={(e) => setDecisionCommunicatedNote(e.target.value)}
            maxLength={400}
            rows={3}
            placeholder="e.g. refusal letter dated 2026-08-01, received by client on 2026-08-05 by email."
          />

          {error ? (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>
              {error}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <SecondaryButton type="button" onClick={onClose} disabled={saving}>Cancel</SecondaryButton>
            <PrimaryButton
              type="submit"
              disabled={!canSubmit || saving}
              iconLeft={saving ? <Loader2 size={14} className="sos-spin" /> : <FilePlus2 size={14} />}
            >
              {saving ? 'Creating…' : 'Create matter'}
            </PrimaryButton>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}

export default function JrMattersPage() {
  const { user, mode } = useJrSession();
  const canAssign = user.permissions.includes('jr.matter.assign');
  const canCreate = user.permissions.includes('jr.matter.create');

  const [newMatterOpen, setNewMatterOpen] = useState(false);
  const [matters, setMatters] = useState<JrMatter[]>([]);
  const [board, setBoard] = useState<JrBoardRow[]>([]);
  const [associates, setAssociates] = useState<JrAssociate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [stage, setStage] = useState<JrMatterStage | ''>('');
  const [intakeType, setIntakeType] = useState<JrIntakeType | ''>('');
  const [awaitingOnly, setAwaitingOnly] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Associate roster — only for callers who can assign (endpoint is gated).
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

  const query: ListMattersQuery = useMemo(
    () => ({
      take: 200,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(stage ? { stage } : {}),
      ...(intakeType ? { intakeType } : {}),
    }),
    [debouncedSearch, stage, intakeType],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchJrMatters(query), fetchJrBoard({ fatalOnly: true })])
      .then(([m, b]) => {
        if (cancelled) return;
        setMatters(m);
        setBoard(b);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load matters');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  const associateName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of associates) m.set(a.id, a.name);
    return m;
  }, [associates]);

  // Unassigned matters float to the top; then the awaiting-only chip filters.
  const displayed = useMemo(() => {
    const base = awaitingOnly
      ? matters.filter((m) => m.assignedAssociateUserId == null)
      : matters;
    return [...base].sort((a, b) => {
      const au = a.assignedAssociateUserId == null ? 0 : 1;
      const bu = b.assignedAssociateUserId == null ? 0 : 1;
      if (au !== bu) return au - bu;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [matters, awaitingOnly]);

  const openCount = matters.filter((m) => m.stage !== 'CLOSED').length;
  const awaitingCount = matters.filter((m) => m.assignedAssociateUserId == null).length;
  const hasFilters = !!(debouncedSearch || stage || intakeType || awaitingOnly);

  function clearFilters() {
    setSearch('');
    setStage('');
    setIntakeType('');
    setAwaitingOnly(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        eyebrow="Federal Court"
        title="Judicial Review"
        description={
          mode === 'head'
            ? 'Every JR matter, the awaiting-assignment queue, and the fatal-deadline strip.'
            : 'The judicial review matters assigned to you.'
        }
        actions={
          canCreate ? (
            <PrimaryButton onClick={() => setNewMatterOpen(true)} iconLeft={<FilePlus2 size={15} />}>
              New Matter
            </PrimaryButton>
          ) : undefined
        }
      />

      {newMatterOpen ? (
        <NewMatterModal
          onClose={() => setNewMatterOpen(false)}
          onCreated={() => {
            setNewMatterOpen(false);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : null}

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <MetricCard label="Open matters" value={openCount} tone="accent" Icon={Scale} hint="Not yet closed" />
        <MetricCard
          label="Awaiting assignment"
          value={awaitingCount}
          tone="warning"
          Icon={UserPlus}
          hint="No associate assigned"
        />
        <MetricCard
          label="Fatal deadlines"
          value={board.length}
          tone="danger"
          Icon={AlertTriangle}
          hint="Pending, cannot be missed"
        />
      </div>

      {/* Fatal-deadline strip */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <AlertTriangle size={15} style={{ color: 'var(--sos-status-danger)' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Fatal deadlines</div>
        </div>
        {board.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sos-text-muted)' }}>
            No pending fatal deadlines across your matters.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {board.slice(0, 12).map((d) => {
              const due = jrDueInfo(d.effectiveDueAt);
              return (
                <Link
                  key={d.id}
                  href={`/jr/matters/${d.matterId}` as Route}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 12px',
                    borderRadius: 'var(--sos-radius-md)',
                    background: 'var(--sos-surface-2)',
                    textDecoration: 'none',
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sos-text-primary)', minWidth: 120 }}>
                    {d.matterNumber}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--sos-text-secondary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.label || jrHumanize(d.milestoneKey)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{jrFmtDate(d.effectiveDueAt)}</span>
                  <StatusBadge tone={due.tone} size="sm">{due.label}</StatusBadge>
                </Link>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Filters */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)' }}>
            <Search size={14} style={{ color: 'var(--sos-text-muted)' }} />
            <input
              type="search"
              placeholder="Search by matter number, style of cause or court file…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--sos-text-primary)', fontSize: 13.5 }}
            />
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '1px solid var(--sos-brand-primary)', borderRadius: 6, background: 'var(--sos-brand-primary-soft)', color: 'var(--sos-brand-primary-strong)', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}
              >
                <X size={12} /> Clear filters
              </button>
            ) : null}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <select className="sos-input" value={stage} onChange={(e) => setStage(e.target.value as JrMatterStage | '')} aria-label="Stage">
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>{jrStageLabel(s)}</option>
              ))}
            </select>
            <select className="sos-input" value={intakeType} onChange={(e) => setIntakeType(e.target.value as JrIntakeType | '')} aria-label="Intake type">
              <option value="">All intake types</option>
              {INTAKE_TYPES.map((t) => (
                <option key={t} value={t}>{t === 'INTERNAL' ? 'Internal escalation' : 'External'}</option>
              ))}
            </select>
            {canAssign ? (
              <button
                type="button"
                onClick={() => setAwaitingOnly((v) => !v)}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 'var(--sos-radius-md)',
                  border: `1px solid ${awaitingOnly ? 'var(--sos-brand-primary)' : 'var(--sos-border-subtle)'}`,
                  background: awaitingOnly ? 'var(--sos-brand-primary-soft)' : 'transparent',
                  color: awaitingOnly ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
                  fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <UserPlus size={14} /> Awaiting assignment {awaitingCount > 0 ? `(${awaitingCount})` : ''}
              </button>
            ) : null}
          </div>
        </div>
      </GlassCard>

      {/* Matters table */}
      <GlassCard variant="panel" padded={false}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 980 }}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '9px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
              <span>Client / matter</span>
              <span>Style of cause</span>
              <span>Stage</span>
              <span>Intake</span>
              <span>Associate</span>
              <span>Opened</span>
            </div>

            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--sos-text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Loader2 size={14} className="sos-spin" /> Loading…
              </div>
            ) : error ? (
              <div style={{ padding: 24, color: 'var(--sos-status-danger)' }}>Failed to load matters: {error}</div>
            ) : displayed.length === 0 ? (
              <div style={{ padding: 8 }}>
                <EmptyState
                  Icon={FolderKanban}
                  title={hasFilters ? 'No matters match these filters' : 'No judicial review matters yet'}
                  description={
                    hasFilters
                      ? 'Try clearing the filters to see the full caseload.'
                      : 'Matters appear here once they are opened from a refused decision.'
                  }
                />
              </div>
            ) : (
              displayed.map((m) => {
                const assignedName = m.assignedAssociateUserId
                  ? associateName.get(m.assignedAssociateUserId) ?? 'Assigned'
                  : null;
                return (
                  <div
                    key={m.id}
                    style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '13px 16px', alignItems: 'center', borderBottom: '1px solid var(--sos-border-subtle)', transition: 'background 150ms' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ minWidth: 0 }}>
                      <Link href={`/jr/matters/${m.id}` as Route} style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {m.clientName || m.styleOfCause || '—'}
                      </Link>
                      <div style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{m.matterNumber}</div>
                      {m.courtFileNumber ? (
                        <div style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>{m.courtFileNumber}</div>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 13, color: m.styleOfCause ? 'var(--sos-text-secondary)' : 'var(--sos-text-muted)', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.styleOfCause ?? '—'}
                    </div>
                    <div>
                      <StatusBadge tone={jrStageTone(m.stage)} size="sm">{jrStageLabel(m.stage)}</StatusBadge>
                    </div>
                    <div>
                      <StatusBadge tone={intakeTone(m.intakeType)} size="sm" dot={false}>
                        {m.intakeType === 'INTERNAL' ? 'Internal' : 'External'}
                      </StatusBadge>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      {canAssign && associates.length > 0 ? (
                        // Always assignable for a Head — the control pre-selects the
                        // current assignee, so this also RE-assigns an assigned matter.
                        <AssignControl matter={m} associates={associates} onAssigned={() => setReloadKey((k) => k + 1)} />
                      ) : assignedName ? (
                        <span style={{ fontSize: 13, color: 'var(--sos-text-secondary)' }}>{assignedName}</span>
                      ) : canAssign ? (
                        <span style={{ fontSize: 11, color: 'var(--sos-text-muted)' }}>
                          No associates — create JR logins
                        </span>
                      ) : (
                        <StatusBadge tone="warning" size="sm">Unassigned</StatusBadge>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{jrFmtDate(m.createdAt)}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
