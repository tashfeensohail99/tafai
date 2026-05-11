'use client';
// Case Workspace — Phase 1B / Screen 3.
// Full case view with left metadata rail and tabbed panel.
// Tabs: Documents · Timeline · Communications · Notes · Tasks · Submissions

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardEdit,
  ClipboardList,
  AlertCircle,
  FileSearch,
  Globe,
  History,
  Layers,
  MessageSquare,
  Phone,
  Send,
  StickyNote,
  User,
  Wallet,
  XCircle,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';
import {
  GlassCard,
  StatusBadge,
  PrimaryButton,
  SecondaryButton,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  getCaseById,
  fmtAmount,
  fmtDate,
  fmtRelative,
  STAGE_LABEL,
  PRIORITY_LABEL,
  type MockProcessingCase,
} from '@/components/processing/mockData';
import { stageTone, priorityTone } from './ProcessingDashboardPage';
import { DocumentChecklistTab } from './tabs/DocumentChecklistTab';
import { CaseTimelineTab } from './tabs/CaseTimelineTab';
import { CommunicationsTab } from './tabs/CommunicationsTab';
import { InternalNotesTab } from './tabs/InternalNotesTab';
import { TasksTab } from './tabs/TasksTab';
import { SubmissionsTab } from './tabs/SubmissionsTab';
import { StageChangeModal } from './StageChangeModal';
import { ProcessingAssignmentModal } from './ProcessingAssignmentModal';
import { CorrectionRequestModal } from './CorrectionRequestModal';
import { CancelCaseModal } from './CancelCaseModal';
import { CorrectionsTab } from './tabs/CorrectionsTab';
import { useProcessingSession } from '@/components/layout/ProcessingShell';

// ---------- Tabs -----------------------------------------------------------

type TabKey = 'documents' | 'timeline' | 'communications' | 'notes' | 'tasks' | 'submissions' | 'corrections';

const TABS: Array<{ key: TabKey; label: string; Icon: React.ElementType }> = [
  { key: 'documents', label: 'Documents', Icon: FileSearch },
  { key: 'timeline', label: 'Timeline', Icon: History },
  { key: 'communications', label: 'Comms', Icon: MessageSquare },
  { key: 'notes', label: 'Notes', Icon: StickyNote },
  { key: 'tasks', label: 'Tasks', Icon: ClipboardList },
  { key: 'corrections', label: 'Corrections', Icon: AlertCircle },
  { key: 'submissions', label: 'Submissions', Icon: Send },
];

// ---------- Left metadata rail --------------------------------------------

function CaseMetaSidebar({ c }: { c: MockProcessingCase }) {
  const docProgress = (() => {
    const core = c.documentItems.filter((i) => i.criticality === 'CRITICAL' || i.criticality === 'REQUIRED');
    const accepted = core.filter((i) => i.status === 'ACCEPTED' || i.status === 'WAIVED' || i.status === 'NOT_APPLICABLE').length;
    const rejected = core.filter((i) => i.status === 'REJECTED').length;
    return { accepted, total: core.length, rejected };
  })();
  const docPct = docProgress.total > 0 ? Math.round((docProgress.accepted / docProgress.total) * 100) : 0;

  return (
    <aside style={{ width: '260px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Client card */}
      <GlassCard variant="panel" padded="md">
        <div style={{ marginBottom: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client</div>
        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sos-text-primary)', display: 'flex', alignItems: 'center', gap: '7px' }}>
          <User size={14} style={{ color: 'var(--sos-text-muted)' }} />
          {c.clientName}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Phone size={12} /> {c.clientPhone}
        </div>
        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-text-muted)' }}>
          <Globe size={12} /> {c.service} · {c.targetCountry}
        </div>
      </GlassCard>

      {/* Stage + priority */}
      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Stage</div>
            <StatusBadge tone={stageTone(c.stage)} size="md">{STAGE_LABEL[c.stage]}</StatusBadge>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Priority</div>
            <StatusBadge tone={priorityTone(c.priority)} size="md" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Time in stage</div>
            <div style={{ fontSize: '13px', color: c.daysInCurrentStage >= 5 ? 'var(--sos-status-warning)' : 'var(--sos-text-primary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '5px' }}>
              {c.daysInCurrentStage >= 5 ? <AlertTriangle size={13} /> : <CalendarClock size={13} />}
              {c.daysInCurrentStage}d in current stage
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Document progress */}
      {c.documentItems.length > 0 ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Document progress
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ flex: 1, height: '7px', background: 'var(--sos-surface-hover)', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{ width: `${docPct}%`, height: '100%', background: docPct === 100 ? 'var(--sos-status-success)' : 'var(--sos-brand-gradient)', borderRadius: '999px', transition: 'width 400ms ease' }} />
            </div>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--sos-text-primary)', minWidth: '36px', textAlign: 'right' }}>{docPct}%</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11.5px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--sos-status-success)' }}>
              <CheckCircle2 size={11} /> {docProgress.accepted} accepted
            </div>
            {docProgress.rejected > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--sos-status-danger)' }}>
                <XCircle size={11} /> {docProgress.rejected} rejected
              </div>
            ) : null}
            <div style={{ color: 'var(--sos-text-muted)' }}>{docProgress.total} required</div>
          </div>
        </GlassCard>
      ) : null}

      {/* Finance summary */}
      <GlassCard variant="panel" padded="md">
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Finance</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--sos-text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Wallet size={14} style={{ color: 'var(--sos-brand-accent)' }} />
          {fmtAmount(c.financeAmount, c.financeCurrency)}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)', marginTop: '4px' }}>
          Sent by {c.handoverOfficerName} · {fmtRelative(c.createdAt)}
        </div>
        {c.financeHandoverNote ? (
          <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: 'var(--sos-radius-sm)', background: 'var(--sos-status-info-soft)', border: '1px solid var(--sos-status-info-border)', fontSize: '12px', color: 'var(--sos-text-primary)' }}>
            {c.financeHandoverNote}
          </div>
        ) : null}
      </GlassCard>

      {/* Assigned officer */}
      <GlassCard variant="panel" padded="md">
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Assigned officer</div>
        {c.assignedOfficer ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--sos-brand-primary-soft)', border: '1px solid var(--sos-brand-primary-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--sos-brand-primary-strong)', flexShrink: 0 }}>
              {c.assignedOfficer.initials}
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{c.assignedOfficer.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--sos-text-muted)' }}>{c.assignedOfficer.role}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-status-warning)', fontWeight: 500 }}>
            <ShieldAlert size={14} /> Unassigned
          </div>
        )}
      </GlassCard>
    </aside>
  );
}

