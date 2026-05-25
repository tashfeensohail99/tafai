'use client';
// Sales OS — Follow-up detail (premium dark glass redesign).
//
// What a sales rep needs on a single follow-up:
//   1. Live countdown — am I overdue, due today, or comfortable?
//   2. One-touch outcomes — Done, No response, Reschedule, Move to decision.
//   3. Channel shortcut — call / WhatsApp / email opens the right app.
//   4. Outcome capture with quick-add presets.
//   5. Preset reschedule chips (in 1h, tomorrow 11am, in 24h…).
//   6. History of prior touches on the same lead, side panel.
//   7. Sticky save bar to commit changes.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Clock4,
  History,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  PhoneOff,
  RefreshCw,
  Save,
  Send,
  Timer,
  Wallet,
  X,
} from 'lucide-react';
import {
  type FollowUp,
  type FollowUpStatus,
  type SlaStatus,
  type Lead,
  FOLLOWUP_TYPE_LABEL,
  STAGE_LABEL,
  fmtDateTime,
  fmtRelative,
  fmtRelativeToNow,
  initialsOf,
} from '@/components/sales-v2/mockData';
import {
  ActionBar,
  ButtonLink,
  Field,
  FormTextarea,
  GlassCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { fetchFollowUps, fetchLead, completeFollowUp, patchFollowUp } from '@/lib/sales-api';

const STATUSES: FollowUpStatus[] = [
  'PENDING',
  'DUE_TODAY',
  'OVERDUE',
  'COMPLETED',
  'RESCHEDULED',
  'NO_RESPONSE',
  'PAYMENT_INTERESTED',
];

const SLA_OPTIONS: SlaStatus[] = ['ACTIVE', 'OVERDUE', 'UPCOMING', 'COMPLETED'];

const OUTCOME_PRESETS = [
  'Client confirmed payment for tomorrow morning.',
  'No answer, will retry in 24 hours.',
  'Asked to reschedule to next week.',
  'Sent documents checklist via WhatsApp.',
  'Client wants to compare with another agency first.',
];

function statusLabel(s: FollowUpStatus): string {
  return ({
    PENDING: 'Pending',
    DUE_TODAY: 'Due Today',
    OVERDUE: 'Overdue',
    COMPLETED: 'Completed',
    RESCHEDULED: 'Rescheduled',
    NO_RESPONSE: 'No Response',
    PAYMENT_INTERESTED: 'Payment Interested',
  } as const)[s];
}

function statusTone(s: FollowUpStatus): BadgeTone {
  switch (s) {
    case 'OVERDUE':
    case 'NO_RESPONSE':
      return 'danger';
    case 'DUE_TODAY':
      return 'warning';
    case 'PENDING':
    case 'RESCHEDULED':
      return 'info';
    case 'PAYMENT_INTERESTED':
      return 'warm';
    case 'COMPLETED':
      return 'success';
    default:
      return 'neutral';
  }
}

function slaTone(s: SlaStatus): BadgeTone {
  if (s === 'OVERDUE') return 'danger';
  if (s === 'ACTIVE') return 'success';
  if (s === 'UPCOMING') return 'info';
  return 'neutral';
}

function ChannelIcon({ channel, size = 14 }: { channel: FollowUp['channel']; size?: number }) {
  switch (channel) {
    case 'CALL':
      return <Phone size={size} />;
    case 'WHATSAPP':
      return <MessageSquare size={size} />;
    case 'EMAIL':
      return <AtSign size={size} />;
    case 'IN_PERSON':
      return <MapPin size={size} />;
  }
}

export function SalesFollowUpDetailPage({ followUpId }: { followUpId: string }) {
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [otherFollowUps, setOtherFollowUps] = useState<FollowUp[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [leadPhone, setLeadPhone] = useState('');
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState<FollowUpStatus>('PENDING');
  const [sla, setSla] = useState<SlaStatus>('ACTIVE');
  const [dueAt, setDueAt] = useState<string>('');
  const [outcome, setOutcome] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    // Fetch by looking up in the full list (no GET /follow-ups/:id endpoint known)
    fetchFollowUps().then(async (all) => {
      const found = all.find((f) => f.id === followUpId) ?? null;
      if (found) {
        setFollowUp(found);
        setStatus(found.status);
        setSla(found.slaStatus);
        setDueAt(new Date(found.dueAt).toISOString().slice(0, 16));
        setOutcome(found.outcome ?? '');
        // Load lead phone
        const leadObj = await fetchLead(found.leadId);
        if (leadObj) {
          setLead(leadObj);
          setLeadPhone(leadObj.phone.replace(/[^+\d]/g, ''));
        }
        // Other follow-ups for same lead
        setOtherFollowUps(all.filter((f) => f.leadId === found.leadId && f.id !== followUpId));
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [followUpId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: '10px', color: 'var(--sos-text-muted)' }}>
        <Loader2 size={20} className="sos-spin" />
        <span>Loading follow-up…</span>
      </div>
    );
  }

  if (!followUp) {
    return (
      <GlassCard variant="strong" padded="lg">
        <div style={{ textAlign: 'center', padding: '36px 16px' }}>
          <h3 className="sos-title" style={{ fontSize: '17px' }}>
            Follow-up not found
          </h3>
          <p className="sos-text-muted" style={{ marginTop: '6px', fontSize: '13.5px' }}>
            Check the URL or jump back to the queue.
          </p>
          <div style={{ marginTop: '16px' }}>
            <ButtonLink
              href={'/sales/follow-ups' as Route}
              variant="secondary"
              iconLeft={<ArrowLeft size={15} />}
            >
              Back to Follow Ups
            </ButtonLink>
          </div>
        </div>
      </GlassCard>
    );
  }

  const phoneClean = leadPhone;

  const dirty =
    status !== followUp.status ||
    sla !== followUp.slaStatus ||
    dueAt !== new Date(followUp.dueAt).toISOString().slice(0, 16) ||
    (outcome ?? '') !== (followUp.outcome ?? '');

  const isOverdue = status === 'OVERDUE';

  // otherFollowUps comes from state (populated in useEffect above)

  function quickMarkDone() {
    setStatus('COMPLETED');
    setSla('COMPLETED');
    setOutcome((o) => o || 'Client reached. Lead moved forward.');
  }
  function quickNoResponse() {
    setStatus('NO_RESPONSE');
    setOutcome((o) => o || 'No answer. Will retry in 24 hours.');
  }
  function quickReschedule(hoursAhead: number) {
    setStatus('RESCHEDULED');
    setSla('UPCOMING');
    const next = new Date();
    next.setHours(next.getHours() + hoursAhead, 0, 0, 0);
    setDueAt(next.toISOString().slice(0, 16));
  }
  function quickRescheduleTomorrow11() {
    setStatus('RESCHEDULED');
    setSla('UPCOMING');
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(11, 0, 0, 0);
    setDueAt(next.toISOString().slice(0, 16));
  }

  function handleReset() {
    setStatus(followUp.status);
    setSla(followUp.slaStatus);
    setDueAt(new Date(followUp.dueAt).toISOString().slice(0, 16));
    setOutcome(followUp.outcome ?? '');
    setSaveError('');
  }
  async function handleSave() {
    if (!followUp || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      if (status === 'COMPLETED') {
        await completeFollowUp(followUp.id, outcome || undefined);
      } else {
        await patchFollowUp(followUp.id, {
          status,
          dueAt: new Date(dueAt).toISOString(),
        });
      }
      setSavedAt(new Date());
    } catch {
      setSaveError('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const [first, last] = followUp.clientName.split(' ');

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
        <Link
          href={'/sales/follow-ups' as Route}
          className="sos-btn sos-btn--ghost"
          style={{ textDecoration: 'none' }}
        >
          <ArrowLeft size={15} /> Back to Follow Ups
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {lead ? (
            <ButtonLink
              href={`/sales/leads/${lead.id}` as Route}
              variant="ghost"
              iconRight={<ArrowRight size={14} />}
            >
              View lead profile
            </ButtonLink>
          ) : null}
        </div>
      </div>

      <PageHeader
        eyebrow={`Follow-up · ${followUp.id}`}
        title={<>{followUp.clientName}</>}
        description={
          <>
            {FOLLOWUP_TYPE_LABEL[followUp.type]} · linked to{' '}
            <strong style={{ color: 'var(--sos-text-primary)' }}>
              {STAGE_LABEL[followUp.linkedStage]}
            </strong>{' '}
            stage. {followUp.reason}
          </>
        }
        actions={
          <>
            {lead && phoneClean ? (
              <a
                href={`tel:${phoneClean}`}
                className="sos-btn sos-btn--primary"
                style={{ textDecoration: 'none' }}
              >
                <Phone size={15} /> Call
              </a>
            ) : null}
            {lead && phoneClean ? (
              <a
                href={`https://wa.me/${phoneClean.replace('+', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="sos-btn sos-btn--secondary"
                style={{ textDecoration: 'none' }}
              >
                <MessageSquare size={15} /> WhatsApp
              </a>
            ) : null}
            {lead?.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="sos-btn sos-btn--ghost"
                style={{ textDecoration: 'none' }}
              >
                <AtSign size={15} /> Email
              </a>
            ) : null}
          </>
        }
        meta={
          <FollowUpStrip
            followUp={followUp}
            status={status}
            sla={sla}
            dueAt={dueAt}
            firstInitial={first ?? ''}
            lastInitial={last ?? ''}
          />
        }
      />

      <QuickActionRow
        onMarkDone={quickMarkDone}
        onNoResponse={quickNoResponse}
        onRescheduleHour={() => quickReschedule(1)}
        onRescheduleTomorrow={quickRescheduleTomorrow11}
        onReschedule24h={() => quickReschedule(24)}
        leadId={followUp.leadId}
      />

      <section
        style={{
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
        }}
        className="sos-detail-grid"
      >
        <GlassCard variant="strong" padded="lg" glow={isOverdue ? 'warm' : 'accent'}>
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
              <div className="sos-eyebrow">Update follow-up</div>
              <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
                Status, SLA, due time, and outcome
              </h2>
            </div>
            <StatusBadge tone={statusTone(status)} size="sm">
              {statusLabel(status)}
            </StatusBadge>
          </div>

          <div
            style={{
              marginTop: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            <Field label="Status" required hint="What happened on this touch?">
              <div
                style={{
                  display: 'grid',
                  gap: '8px',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                }}
              >
                {STATUSES.map((s) => (
                  <StatusPill
                    key={s}
                    active={status === s}
                    onClick={() => setStatus(s)}
                    label={statusLabel(s)}
                    tone={statusTone(s)}
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
              <Field label="SLA" hint="Auto-syncs with stage rules.">
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
                  {SLA_OPTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSla(s)}
                      aria-pressed={sla === s}
                      className="sos-tab"
                      style={{
                        flex: 1,
                        justifyContent: 'center',
                        textTransform: 'capitalize',
                      }}
                    >
                      {s.toLowerCase()}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Due time" required hint="Adjust if you reschedule.">
                <input
                  type="datetime-local"
                  className="sos-input"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                />
              </Field>
            </div>

            <Field
              label="Outcome / reason"
              hint="What did you tell them, what's the next move?"
            >
              <FormTextarea
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                placeholder="e.g. Client picked up, said they will pay tomorrow morning. Booked walk-in for 10:30 AM."
                style={{ minHeight: 140 }}
                inputSize="lg"
              />
              <div
                style={{
                  marginTop: '12px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                {OUTCOME_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setOutcome(outcome ? outcome + ' ' + p : p)}
                    style={{
                      padding: '7px 12px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '999px',
                      border: '1px solid var(--sos-border)',
                      background: 'var(--sos-surface-1)',
                      color: 'var(--sos-text-secondary)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'all 160ms ease',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = 'var(--sos-border-accent)';
                      e.currentTarget.style.color = 'var(--sos-brand-primary-strong)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = 'var(--sos-border)';
                      e.currentTarget.style.color = 'var(--sos-text-secondary)';
                    }}
                  >
                    + {p}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </GlassCard>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <OriginalScheduleCard followUp={followUp} />
          {otherFollowUps.length > 0 ? (
            <RelatedFollowUpsCard items={otherFollowUps.slice(0, 4)} />
          ) : null}
          <RemindersCard />
        </div>
      </section>

      <ActionBar
        left={
          dirty ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Clock4 size={14} style={{ color: 'var(--sos-status-warning)' }} />
              <span style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>
                Unsaved changes
              </span>
              <span className="sos-text-faint" style={{ fontSize: '12px' }}>
                Save to update the queue and notify finance if needed.
              </span>
            </span>
          ) : saveError ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <X size={14} style={{ color: 'var(--sos-status-danger)' }} />
              <span style={{ color: 'var(--sos-status-danger)', fontWeight: 600 }}>
                {saveError}
              </span>
            </span>
          ) : savedAt ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={14} style={{ color: 'var(--sos-status-success)' }} />
              <span style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>
                Saved {fmtRelativeToNow(savedAt.toISOString())}
              </span>
            </span>
          ) : (
            <span className="sos-text-muted" style={{ fontSize: '12.5px' }}>
              Update status, SLA, or outcome — your changes save together.
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
              {saving ? 'Saving…' : 'Save follow-up'}
            </PrimaryButton>
          </>
        }
      />
    </div>
  );
}

function FollowUpStrip({
  followUp,
  status,
  sla,
  dueAt,
  firstInitial,
  lastInitial,
}: {
  followUp: FollowUp;
  status: FollowUpStatus;
  sla: SlaStatus;
  dueAt: string;
  firstInitial: string;
  lastInitial: string;
}) {
  const isOverdue = status === 'OVERDUE';
  const dueIso = dueAt ? new Date(dueAt).toISOString() : followUp.dueAt;

  return (
    <div
      style={{
        display: 'grid',
        gap: '16px',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, auto)',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          flexWrap: 'wrap',
        }}
      >
        <div
          className="sos-avatar sos-avatar--lg"
          style={{
            background: isOverdue
              ? 'var(--sos-avatar-danger-gradient)'
              : 'var(--sos-brand-gradient)',
          }}
        >
          {initialsOf(firstInitial, lastInitial)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <StatusBadge tone={statusTone(status)}>{statusLabel(status)}</StatusBadge>
            <StatusBadge tone={slaTone(sla)}>SLA {sla.toLowerCase()}</StatusBadge>
            <StatusBadge tone="violet">
              <ChannelIcon channel={followUp.channel} size={11} />{' '}
              {followUp.channel.replace('_', ' ').toLowerCase()}
            </StatusBadge>
          </div>
          <div
            className="sos-text-secondary"
            style={{
              marginTop: '8px',
              fontSize: '13px',
              lineHeight: 1.55,
              maxWidth: '60ch',
            }}
          >
            {followUp.reason}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '14px 18px',
          borderRadius: 'var(--sos-radius-sm)',
          background: isOverdue
            ? 'var(--sos-status-danger-soft)'
            : 'var(--sos-surface-2)',
          border: isOverdue
            ? '1px solid var(--sos-status-danger-border)'
            : '1px solid var(--sos-border)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          minWidth: '220px',
        }}
      >
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '12px',
            display: 'grid',
            placeItems: 'center',
            background: isOverdue
              ? 'var(--sos-status-danger-soft)'
              : 'var(--sos-brand-primary-soft)',
            color: isOverdue
              ? 'var(--sos-status-danger)'
              : 'var(--sos-brand-primary-strong)',
            border: '1px solid '
              + (isOverdue
                ? 'var(--sos-status-danger-border)'
                : 'var(--sos-brand-primary-border)'),
            flexShrink: 0,
          }}
        >
          <Timer size={16} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            className="sos-text-faint"
            style={{
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {isOverdue ? 'Overdue by' : 'Due'}
          </div>
          <div
            style={{
              marginTop: '2px',
              fontSize: '15px',
              fontWeight: 700,
              color: isOverdue
                ? 'var(--sos-status-danger)'
                : 'var(--sos-text-primary)',
            }}
          >
            {fmtRelative(dueIso)}
          </div>
          <div
            className="sos-text-faint"
            style={{ marginTop: '2px', fontSize: '11.5px' }}
          >
            {fmtDateTime(dueIso)}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickActionRow({
  onMarkDone,
  onNoResponse,
  onRescheduleHour,
  onRescheduleTomorrow,
  onReschedule24h,
  leadId,
}: {
  onMarkDone: () => void;
  onNoResponse: () => void;
  onRescheduleHour: () => void;
  onRescheduleTomorrow: () => void;
  onReschedule24h: () => void;
  leadId: string;
}) {
  return (
    <GlassCard variant="default" padded="md">
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
          <div className="sos-eyebrow">Quick actions</div>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '12.5px' }}
          >
            One click sets status, SLA, and a sensible default outcome.
          </p>
        </div>
        <ButtonLink
          href={`/sales/leads/${leadId}` as Route}
          variant="primary"
          iconRight={<Send size={14} />}
        >
          Open lead
        </ButtonLink>
      </div>

      <div
        style={{
          marginTop: '16px',
          display: 'grid',
          gap: '10px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        }}
      >
        <QuickActionTile
          Icon={CheckCircle2}
          tone="var(--sos-status-success)"
          title="Mark done"
          caption="Status → Completed, SLA cleared"
          onClick={onMarkDone}
        />
        <QuickActionTile
          Icon={PhoneOff}
          tone="var(--sos-status-warning)"
          title="No response"
          caption="Will retry in 24 hours"
          onClick={onNoResponse}
        />
        <QuickActionTile
          Icon={RefreshCw}
          tone="var(--sos-status-info)"
          title="Reschedule +1h"
          caption="Push due time by an hour"
          onClick={onRescheduleHour}
        />
        <QuickActionTile
          Icon={CalendarClock}
          tone="var(--sos-status-violet)"
          title="Tomorrow 11 AM"
          caption="Standard morning reschedule slot"
          onClick={onRescheduleTomorrow}
        />
        <QuickActionTile
          Icon={Clock}
          tone="var(--sos-brand-accent)"
          title="In 24 hours"
          caption="Same time tomorrow"
          onClick={onReschedule24h}
        />
      </div>
    </GlassCard>
  );
}

function QuickActionTile({
  Icon,
  tone,
  title,
  caption,
  onClick,
}: {
  Icon: typeof Phone;
  tone: string;
  title: string;
  caption: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '14px',
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
          width: '36px',
          height: '36px',
          borderRadius: '11px',
          display: 'grid',
          placeItems: 'center',
          background: 'color-mix(in srgb, ' + tone + ' 18%, transparent)',
          color: tone,
          border: '1px solid color-mix(in srgb, ' + tone + ' 30%, transparent)',
          flexShrink: 0,
        }}
      >
        <Icon size={16} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--sos-text-primary)',
          }}
        >
          {title}
        </div>
        <div
          className="sos-text-muted"
          style={{ marginTop: '4px', fontSize: '11.5px', lineHeight: 1.5 }}
        >
          {caption}
        </div>
      </div>
    </button>
  );
}

function StatusPill({
  active,
  onClick,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone: BadgeTone;
}) {
  const colorMap: Record<BadgeTone, string> = {
    neutral: 'var(--sos-status-neutral)',
    accent: 'var(--sos-brand-primary-strong)',
    warm: 'var(--sos-brand-accent)',
    success: 'var(--sos-status-success)',
    warning: 'var(--sos-status-warning)',
    danger: 'var(--sos-status-danger)',
    info: 'var(--sos-status-info)',
    violet: 'var(--sos-status-violet)',
    cyan: 'var(--sos-status-cyan)',
    pink: 'var(--sos-status-pink)',
  };
  const dot = colorMap[tone];

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
          boxShadow: active
            ? `0 0 0 3px color-mix(in srgb, ${dot} 22%, transparent)`
            : 'none',
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
        {label}
      </span>
      {active ? <Check size={13} style={{ color: dot }} /> : null}
    </button>
  );
}

function OriginalScheduleCard({ followUp }: { followUp: FollowUp }) {
  return (
    <GlassCard variant="default" padded="md">
      <div className="sos-eyebrow">Original schedule</div>
      <div
        style={{
          marginTop: '14px',
          display: 'grid',
          gap: '10px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        }}
      >
        <Mini label="Originally due" value={fmtDateTime(followUp.dueAt)} />
        <Mini label="Type" value={FOLLOWUP_TYPE_LABEL[followUp.type]} />
        <Mini
          label="Channel"
          value={followUp.channel.replace('_', ' ').toLowerCase()}
        />
        <Mini label="Linked stage" value={STAGE_LABEL[followUp.linkedStage]} />
      </div>
    </GlassCard>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
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
          color: 'var(--sos-text-primary)',
          textTransform: 'capitalize',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </div>
    </div>
  );
}


function RelatedFollowUpsCard({ items }: { items: FollowUp[] }) {
  return (
    <GlassCard variant="default" padded="md">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <div>
          <div className="sos-eyebrow">Related follow-ups</div>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '12px' }}
          >
            Other touches on this lead.
          </p>
        </div>
        <History size={14} style={{ color: 'var(--sos-text-faint)' }} />
      </div>
      <div
        style={{
          marginTop: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {items.map((f) => (
          <Link
            key={f.id}
            href={`/sales/follow-ups/${f.id}` as Route}
            style={{ textDecoration: 'none' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
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
                  width: '28px',
                  height: '28px',
                  borderRadius: '9px',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--sos-surface-3)',
                  color: 'var(--sos-text-muted)',
                  border: '1px solid var(--sos-border-subtle)',
                  flexShrink: 0,
                }}
              >
                <ChannelIcon channel={f.channel} size={12} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
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
                  {f.reason}
                </div>
                <div
                  className="sos-text-faint"
                  style={{ fontSize: '11px', marginTop: '2px' }}
                >
                  {fmtRelative(f.dueAt)}
                </div>
              </div>
              <StatusBadge tone={statusTone(f.status)} size="sm">
                {statusLabel(f.status)}
              </StatusBadge>
            </div>
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}

function RemindersCard() {
  return (
    <GlassCard variant="soft" padded="md">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '10px',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--sos-brand-accent-soft)',
            color: 'var(--sos-brand-accent)',
            border: '1px solid var(--sos-brand-accent-border)',
            flexShrink: 0,
          }}
        >
          <Bell size={14} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="sos-eyebrow">Reminder rules</div>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '12px', lineHeight: 1.55 }}
          >
            Saving as <strong>Rescheduled</strong> queues a fresh reminder one hour before
            the new due time. Marking <strong>Done</strong> clears all alerts for this
            touch.
          </p>
        </div>
      </div>
    </GlassCard>
  );
}

