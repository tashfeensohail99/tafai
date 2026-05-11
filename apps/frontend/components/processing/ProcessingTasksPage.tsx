'use client';
// Cross-Case Task List — Phase 1F-2.
// Aggregated view of all open/in-progress/blocked tasks across the officer's cases.
// Supports quick-complete inline, priority/status filtering, and overdue section.

import { useState, useMemo } from 'react';
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
import {
  MOCK_PROCESSING_OFFICER,
  getAggregatedTaskQueue,
  PRIORITY_LABEL,
  fmtDate,
  type MockTask,
  type ProcessingPriority,
  type AggregatedTaskRow,
} from '@/components/processing/mockData';
import { priorityTone } from './ProcessingDashboardPage';

// ---------------------------------------------------------------------------
// Tone helpers (mirrors TasksTab)
// ---------------------------------------------------------------------------

function taskPriorityTone(p: MockTask['priority']): BadgeTone {
  switch (p) {
    case 'URGENT': return 'danger';
    case 'HIGH':   return 'warning';
    case 'NORMAL': return 'info';
    case 'LOW':    return 'neutral';
  }
}

function taskStatusTone(s: MockTask['status']): BadgeTone {
  switch (s) {
    case 'OPEN':        return 'info';
    case 'IN_PROGRESS': return 'accent';
    case 'BLOCKED':     return 'danger';
    case 'DONE':        return 'success';
    case 'CANCELLED':   return 'neutral';
  }
}

function taskStatusLabel(s: MockTask['status']): string {
  const map: Record<MockTask['status'], string> = {
    OPEN: 'Open', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', DONE: 'Done', CANCELLED: 'Cancelled',
  };
  return map[s];
}

// ---------------------------------------------------------------------------
// Filter config
// ---------------------------------------------------------------------------

type StatusFilter = 'ALL' | MockTask['status'];
type PriorityFilter = 'ALL' | MockTask['priority'];

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

const TODAY = '2026-05-12';

// ---------------------------------------------------------------------------
// Task row
// ---------------------------------------------------------------------------

