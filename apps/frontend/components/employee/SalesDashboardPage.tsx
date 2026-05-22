'use client';

import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Loader2,
  PhoneCall,
  Plus,
  Sparkles,
  TimerReset,
  Users,
  Wallet,
} from 'lucide-react';
import { useEmployeeSession } from '@/components/layout/EmployeeShell';
import {
  STAGE_LABEL,
  fmtDayOfMonth,
  fmtLongDate,
  fmtMonthShort,
  fmtTimeOnly,
  fmtRelative,
  initialsOf,
  stageDotColor,
  APPT_TYPE_LABEL,
  type LeadStage,
  type Lead,
  type FollowUp,
  type Appointment,
} from '@/components/sales-v2/mockData';
import {
  ButtonLink,
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { fetchLeads, fetchFollowUps, fetchAppointments } from '@/lib/sales-api';
import { getThreadStats, type ThreadStats } from '@/lib/whatsapp';
import { useEffect, useState } from 'react';

type StageKey = LeadStage;

const PIPELINE_STAGES: Array<{ key: StageKey; label: string }> = [
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'MEETING_NEEDED', label: 'Meeting Needed' },
  { key: 'APPOINTMENT_BOOKED', label: 'Appt Booked' },
  { key: 'PAYMENT_INTERESTED', label: 'Payment' },
  { key: 'SENT_TO_FINANCE', label: 'Sent to Finance' },
];

function appointmentTone(status: string): BadgeTone {
  // Map old class names to new badge tones — keeps mock data unchanged.
  if (status === 'BOOKED' || status === 'CONFIRMED') return 'success';
  if (status === 'PENDING' || status === 'RESCHEDULED') return 'warning';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'danger';
  if (status === 'COMPLETED') return 'info';
  return 'neutral';
}

