'use client';
// Tasks Tab — wired to /processing/cases/:id/tasks.
// List + add + mark in-progress / done.

import { useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  ClipboardList,
  Clock,
  Loader2,
  PlusCircle,
  XCircle,
} from 'lucide-react';
import {
  GlassCard,
  EmptyState,
  PrimaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  fmtDate,
} from '@/components/processing/mockData';
import {
  fetchCaseTasks,
  createCaseTask,
  updateCaseTask,
  type ApiProcessingTask,
  type ProcessingTaskPriority,
  type ProcessingTaskStatus,
} from '@/lib/processing';

function taskPriorityTone(p: ProcessingTaskPriority): BadgeTone {
  switch (p) {
    case 'URGENT': return 'danger';
    case 'HIGH': return 'warning';
    case 'NORMAL': return 'info';
    case 'LOW': return 'neutral';
    default: return 'neutral';
  }
}

function taskStatusLabel(s: ProcessingTaskStatus): string {
  switch (s) {
    case 'OPEN': return 'Open';
    case 'IN_PROGRESS': return 'In progress';
    case 'COMPLETED': return 'Done';
    case 'CANCELLED': return 'Cancelled';
    default: return s;
  }
}

function StatusIcon({ status }: { status: ProcessingTaskStatus }) {
  if (status === 'COMPLETED') return <CheckCircle2 size={16} style={{ color: 'var(--sos-status-success)' }} />;
  if (status === 'CANCELLED') return <XCircle size={16} style={{ color: 'var(--sos-text-muted)' }} />;
  if (status === 'IN_PROGRESS') return <Clock size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />;
  return <Circle size={16} style={{ color: 'var(--sos-text-muted)' }} />;
}

function TaskCard({
  task,
  onAdvance,
}: {
  task: ApiProcessingTask;
  onAdvance: (id: string, next: ProcessingTaskStatus) => void;
}) {
  const isDone = task.status === 'COMPLETED' || task.status === 'CANCELLED';
  const isOverdue =
    task.dueDate && !isDone ? new Date(task.dueDate).getTime() < Date.now() : false;

  // Click rotates through OPEN → IN_PROGRESS → COMPLETED → OPEN
  const next: ProcessingTaskStatus =
    task.status === 'OPEN' ? 'IN_PROGRESS' :
    task.status === 'IN_PROGRESS' ? 'COMPLETED' :
    task.status === 'COMPLETED' ? 'OPEN' :
    task.status;

  return (
    <div style={{ display: 'flex', gap: '12px', padding: '12px 14px', borderBottom: '1px solid var(--sos-border-subtle)', alignItems: 'flex-start', opacity: isDone ? 0.55 : 1, transition: 'background 150ms' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <button
        type="button"
        onClick={() => onAdvance(task.id, next)}
        aria-label={`Advance to ${next}`}
        style={{ paddingTop: '1px', background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        <StatusIcon status={task.status} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: isDone ? 'var(--sos-text-muted)' : 'var(--sos-text-primary)', textDecoration: isDone ? 'line-through' : 'none', marginBottom: '4px' }}>
          {task.title}
        </div>
        {task.description ? (
          <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginBottom: '6px', lineHeight: 1.5 }}>{task.description}</div>
        ) : null}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusBadge tone={taskPriorityTone(task.priority)} size="sm" dot={false}>{task.priority}</StatusBadge>
          <StatusBadge tone={isDone ? 'neutral' : 'info'} size="sm" dot={false}>
            {taskStatusLabel(task.status)}
          </StatusBadge>
          {task.dueDate ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: isOverdue ? 'var(--sos-status-danger)' : 'var(--sos-text-muted)' }}>
              <CalendarClock size={11} /> Due {fmtDate(task.dueDate)}
            </span>
          ) : null}
          {task.assignedTo ? (
            <span style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
              · {task.assignedTo.email.split('@')[0]}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const PRIORITIES: Array<{ value: ProcessingTaskPriority; label: string }> = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

function AddTaskForm({ caseId, onSaved }: { caseId: string; onSaved: (t: ApiProcessingTask) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<ProcessingTaskPriority>('NORMAL');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    if (!title.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const saved = await createCaseTask(caseId, {
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: dueDate || undefined,
        priority,
      });
      onSaved(saved);
      setTitle('');
      setDescription('');
      setDueDate('');
      setPriority('NORMAL');
      setOpen(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create task');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <PrimaryButton iconLeft={<PlusCircle size={14} />} onClick={() => setOpen(true)}>
        Add task
      </PrimaryButton>
    );
  }

  return (
    <GlassCard variant="strong" padded="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          className="sos-input"
          placeholder="Task title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)…"
          rows={3}
          style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Due</div>
            <input
              className="sos-input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Priority</div>
            <select
              className="sos-input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as ProcessingTaskPriority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
        {err ? (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>
            {err}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setOpen(false)} style={{ padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <PrimaryButton onClick={handleSubmit} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Add task'}
          </PrimaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

export function TasksTab({ c }: { c: MockProcessingCase }) {
  const [tasks, setTasks] = useState<ApiProcessingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCaseTasks(c.id)
      .then((rows) => { if (!cancelled) setTasks(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load tasks'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [c.id]);

  function handleSaved(t: ApiProcessingTask) {
    setTasks((prev) => [t, ...prev]);
  }

  async function handleAdvance(id: string, next: ProcessingTaskStatus) {
    // Optimistic — flip in place, revert on error.
    const prev = tasks;
    setTasks((curr) => curr.map((t) => (t.id === id ? { ...t, status: next } : t)));
    try {
      const updated = await updateCaseTask(c.id, id, { status: next });
      setTasks((curr) => curr.map((t) => (t.id === id ? updated : t)));
    } catch {
      setTasks(prev);
    }
  }

  const open = tasks.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
  const done = tasks.filter((t) => t.status === 'COMPLETED' || t.status === 'CANCELLED');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <AddTaskForm caseId={c.id} onSaved={handleSaved} />
      </div>

      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" />
            <span>Loading tasks…</span>
          </div>
        </GlassCard>
      ) : err ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>
        </GlassCard>
      ) : tasks.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={ClipboardList}
            title="No tasks yet"
            description="Track per-case actions like 'Call client about passport', 'Draft cover letter', or 'Schedule biometrics'."
          />
        </GlassCard>
      ) : (
        <>
          {open.length > 0 ? (
            <GlassCard variant="panel" padded={false}>
              <div style={{ padding: '10px 14px', fontSize: 11.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
                Open ({open.length})
              </div>
              {open.map((t) => <TaskCard key={t.id} task={t} onAdvance={handleAdvance} />)}
            </GlassCard>
          ) : null}
          {done.length > 0 ? (
            <GlassCard variant="panel" padded={false}>
              <div style={{ padding: '10px 14px', fontSize: 11.5, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
                Done ({done.length})
              </div>
              {done.map((t) => <TaskCard key={t.id} task={t} onAdvance={handleAdvance} />)}
            </GlassCard>
          ) : null}
        </>
      )}
    </div>
  );
}
