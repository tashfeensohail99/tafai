'use client';
// Cross-Case Task List — wired to GET /processing/tasks.
// Aggregated view of all OPEN / IN_PROGRESS / BLOCKED tasks across the
// officer's cases (or all cases for managers). Quick-complete inline.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  ClipboardList,
  Clock,
  ExternalLink,
  Filter,
  Loader2,
  Search,
  ShieldAlert,
  User,
  XCircle,
} from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { PRIORITY_LABEL, fmtDate } from '@/components/processing/mockData';
import { priorityTone } from './ProcessingDashboardPage';
import {
  casePersonName,
  fetchAggregatedTasks,
  updateCaseTask,
  type ApiAggregatedTask,
  type ProcessingTaskPriority,
  type ProcessingTaskStatus,
} from '@/lib/processing';
import { labelForServiceCode } from '@/lib/service-types';

function taskPriorityTone(p: ProcessingTaskPriority): BadgeTone {
  switch (p) {
    case 'URGENT': return 'danger';
    case 'HIGH':   return 'warning';
    case 'NORMAL': return 'info';
    case 'LOW':    return 'neutral';
  }
}

function taskStatusTone(s: ProcessingTaskStatus): BadgeTone {
  switch (s) {
    case 'OPEN':        return 'info';
    case 'IN_PROGRESS': return 'accent';
    case 'BLOCKED':     return 'danger';
    case 'DONE':        return 'success';
    case 'CANCELLED':   return 'neutral';
  }
}

function taskStatusLabel(s: ProcessingTaskStatus): string {
  const map: Record<ProcessingTaskStatus, string> = {
    OPEN: 'Open', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', DONE: 'Done', CANCELLED: 'Cancelled',
  };
  return map[s];
}

type StatusFilter = 'ALL' | ProcessingTaskStatus;
type PriorityFilter = 'ALL' | ProcessingTaskPriority;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL',        label: 'All' },
  { value: 'OPEN',       label: 'Open' },
  { value: 'IN_PROGRESS',label: 'In progress' },
  { value: 'BLOCKED',    label: 'Blocked' },
];

const PRIORITY_OPTIONS: { value: PriorityFilter; label: string }[] = [
  { value: 'ALL',    label: 'All priorities' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'HIGH',   label: 'High' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LOW',    label: 'Low' },
];

function personName(c: ApiAggregatedTask['case']): string {
  const src = c.client ?? c.lead;
  const first = src?.firstName?.trim() ?? '';
  const last = src?.lastName?.trim() ?? '';
  const full = `${first} ${last}`.trim();
  return full || 'Unnamed';
}

function TaskRow({
  task,
  onDone,
  busy,
  todayIso,
}: {
  task: ApiAggregatedTask;
  onDone: (id: string) => void;
  busy: boolean;
  todayIso: string;
}) {
  const isOverdue = !!task.dueDate && task.dueDate < todayIso;
  const clientName = personName(task.case);

  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap' }}>
        <div style={{ paddingTop: '2px', flexShrink: 0 }}>
          {task.status === 'IN_PROGRESS' ? (
            <Clock size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          ) : task.status === 'BLOCKED' ? (
            <XCircle size={16} style={{ color: 'var(--sos-status-danger)' }} />
          ) : (
            <Circle size={16} style={{ color: 'var(--sos-text-muted)' }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '5px' }}>
            {task.title}
          </div>
          {task.description ? (
            <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginBottom: '6px', lineHeight: 1.5 }}>
              {task.description}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusBadge tone={taskPriorityTone(task.priority)} size="sm" dot={false}>
              {task.priority}
            </StatusBadge>
            <StatusBadge tone={taskStatusTone(task.status)} size="sm">
              {taskStatusLabel(task.status)}
            </StatusBadge>
            {task.assignedTo ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
                <User size={11} /> {task.assignedTo.email.split('@')[0]}
              </span>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--sos-status-warning)' }}>Unassigned</span>
            )}
            {task.dueDate ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: isOverdue ? 'var(--sos-status-danger)' : 'var(--sos-text-muted)', fontWeight: isOverdue ? 600 : 400 }}>
                {isOverdue ? <AlertTriangle size={11} /> : <CalendarClock size={11} />}
                {isOverdue ? 'Overdue · ' : 'Due '}
                {fmtDate(task.dueDate)}
              </span>
            ) : null}
          </div>
        </div>

        <div style={{ minWidth: '150px', flexShrink: 0 }}>
          <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)', marginBottom: '3px', fontWeight: 500 }}>
            {clientName}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)', marginBottom: '5px' }}>
            {labelForServiceCode(task.case.service)} · {task.case.targetCountry}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <StatusBadge tone={priorityTone(task.case.priority)} size="sm">
              {PRIORITY_LABEL[task.case.priority]}
            </StatusBadge>
            <Link
              href={`/processing/cases/${task.case.id}` as Route}
              title="Open case"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11.5px', color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}
            >
              <ExternalLink size={11} /> Case
            </Link>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onDone(task.id)}
          disabled={busy}
          title="Mark as done"
          style={{ flexShrink: 0, alignSelf: 'center', background: 'transparent', border: '1px solid var(--sos-border-subtle)', borderRadius: 'var(--sos-radius-sm)', padding: '5px 12px', fontSize: '12.5px', color: 'var(--sos-text-muted)', cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '5px', opacity: busy ? 0.5 : 1 }}
        >
          <CheckCircle2 size={13} /> {busy ? 'Saving…' : 'Done'}
        </button>
      </div>
    </GlassCard>
  );
}

