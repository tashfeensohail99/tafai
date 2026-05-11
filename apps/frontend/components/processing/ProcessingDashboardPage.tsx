'use client';
// Processing Dashboard — Phase 1B / Screen 1.
// Officer sees: KPI strip, new intake alert, my active cases table, and
// quick links to the queues that need attention today.

import Link from 'next/link';
import type { Route } from 'next';
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
  const intakePending = getIntakePending();
  const myCases = getMyCases(MOCK_PROCESSING_OFFICER.id);

  const activeCasesTotal = MOCK_PROCESSING_CASES.filter(
    (c) => c.stage !== 'COMPLETED' && c.stage !== 'CANCELLED',
  ).length;
  const underReview = countByStage('DOCUMENTS_UNDER_REVIEW');
  const readyToSubmit = countByStage('READY_FOR_SUBMISSION') + countByStage('DOCUMENTS_COMPLETE');
  const withAuthority = countByStage('SUBMITTED') + countByStage('UNDER_AUTHORITY_REVIEW');

  const urgentIntake = intakePending.filter((c) => c.priority === 'CRITICAL' || c.priority === 'URGENT');

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
                    {c.clientName} — {c.service} / {c.targetCountry}
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
                    {c.clientName}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>
                    {c.service} · {c.targetCountry}
                  </div>
                </div>
                <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
                <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
                <div style={{ fontSize: '13px', color: c.daysInCurrentStage >= 5 ? 'var(--sos-status-warning)' : 'var(--sos-text-muted)' }}>
                  {c.daysInCurrentStage}d
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

      {/* All-cases snapshot — show other officers too */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>All active cases</div>
            <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '2px' }}>Team-wide caseload snapshot</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '12px', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sos-border-subtle)' }}>
            <span>Client / Service</span>
            <span>Stage</span>
            <span>Priority</span>
            <span>Officer</span>
            <span>Created</span>
          </div>
          {MOCK_PROCESSING_CASES.filter((c) => c.stage !== 'COMPLETED' && c.stage !== 'CANCELLED').map((c) => (
            <Link
              key={c.id}
              href={`/processing/cases/${c.id}` as Route}
              style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '12px', padding: '12px', borderRadius: 'var(--sos-radius-md)', alignItems: 'center', textDecoration: 'none', color: 'inherit', transition: 'background 150ms' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{c.clientName}</div>
                <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{c.service} · {c.targetCountry}</div>
              </div>
              <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
              <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
              <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)' }}>
                {c.assignedOfficer ? c.assignedOfficer.name.split(' ')[0] : <span style={{ color: 'var(--sos-status-warning)', fontWeight: 600 }}>Unassigned</span>}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>{fmtRelative(c.createdAt)}</div>
            </Link>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
