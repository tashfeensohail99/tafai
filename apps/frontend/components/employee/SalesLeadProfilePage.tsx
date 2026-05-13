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
import { useRouter } from 'next/navigation';
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
  Sparkles,
  Star,
  StickyNote,
  Tag,
  Timer,
  Upload,
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
import {
  fetchLead,
  fetchFollowUps,
  fetchAppointments,
  patchLead,
  fetchLeadFiles,
  uploadLeadFile,
  getLeadFileUrl,
  deleteLeadFile,
  type ApiLeadFile,
} from '@/lib/sales-api';

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

type TabKey = 'OVERVIEW' | 'ACTIVITY' | 'FOLLOWUPS' | 'APPOINTMENTS' | 'NOTES' | 'WHATSAPP';

const TABS: Array<{ key: TabKey; label: string; Icon: typeof Activity }> = [
  { key: 'OVERVIEW', label: 'Overview', Icon: ClipboardList },
  { key: 'WHATSAPP', label: 'WhatsApp', Icon: MessageSquare },
  { key: 'ACTIVITY', label: 'Activity', Icon: History },
  { key: 'FOLLOWUPS', label: 'Follow-ups', Icon: Phone },
  { key: 'APPOINTMENTS', label: 'Appointments', Icon: CalendarClock },
  { key: 'NOTES', label: 'Notes & docs', Icon: StickyNote },
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
  const [lead, setLead] = useState<Lead | null>(null);
  const [leadFollowUps, setLeadFollowUps] = useState<FollowUp[]>([]);
  const [leadAppointments, setLeadAppointments] = useState<Appointment[]>([]);
  const [loadingLead, setLoadingLead] = useState(true);
  const [saving, setSaving] = useState(false);

  const [stage, setStage] = useState<LeadStage>('NEW');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [nextAction, setNextAction] = useState('');
  const [salesNote, setSalesNote] = useState('');
  const [tab, setTab] = useState<TabKey>('OVERVIEW');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pinned, setPinned] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);

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

  const stageIdx = Math.max(0, STAGE_PROGRESS.indexOf(stage));
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
        </div>
      </div>

      <PageHeader
        eyebrow={`Lead profile · ${lead.id}`}
        title={
          <>
            {lead.firstName} {lead.lastName}
          </>
        }
        description={
          <>
            {lead.service} → {lead.targetCountry} ·{' '}
            {lead.assignmentType === 'ADMIN'
              ? `Admin · ${lead.assignedBy?.split('·')[1]?.trim() ?? 'front desk'}`
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
              href={`https://wa.me/${phoneClean.replace('+', '')}`}
              target="_blank"
              rel="noopener noreferrer"
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
            stage={stage}
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
      />

      <Tabs tab={tab} setTab={setTab} counts={{
        OVERVIEW: 0,
        WHATSAPP: 0,
        ACTIVITY: 4,
        FOLLOWUPS: leadFollowUps.length,
        APPOINTMENTS: leadAppointments.length,
        NOTES: salesNote ? 1 : 0,
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
        <ActivityTab lead={lead} stage={stage} />
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
            <ContactItem Icon={Wallet} label="Service" value={lead.service} />
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
}: {
  applyQuickAction: (next: LeadStage, text: string) => void;
  currentStage: LeadStage;
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
    {
      Icon: Send,
      title: 'Send to Finance',
      caption: 'Hand off receipt for verification',
      tone: 'var(--sos-status-success)',
      href: '/sales/decisions',
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

        <GlassCard variant="default" padded="md">
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '14px',
              borderRadius: 'var(--sos-radius-sm)',
              background: 'var(--sos-status-success-soft)',
              border: '1px solid var(--sos-status-success-border)',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '11px',
                display: 'grid',
                placeItems: 'center',
                background: 'var(--sos-status-success-soft)',
                color: 'var(--sos-status-success)',
                border: '1px solid var(--sos-status-success-border)',
                flexShrink: 0,
              }}
            >
              <Wallet size={16} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="sos-eyebrow">Pay-now hand-off</div>
              <p
                className="sos-text-secondary"
                style={{ marginTop: '4px', fontSize: '12.5px', lineHeight: 1.55 }}
              >
                When the client is ready to pay, jump to Decisions to upload the receipt and
                notify finance.
              </p>
            </div>
          </div>
          <div style={{ marginTop: '14px' }}>
            <ButtonLink
              href={'/sales/decisions' as Route}
              variant="success"
              fullWidth
              iconRight={<ArrowRight size={15} />}
            >
              Open Decisions
            </ButtonLink>
          </div>
        </GlassCard>

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
        <SnapshotRow label="Service" value={lead.service} />
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

function ActivityTab({
  lead,
  stage,
}: {
  lead: NonNullable<ReturnType<typeof getLead>>;
  stage: LeadStage;
}) {
  const items = [
    {
      Icon: Shield,
      title: 'Lead assigned',
      meta:
        lead.assignmentType === 'ADMIN'
          ? lead.assignedBy ?? 'Admin'
          : 'Auto CRM',
      description: fmtDateTime(lead.assignedAt),
      done: true,
    },
    {
      Icon: MessageSquare,
      title: 'WhatsApp sent — first touch',
      meta: '1h ago',
      description: 'Intro message + service brochure delivered.',
      done: true,
    },
    {
      Icon: Phone,
      title: 'Outbound call — answered',
      meta: '52m ago',
      description: 'Client confirmed serious interest, asked for office walk-in.',
      done: true,
    },
    {
      Icon: StickyNote,
      title: 'Note added',
      meta: '30m ago',
      description: 'Sales rep added context for finance handover.',
      done: true,
    },
    {
      Icon: Activity,
      title: `Stage moved to ${STAGE_LABEL[stage]}`,
      meta: 'Just now',
      description:
        stage === 'PAYMENT_INTERESTED'
          ? 'Client signaled they want to pay this week.'
          : 'Pipeline updated.',
      done: false,
    },
  ];

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
            Calls, messages, stage changes, and notes — all in one place.
          </p>
        </div>
        <SecondaryButton iconLeft={<History size={14} />}>Export log</SecondaryButton>
      </div>

      <div style={{ marginTop: '20px' }}>
        <Timeline>
          {items.map((it, i) => (
            <TimelineStep
              key={i}
              Icon={it.Icon}
              title={it.title}
              meta={it.meta}
              description={it.description}
              done={it.done}
            />
          ))}
        </Timeline>
      </div>
    </GlassCard>
  );
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