function stageBadgeTone(stage: StageKey): BadgeTone {
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

export function SalesDashboardPage() {
  const { user } = useEmployeeSession();
  const firstName = user.email.split('@')[0] ?? 'there';

  const [leads, setLeads] = useState<Lead[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [slaStats, setSlaStats] = useState<ThreadStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchLeads(),
      fetchFollowUps(),
      fetchAppointments(),
      getThreadStats().catch(() => null),
    ]).then(([l, f, a, s]) => {
      setLeads(l);
      setFollowUps(f);
      setAppointments(a);
      setSlaStats(s);
    }).finally(() => setLoading(false));
  }, []);

  const activeLeads = leads.filter((l) => !['SENT_TO_FINANCE'].includes(l.stage));
  const adminAssigned = leads.filter((l) => l.assignmentType === 'ADMIN').length;
  const autoAssigned = leads.filter((l) => l.assignmentType === 'AUTO_CRM').length;
  const overdue = leads.filter((l) => l.slaStatus === 'OVERDUE').length;

  const dueToday = followUps.filter((f) => f.status === 'DUE_TODAY').length;
  const followOverdue = followUps.filter((f) => f.status === 'OVERDUE').length;
  // Real Response-SLA picture (pause-on-customer) from the WhatsApp engine.
  // slaScore starts at 100 with no history, so the ring reads full until a
  // breach actually happens.
  const slaScore = slaStats?.slaScore ?? 100;
  const slaAwaiting = slaStats?.awaitingReply ?? 0;
  const slaApproaching = slaStats?.approaching ?? 0;
  const slaOverdue = slaStats?.overdue ?? 0;
  const handovers = leads.filter((l) => l.stage === 'SENT_TO_FINANCE').length;

  const upcomingAppointments = appointments
    .filter((a) => a.status === 'BOOKED' || a.status === 'PENDING')
    .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))
    .slice(0, 4);

  const recentLeads = [...leads]
    .sort((a, b) => +new Date(b.assignedAt) - +new Date(a.assignedAt))
    .slice(0, 5);

  const totalPipeline = leads.length;
  const pipeline = PIPELINE_STAGES.map((s) => {
    const count = leads.filter((l) => l.stage === s.key).length;
    return {
      ...s,
      count,
      pct: Math.round((count / Math.max(1, totalPipeline)) * 100),
    };
  });

  const focusRows: Array<{ label: string; note: string; value: number; tone: string }> = [
    {
      label: 'Calls and WhatsApp due',
      note: 'Reach out before clients cool off',
      value: dueToday,
      tone: 'var(--sos-brand-accent)',
    },
    {
      label: 'Overdue follow-ups',
      note: 'Highest-risk queue right now',
      value: followOverdue,
      tone: 'var(--sos-status-danger)',
    },
    {
      label: 'Meetings scheduled',
      note: 'Booked consultations on calendar',
      value: upcomingAppointments.length,
      tone: 'var(--sos-brand-primary-strong)',
    },
    {
      label: 'Sent to finance',
      note: 'Receipts waiting for verification',
      value: handovers,
      tone: 'var(--sos-status-success)',
    },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: '10px', color: 'var(--sos-text-muted)' }}>
        <Loader2 size={20} className="sos-spin" />
        <span>Loading dashboard…</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Hero */}
      <PageHeader
        eyebrow={`${fmtLongDate(new Date().toISOString())} · ${firstName}'s queue`}
        title={<>Keep today&rsquo;s lead queue calm, fast, and under control.</>}
        description={
          <>
            {activeLeads.length} active leads are moving right now. {dueToday} follow-ups need a touch
            today, {followOverdue} are outside the SLA window, and {upcomingAppointments.length}{' '}
            appointments are already locked in.
          </>
        }
        actions={
          <>
            <ButtonLink
              href={'/sales/create-lead' as Route}
              variant="primary"
              iconLeft={<Plus size={16} />}
            >
              Create Lead
            </ButtonLink>
            <ButtonLink
              href={'/sales/leads' as Route}
              variant="secondary"
              iconRight={<ArrowRight size={15} />}
            >
              Open queue
            </ButtonLink>
            <ButtonLink
              href={'/sales/follow-ups' as Route}
              variant="ghost"
              iconLeft={<PhoneCall size={15} />}
            >
              Follow-ups ({dueToday})
            </ButtonLink>
          </>
        }
        meta={
          <div
            style={{
              display: 'grid',
              gap: '12px',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            }}
          >
            <FocusChip label="Active queue" value={activeLeads.length} tone="var(--sos-brand-primary-strong)" />
            <FocusChip label="Touches due today" value={dueToday} tone="var(--sos-brand-accent)" />
            <FocusChip label="Finance-ready" value={handovers} tone="var(--sos-status-success)" />
            <FocusChip label="SLA overdue" value={overdue} tone="var(--sos-status-danger)" />
          </div>
        }
      />

      {/* KPIs */}
      <section
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <MetricCard
          label="Admin assigned"
          value={adminAssigned}
          hint="Manually routed by admin"
          delta="+3 today"
          tone="info"
          Icon={Users}
          footer="Priority queue from the front desk"
        />
        <MetricCard
          label="Auto-CRM assigned"
          value={autoAssigned}
          hint="Social media & website inflow"
          delta="+5 today"
          tone="accent"
          Icon={Sparkles}
          footer="Fresh inbound demand from digital channels"
        />
        <MetricCard
          label="SLA overdue"
          value={overdue}
          hint="Needs immediate attention"
          delta={overdue > 0 ? `${overdue} now` : 'All clear'}
          tone={overdue > 0 ? 'danger' : 'success'}
          Icon={CircleAlert}
          footer={
            overdue > 0
              ? 'Bring this queue back inside the response window'
              : 'All touches are still on schedule'
          }
        />
        <MetricCard
          label="Ready for finance"
          value={handovers}
          hint="Cases handed over today"
          delta="+1 today"
          tone="warm"
          Icon={Wallet}
          footer="Payment-ready leads waiting for verification"
        />
      </section>

      {/* Today focus + Pipeline */}
      <section
        style={{
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
        }}
        className="sos-dashboard-grid"
      >
        {/* Pipeline */}
        <GlassCard variant="strong" padded="lg" glow="accent">
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              marginBottom: '20px',
            }}
          >
            <div>
              <div className="sos-eyebrow">Pipeline</div>
              <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
                Lead stage distribution
              </h2>
            </div>
            <ButtonLink
              href={'/sales/leads' as Route}
              variant="ghost"
              size="sm"
              iconRight={<ArrowUpRight size={13} />}
            >
              View leads
            </ButtonLink>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {pipeline.map((s) => (
              <div key={s.key}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '999px',
                        background: stageDotColor(s.key),
                      }}
                    />
                    <span
                      style={{
                        fontSize: '13.5px',
                        fontWeight: 600,
                        color: 'var(--sos-text-primary)',
                      }}
                    >
                      {s.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '12px', color: 'var(--sos-text-faint)' }}>{s.pct}%</span>
                    <span
                      style={{
                        fontSize: '14.5px',
                        fontWeight: 700,
                        color: 'var(--sos-text-primary)',
                      }}
                    >
                      {s.count}
                    </span>
                  </div>
                </div>
                <div className="sos-progress" style={{ marginTop: '8px' }}>
                  <div
                    className="sos-progress__fill"
                    style={{
                      width: `${Math.max(4, s.pct)}%`,
                      background: stageDotColor(s.key),
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Today focus */}
        <GlassCard variant="default" padded="lg" glow="warm">
          <div className="sos-eyebrow">Today&rsquo;s focus</div>
          <h2 className="sos-display" style={{ fontSize: '1.6rem', marginTop: '8px', maxWidth: '20ch' }}>
            Protect first response and keep meetings moving.
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
            {focusRows.map((row) => (
              <div
                key={row.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '14px',
                  padding: '12px 16px',
                  borderRadius: 'var(--sos-radius-sm)',
                  background: 'var(--sos-surface-2)',
                  border: '1px solid var(--sos-border-subtle)',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--sos-text-primary)',
                    }}
                  >
                    {row.label}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>
                    {row.note}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '1.4rem',
                    fontWeight: 700,
                    letterSpacing: '-0.04em',
                    color: row.tone,
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
      </section>

      {/* Upcoming appointments + SLA */}
      <section
        style={{
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
        }}
        className="sos-dashboard-grid"
      >
        <GlassCard variant="default" padded={false}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '20px 24px',
              borderBottom: '1px solid var(--sos-divider)',
            }}
          >
            <div>
              <div className="sos-eyebrow">Assigned queue</div>
              <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
                Recent leads
              </h2>
            </div>
            <ButtonLink
              href={'/sales/leads' as Route}
              variant="ghost"
              size="sm"
              iconRight={<ArrowUpRight size={13} />}
            >
              View all
            </ButtonLink>
          </div>
          <div>
            {recentLeads.map((lead, idx) => (
              <Link
                key={lead.id}
                href={`/sales/leads/${lead.id}` as Route}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '16px 24px',
                  borderTop: idx === 0 ? 'none' : '1px solid var(--sos-divider)',
                  transition: 'background 160ms ease',
                  textDecoration: 'none',
                }}
                className="sos-recent-row"
              >
                <div
                  className="sos-avatar"
                  style={{
                    background: `linear-gradient(135deg, ${stageDotColor(lead.stage)}, var(--sos-brand-deep))`,
                  }}
                >
                  {initialsOf(lead.firstName, lead.lastName)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: 'var(--sos-text-primary)',
                      }}
                    >
                      {lead.firstName} {lead.lastName}
                    </span>
                    <StatusBadge tone={stageBadgeTone(lead.stage)} size="sm">
                      {STAGE_LABEL[lead.stage]}
                    </StatusBadge>
                    {lead.slaStatus === 'OVERDUE' ? (
                      <StatusBadge tone="danger" size="sm">SLA overdue</StatusBadge>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: '12.5px',
                      color: 'var(--sos-text-muted)',
                      marginTop: '4px',
                    }}
                  >
                    {lead.service} · {lead.targetCountry} · {lead.phone}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }} className="sos-desktop-only">
                  <div
                    style={{
                      fontSize: '10.5px',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--sos-text-faint)',
                      fontWeight: 600,
                    }}
                  >
                    Assigned
                  </div>
                  <div
                    style={{
                      fontSize: '12.5px',
                      fontWeight: 600,
                      color: 'var(--sos-text-secondary)',
                    }}
                  >
                    {fmtRelative(lead.assignedAt)}
                  </div>
                </div>
                <ChevronRight size={15} style={{ color: 'var(--sos-text-faint)' }} />
              </Link>
            ))}
          </div>
        </GlassCard>

        {/* SLA panel — real Response-SLA (reply within 5 min while it's your
            turn). The ring is the agent's on-time score; the rows are the
            live "needs a reply" picture. */}
        <GlassCard variant="strong" padded="lg">
          <div className="sos-eyebrow">SLA Watch</div>
          <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
            Your response score
          </h2>

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginTop: '20px' }}>
            <div
              style={{
                position: 'relative',
                display: 'grid',
                placeItems: 'center',
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                background: `conic-gradient(${slaScore >= 90 ? 'var(--sos-status-success)' : slaScore >= 70 ? 'var(--sos-status-warning)' : 'var(--sos-status-danger)'} 0 ${slaScore}%, var(--sos-surface-progress-track) ${slaScore}% 100%)`,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: '92px',
                  height: '92px',
                  borderRadius: '999px',
                  background: 'var(--sos-bg-elevated)',
                  border: '1px solid var(--sos-border)',
                }}
              >
                <div
                  style={{
                    fontSize: '22px',
                    fontWeight: 700,
                    color: 'var(--sos-text-primary)',
                  }}
                >
                  {slaScore}%
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--sos-text-faint)',
                    fontWeight: 600,
                  }}
                >
                  on time
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                fontSize: '12.5px',
                flex: 1,
                minWidth: 0,
              }}
            >
              <SlaRow Icon={CheckCircle2} tone="var(--sos-status-success)" label="Awaiting your reply" value={slaAwaiting} />
              <SlaRow Icon={TimerReset} tone="var(--sos-status-warning)" label="Approaching breach" value={slaApproaching} />
              <SlaRow Icon={CircleAlert} tone="var(--sos-status-danger)" label="Overdue now" value={slaOverdue} />
            </div>
          </div>

          <div
            style={{
              marginTop: '20px',
              padding: '14px',
              borderRadius: 'var(--sos-radius-sm)',
              background: slaOverdue > 0 ? 'var(--sos-status-danger-soft)' : 'var(--sos-surface-2)',
              border: `1px solid ${slaOverdue > 0 ? 'var(--sos-status-danger-border, rgba(239,68,68,0.35))' : 'var(--sos-border-subtle)'}`,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
            }}
          >
            <Sparkles
              size={14}
              style={{
                color: slaOverdue > 0 ? 'var(--sos-status-danger)' : 'var(--sos-brand-primary-strong)',
                marginTop: 3,
                flexShrink: 0,
              }}
            />
            <div style={{ fontSize: '12.5px', color: 'var(--sos-text-muted)', lineHeight: 1.55 }}>
              {slaOverdue > 0 ? (
                <>
                  <strong style={{ color: 'var(--sos-status-danger)' }}>Reply now —</strong>{' '}
                  you have {slaOverdue} conversation{slaOverdue === 1 ? '' : 's'} past the 5-minute SLA. Leads are reassigned after 10 SLA breaches.
                </>
              ) : (
                <>
                  <strong style={{ color: 'var(--sos-text-primary)' }}>Tip:</strong>{' '}
                  Reply within 5 minutes while it&apos;s your turn — keep your score at 100. Leads are reassigned after 10 SLA breaches.
                </>
              )}
            </div>
          </div>
        </GlassCard>
      </section>

      {/* Upcoming appointments */}
      <GlassCard variant="default" padded="lg">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div>
            <div className="sos-eyebrow">Schedule</div>
            <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
              Upcoming appointments
            </h2>
          </div>
          <ButtonLink
            href={'/sales/appointments' as Route}
            variant="ghost"
            size="sm"
            iconRight={<ArrowUpRight size={13} />}
          >
            All appointments
          </ButtonLink>
        </div>

        {upcomingAppointments.length === 0 ? (
          <div className="sos-banner">No appointments scheduled.</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gap: '12px',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            }}
          >
            {upcomingAppointments.map((a) => (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '14px 16px',
                  borderRadius: 'var(--sos-radius-sm)',
                  background: 'var(--sos-surface-2)',
                  border: '1px solid var(--sos-border-subtle)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 12px',
                    borderRadius: 'var(--sos-radius-input)',
                    background: 'var(--sos-brand-primary-soft)',
                    color: 'var(--sos-brand-primary-strong)',
                    border: '1px solid var(--sos-brand-primary-border)',
                    minWidth: '60px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {fmtMonthShort(a.scheduledAt)}
                  </span>
                  <span style={{ fontSize: '20px', fontWeight: 700 }}>
                    {fmtDayOfMonth(a.scheduledAt)}
                  </span>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontSize: '13.5px',
                        fontWeight: 600,
                        color: 'var(--sos-text-primary)',
                      }}
                    >
                      {a.clientName}
                    </span>
                    <StatusBadge tone={appointmentTone(a.status)} size="sm">
                      {a.status}
                    </StatusBadge>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '6px',
                      fontSize: '12px',
                      color: 'var(--sos-text-muted)',
                    }}
                  >
                    <CalendarClock size={13} />
                    <span>
                      {APPT_TYPE_LABEL[a.type]} · {fmtTimeOnly(a.scheduledAt)} · {a.durationMin}m
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <style>{`
        .sos-recent-row:hover {
          background: var(--sos-surface-2);
        }
        @media (max-width: 1100px) {
          .sos-dashboard-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
        }
        @media (max-width: 720px) {
          .sos-desktop-only { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function FocusChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="sos-stat-chip">
      <div className="sos-stat-chip__label">{label}</div>
      <div className="sos-stat-chip__value" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}

function SlaRow({
  Icon,
  tone,
  label,
  value,
}: {
  Icon: typeof CircleAlert;
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <Icon size={14} style={{ color: tone }} />
        <span style={{ color: 'var(--sos-text-muted)' }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--sos-text-primary)' }}>
        {value}
      </span>
    </div>
  );
}
