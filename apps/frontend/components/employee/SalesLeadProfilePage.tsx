'use client';
// Sales OS — Lead profile (premium dark glass redesign).
//
// Designed around what the sales team actually needs on a single client screen:
//   1. Identity strip — who, where, how to reach them, what stage, how hot.
//   2. Pipeline progress — visual stage tracker that doubles as an editor.
//   3. Quick actions — call / WhatsApp / email + stage shortcuts in one click.
//   4. Workspace tabs — Overview, Activity, Follow-ups, Appointments, Notes & docs.
//   5. Live SLA / countdown so you always know what is bleeding.
//   6. Sticky save bar so edits never get lost.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock4,
  Copy,
  ExternalLink,
  FileText,
  Flame,
  Globe2,
  History,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Paperclip,
  Phone,
  PhoneOff,
  Save,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  StickyNote,
  Tag,
  Timer,
  Upload,
  UserCog,
  Wallet,
  X,
} from 'lucide-react';
import {
  type Lead,
  type Appointment,
  type FollowUp,
  type LeadStage,
  type Priority,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  STAGE_LABEL,
  fmtDateTime,
  fmtRelative,
  fmtRelativeToNow,
  fmtTimeOnly,
  initialsOf,
  stageDotColor,
} from '@/components/sales-v2/mockData';
import {
  ActionBar,
  ButtonLink,
  Field,
  FormInput,
  FormTextarea,
  GhostButton,
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  SuccessButton,
  Timeline,
  TimelineStep,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { WhatsAppLeadTab } from '@/components/whatsapp/WhatsAppLeadTab';
import { EditLeadModal } from '@/components/whatsapp/EditLeadModal';
import {
  fetchLead,
  fetchFollowUps,
  fetchAppointments,
  fetchLeadActivityTimeline,
  fetchLeadFinanceHandovers,
  patchLead,
  sendLeadEmailVerification,
  fetchLeadFiles,
  uploadLeadFile,
  getLeadFileUrl,
  deleteLeadFile,
  type ActivityTimelineEntry,
  type ApiLeadFile,
  type ApiLeadFinanceHandover,
} from '@/lib/sales-api';
import { LeadAgreementsTab } from '@/components/finance/LeadAgreementsTab';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';

const STAGES: LeadStage[] = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'NO_RESPONSE',
  'MEETING_NEEDED',
  'APPOINTMENT_BOOKED',
  'PAYMENT_INTERESTED',
  'RECEIPT_UPLOADED',
  'SENT_TO_FINANCE',
];

const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH'];

const STAGE_PROGRESS: LeadStage[] = [
  'NEW',
  'CONTACTED',
  'APPOINTMENT_BOOKED',
  'PAYMENT_INTERESTED',
  'SENT_TO_FINANCE',
];

type TabKey = 'OVERVIEW' | 'ACTIVITY' | 'FOLLOWUPS' | 'APPOINTMENTS' | 'NOTES' | 'WHATSAPP' | 'VERIFICATION' | 'AGREEMENT' | 'FINANCE';

const TAB_KEYS: readonly TabKey[] = [
  'OVERVIEW', 'ACTIVITY', 'FOLLOWUPS', 'APPOINTMENTS', 'NOTES', 'WHATSAPP', 'VERIFICATION', 'AGREEMENT', 'FINANCE',
] as const;

function parseTabFromUrl(value: string | null): TabKey {
  if (!value) return 'OVERVIEW';
  const upper = value.toUpperCase() as TabKey;
  return TAB_KEYS.includes(upper) ? upper : 'OVERVIEW';
}

const TABS: Array<{ key: TabKey; label: string; Icon: typeof Activity }> = [
  { key: 'OVERVIEW', label: 'Overview', Icon: ClipboardList },
  { key: 'WHATSAPP', label: 'WhatsApp', Icon: MessageSquare },
  { key: 'ACTIVITY', label: 'Activity', Icon: History },
  { key: 'FOLLOWUPS', label: 'Follow-ups', Icon: Phone },
  { key: 'APPOINTMENTS', label: 'Appointments', Icon: CalendarClock },
  { key: 'AGREEMENT', label: 'Agreement', Icon: FileText },
  { key: 'FINANCE', label: 'Finance', Icon: Wallet },
  { key: 'NOTES', label: 'Notes & docs', Icon: StickyNote },
  { key: 'VERIFICATION', label: 'Email verify', Icon: ShieldCheck },
];

function priorityTone(p: Priority): BadgeTone {
  return p === 'HIGH' ? 'danger' : p === 'MEDIUM' ? 'warning' : 'neutral';
}

function stageBadgeTone(stage: LeadStage): BadgeTone {
  switch (stage) {
    case 'NEW':
    case 'ASSIGNED':
      return 'info';
    case 'CONTACTED':
      return 'cyan';
    case 'NO_RESPONSE':
      return 'danger';
    case 'MEETING_NEEDED':
      return 'warm';
    case 'APPOINTMENT_BOOKED':
      return 'violet';
    case 'PAYMENT_INTERESTED':
    case 'RECEIPT_UPLOADED':
      return 'warning';
    case 'SENT_TO_FINANCE':
      return 'success';
    default:
      return 'neutral';
  }
}

