'use client';
// Finance Dashboard — Phase 1 / Screen 1 of 7.
// What finance officer sees when they sign in: today's verification queue,
// problem pile, collection summary, and one-click jump to active queues.

import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Inbox,
  MessageSquareWarning,
  Receipt,
  Send,
  Wallet,
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
  MOCK_FINANCE_USER,
  METHOD_LABEL,
  STATUS_LABEL,
  collectedToday,
  countByStatus,
  countMine,
  fmtAmount,
  fmtRelative,
  initialsOf,
  myActiveQueue,
  problemPile,
  readyForProcessingCount,
  verifiedTodayCount,
  type PaymentRecord,
  type PaymentStatus,
} from '@/components/finance-v1/mockData';

function statusTone(status: PaymentStatus): BadgeTone {
  switch (status) {
    case 'NEW_FROM_SALES':
      return 'info';
    case 'UNDER_VERIFICATION':
      return 'cyan';
    case 'ON_HOLD':
      return 'neutral';
    case 'CORRECTION_REQUIRED':
      return 'warning';
    case 'REJECTED':
      return 'danger';
    case 'AWAITING_BALANCE':
      return 'warm';
    case 'VERIFIED':
    case 'RECEIPT_CONFIRMED':
      return 'success';
    case 'SENT_TO_PROCESSING':
      return 'violet';
    default:
      return 'neutral';
  }
}

function slaTone(status: PaymentRecord['slaStatus']): BadgeTone {
  if (status === 'BREACHED') return 'danger';
  if (status === 'APPROACHING') return 'warning';
  if (status === 'CLEARED') return 'success';
  return 'info';
}

export function FinanceDashboardPage() {
  const newFromSales = countByStatus('NEW_FROM_SALES');
  const underVerificationMine = countMine('UNDER_VERIFICATION');
  const awaitingBalance = countByStatus('AWAITING_BALANCE');
  const correctionRequired = countByStatus('CORRECTION_REQUIRED');
  const readyForProcessing = readyForProcessingCount();
  const collected = collectedToday();
  const verifiedToday = verifiedTodayCount();
  const queue = myActiveQueue();
  const problems = problemPile();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow={`Finance · ${MOCK_FINANCE_USER.name}'s queue`}
        title={
          <>
            Keep verifications honest,<br />on time, and audited.
          </>
        }
        description={
          <>
            {newFromSales} fresh cases from Sales waiting for a claim ·{' '}
            {underVerificationMine} in your active review · {readyForProcessing} ready to
            ship to Processing · {fmtAmount(collected.amount, collected.currency)} collected
            today across {verifiedToday} verified payments.
          </>
        }
        actions={
          <>
            <ButtonLink
              href={'/finance/intake' as Route}
              variant="primary"
              iconLeft={<Inbox size={15} />}
            >
              Open intake queue
            </ButtonLink>
            <ButtonLink
              href={'/finance/corrections' as Route}
              variant="secondary"
              iconLeft={<MessageSquareWarning size={15} />}
            >
              Corrections ({correctionRequired})
            </ButtonLink>
            <ButtonLink
              href={'/finance/handover' as Route}
              variant="ghost"
              iconRight={<ArrowRight size={14} />}
            >
              Send to Processing
            </ButtonLink>
          </>
        }
      />

      {/* KPI strip — 6 tiles (per spec §5.1) */}
      <section
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <MetricCard
          label="New from Sales"
          value={newFromSales}
          hint="Waiting to be claimed"
          tone="accent"
          Icon={Inbox}
          footer="Claim to start verification"
        />
        <MetricCard
          label="Under verification"
          value={underVerificationMine}
          hint="In your active review"
          tone="info"
          Icon={Clock}
          footer="Resume from where you left off"
        />
        <MetricCard
          label="Awaiting balance"
          value={awaitingBalance}
          hint="Deposit verified, balance owed"
          tone="warm"
          Icon={Wallet}
          footer="Sales is chasing the rest"
        />
        <MetricCard
          label="Correction required"
          value={correctionRequired}
          hint="Sent back to Sales"
          tone={correctionRequired > 0 ? 'warning' : 'success'}
          Icon={MessageSquareWarning}
          footer={
            correctionRequired > 0
              ? 'Sales is fixing — re-enter when resubmitted'
              : 'No pending corrections'
          }
        />
        <MetricCard
          label="Ready for processing"
          value={readyForProcessing}
          hint="Verified + receipted"
          tone="success"
          Icon={Send}
          footer={
            readyForProcessing > 0
              ? 'Hand over to Processing'
              : 'Queue clear'
          }
        />
        <MetricCard
          label="Collected today"
          value={fmtAmount(collected.amount, collected.currency)}
          hint={`${verifiedToday} verified payments`}
          tone="warm"
          Icon={Receipt}
          footer="Base currency total"
        />
      </section>

      {/* Two-column body: my queue + problem pile */}
      <section
        style={{
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
        }}
        className="sos-detail-grid"
      >
        <MyQueueCard items={queue} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <ProblemPileCard items={problems} />
          <CollectionSummaryCard collected={collected.amount} verified={verifiedToday} />
        </div>
      </section>
    </div>
  );
}