export function ProcessingTasksPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('ALL');
  const [search, setSearch] = useState('');
  const [tasks, setTasks] = useState<ApiAggregatedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAggregatedTasks();
      setTasks(res.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function handleDone(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setBusyId(taskId);
    try {
      await updateCaseTask(task.caseId, taskId, { status: 'DONE' });
      // Optimistic: drop from list. Server is the source of truth on reload.
      setTasks((curr) => curr.filter((t) => t.id !== taskId));
    } catch (err) {
      // Surface error in the alert area then reload to resync.
      setError(err instanceof Error ? err.message : 'Failed to mark task done');
      void reload();
    } finally {
      setBusyId(null);
    }
  }

  const overdueCount = tasks.filter((t) => !!t.dueDate && t.dueDate < todayIso).length;
  const blockedCount = tasks.filter((t) => t.status === 'BLOCKED').length;
  const urgentCount  = tasks.filter((t) => t.priority === 'URGENT').length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      const sOk = statusFilter === 'ALL' || t.status === statusFilter;
      const pOk = priorityFilter === 'ALL' || t.priority === priorityFilter;
      const qOk =
        !q ||
        [t.title, t.description ?? '', casePersonName(t.case), labelForServiceCode(t.case.service), t.case.targetCountry]
          .join(' ')
          .toLowerCase()
          .includes(q);
      return sOk && pOk && qOk;
    });
  }, [tasks, statusFilter, priorityFilter, search]);

  const overdue = filtered.filter((t) => !!t.dueDate && t.dueDate < todayIso);
  const onTime  = filtered.filter((t) => !t.dueDate || t.dueDate >= todayIso);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Task List"
        description="All open tasks across your active cases — sorted by priority and due date."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        <MetricCard
          label="Open tasks"
          value={String(tasks.length)}
          hint={tasks.length === 0 ? 'All clear' : `${tasks.length} remaining`}
          Icon={ClipboardList}
          tone="accent"
        />
        <MetricCard
          label="Overdue"
          value={String(overdueCount)}
          hint={overdueCount > 0 ? 'Past due date' : 'None overdue'}
          Icon={AlertTriangle}
          tone={overdueCount > 0 ? 'danger' : 'success'}
        />
        <MetricCard
          label="Blocked"
          value={String(blockedCount)}
          hint={blockedCount > 0 ? 'Need unblocking' : 'None blocked'}
          Icon={ShieldAlert}
          tone={blockedCount > 0 ? 'danger' : 'success'}
        />
        <MetricCard
          label="Urgent"
          value={String(urgentCount)}
          hint={urgentCount > 0 ? 'Act today' : 'None urgent'}
          Icon={AlertTriangle}
          tone={urgentCount > 0 ? 'warning' : 'success'}
        />
      </div>

      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '4px', background: 'var(--sos-surface-2)', borderRadius: 'var(--sos-radius-md)', padding: '3px' }}>
            {STATUS_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--sos-radius-sm)',
                  border: 'none',
                  background: statusFilter === value ? 'var(--sos-brand-primary-strong)' : 'transparent',
                  color: statusFilter === value ? '#fff' : 'var(--sos-text-secondary)',
                  fontSize: '12.5px',
                  fontWeight: statusFilter === value ? 600 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={13} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as PriorityFilter)}
              style={{ padding: '5px 10px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-default)', background: 'var(--sos-bg-surface)', color: 'var(--sos-text-primary)', fontSize: '12.5px', cursor: 'pointer', outline: 'none' }}
            >
              {PRIORITY_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', minWidth: 200 }}>
            <Search size={13} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
            <input
              type="search"
              placeholder="Search task, client, service…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--sos-text-primary)', fontSize: 12.5 }}
            />
          </div>

          <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
            {filtered.length} task{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      </GlassCard>

      {error ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>Failed to load tasks: {error}</div>
        </GlassCard>
      ) : null}

      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" /> Loading tasks…
          </div>
        </GlassCard>
      ) : null}

      {!loading && overdue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11px', fontWeight: 700, color: 'var(--sos-status-danger)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            <AlertTriangle size={13} />
            Overdue ({overdue.length})
          </div>
          <div style={{ borderLeft: '3px solid var(--sos-status-danger-border)', paddingLeft: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {overdue.map((t) => (
              <TaskRow key={t.id} task={t} onDone={handleDone} busy={busyId === t.id} todayIso={todayIso} />
            ))}
          </div>
        </div>
      )}

      {!loading && onTime.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {overdue.length > 0 && (
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Upcoming ({onTime.length})
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {onTime.map((t) => (
              <TaskRow key={t.id} task={t} onDone={handleDone} busy={busyId === t.id} todayIso={todayIso} />
            ))}
          </div>
        </div>
      )}

      {!loading && filtered.length === 0 && !error && (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={CheckCircle2}
            title={tasks.length === 0 ? 'All tasks complete' : 'No tasks match this filter'}
            description={
              tasks.length === 0
                ? 'Great work — no open tasks across your cases right now.'
                : 'Try a different status or priority filter.'
            }
          />
        </GlassCard>
      )}
    </div>
  );
}
