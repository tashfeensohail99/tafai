'use client';
// Finance Dashboard.
// What a finance officer sees on sign-in: today's verification queue,
// problem pile, collection summary, and one-click jumps to active queues.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  Receipt,
  Send,
  Wallet,
} from 'lucide-react';
import { fetchAgreementReviewCounts } from '@/lib/agreements';
import {
  ButtonLink,
  GlassCard,
  MetricCard,
  PageHeader,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  fetchHandovers,
  fetchRevenueByService,
  fmtAmount,
  fmtRelative,
  clientName,
  STATUS_LABEL,
  METHOD_LABEL,
  type ApiHandover,
  type FinanceHandoverStatus,
  type ApiRevenueByService,
} from '@/lib/finance-api';
import { useSession } from '@/lib/session';

function statusTone(status: FinanceHandoverStatus): BadgeTone {
  switch (status) {
    case 'SUBMITTED':
      return 'info';
    case 'IN_REVIEW':
      return 'cyan';
    case 'PAYMENT_RECORDED':
      return 'warm';
    case 'REJECTED':
      return 'warning';
    case 'PAYMENT_VERIFIED':
      return 'success';
    case 'SENT_TO_PROCESSING':
      return 'violet';
    case 'CANCELLED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function FinanceDashboardPage() {
  const session = useSession();
  const [handovers, setHandovers] = useState<ApiHandover[]>([]);
  const [revenue, setRevenue] = useState<ApiRevenueByService | null>(null);
  const [agreementsToReview, setAgreementsToReview] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchHandovers(),
      fetchRevenueByService(),
      fetchAgreementReviewCounts().catch(() => ({ financeToReview: 0, salesChangesRequested: 0 })),
    ])
      .then(([h, r, c]) => {
        setHandovers(h);
        setRevenue(r);
        setAgreementsToReview(c.financeToReview);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const userId = session.status === 'authed' ? session.user.id : null;
  const newFromSales = handovers.filter((h) => h.status === 'SUBMITTED').length;
  const underVerificationMine = handovers.filter(
    (h) => h.status === 'IN_REVIEW' && h.reviewedByUserId === userId,
  ).length;
  const readyForProcessing = handovers.filter((h) => h.status === 'PAYMENT_VERIFIED').length;
  const collectedAllTime = revenue?.totals.allTime ?? 0;
  const verifiedCount = handovers.filter((h) => h.status === 'PAYMENT_VERIFIED' || h.status === 'SENT_TO_PROCESSING').length;
  const queue = handovers
    .filter((h) => h.status === 'SUBMITTED' || h.status === 'IN_REVIEW')
    .slice(0, 6);
  const problems = handovers.filter(
    (h) => h.status === 'REJECTED' || h.status === 'CANCELLED',
  );

  if (loading) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--sos-text-muted)' }}>
        Loading finance dashboard…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="Finance · verification queue"
        title={<>Keep verifications honest, on time, and audited.</>}
        description={
          <>
            {newFromSales} fresh cases from Sales waiting for a claim ·{' '}
            {underVerificationMine} in your active review · {readyForProcessing} ready to
            ship to Processing · {fmtAmount(collectedAllTime, 'CAD')} collected
            all time across {verifiedCount} verified payments.
          </>
        }
        actions={
          <>
            <ButtonLink
              href={'/finance/clients' as Route}
              variant="primary"
              iconLeft={<Inbox size={15} />}
            >
              Customers
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
          label="Agreements to review"
          value={agreementsToReview}
          hint="Submitted by Sales"
          tone={agreementsToReview > 0 ? 'warm' : 'success'}
          Icon={FileText}
          footer={
            <Link href={'/finance/agreements' as Route} style={{ color: 'var(--sos-brand-accent)', fontWeight: 600, textDecoration: 'none' }}>
              Review &amp; approve →
            </Link>
          }
        />
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
          value={handovers.filter((h) => h.status === 'PAYMENT_RECORDED').length}
          hint="Deposit recorded, awaiting verification"
          tone="warm"
          Icon={Wallet}
          footer="Payment recorded by sales"
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
          label="Collected all-time"
          value={fmtAmount(collectedAllTime, 'CAD')}
          hint={`${verifiedCount} verified payments`}
          tone="warm"
          Icon={Receipt}
          footer="All verified payments"
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
          <CollectionSummaryCard revenue={revenue} verified={verifiedCount} />
        </div>
      </section>
    </div>
  );
}

// ---------- My queue ----------------------------------------------------

function MyQueueCard({ items }: { items: ApiHandover[] }) {
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
          <div className="sos-eyebrow">Payments to verify</div>
          <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
            {items.length} awaiting verification
          </h2>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '13px' }}
          >
            Recorded payments not yet verified — open the customer to confirm.
          </p>
        </div>
        <ButtonLink
          href={'/finance/clients' as Route}
          variant="ghost"
          size="sm"
          iconRight={<ArrowRight size={13} />}
        >
          All customers
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

function QueueRow({ item }: { item: ApiHandover }) {
  const name = clientName(item);
  const initials = initialsOf(name);
  return (
    <Link
      href={`/finance/clients/${item.lead.id}` as Route}
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
              {name}
            </span>
            <StatusBadge tone={statusTone(item.status)} size="sm">
              {STATUS_LABEL[item.status]}
            </StatusBadge>
          </div>
          <div
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '12px' }}
          >
            {fmtAmount(item.submittedAmount, item.currency)} ·{' '}
            {item.paymentMethod ? METHOD_LABEL[item.paymentMethod] ?? item.paymentMethod : '—'}
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
            Submitted
          </div>
          <div
            style={{
              marginTop: '2px',
              fontSize: '12.5px',
              fontWeight: 700,
              color: 'var(--sos-text-primary)',
            }}
          >
            {fmtRelative(item.submittedAt)}
          </div>
        </div>

        <ArrowRight size={14} style={{ color: 'var(--sos-text-faint)' }} />
      </div>
    </Link>
  );
}

// ---------- Problem pile -------------------------------------------------

function ProblemPileCard({ items }: { items: ApiHandover[] }) {
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
              href={`/finance/clients/${p.lead.id}` as Route}
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
                    {clientName(p)}
                  </div>
                  <div
                    className="sos-text-faint"
                    style={{ marginTop: '2px', fontSize: '11px' }}
                  >
                    {p.financeNotes ?? STATUS_LABEL[p.status]}
                  </div>
                </div>
                <StatusBadge tone="warning" size="sm">
                  {fmtRelative(p.submittedAt)}
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
  revenue,
  verified,
}: {
  revenue: ApiRevenueByService | null;
  verified: number;
}) {
  const collected = revenue?.totals.allTime ?? 0;
  const byService = revenue?.byService ?? [];
  return (
    <GlassCard variant="strong" padded="lg" glow="warm">
      <div className="sos-eyebrow">Collection summary (all time)</div>

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
        {byService.length > 0 ? byService.map((s) => (
          <ChannelRow
            key={s.service}
            label={s.service}
            amount={s.allTime}
            pct={collected > 0 ? Math.round((s.allTime / collected) * 100) : 0}
          />
        )) : (
          <div className="sos-text-muted" style={{ fontSize: '12.5px' }}>No breakdown available.</div>
        )}
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
