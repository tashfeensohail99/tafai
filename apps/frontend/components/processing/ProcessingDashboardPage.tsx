'use client';
// Processing Dashboard — wired to real backend (P4.1 + P5.3).
//
// Same page renders for managers and associates with different framing:
// - Associate: "your work today" — KPIs filtered to their own caseload.
// - Manager: same numbers (server returns aggregates when canViewAll)
//   plus a deeper top-of-page link into the Manager Queue.

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileSearch,
  FolderKanban,
  Inbox,
  Loader2,
  Send,
  User,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  casePersonName,
  fetchProcessingCases,
  fetchProcessingDashboard,
  fetchIntakeQueue,
  type ApiProcessingCaseListItem,
  type ProcessingDashboardMetrics,
} from '@/lib/processing';
import { labelForServiceCode } from '@/lib/service-types';
import {
  ButtonLink,
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  fmtRelative,
  STAGE_LABEL,
  PRIORITY_LABEL,
  type ProcessingStage,
  type ProcessingPriority,
} from '@/components/processing/mockData';
import { useProcessingSession } from '@/components/layout/ProcessingShell';

// ---------- Tone helpers (used by other pages too) -------------------------

export function stageTone(stage: ProcessingStage): BadgeTone {
  switch (stage) {
    case 'INTAKE_PENDING': return 'neutral';
    case 'DOCUMENTS_COLLECTION': return 'info';
    case 'DOCUMENTS_UNDER_REVIEW': return 'accent';
    case 'DOCUMENTS_INCOMPLETE': return 'warning';
    case 'DOCUMENTS_COMPLETE': return 'success';
    case 'READY_FOR_SUBMISSION': return 'violet';
    case 'SUBMITTED': return 'cyan';
    case 'UNDER_AUTHORITY_REVIEW': return 'info';
    case 'ADDITIONAL_INFO_REQUESTED': return 'warning';
    case 'DECISION_RECEIVED': return 'accent';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    case 'APPEAL_IN_PROGRESS': return 'warm';
    case 'COMPLETED': return 'success';
    case 'CANCELLED': return 'neutral';
    default: return 'neutral';
  }
}

export function priorityTone(priority: ProcessingPriority): BadgeTone {
  switch (priority) {
    case 'CRITICAL': return 'danger';
    case 'URGENT': return 'warning';
    case 'NORMAL': return 'info';
    case 'LOW': return 'neutral';
    default: return 'neutral';
  }
}

// ---------- Dashboard ------------------------------------------------------

