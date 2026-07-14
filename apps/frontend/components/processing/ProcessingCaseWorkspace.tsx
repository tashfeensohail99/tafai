'use client';
// Case Workspace — Phase 1B / Screen 3.
// Full case view with left metadata rail and tabbed panel.
// Tabs: Documents · Timeline · Communications · Notes · Tasks · Submissions

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useSearchParams } from 'next/navigation';
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
  Headphones,
  History,
  Layers,
  Loader2,
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  User,
  Wallet,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Compass,
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
import { STAGE_NEXT_STEP, STAGE_WAITING_ON_EXTERNAL } from '@/components/processing/stage-guidance';
import {
  fetchProcessingCase,
  fetchCaseFinance,
  fetchCaseTabActivity,
  markCaseTabSeen,
  updateCaseSubStage,
  casePersonName,
  casePersonPhone,
  type ApiProcessingCaseDetail,
  type CaseFinanceSummary,
} from '@/lib/processing';
import { subStagesForService } from '@/lib/processing-substages';
import { labelForServiceCode } from '@/lib/service-types';
import { stageTone, priorityTone } from './ProcessingDashboardPage';
import { DocumentChecklistTab } from './tabs/DocumentChecklistTab';
import { CaseTimelineTab } from './tabs/CaseTimelineTab';
import { CaseHistoryTab } from './tabs/CaseHistoryTab';
import { CommunicationsTab } from './tabs/CommunicationsTab';
import { CaseWhatsAppTab } from './tabs/CaseWhatsAppTab';
import { InternalNotesTab } from './tabs/InternalNotesTab';
import { TasksTab } from './tabs/TasksTab';
import { SubmissionsTab } from './tabs/SubmissionsTab';
import { FinanceTab } from './tabs/FinanceTab';
import { StageChangeModal } from './StageChangeModal';
import { ProcessingAssignmentModal } from './ProcessingAssignmentModal';
import { CorrectionRequestModal } from './CorrectionRequestModal';
import { CancelCaseModal } from './CancelCaseModal';
import { CorrectionsTab } from './tabs/CorrectionsTab';
import { MilestonesTab } from './tabs/MilestonesTab';
import { SubmissionPackagePanel } from './SubmissionPackagePanel';
import { useProcessingSession } from '@/components/layout/ProcessingShell';

// ---------- Tabs -----------------------------------------------------------

type TabKey = 'milestones' | 'documents' | 'timeline' | 'history' | 'communications' | 'finance' | 'whatsapp' | 'notes' | 'tasks' | 'submissions' | 'corrections';

const TABS: Array<{ key: TabKey; label: string; Icon: React.ElementType }> = [
  // Milestones first — the case-progress narrative the associate works
  // through. Seeded per case-type at acknowledge time.
  { key: 'milestones', label: 'Milestones', Icon: Sparkles },
  { key: 'documents', label: 'Documents', Icon: FileSearch },
  { key: 'timeline', label: 'Timeline', Icon: History },
  { key: 'history', label: 'History', Icon: Headphones },
  { key: 'communications', label: 'Comms', Icon: MessageSquare },
  { key: 'finance', label: 'Finance', Icon: Wallet },
  { key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
  { key: 'notes', label: 'Notes', Icon: StickyNote },
  { key: 'tasks', label: 'Tasks', Icon: ClipboardList },
  { key: 'corrections', label: 'Corrections', Icon: AlertCircle },
  { key: 'submissions', label: 'Submissions', Icon: Send },
];

// ---------- Left metadata rail --------------------------------------------

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      {children}
    </div>
  );
}

function MetaDivider() {
  return <span aria-hidden="true" style={{ width: 1, alignSelf: 'stretch', minHeight: 30, background: 'var(--sos-border-subtle)' }} />;
}

// Compact horizontal meta bar — replaces the tall vertical rail. The client
// name + assignee now live in the page header, so this keeps just the
// at-a-glance state (stage, priority, time-in-stage) plus a clickable finance
// KPI that opens the Finance tab. Wraps gracefully on narrow widths.
/**
 * Editable sub-stage label (feedback F3) — a compact per-service picklist that
 * sits beside the Stage badge. Purely a tracking label; it does not change the
 * case stage. Clearing (the "—" option) sends null.
 */
