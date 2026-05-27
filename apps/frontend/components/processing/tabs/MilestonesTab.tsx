'use client';
// Milestones Tab — per-case-type progress checklist.
//
// Seeded at acknowledge from milestone-templates.ts on the backend (WORK_
// PERMIT: LMIA + Offer Letter; E2_VISA: Business Meeting + Incorporation;
// etc.). Associate ticks them off as they complete the work. Manager can
// add ad-hoc milestones via the "+ Add milestone" affordance.
//
// Independent of the gated stage machine — completing all milestones
// doesn't auto-advance the stage. That stays under the manager's control
// from the case header.

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  PlusCircle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {
  GlassCard,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
} from '@/components/sales-v2/ui';
import {
  fmtRelative,
  type MockProcessingCase,
} from '@/components/processing/mockData';
import {
  completeMilestone,
  createCaseMilestone,
  fetchCaseMilestones,
  uncompleteMilestone,
  type ApiCaseMilestone,
} from '@/lib/processing';
import { useProcessingSession } from '@/components/layout/ProcessingShell';

function MilestoneRow({
  m,
  onComplete,
  onUncomplete,
  busy,
  isLast,
}: {
  m: ApiCaseMilestone;
  onComplete: (id: string) => void;
  onUncomplete: (id: string) => void;
  busy: boolean;
  isLast: boolean;
}) {
  const done = !!m.completedAt;
  return (
    <div style={{ display: 'flex', gap: 12, position: 'relative' }}>
      {/* Vertical connector */}
      {!isLast ? (
        <div
          style={{
            position: 'absolute',
            left: 11,
            top: 28,
            bottom: -6,
            width: 2,
            background: done ? 'var(--sos-status-success)' : 'var(--sos-border-subtle)',
            transition: 'background 200ms',
          }}
        />
      ) : null}

      {/* Status dot — click to toggle */}
      <button
        type="button"
        onClick={() => (done ? onUncomplete(m.id) : onComplete(m.id))}
        disabled={busy}
        title={done ? 'Mark not done' : 'Mark done'}
        aria-label={done ? 'Mark milestone not done' : 'Mark milestone done'}
        style={{
          flexShrink: 0,
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: done ? 'var(--sos-status-success)' : 'var(--sos-surface-2)',
          border: `2px solid ${done ? 'var(--sos-status-success)' : 'var(--sos-border-default)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: busy ? 'wait' : 'pointer',
          marginTop: 4,
          padding: 0,
          opacity: busy ? 0.6 : 1,
          transition: 'all 150ms',
          zIndex: 1,
        }}
      >
        {done ? <CheckCircle2 size={14} style={{ color: '#fff' }} /> : <Circle size={14} style={{ color: 'transparent' }} />}
      </button>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 14,
            fontWeight: 600,
            color: done ? 'var(--sos-text-muted)' : 'var(--sos-text-primary)',
            textDecoration: done ? 'line-through' : 'none',
          }}>
            {m.title}
          </span>
          {done && m.completedAt ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--sos-status-success)' }}>
              <CheckCircle2 size={11} />
              {fmtRelative(m.completedAt)}{m.completedBy ? ` · ${m.completedBy.email.split('@')[0]}` : ''}
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--sos-text-muted)' }}>
              <Clock size={11} /> Pending
            </span>
          )}
          {done ? (
            <button
              type="button"
              onClick={() => onUncomplete(m.id)}
              disabled={busy}
              title="Mark not done"
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--sos-text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, padding: 2 }}
            >
              <RotateCcw size={10} /> Undo
            </button>
          ) : null}
        </div>
        {m.description ? (
          <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)', marginTop: 3, lineHeight: 1.5 }}>
            {m.description}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AddMilestoneForm({
  caseId,
  nextSortOrder,
  onSaved,
}: {
  caseId: string;
  nextSortOrder: number;
  onSaved: (m: ApiCaseMilestone) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    if (!title.trim()) {
      setErr('Title is required');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const saved = await createCaseMilestone(caseId, {
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        sortOrder: nextSortOrder,
      });
      onSaved(saved);
      setTitle('');
      setDescription('');
      setOpen(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to add milestone');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <SecondaryButton iconLeft={<PlusCircle size={14} />} onClick={() => setOpen(true)}>
        Add milestone
      </SecondaryButton>
    );
  }

  return (
    <GlassCard variant="strong" padded="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          className="sos-input"
          placeholder="Milestone title (e.g. Authority interview scheduled)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional context for what this step covers"
          style={{ width: '100%', resize: 'vertical', padding: '8px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
        {err ? (
          <div style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12 }}>{err}</div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setOpen(false)} disabled={saving} style={{ padding: '6px 14px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <PrimaryButton onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? 'Adding…' : 'Add milestone'}
          </PrimaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

export function MilestonesTab({ c }: { c: MockProcessingCase }) {
  const { user } = useProcessingSession();
  const [items, setItems] = useState<ApiCaseMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Manager-only affordance for adding ad-hoc milestones. Server enforces
  // this too via processing.case.assign permission on the POST route.
  const isManager = user.permissions.includes('processing.case.assign')
    || user.permissions.includes('processing.case.view_all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCaseMilestones(c.id)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load milestones'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [c.id]);

  async function handleComplete(id: string) {
    setBusyId(id);
    // Optimistic: mark complete locally, revert if server fails.
    const prev = items;
    setItems((curr) => curr.map((m) => m.id === id
      ? { ...m, completedAt: new Date().toISOString(), completedByUserId: user.id, completedBy: { id: user.id, email: user.email } }
      : m));
    try {
      const updated = await completeMilestone(c.id, id);
      setItems((curr) => curr.map((m) => m.id === id ? updated : m));
    } catch (e: unknown) {
      setItems(prev);
      setErr(e instanceof Error ? e.message : 'Failed to mark complete');
    } finally {
      setBusyId(null);
    }
  }

  async function handleUncomplete(id: string) {
    setBusyId(id);
    const prev = items;
    setItems((curr) => curr.map((m) => m.id === id
      ? { ...m, completedAt: null, completedByUserId: null, completedBy: null }
      : m));
    try {
      const updated = await uncompleteMilestone(c.id, id);
      setItems((curr) => curr.map((m) => m.id === id ? updated : m));
    } catch (e: unknown) {
      setItems(prev);
      setErr(e instanceof Error ? e.message : 'Failed to mark not done');
    } finally {
      setBusyId(null);
    }
  }

  const completed = items.filter((m) => m.completedAt).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const nextSortOrder = items.length > 0
    ? Math.max(...items.map((m) => m.sortOrder)) + 1
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Progress header */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--sos-brand-primary-soft)', border: '1px solid var(--sos-brand-primary-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Sparkles size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {completed} of {total} milestones complete
            </div>
            <div style={{ marginTop: 6, height: 6, background: 'var(--sos-border-subtle)', borderRadius: 9999, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--sos-status-success)' : 'var(--sos-brand-primary-strong)', borderRadius: 9999, transition: 'width 300ms ease' }} />
            </div>
          </div>
          {isManager ? (
            <AddMilestoneForm caseId={c.id} nextSortOrder={nextSortOrder} onSaved={(m) => setItems((curr) => [...curr, m])} />
          ) : null}
        </div>
      </GlassCard>

      {err ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>
        </GlassCard>
      ) : null}

      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" /> Loading milestones…
          </div>
        </GlassCard>
      ) : items.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={Sparkles}
            title="No milestones yet"
            description="Milestones get seeded automatically when a manager acknowledges a case. Older cases acknowledged before this feature shipped have an empty list — the manager can add milestones by hand if needed."
          />
        </GlassCard>
      ) : (
        <GlassCard variant="panel" padded="md">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {items.map((m, idx) => (
              <MilestoneRow
                key={m.id}
                m={m}
                onComplete={handleComplete}
                onUncomplete={handleUncomplete}
                busy={busyId === m.id}
                isLast={idx === items.length - 1}
              />
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