function TaskRow({
  row,
  onDone,
}: {
  row: AggregatedTaskRow;
  onDone: (id: string) => void;
}) {
  const { task, caseId, clientName, service, targetCountry, casePriority } = row;
  const isOverdue = !!task.dueDate && task.dueDate < TODAY;
  const [hover, setHover] = useState(false);

  return (
    <GlassCard variant="default" padded="md">
      <div
        style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap', background: hover ? 'var(--sos-surface-hover)' : 'transparent', transition: 'background 150ms', borderRadius: 'var(--sos-radius-sm)', margin: '-4px', padding: '4px' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {/* Status icon */}
        <div style={{ paddingTop: '2px', flexShrink: 0 }}>
          {task.status === 'IN_PROGRESS' ? (
            <Clock size={16} style={{ color: 'var(--sos-brand-primary-strong)' }} />
          ) : task.status === 'BLOCKED' ? (
            <XCircle size={16} style={{ color: 'var(--sos-status-danger)' }} />
          ) : (
            <Circle size={16} style={{ color: 'var(--sos-text-muted)' }} />
          )}
        </div>

        {/* Task body */}
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
            {task.assignedToName ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
                <User size={11} /> {task.assignedToName}
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

        {/* Case context */}
        <div style={{ minWidth: '150px', flexShrink: 0 }}>
          <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)', marginBottom: '3px', fontWeight: 500 }}>
            {clientName}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)', marginBottom: '5px' }}>
            {service} · {targetCountry}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <StatusBadge tone={priorityTone(casePriority)} size="sm">
              {PRIORITY_LABEL[casePriority]}
            </StatusBadge>
            <Link
              href={`/processing/cases/${caseId}` as Route}
              title="Open case"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11.5px', color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}
            >
              <ExternalLink size={11} /> Case
            </Link>
          </div>
        </div>

        {/* Quick-done button */}
        <button
          type="button"
          onClick={() => onDone(task.id)}
          title="Mark as done"
          style={{ flexShrink: 0, alignSelf: 'center', background: 'transparent', border: '1px solid var(--sos-border-subtle)', borderRadius: 'var(--sos-radius-sm)', padding: '5px 12px', fontSize: '12.5px', color: 'var(--sos-text-muted)', cursor: 'pointer', transition: 'all 150ms', display: 'flex', alignItems: 'center', gap: '5px' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sos-status-success-soft)'; e.currentTarget.style.color = 'var(--sos-status-success)'; e.currentTarget.style.borderColor = 'var(--sos-status-success-border)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--sos-text-muted)'; e.currentTarget.style.borderColor = 'var(--sos-border-subtle)'; }}
        >
          <CheckCircle2 size={13} /> Done
        </button>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function ProcessingTasksPage() {
  const [statusFilter,   setStatusFilter]   = useState<StatusFilter>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('ALL');
  const [doneIds,        setDoneIds]        = useState<Set<string>>(new Set());

  // All open tasks for my cases
  const allRows = useMemo(() => getAggregatedTaskQueue(MOCK_PROCESSING_OFFICER.id), []);

  // Live rows: exclude locally-done
  const liveRows = useMemo(
    () => allRows.filter((r) => !doneIds.has(r.task.id)),
    [allRows, doneIds],
  );

  function handleDone(id: string) {
    setDoneIds((prev) => new Set([...prev, id]));
  }

  // Metrics over live rows
  const overdueCount  = liveRows.filter((r) => !!r.task.dueDate && r.task.dueDate < TODAY).length;
  const blockedCount  = liveRows.filter((r) => r.task.status === 'BLOCKED').length;
  const urgentCount   = liveRows.filter((r) => r.task.priority === 'URGENT').length;

  // Filtered
  const filtered = useMemo(() => {
    return liveRows.filter((r) => {
      const sOk = statusFilter   === 'ALL' || r.task.status   === statusFilter;
      const pOk = priorityFilter === 'ALL' || r.task.priority === priorityFilter;
      return sOk && pOk;
    });
  }, [liveRows, statusFilter, priorityFilter]);

  // Split into overdue + normal for visual grouping
  const overdue = filtered.filter((r) => !!r.task.dueDate && r.task.dueDate < TODAY);
  const onTime  = filtered.filter((r) => !r.task.dueDate || r.task.dueDate >= TODAY);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Task List"
        description="All open tasks across your active cases — sorted by priority and due date."
      />

      {/* ── KPI strip ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        <MetricCard
          label="Open tasks"
          value={String(liveRows.length)}
          hint={liveRows.length === 0 ? 'All clear' : `${liveRows.length} remaining`}
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

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* Status tabs */}
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
                  transition: 'all 150ms',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Priority select */}
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

          <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--sos-text-muted)' }}>
            {filtered.length} task{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      </GlassCard>

      {/* ── Overdue section ────────────────────────────────────────────── */}
      {overdue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11px', fontWeight: 700, color: 'var(--sos-status-danger)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            <AlertTriangle size={13} />
            Overdue ({overdue.length})
          </div>
          <div style={{ borderLeft: '3px solid var(--sos-status-danger-border)', paddingLeft: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {overdue.map((row) => (
              <TaskRow key={`${row.caseId}-${row.task.id}`} row={row} onDone={handleDone} />
            ))}
          </div>
        </div>
      )}

      {/* ── On-time tasks ──────────────────────────────────────────────── */}
      {onTime.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {overdue.length > 0 && (
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Upcoming ({onTime.length})
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {onTime.map((row) => (
              <TaskRow key={`${row.caseId}-${row.task.id}`} row={row} onDone={handleDone} />
            ))}
          </div>
        </div>
      )}

      {/* ── Empty ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={CheckCircle2}
            title={liveRows.length === 0 ? 'All tasks complete' : 'No tasks match this filter'}
            description={
              liveRows.length === 0
                ? 'Great work — no open tasks across your cases right now.'
                : 'Try a different status or priority filter.'
            }
          />
        </GlassCard>
      )}
    </div>
  );
}
