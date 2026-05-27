'use client';
// Processing Dashboard — Phase 1B / Screen 1.
// Officer sees: KPI strip, new intake alert, my active cases table, and
// quick links to the queues that need attention today.

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileSearch,
  FolderKanban,
  Inbox,
  Send,
  User,
} from 'lucide-react';
import {
  fetchProcessingDashboard,
  fetchIntakeQueue,
  casePersonName,
  type ProcessingDashboardMetrics,
  type ApiProcessingCaseListItem,
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
  MOCK_PROCESSING_OFFICER,
  MOCK_PROCESSING_CASES,
  countByStage,
  getIntakePending,
  getMyCases,
  fmtRelative,
  fmtAmount,
  STAGE_LABEL,
  PRIORITY_LABEL,
  type ProcessingStage,
  type ProcessingPriority,
} from '@/components/processing/mockData';

// ---------- Tone helpers ---------------------------------------------------

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

// ---------- Dashboard component -------------------------------------------

export function ProcessingDashboardPage() {
  // Real backend wiring. KPI counts come from /processing/dashboard;
  // the urgent-intake panel pulls from /processing/intake. Was previously
  // 100% mock data.
  const [metrics, setMetrics] = useState<ProcessingDashboardMetrics | null>(null);
  const [intakePending, setIntakePending] = useState<ApiProcessingCaseListItem[]>([]);
  const [loadingErr, setLoadingErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchProcessingDashboard(), fetchIntakeQueue()])
      .then(([m, q]) => {
        if (cancelled) return;
        setMetrics(m);
        setIntakePending(q);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadingErr(err instanceof Error ? err.message : 'Failed to load dashboard');
      });
    return () => { cancelled = true; };
  }, []);

  const activeCasesTotal = metrics?.activeCases ?? 0;
  const underReview = metrics?.awaitingReview ?? 0;
  const readyToSubmit = metrics?.readyToSubmit ?? 0;
  // "With authority" isn't its own backend tile yet — derive from list when
  // we wire a richer dashboard. For now: total - under-review - ready ≈
  // submitted/awaiting buckets, but we keep it neutral until backend tile
  // ships.
  const withAuthority = 0;

  const urgentIntake = intakePending.filter((c) => c.priority === 'CRITICAL' || c.priority === 'URGENT');
  // Was wired to a hardcoded mock officer; until per-officer "my cases"
  // ships in the API, fall back to total active count for the header line.
  const myCases: ApiProcessingCaseListItem[] = [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Hero header */}
      <PageHeader
        eyebrow="Processing Team"
        title={
          <>
            Good morning, {MOCK_PROCESSING_OFFICER.name.split(' ')[0]}.
            {myCases.length > 0 ? ` You have ${myCases.length} active cases.` : ''}
          </>
        }
        description={
          intakePending.length > 0
            ? `${intakePending.length} new case${intakePending.length !== 1 ? 's' : ''} in the intake queue — ${urgentIntake.length > 0 ? `${urgentIntake.length} urgent` : 'review when ready'}.`
            : 'Intake queue is clear. Focus on your active caseload.'
        }
        actions={
          <>
            <ButtonLink
              href={'/processing/intake' as Route}
              variant="primary"
              iconLeft={<Inbox size={15} />}
            >
              Intake queue ({intakePending.length})
            </ButtonLink>
            <ButtonLink
              href={'/processing/cases' as Route}
              variant="secondary"
              iconLeft={<FolderKanban size={15} />}
            >
              My cases ({myCases.length})
            </ButtonLink>
            <ButtonLink
              href={'/processing/documents' as Route}
              variant="ghost"
              iconLeft={<FileSearch size={14} />}
              iconRight={<ArrowRight size={14} />}
            >
              Document reviews
            </ButtonLink>
          </>
        }
      />

      {/* KPI strip */}
      <section
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        }}
      >
        <MetricCard label="Active cases" value={activeCasesTotal} hint="Across all officers" tone="accent" Icon={FolderKanban} footer="Total live caseload" />
        <MetricCard label="New intake" value={intakePending.length} hint="Awaiting acknowledgment" tone={intakePending.length > 0 ? 'warning' : 'neutral'} Icon={Inbox} footer={intakePending.length > 0 ? 'Claim a case to start' : 'Queue is clear'} />
        <MetricCard label="Under review" value={underReview} hint="Documents being assessed" tone="info" Icon={FileSearch} footer="Resume review in queue" />
        <MetricCard label="Ready to file" value={readyToSubmit} hint="Docs complete, submit now" tone={readyToSubmit > 0 ? 'success' : 'neutral'} Icon={Send} footer={readyToSubmit > 0 ? 'File without delay' : 'None ready yet'} />
        <MetricCard label="With authority" value={withAuthority} hint="Submitted, awaiting decision" tone="info" Icon={Clock} footer="Track via authority portal" />
      </section>

      {/* Urgent intake alert */}
      {urgentIntake.length > 0 ? (
        <GlassCard variant="strong" padded="md" style={{ borderLeft: '3px solid var(--sos-status-warning)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ flexShrink: 0, width: '36px', height: '36px', borderRadius: '10px', background: 'var(--sos-status-warning-soft)', border: '1px solid var(--sos-status-warning-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={16} style={{ color: 'var(--sos-status-warning)' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '4px' }}>
                {urgentIntake.length} urgent case{urgentIntake.length !== 1 ? 's' : ''} need immediate acknowledgment
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                {urgentIntake.map((c) => (
                  <Link
                    key={c.id}
                    href={`/processing/cases/${c.id}` as Route}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', border: '1px solid var(--sos-border-subtle)', fontSize: '13px', color: 'var(--sos-text-primary)', textDecoration: 'none', fontWeight: 500 }}
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

      {/* My active cases table */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>My active cases</div>
            <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>Cases assigned to you</div>
          </div>
          <Link href={'/processing/cases' as Route} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: 'var(--sos-brand-primary-strong)', fontWeight: 500, textDecoration: 'none' }}>
            View all <ArrowRight size={13} />
          </Link>
        </div>

        {myCases.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--sos-text-muted)', fontSize: '14px' }}>
            No active cases assigned to you.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 100px', gap: '12px', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
              <span>Client / Service</span>
              <span>Stage</span>
              <span>Priority</span>
              <span>Days in stage</span>
              <span></span>
            </div>
            {myCases.map((c) => (
              <div
                key={c.id}
                style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 100px', gap: '12px', padding: '12px', borderRadius: 'var(--sos-radius-md)', alignItems: 'center', transition: 'background 150ms', cursor: 'default' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <User size={13} style={{ color: 'var(--sos-text-muted)', flexShrink: 0 }} />
                    {casePersonName(c)}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>
                    {labelForServiceCode(c.service)} · {c.targetCountry}
                  </div>
                </div>
                <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
                <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
                <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)' }}>
                  {Math.floor((Date.now() - new Date(c.updatedAt).getTime()) / 86400000)}d
                </div>
                <Link
                  href={`/processing/cases/${c.id}` as Route}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 500, color: 'var(--sos-brand-primary-strong)', textDecoration: 'none' }}
                >
                  Open <ArrowRight size={13} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* All-cases snapshot — link out to the full list. The previous inline
          table rendered mock data; the real list lives at /processing/cases
          with proper pagination + filters. */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>All active cases</div>
            <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>
              Team-wide caseload — currently {activeCasesTotal} live across all officers.
            </div>
          </div>
          <Link
            href={'/processing/cases' as Route}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--sos-brand-primary-strong)', fontWeight: 500, textDecoration: 'none' }}
          >
            Open case list <ArrowRight size={13} />
          </Link>
        </div>
        {loadingErr ? (
          <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--sos-status-danger)' }}>
            Couldn&apos;t load metrics: {loadingErr}
          </div>
        ) : null}
      </GlassCard>
    </div>
  );
}