// ---------- Main workspace ------------------------------------------------

interface ProcessingCaseWorkspaceProps {
  caseId: string;
}

export function ProcessingCaseWorkspace({ caseId }: ProcessingCaseWorkspaceProps) {
  const c = getCaseById(caseId);
  const { user } = useProcessingSession();
  const [activeTab, setActiveTab] = useState<TabKey>('documents');
  const [showStageModal, setShowStageModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const isManager = user.permissions.includes('processing.case.view_all');
  const canAssign = user.permissions.includes('processing.case.assign');

  if (!c) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--sos-text-muted)' }}>
          Case not found.{' '}
          <Link href={'/processing/cases' as Route} style={{ color: 'var(--sos-brand-primary-strong)' }}>
            Back to cases
          </Link>
        </div>
      </GlassCard>
    );
  }

  return (
    <>
      {showStageModal ? (
        <StageChangeModal caseRecord={c} onClose={() => setShowStageModal(false)} />
      ) : null}
      {showAssignModal ? (
        <ProcessingAssignmentModal
          caseRecord={c}
          currentUserPermissions={user.permissions}
          onClose={() => setShowAssignModal(false)}
        />
      ) : null}
      {showCorrectionModal ? (
        <CorrectionRequestModal
          caseRecord={c}
          onClose={() => setShowCorrectionModal(false)}
        />
      ) : null}
      {showCancelModal ? (
        <CancelCaseModal
          caseRecord={c}
          onClose={() => setShowCancelModal(false)}
        />
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--sos-text-muted)' }}>
          <Link href={'/processing' as Route} style={{ color: 'var(--sos-text-muted)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ArrowLeft size={13} /> Processing
          </Link>
          <ChevronRight size={13} />
          <Link href={'/processing/cases' as Route} style={{ color: 'var(--sos-text-muted)', textDecoration: 'none' }}>
            Cases
          </Link>
          <ChevronRight size={13} />
          <span style={{ color: 'var(--sos-text-primary)', fontWeight: 500 }}>{c.clientName}</span>
        </div>

        {/* Title bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>{c.clientName}</div>
            <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginTop: '3px' }}>
              {c.service} · {c.targetCountry} · Case #{c.id}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {canAssign ? (
              <SecondaryButton iconLeft={<User size={14} />} onClick={() => setShowAssignModal(true)}>Reassign</SecondaryButton>
            ) : null}
            <SecondaryButton iconLeft={<ClipboardEdit size={14} />} onClick={() => setShowCorrectionModal(true)}>Request correction</SecondaryButton>
            {isManager && c.stage !== 'CANCELLED' && c.stage !== 'COMPLETED' ? (
              <button
                type="button"
                onClick={() => setShowCancelModal(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-status-danger-border)', background: 'var(--sos-status-danger-soft)', color: 'var(--sos-status-danger)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 150ms' }}
              >
                <XCircle size={13} /> Cancel case
              </button>
            ) : null}
            <PrimaryButton iconLeft={<Layers size={14} />} onClick={() => setShowStageModal(true)}>Change stage</PrimaryButton>
          </div>
        </div>

        {/* Layout: sidebar + main — responsive via sos-workspace-split CSS class */}
        <div className="sos-workspace-split" style={{ gap: '16px', alignItems: 'flex-start' }}>
          <CaseMetaSidebar c={c} />

          {/* Tab panel */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0' }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', gap: '2px', padding: '4px', background: 'var(--sos-surface-2)', borderRadius: 'var(--sos-radius-md)', marginBottom: '12px', overflowX: 'auto' }}>
              {TABS.map((tab) => {
                const Icon = tab.Icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '7px 14px',
                      borderRadius: 'calc(var(--sos-radius-md) - 2px)',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-muted)',
                      background: isActive ? 'var(--sos-brand-primary-soft)' : 'transparent',
                      transition: 'all 150ms',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Icon size={13} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            {activeTab === 'documents' && <DocumentChecklistTab c={c} />}
            {activeTab === 'timeline' && <CaseTimelineTab c={c} />}
            {activeTab === 'communications' && <CommunicationsTab c={c} />}
            {activeTab === 'notes' && <InternalNotesTab c={c} />}
            {activeTab === 'tasks' && <TasksTab c={c} />}
            {activeTab === 'corrections' && <CorrectionsTab c={c} />}
            {activeTab === 'submissions' && <SubmissionsTab c={c} />}
          </div>
        </div>
      </div>
    </>
  );
}