export function SalesLeadProfilePage({ leadId }: { leadId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [lead, setLead] = useState<Lead | null>(null);
  const [leadFollowUps, setLeadFollowUps] = useState<FollowUp[]>([]);
  const [leadAppointments, setLeadAppointments] = useState<Appointment[]>([]);
  const [loadingLead, setLoadingLead] = useState(true);
  const [saving, setSaving] = useState(false);

  const [stage, setStage] = useState<LeadStage>('NEW');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [nextAction, setNextAction] = useState('');
  const [salesNote, setSalesNote] = useState('');

  // Tabs are driven by the URL (`?tab=finance`) so refresh/back/forward and
  // shared links land on the right tab. Default to OVERVIEW when no param.
  const tab: TabKey = parseTabFromUrl(searchParams.get('tab'));
  const setTab = (next: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'OVERVIEW') {
      params.delete('tab');
    } else {
      params.set('tab', next.toLowerCase());
    }
    const qs = params.toString();
    // Cast through `as never` because Next.js typed routes can't statically
    // verify a dynamic URL built from runtime params + search string.
    router.replace((qs ? `${pathname}?${qs}` : pathname) as never, { scroll: false });
  };
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pinned, setPinned] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [financeHandovers, setFinanceHandovers] = useState<ApiLeadFinanceHandover[]>([]);
  const [financeLoading, setFinanceLoading] = useState(true);

  // Load lead + related data
  useEffect(() => {
    setLoadingLead(true);
    fetchLead(leadId).then((data) => {
      if (data) {
        setLead(data);
        setStage(data.stage);
        setPriority(data.priority);
        setNextAction(data.nextAction);
        setSalesNote(data.salesNote ?? '');
      }
      setLoadingLead(false);
    });
    fetchFollowUps(leadId).then(setLeadFollowUps).catch(() => {});
    fetchAppointments(leadId).then(setLeadAppointments).catch(() => {});
    setFinanceLoading(true);
    fetchLeadFinanceHandovers(leadId)
      .then(setFinanceHandovers)
      .catch(() => setFinanceHandovers([]))
      .finally(() => setFinanceLoading(false));
  }, [leadId]);

  if (loadingLead) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: '10px', color: 'var(--sos-text-muted)' }}>
        <Loader2 size={20} className="sos-spin" />
        <span>Loading lead…</span>
      </div>
    );
  }

  if (!lead) {
    return (
      <GlassCard variant="strong" padded="lg">
        <div style={{ textAlign: 'center', padding: '36px 16px' }}>
          <h3 className="sos-title" style={{ fontSize: '17px' }}>
            Lead not found
          </h3>
          <p className="sos-text-muted" style={{ marginTop: '6px', fontSize: '13.5px' }}>
            Check the URL or jump back to the queue.
          </p>
          <div style={{ marginTop: '16px' }}>
            <ButtonLink
              href={'/sales/leads' as Route}
              variant="secondary"
              iconLeft={<ArrowLeft size={15} />}
            >
              Back to Assigned Leads
            </ButtonLink>
          </div>
        </div>
      </GlassCard>
    );
  }

  const dirty =
    stage !== lead.stage ||
    priority !== lead.priority ||
    nextAction !== lead.nextAction ||
    (salesNote ?? '') !== (lead.salesNote ?? '');

  /**
   * Derive the "effective" pipeline stage from the lead's actual finance
   * activity, not just lead.status. Sales used to see "Contacted" on the
   * progress bar even after a payment had been sent to finance because
   * lead.status only flipped on full conversion. The handovers fetched
   * by the Finance tab are the truth — when one exists, the lead is at
   * least at "Sent to Finance" regardless of what status the column
   * still says. Backend now also bumps lead.status forward when a
   * handover is created (commit follows), but the frontend derivation
   * is the belt to that suspenders: even on stale data or a missed
   * write, the UI shows reality.
   */
  const derivedStage: LeadStage | null = (() => {
    if (financeHandovers.length === 0) return null;
    // Any verified or sent-to-processing handover → fully through the funnel.
    if (
      financeHandovers.some(
        (h) => h.status === 'PAYMENT_VERIFIED' || h.status === 'SENT_TO_PROCESSING',
      )
    ) {
      return 'SENT_TO_FINANCE';
    }
    // Any in-flight handover (submitted / in-review / payment recorded) →
    // also Sent to Finance. The bar shows "done" at this column; the
    // Finance tab tells the operator whether it's actually verified.
    if (
      financeHandovers.some(
        (h) => h.status === 'SUBMITTED' || h.status === 'IN_REVIEW' || h.status === 'PAYMENT_RECORDED',
      )
    ) {
      return 'SENT_TO_FINANCE';
    }
    // Only rejected/cancelled handovers exist — Sales tried to pay but
    // bounced back; the lead is still in the payment phase.
    return 'PAYMENT_INTERESTED';
  })();
  const effectiveStage: LeadStage = derivedStage ?? stage;
  const stageIdx = Math.max(0, STAGE_PROGRESS.indexOf(effectiveStage));
  const stagePct = Math.round(((stageIdx + 1) / STAGE_PROGRESS.length) * 100);

  const phoneClean = lead.phone.replace(/[^+\d]/g, '');

  async function handleSave() {
    setSaving(true);
    try {
      await patchLead(leadId, { stage, priority, notes: salesNote });
      setLead((prev) => prev ? { ...prev, stage, priority, nextAction, salesNote } : prev);
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setStage(lead.stage);
    setPriority(lead.priority);
    setNextAction(lead.nextAction);
    setSalesNote(lead.salesNote ?? '');
  }

  function applyQuickAction(next: LeadStage, nextActionText: string) {
    setStage(next);
    setNextAction(nextActionText);
  }

  async function copy(text: string, hint: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyHint(hint);
      setTimeout(() => setCopyHint(null), 1600);
    } catch {
      // ignore
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <GhostButton
          iconLeft={<ArrowLeft size={15} />}
          onClick={() => router.push('/sales/leads')}
        >
          Back to Assigned Leads
        </GhostButton>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {copyHint ? (
            <StatusBadge tone="success" size="sm">
              <Check size={11} /> {copyHint}
            </StatusBadge>
          ) : null}
          {/* "Finance returned this case" pill — shown across every tab so
              the agent can't miss a bounce-back. Clicking jumps to the
              Finance tab where the rejection reason + receipt + notes live. */}
          {financeHandovers[0]?.status === 'REJECTED' ? (
            <button
              type="button"
              onClick={() => setTab('FINANCE')}
              className="sos-banner sos-banner--danger"
              style={{
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 12.5,
                fontWeight: 700,
                border: 'none',
                borderRadius: 999,
              }}
            >
              <CircleAlert size={13} />
              Finance returned — open Finance tab
            </button>
          ) : null}
          <GhostButton
            iconLeft={<UserCog size={14} />}
            onClick={() => setEditOpen(true)}
          >
            Edit lead
          </GhostButton>
          <GhostButton
            iconLeft={<Star size={14} fill={pinned ? 'currentColor' : 'none'} />}
            onClick={() => setPinned((v) => !v)}
            style={pinned ? { color: 'var(--sos-brand-accent)' } : undefined}
          >
            {pinned ? 'Pinned' : 'Pin lead'}
          </GhostButton>
          <ButtonLink
            href={`/sales/follow-ups` as Route}
            variant="ghost"
            iconLeft={<ExternalLink size={14} />}
          >
            All follow-ups
          </ButtonLink>
          <SecondaryButton
            iconLeft={<FileText size={14} />}
            onClick={() => setTab('AGREEMENT')}
          >
            Create Agreement
          </SecondaryButton>
        </div>
      </div>

      <PageHeader
        eyebrow={`Lead profile · ${lead.referenceCode ?? lead.id}`}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {lead.firstName} {lead.lastName}
            {lead.csvBatch ? <CsvLeadBadge batchName={lead.csvBatch.name} /> : null}
          </span>
        }
        description={
          <>
            {labelForServiceCode(lead.service)} → {lead.targetCountry} ·{' '}
            {lead.assignmentType === 'ADMIN'
              ? `Admin · ${lead.assignedBy ?? 'Unassigned'}`
              : 'Auto CRM'}{' '}
            · Assigned {fmtRelative(lead.assignedAt)}
          </>
        }
        actions={
          <>
            <a
              href={`tel:${phoneClean}`}
              className="sos-btn sos-btn--primary"
              style={{ textDecoration: 'none' }}
            >
              <Phone size={15} /> Call now
            </a>
            <a
              href={`https://web.whatsapp.com/send?phone=${phoneClean.replace('+', '')}`}
              target="tashfeen-whatsapp"
              onClick={(e) => {
                // Reuse one WhatsApp tab instead of cold-loading a new one each click.
                e.preventDefault();
                const w = window.open(`https://web.whatsapp.com/send?phone=${phoneClean.replace('+', '')}`, 'tashfeen-whatsapp');
                if (w) w.focus();
              }}
              className="sos-btn sos-btn--secondary"
              style={{ textDecoration: 'none' }}
            >
              <MessageSquare size={15} /> WhatsApp
            </a>
            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="sos-btn sos-btn--ghost"
                style={{ textDecoration: 'none' }}
              >
                <Mail size={15} /> Email
              </a>
            ) : null}
          </>
        }
        meta={
          <IdentityStrip
            lead={lead}
            stage={effectiveStage}
            priority={priority}
            stageIdx={stageIdx}
            stagePct={stagePct}
            onCopy={copy}
          />
        }
      />

      <QuickActionRail
        applyQuickAction={applyQuickAction}
        currentStage={stage}
        leadId={leadId}
      />

      <Tabs tab={tab} setTab={setTab} counts={{
        OVERVIEW: 0,
        WHATSAPP: 0,
        ACTIVITY: 4,
        FOLLOWUPS: leadFollowUps.length,
        APPOINTMENTS: leadAppointments.length,
        NOTES: salesNote ? 1 : 0,
        VERIFICATION: lead.emailVerified ? 1 : 0,
        AGREEMENT: 0,
        FINANCE: financeHandovers.length,
      }} />

      {tab === 'OVERVIEW' ? (
        <OverviewTab
          lead={lead}
          stage={stage}
          setStage={setStage}
          priority={priority}
          setPriority={setPriority}
          nextAction={nextAction}
          setNextAction={setNextAction}
          salesNote={salesNote}
          setSalesNote={setSalesNote}
        />
      ) : null}

      {tab === 'ACTIVITY' ? (
        <ActivityTab leadId={lead.id} />
      ) : null}

      {tab === 'FOLLOWUPS' ? (
        <FollowUpsTab leadFollowUps={leadFollowUps} />
      ) : null}

      {tab === 'APPOINTMENTS' ? (
        <AppointmentsTab leadAppointments={leadAppointments} />
      ) : null}

      {tab === 'NOTES' ? (
        <NotesTab salesNote={salesNote} setSalesNote={setSalesNote} leadId={lead.id} />
      ) : null}

      {tab === 'WHATSAPP' ? (
        <WhatsAppLeadTab leadId={lead.id} leadPhone={lead.phone ?? null} />
      ) : null}

      {tab === 'VERIFICATION' ? (
        <VerificationTab lead={lead} onVerified={(verified) => setLead((prev) => prev ? { ...prev, emailVerified: verified } : prev)} />
      ) : null}

      {tab === 'AGREEMENT' ? (
        <LeadAgreementsTab leadId={lead.id} />
      ) : null}

      {tab === 'FINANCE' ? (
        <FinanceTab
          handovers={financeHandovers}
          loading={financeLoading}
          serviceFeeAmount={lead.serviceFeeAmount}
          serviceFeeCurrency={lead.serviceFeeCurrency}
        />
      ) : null}

      <ActionBar
        left={
          dirty ? (
            <span
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <Clock4 size={14} style={{ color: 'var(--sos-status-warning)' }} />
              <span style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>
                Unsaved changes
              </span>
              <span className="sos-text-faint" style={{ fontSize: '12px' }}>
                Edits stay local until you save.
              </span>
            </span>
          ) : savedAt ? (
            <span
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <CheckCircle2 size={14} style={{ color: 'var(--sos-status-success)' }} />
              <span style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>
                Saved {fmtRelativeToNow(savedAt.toISOString())}
              </span>
            </span>
          ) : (
            <span className="sos-text-muted" style={{ fontSize: '12.5px' }}>
              Update stage, priority, or notes — your changes save together.
            </span>
          )
        }
        right={
          <>
            <SecondaryButton
              onClick={handleReset}
              disabled={!dirty}
              iconLeft={<X size={15} />}
            >
              Discard
            </SecondaryButton>
            <PrimaryButton
              onClick={handleSave}
              disabled={!dirty || saving}
              iconLeft={saving ? <Loader2 size={15} className="sos-spin" /> : <Save size={15} />}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
          </>
        }
      />

      <EditLeadModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        lead={
          lead
            ? {
                id: lead.id,
                firstName: lead.firstName,
                lastName: lead.lastName,
                phone: lead.phone,
                email: lead.email,
                service: lead.service,
                targetCountry: lead.targetCountry,
                serviceFeeAmount: lead.serviceFeeAmount,
                serviceFeeCurrency: lead.serviceFeeCurrency,
              }
            : null
        }
        onSaved={() => {
          // Pull a fresh copy so identity changes flow through the rest
          // of the page (header title, identity strip, contact actions).
          void fetchLead(leadId).then((fresh) => {
            if (fresh) setLead(fresh);
          });
        }}
      />
    </div>
  );
}