function SubStagePicker({
  caseId,
  service,
  value,
  onChanged,
}: {
  caseId: string;
  service: string;
  value: string | null | undefined;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const options = subStagesForService(service);

  async function handle(next: string) {
    setSaving(true);
    try {
      await updateCaseSubStage(caseId, { subStage: next || null });
      onChanged();
    } catch {
      // Non-fatal — the parent refetch restores the true value on next load.
    } finally {
      setSaving(false);
    }
  }

  return (
    <MetaItem label="Sub-stage">
      <select
        value={value ?? ''}
        disabled={saving}
        onChange={(e) => handle(e.target.value)}
        aria-label="Sub-stage"
        style={{
          padding: '3px 8px',
          borderRadius: 'var(--sos-radius-sm)',
          border: '1px solid var(--sos-border-default)',
          background: 'var(--sos-bg-surface)',
          color: 'var(--sos-text-primary)',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: saving ? 'wait' : 'pointer',
          outline: 'none',
          maxWidth: 200,
        }}
      >
        <option value="">— none —</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </MetaItem>
  );
}

function CaseMetaBar({
  c,
  service,
  onSubStageChanged,
  finance,
  financeLoading,
  onOpenFinance,
}: {
  c: MockProcessingCase;
  service: string;
  onSubStageChanged: () => void;
  finance: CaseFinanceSummary | null;
  financeLoading: boolean;
  onOpenFinance: () => void;
}) {
  const overdue = c.daysInCurrentStage >= 5;
  const round0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <MetaItem label="Stage">
          <StatusBadge tone={stageTone(c.stage)} size="sm">{STAGE_LABEL[c.stage]}</StatusBadge>
        </MetaItem>
        <MetaDivider />
        <SubStagePicker caseId={c.id} service={service} value={c.subStage} onChanged={onSubStageChanged} />
        <MetaDivider />
        <MetaItem label="Priority">
          <StatusBadge tone={priorityTone(c.priority)} size="sm" dot={false}>{PRIORITY_LABEL[c.priority]}</StatusBadge>
        </MetaItem>
        <MetaDivider />
        <MetaItem label="Time in stage">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: overdue ? 'var(--sos-status-warning)' : 'var(--sos-text-primary)' }}>
            {overdue ? <AlertTriangle size={13} /> : <CalendarClock size={13} />}
            {c.daysInCurrentStage}d
          </span>
        </MetaItem>
        <MetaDivider />
        <button
          type="button"
          onClick={onOpenFinance}
          title="Open the Finance tab"
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <MetaItem label="Finance">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
              <Wallet size={13} style={{ color: 'var(--sos-brand-accent)' }} />
              {financeLoading
                ? '…'
                : finance && finance.totalAgreed > 0
                  ? `${round0(finance.totalPaid)} / ${round0(finance.totalAgreed)} ${finance.currency}`
                  : 'No finance'}
              {finance && finance.balance > 0 ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-status-warning)' }}>· {round0(finance.balance)} due</span>
              ) : null}
            </span>
          </MetaItem>
        </button>
      </div>
    </GlassCard>
  );
}