export function ProcessingDashboardPage() {
  const { user } = useProcessingSession();
  const [metrics, setMetrics] = useState<ProcessingDashboardMetrics | null>(null);
  const [myCases, setMyCases] = useState<ApiProcessingCaseListItem[]>([]);
  const [intakePending, setIntakePending] = useState<ApiProcessingCaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Manager == anyone who can see all cases or assign. Drives the framing
  // (Manager Queue link, header copy).
  const isManager = user.permissions.includes('processing.case.view_all')
    || user.permissions.includes('processing.case.assign');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // The cases call returns my own caseload for associates (server-side
    // filter via processing.case.view_assigned) or the full caseload for
    // managers. We filter to active stages for the table.
    Promise.all([
      fetchProcessingDashboard(),
      fetchProcessingCases({ limit: 8 }),
      isManager ? fetchIntakeQueue() : Promise.resolve([]),
    ])
      .then(([m, casesRes, intake]) => {
        if (cancelled) return;
        setMetrics(m);
        setMyCases(casesRes.cases.filter((c) => c.stage !== 'COMPLETED' && c.stage !== 'CANCELLED'));
        setIntakePending(intake);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isManager]);

  const urgentIntake = useMemo(
    () => intakePending.filter((c) => c.priority === 'CRITICAL' || c.priority === 'URGENT'),
    [intakePending],
  );

  const greetingName = user.name?.split(' ')[0] ?? user.email.split('@')[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader
        eyebrow={isManager ? 'Processing — Manager' : 'Processing — Associate'}
        title={
          <>
            Hi {greetingName}.
            {metrics ? ` ${isManager ? 'Team is carrying' : 'You have'} ${metrics.activeCases} active case${metrics.activeCases !== 1 ? 's' : ''}.` : ''}
          </>
        }
        description={
          isManager
            ? (intakePending.length > 0
              ? `${intakePending.length} new case${intakePending.length !== 1 ? 's' : ''} from Finance awaiting your assignment.`
              : 'No new intake from Finance. Track team workload below.')
            : ((metrics?.myClientFollowUp ?? 0) > 0
              ? `${metrics?.myClientFollowUp} case${metrics?.myClientFollowUp !== 1 ? 's' : ''} blocked on client — follow up today.`
              : 'No client follow-ups pending. Focus on your active caseload.')
        }
        actions={
          <>
            {isManager ? (
              <ButtonLink href={'/processing/intake' as Route} variant="primary" iconLeft={<Inbox size={15} />}>
                Manager Queue ({intakePending.length})
              </ButtonLink>
            ) : null}
            <ButtonLink href={'/processing/cases' as Route} variant={isManager ? 'secondary' : 'primary'} iconLeft={<FolderKanban size={15} />}>
              {isManager ? 'All cases' : 'My cases'}
            </ButtonLink>
            <ButtonLink href={'/processing/documents' as Route} variant="ghost" iconLeft={<FileSearch size={14} />} iconRight={<ArrowRight size={14} />}>
              Document reviews
            </ButtonLink>
          </>
        }
      />

      {/* KPI strip — per-associate framing (server already filters by user). */}
      <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <MetricCard
          label={isManager ? 'Active cases' : 'My active cases'}
          value={metrics?.activeCases ?? 0}
          hint={isManager ? 'Team-wide' : 'Assigned to you'}
          tone="accent"
          Icon={FolderKanban}
        />
        <MetricCard
          label={isManager ? 'Pending docs cases' : 'My pending docs'}
          value={metrics?.myPendingDocs ?? 0}
          hint="In document collection / review"
          tone={(metrics?.myPendingDocs ?? 0) > 0 ? 'info' : 'neutral'}
          Icon={FileSearch}
        />
        <MetricCard
          label={isManager ? 'Client follow-ups' : 'My client follow-ups'}
          value={metrics?.myClientFollowUp ?? 0}
          hint="Awaiting client (incomplete / info request)"
          tone={(metrics?.myClientFollowUp ?? 0) > 0 ? 'warning' : 'success'}
          Icon={UserCheck}
        />
        <MetricCard
          label={isManager ? 'Ready to file' : 'My ready to file'}
          value={metrics?.readyToSubmit ?? 0}
          hint="Final submission pending"
          tone={(metrics?.readyToSubmit ?? 0) > 0 ? 'success' : 'neutral'}
          Icon={Send}
        />
        <MetricCard
          label={isManager ? 'Approved' : 'My approved'}
          value={metrics?.myApproved ?? 0}
          hint="Lifetime"
          tone="success"
          Icon={CheckCircle2}
        />
        <MetricCard
          label={isManager ? 'Refused' : 'My refused'}
          value={metrics?.myRefused ?? 0}
          hint="Lifetime"
          tone={(metrics?.myRefused ?? 0) > 0 ? 'neutral' : 'success'}
          Icon={XCircle}
        />
      </section>

      {/* Quick links — shortcuts to the most-used sections, placed right under
          the KPI strip so they're handy without crowding the bottom. */}
      <section style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <QuickLink href="/processing/tasks" label="Today's tasks" icon={<Clock size={14} />} count={null} />
        <QuickLink href="/processing/documents" label="Document queue" icon={<FileSearch size={14} />} count={metrics?.myPendingDocs ?? null} />
        <QuickLink href="/processing/refunds" label="Refunds & appeals" icon={<XCircle size={14} />} count={null} />
        <QuickLink href="/processing/history" label="Case history" icon={<CheckCircle2 size={14} />} count={null} />
      </section>

      {/* Urgent intake alert — manager-only */}
      {isManager && urgentIntake.length > 0 ? (
        <GlassCard variant="strong" padded="md" style={{ borderLeft: '3px solid var(--sos-status-warning)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, background: 'var(--sos-status-warning-soft)', border: '1px solid var(--sos-status-warning-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={16} style={{ color: 'var(--sos-status-warning)' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: 4 }}>
                {urgentIntake.length} urgent case{urgentIntake.length !== 1 ? 's' : ''} need immediate assignment
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {urgentIntake.map((c) => (
                  <Link
                    key={c.id}
                    href={`/processing/intake` as Route}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', border: '1px solid var(--sos-border-subtle)', fontSize: 13, color: 'var(--sos-text-primary)', textDecoration: 'none', fontWeight: 500 }}
                  >
                    <StatusBadge tone={priorityTone(c.priority)} size="sm">{c.priority}</StatusBadge>
                    {casePersonName(c)} — {labelForServiceCode(c.service)} / {c.targetCountry}
                    <ArrowRight size={13} style={{ color: 'var(--sos-text-muted)' }} />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      ) : null}

      {/* Cases table */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {isManager ? 'Recent active cases' : 'My active cases'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 2 }}>
              {isManager ? 'Team-wide caseload — top 8 by priority' : 'Cases assigned to you'}
            </div>
          </div>
          <Link href={'/processing/cases' as Route} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--sos-brand-primary-strong)', fontWeight: 500, textDecoration: 'none' }}>
            View all <ArrowRight size={13} />
          </Link>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" /> Loading dashboard…
          </div>
        ) : error ? (
          <div style={{ fontSize: 13, color: 'var(--sos-status-danger)', padding: 12 }}>
            Couldn&apos;t load dashboard: {error}
          </div>
        ) : myCases.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--sos-text-muted)', fontSize: 14 }}>
            {isManager ? 'No active cases yet.' : 'No cases assigned to you yet. Your manager will assign work as it comes in.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 100px', gap: 12, padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
              <span>Client / Service</span>
              <span>Stage</span>
              <span>Priority</span>
              <span>Last activity</span>
              <span></span>
            </div>
            {myCases.map((c) => (
              <div
                key={c.id}
                style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 100px', gap: 12, padding: 12, borderRadius: 'var(--sos-radius-md)', alignItems: 'center', transition: 'background 150ms' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <User size={13} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
                    {casePersonName(c)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 2 }}>
                    {labelForServiceCode(c.service)} · {c.targetCountry}
                  </div>
                </div>
                <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
                <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
                <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                  {fmtRelative(c.updatedAt)}
                </div>
                <Link
                  href={`/processing/cases/${c.id}` as Route}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 500, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}
                >
                  Open <ArrowRight size={13} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function QuickLink({ href, label, icon, count }: { href: string; label: string; icon: React.ReactNode; count: number | null }) {
  return (
    <Link
      href={href as Route}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', textDecoration: 'none' }}
    >
      <span style={{ color: 'var(--sos-brand-primary-strong)' }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--sos-text-primary)' }}>{label}</span>
      {count != null ? <StatusBadge tone="neutral" size="sm">{count}</StatusBadge> : null}
      <ArrowRight size={12} style={{ color: 'var(--sos-text-muted)' }} />
    </Link>
  );
}