function IdentityStrip({
  lead,
  stage,
  priority,
  stageIdx,
  stagePct,
  onCopy,
}: {
  lead: ReturnType<typeof getLead> & {};
  stage: LeadStage;
  priority: Priority;
  stageIdx: number;
  stagePct: number;
  onCopy: (text: string, hint: string) => void;
}) {
  if (!lead) return null;

  const slaTone: BadgeTone =
    lead.slaStatus === 'OVERDUE'
      ? 'danger'
      : lead.slaStatus === 'COMPLETED'
        ? 'success'
        : 'info';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div
        style={{
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div
          className="sos-avatar sos-avatar--xl"
          style={{
            background: `linear-gradient(135deg, ${stageDotColor(stage)}, var(--sos-brand-deep))`,
            boxShadow: 'var(--sos-shadow-glow)',
          }}
        >
          {initialsOf(lead.firstName, lead.lastName)}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <StatusBadge tone={stageBadgeTone(stage)}>{STAGE_LABEL[stage]}</StatusBadge>
            <StatusBadge tone={priorityTone(priority)}>
              {priority === 'HIGH' ? <Flame size={11} /> : null}
              {PRIORITY_LABEL[priority]} priority
            </StatusBadge>
            <StatusBadge tone="violet">{SOURCE_LABEL[lead.source]}</StatusBadge>
            <StatusBadge tone={slaTone}>
              <Timer size={11} />
              {lead.slaStatus === 'OVERDUE'
                ? 'SLA overdue'
                : lead.slaDueAt
                  ? `SLA due ${fmtRelative(lead.slaDueAt)}`
                  : 'SLA complete'}
            </StatusBadge>
            {lead.tags?.map((t) => (
              <StatusBadge key={t} tone="neutral" size="sm">
                <Tag size={10} /> {t}
              </StatusBadge>
            ))}
          </div>

          <div
            style={{
              marginTop: '14px',
              display: 'grid',
              gap: '10px',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <ContactItem
              Icon={Phone}
              label="Phone"
              value={lead.phone}
              onCopy={() => onCopy(lead.phone, 'Phone copied')}
            />
            {lead.email ? (
              <ContactItem
                Icon={Mail}
                label="Email"
                value={lead.email}
                onCopy={() => onCopy(lead.email!, 'Email copied')}
              />
            ) : null}
            <ContactItem
              Icon={Globe2}
              label="Target"
              value={lead.targetCountry}
            />
            <ContactItem Icon={Wallet} label="Service" value={labelForServiceCode(lead.service)} />
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '16px 18px',
          borderRadius: 'var(--sos-radius-sm)',
          background: 'var(--sos-surface-1)',
          border: '1px solid var(--sos-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div className="sos-eyebrow">Pipeline progress</div>
          <span
            className="sos-text-muted"
            style={{ fontSize: '12px', fontWeight: 600 }}
          >
            Step {stageIdx + 1} of {STAGE_PROGRESS.length} · {stagePct}%
          </span>
        </div>

        <div className="sos-progress" style={{ height: '6px' }}>
          <div className="sos-progress__fill" style={{ width: stagePct + '%' }} />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${STAGE_PROGRESS.length}, minmax(0, 1fr))`,
            gap: '8px',
          }}
        >
          {STAGE_PROGRESS.map((s, i) => {
            const isCurrent = i === stageIdx;
            const isDone = i < stageIdx;
            return (
              <div
                key={s}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  alignItems: 'flex-start',
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '999px',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '11px',
                    fontWeight: 700,
                    background: isDone
                      ? 'var(--sos-status-success)'
                      : isCurrent
                        ? 'var(--sos-brand-gradient)'
                        : 'var(--sos-surface-3)',
                    color:
                      isDone || isCurrent
                        ? 'var(--sos-text-on-accent)'
                        : 'var(--sos-text-faint)',
                    border:
                      isDone || isCurrent
                        ? '1px solid transparent'
                        : '1px solid var(--sos-border)',
                    boxShadow: isCurrent ? 'var(--sos-shadow-glow)' : 'none',
                  }}
                >
                  {isDone ? <Check size={12} /> : i + 1}
                </span>
                <span
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 600,
                    color: isCurrent
                      ? 'var(--sos-text-primary)'
                      : isDone
                        ? 'var(--sos-text-secondary)'
                        : 'var(--sos-text-faint)',
                    lineHeight: 1.3,
                  }}
                >
                  {STAGE_LABEL[s]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ContactItem({
  Icon,
  label,
  value,
  onCopy,
}: {
  Icon: typeof Phone;
  label: string;
  value: string;
  onCopy?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '9px',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--sos-brand-primary-soft)',
          color: 'var(--sos-brand-primary-strong)',
          border: '1px solid var(--sos-brand-primary-border)',
          flexShrink: 0,
        }}
      >
        <Icon size={13} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          className="sos-text-faint"
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: '12.5px',
            fontWeight: 600,
            color: 'var(--sos-text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {value}
        </div>
      </div>
      {onCopy ? (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--sos-text-faint)',
            display: 'inline-flex',
            padding: '4px',
            borderRadius: '6px',
          }}
        >
          <Copy size={13} />
        </button>
      ) : null}
    </div>
  );
}

function QuickActionRail({
  applyQuickAction,
  currentStage,
  leadId,
}: {
  applyQuickAction: (next: LeadStage, text: string) => void;
  currentStage: LeadStage;
  leadId: string;
}) {
  const actions: Array<{
    Icon: typeof Phone;
    title: string;
    caption: string;
    tone: string;
    onClick?: () => void;
    href?: string;
    disabled?: boolean;
  }> = [
    {
      Icon: Phone,
      title: 'Mark Contacted',
      caption: 'Stage → Contacted, SLA done',
      tone: 'var(--sos-status-cyan)',
      onClick: () => applyQuickAction('CONTACTED', 'Move to decision'),
      disabled: currentStage === 'CONTACTED',
    },
    {
      Icon: PhoneOff,
      title: 'No Response',
      caption: 'Retry in 24h, lead stays warm',
      tone: 'var(--sos-status-warning)',
      onClick: () => applyQuickAction('NO_RESPONSE', 'Retry in 24 hours'),
    },
    {
      Icon: CalendarPlus,
      title: 'Book Appointment',
      caption: 'Schedule a consultation',
      tone: 'var(--sos-status-violet)',
      href: '/sales/appointments',
    },
  ];

  return (
    <section
      style={{
        display: 'grid',
        gap: '14px',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      }}
    >
      {actions.map((a) => (
        <ActionTile key={a.title} {...a} />
      ))}
    </section>
  );
}

function ActionTile({
  Icon,
  title,
  caption,
  tone,
  onClick,
  href,
  disabled,
}: {
  Icon: typeof Phone;
  title: string;
  caption: string;
  tone: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const inner = (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '16px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
        height: '100%',
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 160ms ease',
      }}
      onMouseOver={(e) => {
        if (disabled) return;
        e.currentTarget.style.borderColor = 'var(--sos-border-strong)';
        e.currentTarget.style.background = 'var(--sos-surface-3)';
      }}
      onMouseOut={(e) => {
        if (disabled) return;
        e.currentTarget.style.borderColor = 'var(--sos-border-subtle)';
        e.currentTarget.style.background = 'var(--sos-surface-1)';
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '12px',
          display: 'grid',
          placeItems: 'center',
          background: 'color-mix(in srgb, ' + tone + ' 18%, transparent)',
          color: tone,
          border: '1px solid color-mix(in srgb, ' + tone + ' 28%, transparent)',
          flexShrink: 0,
        }}
      >
        <Icon size={18} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sos-text-primary)' }}
        >
          {title}
        </div>
        <div
          className="sos-text-muted"
          style={{ fontSize: '12px', marginTop: '4px', lineHeight: 1.5 }}
        >
          {caption}
        </div>
      </div>
      <ArrowRight
        size={16}
        style={{ color: 'var(--sos-text-faint)', alignSelf: 'center', flexShrink: 0 }}
      />
    </div>
  );

  if (href && !disabled) {
    return (
      <Link href={href as Route} style={{ textDecoration: 'none' }}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        all: 'unset',
        display: 'block',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {inner}
    </button>
  );
}

function Tabs({
  tab,
  setTab,
  counts,
}: {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  counts: Record<TabKey, number>;
}) {
  return (
    <div
      className="sos-no-scrollbar"
      style={{
        display: 'flex',
        gap: '6px',
        padding: '4px',
        background: 'var(--sos-bg-input)',
        border: '1px solid var(--sos-border)',
        borderRadius: 'var(--sos-radius-button)',
        overflowX: 'auto',
        alignSelf: 'flex-start',
        maxWidth: '100%',
      }}
    >
      {TABS.map((t) => {
        const Icon = t.Icon;
        const count = counts[t.key];
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className="sos-tab"
          >
            <Icon size={13} />
            {t.label}
            {count > 0 ? <span className="sos-tab__count">{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function OverviewTab({
  lead,
  stage,
  setStage,
  priority,
  setPriority,
  nextAction,
  setNextAction,
  salesNote,
  setSalesNote,
}: {
  lead: NonNullable<ReturnType<typeof getLead>>;
  stage: LeadStage;
  setStage: (s: LeadStage) => void;
  priority: Priority;
  setPriority: (p: Priority) => void;
  nextAction: string;
  setNextAction: (s: string) => void;
  salesNote: string;
  setSalesNote: (s: string) => void;
}) {
  return (
    <section
      style={{
        display: 'grid',
        gap: '20px',
        gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
      }}
      className="sos-detail-grid"
    >
      <GlassCard variant="strong" padded="lg">
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="sos-eyebrow">Lead progress</div>
            <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
              Update stage, priority, and the next move
            </h2>
          </div>
          <StatusBadge tone="accent" size="sm">
            <Sparkles size={11} /> Auto-syncs to queue
          </StatusBadge>
        </div>

        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Field label="Stage" required hint="Determines where this lead shows up in the queue.">
            <div
              style={{
                display: 'grid',
                gap: '8px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              }}
            >
              {STAGES.map((s) => (
                <StagePill
                  key={s}
                  active={s === stage}
                  onClick={() => setStage(s)}
                  stage={s}
                />
              ))}
            </div>
          </Field>

          <div
            style={{
              display: 'grid',
              gap: '20px',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            <Field label="Priority" required>
              <div
                className="sos-no-scrollbar"
                style={{
                  display: 'flex',
                  gap: '4px',
                  padding: '4px',
                  background: 'var(--sos-bg-input)',
                  border: '1px solid var(--sos-border)',
                  borderRadius: 'var(--sos-radius-button)',
                }}
              >
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    aria-pressed={priority === p}
                    className="sos-tab"
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    {p === 'HIGH' ? <Flame size={12} /> : null}
                    {PRIORITY_LABEL[p]}
                  </button>
                ))}
              </div>
            </Field>

            <FormInput
              label="Next action"
              required
              hint="A single, clear move. The next person reads this first."
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder="e.g. Confirm payment & upload receipt"
            />
          </div>

          <FormTextarea
            label="Sales note"
            hint="Visible to admin and finance during handover. Avoid putting raw payment details here."
            value={salesNote}
            onChange={(e) => setSalesNote(e.target.value)}
            placeholder="Capture context for the next person on the case…"
            style={{ minHeight: 140 }}
          />
        </div>
      </GlassCard>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <SnapshotCard lead={lead} />


        <GlassCard variant="soft" padded="md">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--sos-text-secondary)',
              fontSize: '12.5px',
              lineHeight: 1.55,
            }}
          >
            <Shield size={14} style={{ color: 'var(--sos-brand-primary-strong)', flexShrink: 0 }} />
            <span>
              <strong style={{ color: 'var(--sos-text-primary)' }}>Permissions:</strong> Sales
              can update stage, priority, next action, sales note, appointments, and receipt
              upload.
            </span>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}

function SnapshotCard({ lead }: { lead: NonNullable<ReturnType<typeof getLead>> }) {
  const slaTone: BadgeTone =
    lead.slaStatus === 'OVERDUE'
      ? 'danger'
      : lead.slaStatus === 'COMPLETED'
        ? 'success'
        : 'info';

  return (
    <GlassCard variant="default" padded="md">
      <div className="sos-eyebrow">Lead snapshot</div>
      <div
        style={{
          marginTop: '14px',
          display: 'grid',
          gap: '10px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}
      >
        <SnapshotRow label="Assigned" value={fmtRelative(lead.assignedAt)} />
        <SnapshotRow
          label="SLA"
          value={
            lead.slaStatus === 'OVERDUE'
              ? 'Overdue'
              : lead.slaDueAt
                ? `Due ${fmtRelative(lead.slaDueAt)}`
                : 'Completed'
          }
          tone={slaTone}
        />
        <SnapshotRow label="Source" value={SOURCE_LABEL[lead.source]} />
        <SnapshotRow label="Service" value={labelForServiceCode(lead.service)} />
        <SnapshotRow label="Country" value={lead.targetCountry} />
        <SnapshotRow
          label="Channel"
          value={lead.assignmentType === 'ADMIN' ? 'Admin assigned' : 'Auto CRM'}
        />
      </div>
    </GlassCard>
  );
}

function SnapshotRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: BadgeTone;
}) {
  const color =
    tone === 'success'
      ? 'var(--sos-status-success)'
      : tone === 'danger'
        ? 'var(--sos-status-danger)'
        : tone === 'warning'
          ? 'var(--sos-status-warning)'
          : tone === 'info'
            ? 'var(--sos-status-info)'
            : 'var(--sos-text-primary)';
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
        minWidth: 0,
      }}
    >
      <div
        className="sos-text-faint"
        style={{
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: '4px',
          fontSize: '13px',
          fontWeight: 600,
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StagePill({
  active,
  onClick,
  stage,
}: {
  active: boolean;
  onClick: () => void;
  stage: LeadStage;
}) {
  const dot = stageDotColor(stage);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 12px',
        borderRadius: 'var(--sos-radius-button)',
        border: active ? '1.5px solid ' + dot : '1px solid var(--sos-border)',
        background: active
          ? 'color-mix(in srgb, ' + dot + ' 12%, transparent)'
          : 'var(--sos-surface-1)',
        color: active ? 'var(--sos-text-primary)' : 'var(--sos-text-secondary)',
        fontSize: '12.5px',
        fontWeight: active ? 700 : 600,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 160ms ease',
        fontFamily: 'inherit',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '999px',
          background: dot,
          flexShrink: 0,
          boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${dot} 22%, transparent)` : 'none',
        }}
      />
      <span
        style={{
          flex: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {STAGE_LABEL[stage]}
      </span>
      {active ? <Check size={13} style={{ color: dot }} /> : null}
    </button>
  );
}

/**
 * Map a backend TimelineEventType to: an icon, a human title, and a tone.
 * Anything not listed falls through to a neutral catch-all so unknown
 * server-side events still render with the description and timestamp,
 * just without a dedicated icon/title.
 */
const TIMELINE_EVENT_META: Record<
  string,
  { Icon: typeof Activity; title: string; tone?: 'success' | 'danger' | 'info' | 'warning' }
> = {
  LEAD_CREATED:          { Icon: Sparkles,     title: 'Lead created' },
  LEAD_CONTACTED:        { Icon: Phone,        title: 'Lead contacted',  tone: 'info' },
  LEAD_QUALIFIED:        { Icon: ShieldCheck,  title: 'Lead qualified',  tone: 'success' },
  LEAD_ASSIGNED:         { Icon: Shield,       title: 'Lead assigned',   tone: 'info' },
  LEAD_CONVERTED:        { Icon: CheckCircle2, title: 'Lead converted',  tone: 'success' },
  LEAD_STATUS_CHANGED:   { Icon: Activity,     title: 'Status changed' },
  LEAD_UPDATED:          { Icon: ClipboardList,title: 'Lead updated' },
  LEAD_DELETED:          { Icon: X,            title: 'Lead deleted',    tone: 'danger' },
  LEAD_FILE_UPLOADED:    { Icon: Paperclip,    title: 'File uploaded' },
  LEAD_FILE_DELETED:     { Icon: X,            title: 'File deleted',    tone: 'danger' },
  FOLLOW_UP_CREATED:     { Icon: CalendarPlus, title: 'Follow-up created' },
  FOLLOW_UP_COMPLETED:   { Icon: Check,        title: 'Follow-up done',  tone: 'success' },
  FOLLOW_UP_RESCHEDULED: { Icon: CalendarClock,title: 'Follow-up rescheduled', tone: 'warning' },
  APPOINTMENT_SCHEDULED: { Icon: CalendarPlus, title: 'Appointment booked' },
  APPOINTMENT_COMPLETED: { Icon: CheckCircle2, title: 'Appointment completed', tone: 'success' },
  APPOINTMENT_CANCELLED: { Icon: X,            title: 'Appointment cancelled', tone: 'danger' },
  APPOINTMENT_RESCHEDULED:{Icon: CalendarClock,title: 'Appointment rescheduled', tone: 'warning' },
  APPOINTMENT_NO_SHOW:   { Icon: PhoneOff,     title: 'No-show',         tone: 'danger' },
  WHATSAPP_LEAD_CREATED: { Icon: MessageSquare,title: 'WhatsApp lead created', tone: 'info' },
  WHATSAPP_MESSAGE_RECEIVED: { Icon: MessageSquare, title: 'WhatsApp received', tone: 'info' },
  WHATSAPP_MESSAGE_SENT: { Icon: MessageSquare,title: 'WhatsApp sent',   tone: 'info' },
  WHATSAPP_ASSIGNED:     { Icon: Shield,       title: 'WhatsApp routed', tone: 'info' },
  WHATSAPP_CONVERSATION_RESOLVED: { Icon: Check, title: 'WhatsApp resolved', tone: 'success' },
  WHATSAPP_OPTED_OUT:    { Icon: PhoneOff,     title: 'Customer opted out', tone: 'danger' },
  EMAIL_RECEIVED:        { Icon: Mail,         title: 'Email received',  tone: 'info' },
  EMAIL_VERIFICATION_SENT: { Icon: Mail,       title: 'Verification email sent' },
  EMAIL_VERIFIED:        { Icon: ShieldCheck,  title: 'Email verified',  tone: 'success' },
  PAYMENT_RECEIVED:      { Icon: Wallet,       title: 'Payment received', tone: 'success' },
  FINANCE_HANDOVER_SUBMITTED: { Icon: Send,    title: 'Finance handover sent' },
  FINANCE_HANDOVER_REVIEWED:  { Icon: CheckCircle2, title: 'Finance reviewed', tone: 'success' },
  DOCUMENT_UPLOADED:     { Icon: Upload,       title: 'Document uploaded' },
  DOCUMENT_VERIFIED:     { Icon: CheckCircle2, title: 'Document verified', tone: 'success' },
  DOCUMENT_REJECTED:     { Icon: X,            title: 'Document rejected', tone: 'danger' },
  NOTE_ADDED:            { Icon: StickyNote,   title: 'Note added' },
};

function ActivityTab({ leadId }: { leadId: string }) {
  const [entries, setEntries] = useState<ActivityTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch on mount + whenever leadId changes. Refresh-on-focus keeps the
  // timeline current while the user is also acting on the lead in other
  // tabs (e.g. moving status, sending WhatsApp) — when they come back to
  // Activity the new events show up without a hard reload.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchLeadActivityTimeline(leadId);
        if (!cancelled) setEntries(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load timeline');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [leadId]);

  return (
    <GlassCard variant="strong" padded="lg">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="sos-eyebrow">Activity timeline</div>
          <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
            Every touch on this lead, newest first
          </h2>
          <p className="sos-text-muted" style={{ marginTop: '4px', fontSize: '13px' }}>
            Calls, WhatsApp, emails, status changes, files, payments — all in one place.
          </p>
        </div>
        <span className="sos-text-muted" style={{ fontSize: '12px' }}>
          {loading ? 'Loading…' : `${entries.length} event${entries.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {error ? (
        <div
          style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'var(--sos-status-danger-soft)',
            color: 'var(--sos-status-danger)',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ marginTop: '20px' }}>
        {loading && entries.length === 0 ? (
          <div className="sos-text-muted" style={{ fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
            Loading timeline…
          </div>
        ) : entries.length === 0 ? (
          <div className="sos-text-muted" style={{ fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
            No activity yet. Touches on this lead will appear here.
          </div>
        ) : (
          <Timeline>
            {entries.map((entry) => {
              const meta = TIMELINE_EVENT_META[entry.eventType] ?? {
                Icon: Activity,
                title: prettifyEventType(entry.eventType),
              };
              return (
                <TimelineStep
                  key={entry.id}
                  Icon={meta.Icon}
                  title={meta.title}
                  meta={fmtRelativeToNow(entry.createdAt)}
                  description={entry.description}
                  done={true}
                />
              );
            })}
          </Timeline>
        )}
      </div>
    </GlassCard>
  );
}

/** Turn LEAD_STATUS_CHANGED into "Lead status changed" for unknown events. */
function prettifyEventType(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(' ');
}

function FollowUpsTab({
  leadFollowUps,
}: {
  leadFollowUps: typeof MOCK_FOLLOWUPS;
}) {
  return (
    <GlassCard variant="strong" padded="lg">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="sos-eyebrow">Follow-ups</div>
          <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
            Scheduled touches for this lead
          </h2>
          <p className="sos-text-muted" style={{ marginTop: '4px', fontSize: '13px' }}>
            {leadFollowUps.length} active follow-up{leadFollowUps.length === 1 ? '' : 's'} across
            calls, WhatsApp, and visits.
          </p>
        </div>
        <ButtonLink
          href={'/sales/follow-ups' as Route}
          variant="secondary"
          iconRight={<ArrowRight size={14} />}
        >
          Open queue
        </ButtonLink>
      </div>

      <div
        style={{
          marginTop: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {leadFollowUps.length === 0 ? (
          <EmptyInline
            Icon={Phone}
            title="No follow-ups scheduled"
            caption="Schedule the next outreach so this lead does not go cold."
          />
        ) : (
          leadFollowUps.map((f) => (
            <Link
              key={f.id}
              href={`/sales/follow-ups/${f.id}` as Route}
              style={{ textDecoration: 'none' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '14px 16px',
                  borderRadius: 'var(--sos-radius-sm)',
                  background: 'var(--sos-surface-1)',
                  border: '1px solid var(--sos-border-subtle)',
                  transition: 'all 160ms ease',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'var(--sos-border-strong)';
                  e.currentTarget.style.background = 'var(--sos-surface-3)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'var(--sos-border-subtle)';
                  e.currentTarget.style.background = 'var(--sos-surface-1)';
                }}
              >
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--sos-brand-primary-soft)',
                    color: 'var(--sos-brand-primary-strong)',
                    border: '1px solid var(--sos-brand-primary-border)',
                    flexShrink: 0,
                  }}
                >
                  {f.channel === 'CALL' ? (
                    <Phone size={16} />
                  ) : f.channel === 'WHATSAPP' ? (
                    <MessageSquare size={16} />
                  ) : f.channel === 'EMAIL' ? (
                    <Mail size={16} />
                  ) : (
                    <MapPin size={16} />
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: '13.5px',
                      fontWeight: 700,
                      color: 'var(--sos-text-primary)',
                    }}
                  >
                    {f.reason}
                  </div>
                  <div
                    className="sos-text-muted"
                    style={{ marginTop: '4px', fontSize: '12px' }}
                  >
                    {f.channel.replace('_', ' ')} · {fmtDateTime(f.dueAt)}
                  </div>
                </div>
                <StatusBadge
                  tone={
                    f.status === 'OVERDUE'
                      ? 'danger'
                      : f.status === 'DUE_TODAY'
                        ? 'warning'
                        : f.status === 'COMPLETED'
                          ? 'success'
                          : 'info'
                  }
                >
                  {fmtRelative(f.dueAt)}
                </StatusBadge>
                <ArrowRight size={14} style={{ color: 'var(--sos-text-faint)' }} />
              </div>
            </Link>
          ))
        )}
      </div>
    </GlassCard>
  );
}

function AppointmentsTab({
  leadAppointments,
}: {
  leadAppointments: typeof MOCK_APPOINTMENTS;
}) {
  return (
    <GlassCard variant="strong" padded="lg">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="sos-eyebrow">Appointments</div>
          <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
            Booked consultations and visits
          </h2>
        </div>
        <ButtonLink
          href={'/sales/appointments' as Route}
          variant="primary"
          iconLeft={<CalendarPlus size={14} />}
        >
          Book new
        </ButtonLink>
      </div>

      <div
        style={{
          marginTop: '20px',
          display: 'grid',
          gap: '12px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        }}
      >
        {leadAppointments.length === 0 ? (
          <EmptyInline
            Icon={CalendarClock}
            title="No appointments yet"
            caption="When the client agrees to meet, book it from the appointments screen."
          />
        ) : (
          leadAppointments.map((a) => (
            <div
              key={a.id}
              style={{
                padding: '16px',
                borderRadius: 'var(--sos-radius-sm)',
                background: 'var(--sos-surface-1)',
                border: '1px solid var(--sos-border-subtle)',
                display: 'flex',
                gap: '14px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '10px 14px',
                  borderRadius: 'var(--sos-radius-sm)',
                  background: 'var(--sos-brand-primary-soft)',
                  color: 'var(--sos-brand-primary-strong)',
                  border: '1px solid var(--sos-brand-primary-border)',
                  minWidth: '70px',
                }}
              >
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  {new Intl.DateTimeFormat('en-PK', { month: 'short' }).format(
                    new Date(a.scheduledAt),
                  )}
                </span>
                <span style={{ fontSize: '24px', fontWeight: 700, lineHeight: 1 }}>
                  {new Date(a.scheduledAt).getDate()}
                </span>
                <span style={{ fontSize: '11px', marginTop: '4px' }}>
                  {fmtTimeOnly(a.scheduledAt)}
                </span>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: '13.5px',
                    fontWeight: 700,
                    color: 'var(--sos-text-primary)',
                  }}
                >
                  {a.type
                    .split('_')
                    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
                    .join(' ')}
                </div>
                <div
                  className="sos-text-muted"
                  style={{ marginTop: '4px', fontSize: '12px' }}
                >
                  {a.durationMin}m · {a.status}
                </div>
                {a.location ? (
                  <div
                    style={{
                      marginTop: '8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                      color: 'var(--sos-text-secondary)',
                    }}
                  >
                    <MapPin size={12} /> {a.location}
                  </div>
                ) : null}
                {a.note ? (
                  <div
                    className="sos-text-faint"
                    style={{ marginTop: '6px', fontSize: '11.5px', lineHeight: 1.5 }}
                  >
                    {a.note}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </GlassCard>
  );
}

function NotesTab({
  salesNote,
  setSalesNote,
  leadId,
}: {
  salesNote: string;
  setSalesNote: (s: string) => void;
  leadId: string;
}) {
  const [files, setFiles] = useState<ApiLeadFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFilesLoading(true);
    setFilesError(null);
    fetchLeadFiles(leadId)
      .then((data) => { if (!cancelled) { setFiles(data); setFilesLoading(false); } })
      .catch((err) => { if (!cancelled) { setFilesError(String(err)); setFilesLoading(false); } });
    return () => { cancelled = true; };
  }, [leadId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const created = await uploadLeadFile(leadId, file);
      setFiles((prev) => [created, ...prev]);
    } catch (err) {
      alert(`Upload failed: ${String(err)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDownload(fileId: string) {
    try {
      const url = await getLeadFileUrl(leadId, fileId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      alert('Could not generate download link. Please try again.');
    }
  }

  async function handleDelete(fileId: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return;
    try {
      await deleteLeadFile(leadId, fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch {
      alert('Delete failed. Please try again.');
    }
  }

  function fmtBytes(bytes: number | null): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <section
      style={{
        display: 'grid',
        gap: '20px',
        gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
      }}
      className="sos-detail-grid"
    >
      <GlassCard variant="strong" padded="lg">
        <div className="sos-eyebrow">Sales note</div>
        <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
          Context the next person should see
        </h2>
        <div style={{ marginTop: '20px' }}>
          <FormTextarea
            value={salesNote}
            onChange={(e) => setSalesNote(e.target.value)}
            placeholder="Capture client context, promises made, and the cleanest next move…"
            style={{ minHeight: 220 }}
            inputSize="lg"
          />
        </div>
      </GlassCard>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <GlassCard variant="default" padded="md">
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div>
              <div className="sos-eyebrow">Documents</div>
              <p
                className="sos-text-muted"
                style={{ marginTop: '6px', fontSize: '12.5px', lineHeight: 1.55 }}
              >
                Attach passports, transcripts, or receipts so finance can verify in one click.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleUpload}
            />
            <PrimaryButton
              size="sm"
              iconLeft={uploading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={13} />}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </PrimaryButton>
          </div>
          <div
            style={{
              marginTop: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {filesLoading ? (
              <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--sos-text-faint)', fontSize: '12px' }}>
                Loading files…
              </div>
            ) : filesError ? (
              <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--sos-status-danger)', fontSize: '12px' }}>
                {filesError}
              </div>
            ) : files.length === 0 ? (
              <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--sos-text-faint)', fontSize: '12px' }}>
                No files attached yet. Click Upload to add documents.
              </div>
            ) : (
              files.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    borderRadius: 'var(--sos-radius-sm)',
                    background: 'var(--sos-surface-1)',
                    border: '1px solid var(--sos-border-subtle)',
                  }}
                >
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '10px',
                      display: 'grid',
                      placeItems: 'center',
                      background: 'var(--sos-surface-2)',
                      color: 'var(--sos-text-muted)',
                      border: '1px solid var(--sos-border-subtle)',
                      flexShrink: 0,
                    }}
                  >
                    <Paperclip size={14} />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownload(f.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      minWidth: 0,
                      flex: 1,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 600,
                        color: 'var(--sos-text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {f.fileName}
                    </div>
                    <div className="sos-text-faint" style={{ fontSize: '11px', marginTop: '2px' }}>
                      {fmtBytes(f.fileSizeBytes)}
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label="Remove document"
                    onClick={() => handleDelete(f.id, f.fileName)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--sos-text-faint)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      padding: '4px',
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </GlassCard>

        <GlassCard variant="default" padded="md">
          <div className="sos-eyebrow">Reminders</div>
          <div
            style={{
              marginTop: '12px',
              padding: '16px 0',
              textAlign: 'center',
              color: 'var(--sos-text-faint)',
              fontSize: '12px',
            }}
          >
            Reminders will appear here once the module is enabled.
          </div>
        </GlassCard>
      </div>
    </section>
  );
}

function EmptyInline({
  Icon,
  title,
  caption,
}: {
  Icon: typeof Phone;
  title: string;
  caption: string;
}) {
  return (
    <div
      style={{
        gridColumn: '1 / -1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '32px 18px',
        gap: '10px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px dashed var(--sos-border)',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '14px',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--sos-brand-primary-soft)',
          color: 'var(--sos-brand-primary-strong)',
          border: '1px solid var(--sos-brand-primary-border)',
        }}
      >
        <Icon size={20} />
      </div>
      <div
        style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sos-text-primary)' }}
      >
        {title}
      </div>
      <div className="sos-text-muted" style={{ fontSize: '12.5px', maxWidth: '40ch' }}>
        {caption}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification Tab
// ---------------------------------------------------------------------------

function VerificationTab({
  lead,
  onVerified,
}: {
  lead: NonNullable<ReturnType<typeof getLead>>;
  onVerified: (verified: boolean) => void;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendVerification() {
    if (!lead.email) return;
    setSending(true);
    setError(null);
    try {
      await sendLeadEmailVerification(lead.id);
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send verification email');
    } finally {
      setSending(false);
    }
  }

  const isVerified = lead.emailVerified === true;

  return (
    <GlassCard variant="strong" padded="lg">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div className="sos-eyebrow">Email verification</div>
          <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
            Verify this lead&apos;s email address
          </h2>
          <p className="sos-text-muted" style={{ marginTop: '4px', fontSize: '13px' }}>
            A verification link is sent to the lead&apos;s email. Once they click it, the address is marked as confirmed.
          </p>
        </div>
        {isVerified ? (
          <StatusBadge tone="success">
            <ShieldCheck size={12} /> Verified
          </StatusBadge>
        ) : (
          <StatusBadge tone="warning">
            <Shield size={12} /> Not verified
          </StatusBadge>
        )}
      </div>

      {/* Status card */}
      <div
        style={{
          marginTop: '24px',
          padding: '20px',
          borderRadius: 'var(--sos-radius-sm)',
          background: isVerified ? 'var(--sos-status-success-soft)' : 'var(--sos-surface-1)',
          border: `1px solid ${isVerified ? 'var(--sos-status-success-border)' : 'var(--sos-border-subtle)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '13px',
            display: 'grid',
            placeItems: 'center',
            background: isVerified ? 'var(--sos-status-success-soft)' : 'var(--sos-brand-primary-soft)',
            color: isVerified ? 'var(--sos-status-success)' : 'var(--sos-brand-primary-strong)',
            border: `1px solid ${isVerified ? 'var(--sos-status-success-border)' : 'var(--sos-brand-primary-border)'}`,
            flexShrink: 0,
          }}
        >
          {isVerified ? <CheckCircle2 size={20} /> : <Mail size={20} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
            {isVerified ? 'Email address confirmed' : (lead.email ? lead.email : 'No email on file')}
          </div>
          <div className="sos-text-muted" style={{ marginTop: '4px', fontSize: '12.5px' }}>
            {isVerified
              ? `${lead.email} has been verified`
              : lead.email
                ? 'Verification email not yet sent or lead has not clicked the link'
                : 'Add an email address to this lead before sending verification'}
          </div>
        </div>
      </div>

      {/* Action */}
      {!isVerified && (
        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {!lead.email ? (
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 'var(--sos-radius-sm)',
                background: 'var(--sos-status-warning-soft)',
                border: '1px solid var(--sos-status-warning-border)',
                fontSize: '13px',
                color: 'var(--sos-text-secondary)',
              }}
            >
              No email address on file. Go to the Overview tab to add one before sending verification.
            </div>
          ) : sent ? (
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 'var(--sos-radius-sm)',
                background: 'var(--sos-status-success-soft)',
                border: '1px solid var(--sos-status-success-border)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '13px',
                color: 'var(--sos-status-success)',
                fontWeight: 600,
              }}
            >
              <CheckCircle2 size={16} />
              Verification email sent to {lead.email}. Waiting for the lead to click the link.
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 'var(--sos-radius-sm)',
                background: 'var(--sos-status-danger-soft)',
                border: '1px solid var(--sos-status-danger-border)',
                fontSize: '13px',
                color: 'var(--sos-status-danger)',
              }}
            >
              {error}
            </div>
          ) : null}

          {lead.email && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <PrimaryButton
                onClick={handleSendVerification}
                disabled={sending || sent}
                iconLeft={sending ? <Loader2 size={15} className="sos-spin" /> : <Send size={15} />}
              >
                {sending ? 'Sending…' : sent ? 'Email sent' : 'Send verification email'}
              </PrimaryButton>
              {sent && (
                <GhostButton
                  onClick={() => { setSent(false); setError(null); }}
                  iconLeft={<Send size={14} />}
                >
                  Resend
                </GhostButton>
              )}
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div
        style={{
          marginTop: '24px',
          padding: '14px 16px',
          borderRadius: 'var(--sos-radius-sm)',
          background: 'var(--sos-surface-1)',
          border: '1px solid var(--sos-border-subtle)',
          display: 'flex',
          gap: '10px',
          alignItems: 'flex-start',
        }}
      >
        <Shield size={14} style={{ color: 'var(--sos-brand-primary-strong)', flexShrink: 0, marginTop: '2px' }} />
        <p className="sos-text-muted" style={{ margin: 0, fontSize: '12.5px', lineHeight: 1.6 }}>
          The verification link expires in 48 hours. If the lead does not receive the email, check the spam folder or resend.
          Verified email addresses are shown with a green badge across the system.
        </p>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Finance tab — the trail of every handover Sales has shipped + every
// decision Finance has returned. This is what makes the "where did my
// receipt go?" question answerable from inside the lead profile.
// ---------------------------------------------------------------------------

type HandoverStatus = ApiLeadFinanceHandover['status'];

const FINANCE_STATUS_LABEL: Record<HandoverStatus, string> = {
  SUBMITTED: 'Submitted to Finance',
  IN_REVIEW: 'Finance reviewing',
  PAYMENT_RECORDED: 'Payment recorded',
  PAYMENT_VERIFIED: 'Payment verified',
  REJECTED: 'Returned to Sales',
  CANCELLED: 'Cancelled',
  SENT_TO_PROCESSING: 'Sent to Processing',
};

function financeStatusTone(s: HandoverStatus): BadgeTone {
  switch (s) {
    case 'REJECTED':
    case 'CANCELLED':
      return 'danger';
    case 'SUBMITTED':
    case 'IN_REVIEW':
      return 'warning';
    case 'PAYMENT_RECORDED':
      return 'info';
    case 'PAYMENT_VERIFIED':
    case 'SENT_TO_PROCESSING':
      return 'success';
    default:
      return 'neutral';
  }
}

function fmtAmount(amount: string, currency: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  // Locale-aware grouping is nice for big-ticket payments without
  // depending on a heavy i18n library. Falls back gracefully if the
  // currency code isn't ISO 4217.
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toLocaleString()} ${currency}`;
  }
}

function FinanceTab({
  handovers,
  loading,
  serviceFeeAmount,
  serviceFeeCurrency,
}: {
  handovers: ApiLeadFinanceHandover[];
  loading: boolean;
  /** The lead's agreed service fee (the anchor for the single Invoice).
   *  When set, the tab shows a "paid X of Y · Z remaining" running balance. */
  serviceFeeAmount?: string;
  serviceFeeCurrency?: string;
}) {
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <GlassCard variant="strong" padded="lg">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 16px',
              color: 'var(--sos-text-muted)',
              gap: 10,
            }}
          >
            <Loader2 size={16} className="sos-spin" />
            Loading finance history…
          </div>
        </GlassCard>
      </div>
    );
  }

  if (handovers.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <GlassCard variant="strong" padded="lg">
          <div style={{ textAlign: 'center', padding: '36px 16px' }}>
            <Wallet
              size={36}
              style={{ color: 'var(--sos-text-faint)', margin: '0 auto 12px' }}
            />
            <h3 className="sos-title" style={{ fontSize: '16px' }}>
              Nothing sent to Finance yet
            </h3>
            <p className="sos-text-muted" style={{ marginTop: 6, fontSize: '13px' }}>
              Once you upload a receipt and hand this lead to Finance, every
              decision — approval, rejection, correction request — will show up
              here with the finance officer&apos;s notes.
            </p>
          </div>
        </GlassCard>
      </div>
    );
  }

  // Handovers come back newest-first from the API; reflect that ordering.
  const latest = handovers[0];
  const showAlert = latest.status === 'REJECTED';

  // Roll up "paid against the agreed fee" — only verified payments count.
  // PAYMENT_RECORDED is in-flight (Finance recorded the receipt but didn't
  // verify), so we report it separately as "pending review" rather than
  // counting it as paid. Same currency across all rollups; if currencies
  // mix we just hide the rollup to avoid lying.
  const handoverCurrencies = new Set(handovers.map((h) => h.currency));
  const singleCurrency = handoverCurrencies.size === 1 ? Array.from(handoverCurrencies)[0] : null;
  const hasAgreedFee = !!serviceFeeAmount && Number(serviceFeeAmount) > 0;
  const agreedTotal = hasAgreedFee ? Number(serviceFeeAmount) : null;
  const paidVerified = handovers
    .filter((h) => h.status === 'PAYMENT_VERIFIED' || h.status === 'SENT_TO_PROCESSING')
    .reduce((s, h) => s + Number(h.submittedAmount), 0);
  const pendingReview = handovers
    .filter((h) => h.status === 'SUBMITTED' || h.status === 'IN_REVIEW' || h.status === 'PAYMENT_RECORDED')
    .reduce((s, h) => s + Number(h.submittedAmount), 0);
  const remaining = agreedTotal !== null ? Math.max(0, agreedTotal - paidVerified) : null;
  const balanceCurrency = serviceFeeCurrency ?? singleCurrency ?? 'CAD';
  const fmtMoney = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: balanceCurrency,
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${n.toLocaleString()} ${balanceCurrency}`;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Contract / running-balance summary — the most important number on
          this tab. When the agreed fee is captured, we show paid-of-total
          progress; otherwise we just show what's been received so far. */}
      <GlassCard variant="strong" padded="lg">
        <div className="sos-eyebrow" style={{ marginBottom: 8 }}>
          {hasAgreedFee ? 'Service contract' : 'Payments received'}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 14,
            alignItems: 'flex-end',
          }}
        >
          {hasAgreedFee ? (
            <BalanceTile
              label="Agreed total"
              value={fmtMoney(agreedTotal ?? 0)}
              tone="neutral"
            />
          ) : null}
          <BalanceTile
            label="Paid (verified)"
            value={fmtMoney(paidVerified)}
            tone={paidVerified > 0 ? 'success' : 'neutral'}
          />
          {pendingReview > 0 ? (
            <BalanceTile
              label="Pending review"
              value={fmtMoney(pendingReview)}
              tone="warning"
            />
          ) : null}
          {hasAgreedFee && remaining !== null ? (
            <BalanceTile
              label="Remaining"
              value={fmtMoney(remaining)}
              tone={remaining === 0 ? 'success' : 'info'}
            />
          ) : null}
        </div>
        {hasAgreedFee && agreedTotal !== null && agreedTotal > 0 ? (
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                width: '100%',
                height: 6,
                background: 'var(--sos-surface-1)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.round((paidVerified / agreedTotal) * 100))}%`,
                  height: '100%',
                  background: 'var(--sos-status-success)',
                  transition: 'width 200ms ease',
                }}
              />
            </div>
            <div className="sos-text-muted" style={{ marginTop: 6, fontSize: 11.5 }}>
              {Math.round((paidVerified / agreedTotal) * 100)}% of the agreed fee paid
            </div>
          </div>
        ) : null}
        {!hasAgreedFee ? (
          <div
            className="sos-text-muted"
            style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5 }}
          >
            No agreed service fee captured yet. Set it via the &ldquo;Edit
            lead&rdquo; button in the header so finance can show a running
            balance and so installment payments roll up against one invoice.
          </div>
        ) : null}
      </GlassCard>

      {showAlert ? (
        <div
          role="alert"
          style={{
            padding: '14px 18px',
            borderRadius: 'var(--sos-radius-sm)',
            background: 'var(--sos-status-danger-soft)',
            border: '1px solid var(--sos-status-danger)',
            color: 'var(--sos-status-danger)',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <CircleAlert size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>
              Finance returned this case to Sales
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 12.5,
                color: 'var(--sos-text-primary)',
                lineHeight: 1.5,
              }}
            >
              {latest.financeNotes
                ? `Finance note: "${latest.financeNotes}"`
                : 'No finance note was attached.'}
            </div>
            <div className="sos-text-muted" style={{ marginTop: 6, fontSize: 11.5 }}>
              {latest.reviewedAt
                ? `Reviewed ${new Date(latest.reviewedAt).toLocaleString()}`
                : null}
            </div>
          </div>
        </div>
      ) : null}

      <GlassCard variant="strong" padded="lg">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 14,
          }}
        >
          <div>
            <div className="sos-eyebrow">Finance handover ledger</div>
            <h2 className="sos-title" style={{ fontSize: '17px', marginTop: 6 }}>
              {handovers.length} {handovers.length === 1 ? 'handover' : 'handovers'}
            </h2>
            <p
              className="sos-text-muted"
              style={{ marginTop: 4, fontSize: 12.5 }}
            >
              Every receipt sent to Finance for this lead and every decision
              Finance has logged. Newest first.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {handovers.map((h, idx) => (
            <HandoverCard key={h.id} handover={h} index={handovers.length - idx} />
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function BalanceTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'info' | 'neutral';
}) {
  const colorByTone: Record<typeof tone, string> = {
    success: 'var(--sos-status-success)',
    warning: 'var(--sos-status-warning)',
    info: 'var(--sos-brand-primary-strong)',
    neutral: 'var(--sos-text-primary)',
  };
  return (
    <div>
      <div className="sos-text-faint" style={{ fontSize: 11, letterSpacing: '0.06em' }}>
        {label.toUpperCase()}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: colorByTone[tone],
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function HandoverCard({
  handover,
  index,
}: {
  handover: ApiLeadFinanceHandover;
  index: number;
}) {
  const tone = financeStatusTone(handover.status);
  const label = FINANCE_STATUS_LABEL[handover.status];
  const isRejected = handover.status === 'REJECTED';

  return (
    <div
      style={{
        padding: '16px 18px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: isRejected
          ? '1px solid var(--sos-status-danger)'
          : '1px solid var(--sos-border-subtle)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            className="sos-text-faint"
            style={{ fontSize: 11, letterSpacing: '0.06em' }}
          >
            #{index}
          </span>
          <span
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: 'var(--sos-text-primary)',
            }}
          >
            {fmtAmount(handover.submittedAmount, handover.currency)}
          </span>
          {handover.paymentMethod ? (
            <StatusBadge tone="neutral" size="sm">
              {handover.paymentMethod}
            </StatusBadge>
          ) : null}
          <StatusBadge tone={tone} size="sm" dot>
            {label}
          </StatusBadge>
        </div>
        {handover.receiptDownloadUrl ? (
          <a
            href={handover.receiptDownloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="sos-btn sos-btn--ghost sos-btn--sm"
            style={{ textDecoration: 'none' }}
          >
            <Paperclip size={13} />
            {handover.receiptFileName}
          </a>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
          fontSize: 12.5,
        }}
      >
        <div>
          <div className="sos-text-faint" style={{ fontSize: 11 }}>Submitted</div>
          <div>{new Date(handover.submittedAt).toLocaleString()}</div>
        </div>
        {handover.reviewedAt ? (
          <div>
            <div className="sos-text-faint" style={{ fontSize: 11 }}>
              Reviewed by Finance
            </div>
            <div>{new Date(handover.reviewedAt).toLocaleString()}</div>
          </div>
        ) : (
          <div>
            <div className="sos-text-faint" style={{ fontSize: 11 }}>
              Reviewed by Finance
            </div>
            <div className="sos-text-faint">Awaiting review</div>
          </div>
        )}
        {handover.transactionRef ? (
          <div>
            <div className="sos-text-faint" style={{ fontSize: 11 }}>
              Transaction ref
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {handover.transactionRef}
            </div>
          </div>
        ) : null}
      </div>

      {handover.notes ? (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 'var(--sos-radius-xs)',
            background: 'var(--sos-surface-0)',
            border: '1px solid var(--sos-border-subtle)',
            fontSize: 12.5,
          }}
        >
          <div className="sos-text-faint" style={{ fontSize: 11, marginBottom: 4 }}>
            Sales note (sent with receipt)
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{handover.notes}</div>
        </div>
      ) : null}

      {handover.financeNotes ? (
        <div
          style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 'var(--sos-radius-xs)',
            background: isRejected
              ? 'var(--sos-status-danger-soft)'
              : 'var(--sos-surface-0)',
            border: isRejected
              ? '1px solid var(--sos-status-danger)'
              : '1px solid var(--sos-border-subtle)',
            fontSize: 12.5,
          }}
        >
          <div
            className="sos-text-faint"
            style={{
              fontSize: 11,
              marginBottom: 4,
              color: isRejected ? 'var(--sos-status-danger)' : undefined,
              fontWeight: isRejected ? 700 : undefined,
            }}
          >
            Finance officer note {isRejected ? '— REASON FOR RETURN' : ''}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{handover.financeNotes}</div>
        </div>
      ) : null}
    </div>
  );
}

// Helper used below for type inference
function getLead() { return null as unknown as ReturnType<typeof adaptLead>; }
import { adaptLead } from '@/lib/sales-api';
import { labelForServiceCode } from '@/lib/service-types';