// ---------- Next-step guidance banner -------------------------------------
// Stage-driven "what to do now" so the next action is never a guess. Hidden
// for terminal stages (Completed / Cancelled). Adds a gentle overdue nudge
// when an officer-actionable case has sat in the same stage too long (not for
// stages where we're legitimately waiting on the authority).
function NextStepBanner({ c }: { c: MockProcessingCase }) {
  const next = STAGE_NEXT_STEP[c.stage];
  if (!next) return null;
  const overdue = !STAGE_WAITING_ON_EXTERNAL.has(c.stage) && c.daysInCurrentStage >= 5;
  const accent = overdue ? 'var(--sos-status-warning)' : 'var(--sos-brand-primary-strong)';
  const accentSoft = overdue ? 'var(--sos-status-warning-soft)' : 'var(--sos-brand-primary-soft)';
  return (
    <GlassCard variant="panel" padded="md" style={{ borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <div style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, background: accentSoft, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {overdue ? <AlertTriangle size={16} /> : <Compass size={16} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--sos-text-muted)', marginBottom: 3 }}>
            Next step
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--sos-text-primary)', lineHeight: 1.5 }}>{next}</div>
          {overdue ? (
            <div style={{ fontSize: 12, color: 'var(--sos-status-warning)', marginTop: 5, fontWeight: 600 }}>
              In “{STAGE_LABEL[c.stage]}” for {c.daysInCurrentStage} days — consider moving it forward.
            </div>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}

// ---------- Main workspace ------------------------------------------------

interface ProcessingCaseWorkspaceProps {
  caseId: string;
}

export function ProcessingCaseWorkspace({ caseId }: ProcessingCaseWorkspaceProps) {
  const { user } = useProcessingSession();
  const [api, setApi] = useState<ApiProcessingCaseDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Deep-link support: /processing/cases/:id?tab=whatsapp opens straight onto
  // that tab (used by the cases-roster quick actions). Falls back to milestones.
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const t = searchParams.get('tab');
    return t && TABS.some((tab) => tab.key === t) ? (t as TabKey) : 'milestones';
  });
  const [showStageModal, setShowStageModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showJunkModal, setShowJunkModal] = useState(false);
  const isManager = user.permissions.includes('processing.case.view_all');
  const canAssign = user.permissions.includes('processing.case.assign');

  // Refetch trigger — bumped by child modals (reassignment, stage change)
  // after a successful mutation so the workspace shows the new state
  // without a hard reload.
  const [refetchTick, setRefetchTick] = useState(0);

  // Finance summary — powers the Finance tab + the header meta KPI. Refetched
  // alongside the case so new payments show without a hard reload.
  const [finance, setFinance] = useState<CaseFinanceSummary | null>(null);
  const [financeLoading, setFinanceLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchProcessingCase(caseId)
      .then((r) => { if (!cancelled) setApi(r); })
      .catch((e: unknown) => { if (!cancelled) setLoadErr(e instanceof Error ? e.message : 'Failed to load case'); });
    return () => { cancelled = true; };
  }, [caseId, refetchTick]);

  useEffect(() => {
    let cancelled = false;
    setFinanceLoading(true);
    fetchCaseFinance(caseId)
      .then((r) => { if (!cancelled) setFinance(r); })
      .catch(() => { if (!cancelled) setFinance(null); })
      .finally(() => { if (!cancelled) setFinanceLoading(false); });
    return () => { cancelled = true; };
  }, [caseId, refetchTick]);

  // --- Tab "new items" badges -----------------------------------------------
  // Per-user unseen counts per tab (notes / documents / corrections / whatsapp
  // / comms / tasks). Opening a tab marks it seen so its badge clears. The
  // active tab never shows a badge (you're already looking at it).
  const [tabActivity, setTabActivity] = useState<Record<string, number>>({});
  const activeTabRef = useRef<TabKey>(activeTab);
  activeTabRef.current = activeTab;

  const loadActivity = useCallback(() => {
    fetchCaseTabActivity(caseId)
      .then((a) => setTabActivity(a as unknown as Record<string, number>))
      .catch(() => { /* non-fatal — badges just keep their last values */ });
  }, [caseId]);

  const markSeen = useCallback((tab: TabKey) => {
    setTabActivity((prev) => ({ ...prev, [tab]: 0 })); // optimistic clear
    markCaseTabSeen(caseId, tab).catch(() => { /* non-fatal */ });
  }, [caseId]);

  const switchTab = useCallback((next: TabKey) => {
    markSeen(activeTabRef.current); // finished viewing the current tab
    setActiveTab(next);
    markSeen(next);                 // now viewing the next tab
  }, [markSeen]);

  // Pull counts on load + whenever the case is refetched.
  useEffect(() => { loadActivity(); }, [loadActivity, refetchTick]);

  // Mark the initially-open tab (deep-link or default) seen, once per case.
  useEffect(() => { markSeen(activeTabRef.current); }, [caseId, markSeen]);

  // Keep counts live while the workspace is open: refresh on a slow poll + on
  // window focus, and re-mark the active tab seen each tick so its badge never
  // accrues while it's the tab you're looking at.
  useEffect(() => {
    const tick = () => {
      loadActivity();
      markCaseTabSeen(caseId, activeTabRef.current).catch(() => { /* non-fatal */ });
    };
    window.addEventListener('focus', tick);
    const id = window.setInterval(tick, 60000);
    return () => { window.removeEventListener('focus', tick); window.clearInterval(id); };
  }, [caseId, loadActivity]);

  if (loadErr) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--sos-text-muted)' }}>
          {loadErr}.{' '}
          <Link href={'/processing/cases' as Route} style={{ color: 'var(--sos-brand-primary-strong)' }}>
            Back to cases
          </Link>
        </div>
      </GlassCard>
    );
  }
  if (!api) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: 10, color: 'var(--sos-text-muted)' }}>
        <Loader2 size={18} className="sos-spin" />
        <span>Loading case…</span>
      </div>
    );
  }

  // Adapter: convert API case to the MockProcessingCase shape the existing
  // tab components (DocumentChecklistTab, CommunicationsTab, etc.) still
  // depend on. Header / sidebar fields are real; tab-specific arrays start
  // empty until each tab is wired to its own backend endpoint in the next
  // pass. InternalNotesTab + TasksTab read directly from the API client and
  // ignore these empty arrays.
  const c: MockProcessingCase = {
    id: api.id,
    service: api.service,
    targetCountry: api.targetCountry,
    stage: api.stage as MockProcessingCase['stage'],
    subStage: api.subStage,
    priority: api.priority as MockProcessingCase['priority'],
    clientName: casePersonName(api),
    clientPhone: casePersonPhone(api),
    assignedOfficer: api.assignedOfficer
      ? {
          id: api.assignedOfficer.id,
          name: api.assignedOfficer.email.split('@')[0] ?? api.assignedOfficer.email,
          email: api.assignedOfficer.email,
          initials: (api.assignedOfficer.email.slice(0, 2) ?? 'U').toUpperCase(),
          role: 'Processing Officer',
        }
      : null,
    salesRep: api.lead?.assignedEmployee
      ? { name: `${api.lead.assignedEmployee.firstName} ${api.lead.assignedEmployee.lastName}`.trim() }
      : null,
    financeAmount: api.financeHandover ? Number(api.financeHandover.submittedAmount) : 0,
    financeCurrency: api.financeHandover?.currency ?? 'CAD',
    financeHandoverNote: api.financeHandoverNote,
    handoverOfficerName: 'Finance team',
    createdAt: api.createdAt,
    documentItems: [],   // wired separately per-tab in the next pass
    communications: [],
    notes: [],
    tasks: [],
    timeline: api.stageHistory.map((h) => ({
      id: h.id,
      createdAt: h.createdAt,
      eventType: 'STAGE_CHANGED',
      actorName: 'System',
      description: `Stage moved to ${h.toStage}${h.reason ? ` — ${h.reason}` : ''}`,
    })),
    submissions: [],
    daysInCurrentStage: Math.max(0, Math.floor((Date.now() - new Date(api.updatedAt).getTime()) / 86400000)),
  };

  return (
    <>
      {showStageModal ? (
        <StageChangeModal
          caseRecord={c}
          onClose={() => setShowStageModal(false)}
          onChanged={() => setRefetchTick((n) => n + 1)}
        />
      ) : null}
      {showAssignModal ? (
        <ProcessingAssignmentModal
          caseRecord={c}
          currentUserPermissions={user.permissions}
          onClose={() => setShowAssignModal(false)}
          onAssigned={() => setRefetchTick((n) => n + 1)}
        />
      ) : null}
      {showCorrectionModal ? (
        <CorrectionRequestModal
          caseRecord={c}
          onClose={() => setShowCorrectionModal(false)}
          onCreated={() => setRefetchTick((n) => n + 1)}
        />
      ) : null}
      {showCancelModal ? (
        <CancelCaseModal
          caseRecord={c}
          onClose={() => setShowCancelModal(false)}
          onCancelled={() => setRefetchTick((n) => n + 1)}
        />
      ) : null}
      {showJunkModal ? (
        <CancelCaseModal
          mode="junk"
          caseRecord={c}
          onClose={() => setShowJunkModal(false)}
          onCancelled={() => setRefetchTick((n) => n + 1)}
        />
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Back to My Cases */}
        <div>
          <Link
            href={'/processing/cases' as Route}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-muted)', textDecoration: 'none' }}
          >
            <ArrowLeft size={14} /> Back to My Cases
          </Link>
        </div>

        {/* Title bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>{c.clientName}</div>
            <div style={{ fontSize: '13px', color: 'var(--sos-text-muted)', marginTop: '3px' }}>
              {c.service} · {c.targetCountry} · Case #{c.id}
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <User size={12} />
              {c.assignedOfficer ? `${c.assignedOfficer.name} · ${c.assignedOfficer.role}` : 'Unassigned'}
              {c.salesRep ? (
                <span style={{ color: 'var(--sos-text-faint)' }}>· Sales: {c.salesRep.name}</span>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {canAssign ? (
              <SecondaryButton iconLeft={<User size={14} />} onClick={() => setShowAssignModal(true)}>
                {c.assignedOfficer ? 'Reassign' : 'Assign'}
              </SecondaryButton>
            ) : null}
            <SecondaryButton iconLeft={<ClipboardEdit size={14} />} onClick={() => setShowCorrectionModal(true)}>Request correction</SecondaryButton>
            {isManager && c.stage !== 'CANCELLED' && c.stage !== 'COMPLETED' && c.stage !== 'JUNK' ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowJunkModal(true)}
                  title="Mark this case as junk (spam / duplicate / dead lead)"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-default)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-secondary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 150ms' }}
                >
                  <Trash2 size={13} /> Mark as junk
                </button>
                <button
                  type="button"
                  onClick={() => setShowCancelModal(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-status-danger-border)', background: 'var(--sos-status-danger-soft)', color: 'var(--sos-status-danger)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 150ms' }}
                >
                  <XCircle size={13} /> Cancel case
                </button>
              </>
            ) : null}
            <PrimaryButton iconLeft={<Layers size={14} />} onClick={() => setShowStageModal(true)}>Change stage</PrimaryButton>
          </div>
        </div>

        {/* Compact horizontal meta bar (replaces the tall vertical rail) */}
        <CaseMetaBar c={c} service={api.service} onSubStageChanged={() => setRefetchTick((n) => n + 1)} finance={finance} financeLoading={financeLoading} onOpenFinance={() => setActiveTab('finance')} />

        {/* Stage-driven "what to do now" guidance for the officer */}
        <NextStepBanner c={c} />

        {/* Full-width tab panel */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: '2px', padding: '4px', background: 'var(--sos-surface-2)', borderRadius: 'var(--sos-radius-md)', marginBottom: '12px', overflowX: 'auto' }}>
            {TABS.map((tab) => {
              const Icon = tab.Icon;
              const isActive = activeTab === tab.key;
              // The active tab is always "seen", so it never shows a badge.
              const newCount = isActive ? 0 : (tabActivity[tab.key] ?? 0);
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => switchTab(tab.key)}
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
                  {newCount > 0 ? (
                    <span
                      aria-label={`${newCount} new`}
                      title={`${newCount} new since you last looked`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '16px',
                        height: '16px',
                        padding: '0 5px',
                        marginLeft: '1px',
                        borderRadius: '8px',
                        fontSize: '10px',
                        fontWeight: 700,
                        lineHeight: 1,
                        color: '#fff',
                        background: 'var(--sos-status-danger)',
                      }}
                    >
                      {newCount > 99 ? '99+' : newCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          {activeTab === 'milestones' && <MilestonesTab c={c} />}
          {activeTab === 'documents' && <DocumentChecklistTab c={c} />}
          {activeTab === 'timeline' && <CaseTimelineTab c={c} />}
          {activeTab === 'history' && <CaseHistoryTab c={c} />}
          {activeTab === 'communications' && <CommunicationsTab c={c} />}
          {activeTab === 'finance' && <FinanceTab finance={finance} loading={financeLoading} />}
          {activeTab === 'whatsapp' && <CaseWhatsAppTab c={c} />}
          {activeTab === 'notes' && <InternalNotesTab c={c} />}
          {activeTab === 'tasks' && <TasksTab c={c} />}
          {activeTab === 'corrections' && <CorrectionsTab c={c} />}
          {activeTab === 'submissions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <SubmissionPackagePanel caseId={c.id} caseStage={c.stage} />
              <SubmissionsTab c={c} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