// ---------- My queue ----------------------------------------------------

function MyQueueCard({ items }: { items: PaymentRecord[] }) {
  return (
    <GlassCard variant="strong" padded="lg" glow="accent">
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
          <div className="sos-eyebrow">My verification queue</div>
          <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
            Sorted by SLA — most urgent first
          </h2>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '13px' }}
          >
            New cases from Sales and ones you've already started reviewing.
          </p>
        </div>
        <ButtonLink
          href={'/finance/intake' as Route}
          variant="ghost"
          size="sm"
          iconRight={<ArrowRight size={13} />}
        >
          Open full queue
        </ButtonLink>
      </div>

      {items.length === 0 ? (
        <EmptyInline
          Icon={CheckCircle2}
          title="No cases waiting"
          caption="When Sales hands over the next case, it'll show up here."
        />
      ) : (
        <div
          style={{
            marginTop: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {items.slice(0, 6).map((p) => (
            <QueueRow key={p.id} item={p} />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function QueueRow({ item }: { item: PaymentRecord }) {
  const initials = initialsOf(item.clientName);
  return (
    <Link
      href={`/finance/intake/${item.id}` as Route}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
          gap: '14px',
          alignItems: 'center',
          padding: '12px 14px',
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
        <div className="sos-avatar" aria-hidden>
          {initials}
        </div>

        <div style={{ minWidth: 0 }}>
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
                fontWeight: 700,
                color: 'var(--sos-text-primary)',
              }}
            >
              {item.clientName}
            </span>
            <StatusBadge tone={statusTone(item.status)} size="sm">
              {STATUS_LABEL[item.status]}
            </StatusBadge>
            {item.priority === 'URGENT' ? (
              <StatusBadge tone="danger" size="sm">
                Urgent
              </StatusBadge>
            ) : null}
          </div>
          <div
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '12px' }}
          >
            {fmtAmount(item.receivedAmount, item.currency)} ·{' '}
            {METHOD_LABEL[item.paymentMethod]} · from {item.salesUserName}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div
            className="sos-text-faint"
            style={{
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            SLA
          </div>
          <div
            style={{
              marginTop: '2px',
              fontSize: '12.5px',
              fontWeight: 700,
              color:
                item.slaStatus === 'BREACHED'
                  ? 'var(--sos-status-danger)'
                  : item.slaStatus === 'APPROACHING'
                    ? 'var(--sos-status-warning)'
                    : 'var(--sos-text-primary)',
            }}
          >
            {fmtRelative(item.slaDueAt)}
          </div>
        </div>

        <ArrowRight size={14} style={{ color: 'var(--sos-text-faint)' }} />
      </div>
    </Link>
  );
}

// ---------- Problem pile -------------------------------------------------

function ProblemPileCard({ items }: { items: PaymentRecord[] }) {
  return (
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
          <div className="sos-eyebrow">Problem pile</div>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '12.5px' }}
          >
            Corrections, rejections, on-hold, and SLA breaches.
          </p>
        </div>
        <StatusBadge tone={items.length > 0 ? 'warning' : 'success'} size="sm">
          {items.length}
        </StatusBadge>
      </div>

      {items.length === 0 ? (
        <EmptyInline
          Icon={CheckCircle2}
          title="All clear"
          caption="No problem cases right now."
        />
      ) : (
        <div
          style={{
            marginTop: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {items.slice(0, 4).map((p) => (
            <Link
              key={p.id}
              href={`/finance/intake/${p.id}` as Route}
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
                    width: '30px',
                    height: '30px',
                    borderRadius: '10px',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--sos-status-warning-soft)',
                    color: 'var(--sos-status-warning)',
                    border: '1px solid var(--sos-status-warning-border)',
                    flexShrink: 0,
                  }}
                >
                  <AlertCircle size={14} />
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
                    {p.clientName}
                  </div>
                  <div
                    className="sos-text-faint"
                    style={{ marginTop: '2px', fontSize: '11px' }}
                  >
                    {p.correctionLastReason ?? STATUS_LABEL[p.status]}
                  </div>
                </div>
                <StatusBadge tone={slaTone(p.slaStatus)} size="sm">
                  {p.slaStatus === 'BREACHED' ? 'Breached' : fmtRelative(p.slaDueAt)}
                </StatusBadge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

// ---------- Collection summary ------------------------------------------

function CollectionSummaryCard({
  collected,
  verified,
}: {
  collected: number;
  verified: number;
}) {
  return (
    <GlassCard variant="strong" padded="lg" glow="warm">
      <div className="sos-eyebrow">Today's collection</div>

      <div
        style={{
          marginTop: '14px',
          padding: '18px',
          borderRadius: 'var(--sos-radius-card)',
          background: 'var(--sos-brand-accent-soft)',
          border: '1px solid var(--sos-brand-accent-border)',
        }}
      >
        <div
          className="sos-text-faint"
          style={{
            fontSize: '10.5px',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Verified amount (base)
        </div>
        <div
          className="sos-display"
          style={{
            marginTop: '6px',
            fontSize: '28px',
            color: 'var(--sos-text-primary)',
            letterSpacing: '-0.02em',
          }}
        >
          {fmtAmount(collected, 'CAD')}
        </div>
        <div
          className="sos-text-secondary"
          style={{ marginTop: '4px', fontSize: '12.5px' }}
        >
          {verified} verified payments across all branches
        </div>
      </div>

      <div
        style={{
          marginTop: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <ChannelRow label="Cash" amount={3300} pct={35} />
        <ChannelRow label="Bank transfer" amount={4400} pct={47} />
        <ChannelRow label="Card" amount={800} pct={9} />
        <ChannelRow label="Wire" amount={0} pct={0} />
      </div>

      <p
        className="sos-text-muted"
        style={{ marginTop: '14px', fontSize: '11.5px', lineHeight: 1.55 }}
      >
        Running total of payments verified today, grouped by collection channel
        for daily finance review.
      </p>
    </GlassCard>
  );
}

function ChannelRow({
  label,
  amount,
  pct,
}: {
  label: string;
  amount: number;
  pct: number;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: '10px',
      }}
    >
      <span
        className="sos-text-muted"
        style={{ fontSize: '12px', fontWeight: 600 }}
      >
        {label}
      </span>
      <div
        style={{
          height: '6px',
          borderRadius: '999px',
          background: 'var(--sos-surface-progress-track)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: pct + '%',
            height: '100%',
            background: 'var(--sos-brand-gradient)',
          }}
        />
      </div>
      <span
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--sos-text-primary)',
          minWidth: '70px',
          textAlign: 'right',
        }}
      >
        {fmtAmount(amount, 'CAD')}
      </span>
    </div>
  );
}

// ---------- Empty state helper ------------------------------------------

function EmptyInline({
  Icon,
  title,
  caption,
}: {
  Icon: typeof Inbox;
  title: string;
  caption: string;
}) {
  return (
    <div
      style={{
        marginTop: '14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '24px 16px',
        gap: '10px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px dashed var(--sos-border)',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '12px',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--sos-status-success-soft)',
          color: 'var(--sos-status-success)',
          border: '1px solid var(--sos-status-success-border)',
        }}
      >
        <Icon size={18} />
      </div>
      <div
        style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--sos-text-primary)' }}
      >
        {title}
      </div>
      <div className="sos-text-muted" style={{ fontSize: '12px', maxWidth: '40ch' }}>
        {caption}
      </div>
    </div>
  );
}
