'use client';
// Tasks Tab — Phase 1B.
// Shows task cards with priority/status/assignee/due date.
// Basic add-task form.

import { useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  ClipboardList,
  Clock,
  PlusCircle,
  User,
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
  type MockTask,
  fmtDate,
} from '@/components/processing/mockData';

// ---------- Tone helpers --------------------------------------------------

function taskPriorityTone(p: MockTask['priority']): BadgeTone {
  switch (p) {
    case 'URGENT': return 'danger';
    case 'HIGH': return 'warning';
    case 'NORMAL': return 'info';
    case 'LOW': return 'neutral';
    default: return 'neutral';
  }
}

function taskStatusTone(s: MockTask['status']): BadgeTone {
  switch (s) {
    case 'OPEN': return 'info';
    case 'IN_PROGRESS': return 'accent';
    case 'BLOCKED': return 'danger';
    case 'DONE': return 'success';
    case 'CANCELLED': return 'neutral';
    default: return 'neutral';
  }
}

function taskStatusLabel(s: MockTask['status']): string {
  switch (s) {
    case 'OPEN': return 'Open';
    case 'IN_PROGRESS': return 'In progress';
    case 'BLOCKED': return 'Blocked';
    case 'DONE': return 'Done';
    case 'CANCELLED': return 'Cancelled';
    default: return s;
  }
}

function StatusIcon({ status }: { status: MockTask['status'] }) {
  if (status === 'DONE') return <CheckCircle2 size={16} style={{ color: 'var(--sos-status-success)' }} />;
  if (status === 'BLOCKED') return <XCircle size={16} style={{ color: 'var(--sos-status-danger)' }} />;
  if (status === 'IN_PROGRESS') return <Clock size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />;
  if (status === 'CANCELLED') return <XCircle size={16} style={{ color: 'var(--sos-text-muted)' }} />;
  return <Circle size={16} style={{ color: 'var(--sos-text-muted)' }} />;
}

// ---------- Task card -----------------------------------------------------

function TaskCard({ task, onDone }: { task: MockTask; onDone: (id: string) => void }) {
  const isDone = task.status === 'DONE' || task.status === 'CANCELLED';
  const isOverdue = task.dueDate ? new Date(task.dueDate) < new Date('2026-05-11') && !isDone : false;

  return (
    <div style={{ display: 'flex', gap: '12px', padding: '12px 14px', borderBottom: '1px solid var(--sos-border-subtle)', alignItems: 'flex-start', opacity: isDone ? 0.55 : 1, transition: 'background 150ms' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ paddingTop: '1px' }}>
        <StatusIcon status={task.status} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: isDone ? 'var(--sos-text-muted)' : 'var(--sos-text-primary)', textDecoration: isDone ? 'line-through' : 'none', marginBottom: '4px' }}>
          {task.title}
        </div>
        {task.description ? (
          <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginBottom: '6px', lineHeight: 1.5 }}>{task.description}</div>
        ) : null}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusBadge tone={taskPriorityTone(task.priority)} size="sm" dot={false}>{task.priority}</StatusBadge>
          <StatusBadge tone={taskStatusTone(task.status)} size="sm">{taskStatusLabel(task.status)}</StatusBadge>
          {task.assignedToName ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
              <User size={11} /> {task.assignedToName}
            </span>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--sos-status-warning)' }}>Unassigned</span>
          )}
          {task.dueDate ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: isOverdue ? 'var(--sos-status-danger)' : 'var(--sos-text-muted)' }}>
              {isOverdue ? <AlertTriangle size={11} /> : <CalendarClock size={11} />}
              Due {fmtDate(task.dueDate)}
              {isOverdue ? ' (overdue)' : ''}
            </span>
          ) : null}
        </div>
      </div>
      {!isDone ? (
        <button
          type="button"
          onClick={() => onDone(task.id)}
          title="Mark as done"
          style={{ flexShrink: 0, background: 'transparent', border: '1px solid var(--sos-border-subtle)', borderRadius: 'var(--sos-radius-sm)', padding: '4px 10px', fontSize: '12px', color: 'var(--sos-text-muted)', cursor: 'pointer', transition: 'all 150ms' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sos-status-success-soft)'; e.currentTarget.style.color = 'var(--sos-status-success)'; e.currentTarget.style.borderColor = 'var(--sos-status-success-border)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--sos-text-muted)'; e.currentTarget.style.borderColor = 'var(--sos-border-subtle)'; }}
        >
          Done
        </button>
      ) : null}
    </div>
  );
}

// ---------- Add task form --------------------------------------------------

function AddTaskForm({ onAdd }: { onAdd: (task: MockTask) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<MockTask['priority']>('NORMAL');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);

  function handleSubmit() {
    if (!title.trim()) return;
    setLoading(true);
    setTimeout(() => {
      onAdd({
        id: `task-new-${Date.now()}`,
        title,
        priority,
        status: 'OPEN',
        assignedToName: 'Sara Malik',
        dueDate: dueDate || null,
      });
      setTitle('');
      setPriority('NORMAL');
      setDueDate('');
      setOpen(false);
      setLoading(false);
    }, 500);
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title…"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '120px' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Priority</div>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as MockTask['priority'])}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}
            >
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: '120px' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Due date</div>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setOpen(false)} style={{ padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: '13px', cursor: 'pointer' }}>
            Cancel
          </button>
          <PrimaryButton onClick={handleSubmit} disabled={loading || !title.trim()}>
            {loading ? 'Creating…' : 'Create task'}
          </PrimaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

// ---------- Tasks tab component -------------------------------------------

export function TasksTab({ c }: { c: MockProcessingCase }) {
  const [tasks, setTasks] = useState<MockTask[]>(c.tasks);

  function handleAdd(task: MockTask) {
    setTasks((prev) => [task, ...prev]);
  }

  function handleDone(id: string) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: 'DONE' as const } : t));
  }

  const open = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
  const done = tasks.filter((t) => t.status === 'DONE' || t.status === 'CANCELLED');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <AddTaskForm onAdd={handleAdd} />
      </div>

      {tasks.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={ClipboardList}
            title="No tasks yet"
            description="Create tasks to track follow-ups and reminders for this case."
          />
        </GlassCard>
      ) : (
        <>
          {open.length > 0 ? (
            <GlassCard variant="panel" padded={false}>
              <div style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
                Open tasks ({open.length})
              </div>
              {open.map((t) => <TaskCard key={t.id} task={t} onDone={handleDone} />)}
            </GlassCard>
          ) : null}

          {done.length > 0 ? (
            <GlassCard variant="panel" padded={false}>
              <div style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
                Completed / cancelled ({done.length})
              </div>
              {done.map((t) => <TaskCard key={t.id} task={t} onDone={handleDone} />)}
            </GlassCard>
          ) : null}
        </>
      )}
    </div>
  );
}
