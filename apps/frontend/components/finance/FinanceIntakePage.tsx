'use client';
// Finance Intake Queue — Phase 1 / Screen 2 of 7.
// Lists every handover currently in an active finance state.
// Officer claims an unclaimed case OR resumes one already in their queue.

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowRight,
  Banknote,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  Globe,
  Inbox,
  MessageSquare,
  Phone,
  Search,
  ShieldCheck,
  Sliders,
  Smartphone,
  Wallet,
} from 'lucide-react';
import {
  ButtonLink,
  EmptyState,
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  fetchHandovers,
  fmtAmount,
  fmtRelative,
  clientName,
  STATUS_LABEL,
  METHOD_LABEL,
  type ApiHandover,
  type FinanceHandoverStatus,
} from '@/lib/finance-api';
import { useSession } from '@/lib/session';

// ---------- Tab filter system -------------------------------------------

type TabKey =
  | 'ALL'
  | 'SUBMITTED'
  | 'MINE'
  | 'REJECTED'
  | 'PAYMENT_RECORDED'
  | 'IN_REVIEW';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'ALL', label: 'All active' },
  { key: 'SUBMITTED', label: 'New from Sales' },
  { key: 'MINE', label: 'My queue' },
  { key: 'REJECTED', label: 'Corrections' },
  { key: 'PAYMENT_RECORDED', label: 'Payment Recorded' },
  { key: 'IN_REVIEW', label: 'In Review' },
];

const ACTIVE_STATUSES: FinanceHandoverStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'PAYMENT_RECORDED',
  'REJECTED',
];

function applyTab(items: ApiHandover[], tab: TabKey, userId: string | null): ApiHandover[] {
  switch (tab) {
    case 'SUBMITTED':
      return items.filter((p) => p.status === 'SUBMITTED');
    case 'MINE':
      return items.filter(
        (p) => p.reviewedByUserId === userId && p.status === 'IN_REVIEW',
      );
    case 'REJECTED':
      return items.filter((p) => p.status === 'REJECTED');
    case 'PAYMENT_RECORDED':
      return items.filter((p) => p.status === 'PAYMENT_RECORDED');
    case 'IN_REVIEW':
      return items.filter((p) => p.status === 'IN_REVIEW');
    case 'ALL':
    default:
      return items.filter((p) => ACTIVE_STATUSES.includes(p.status));
  }
}

// ---------- Tone mappers -------------------------------------------------

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

function MethodIcon({
  method,
  size = 13,
}: {
  method: string;
  size?: number;
}) {
  switch (method) {
    case 'CASH':
      return <Banknote size={size} />;
    case 'BANK':
      return <Building2 size={size} />;
    case 'CARD':
      return <CreditCard size={size} />;
    case 'CHEQUE':
      return <ShieldCheck size={size} />;
    case 'MOBILE':
      return <Smartphone size={size} />;
    case 'WIRE':
      return <Globe size={size} />;
    default:
      return <Wallet size={size} />;
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

// ---------- Main page ----------------------------------------------------

export function FinanceIntakePage() {
  const session = useSession();
  const [tab, setTab] = useState<TabKey>('ALL');
  const [query, setQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [handovers, setHandovers] = useState<ApiHandover[]>([]);
  const [loading, setLoading] = useState(true);

  const userId = session.status === 'authed' ? session.user.id : null;

  useEffect(() => {
    fetchHandovers()
      .then(setHandovers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = applyTab(handovers, tab, userId);

    if (methodFilter !== 'ALL') {
      result = result.filter((p) => p.paymentMethod === methodFilter);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter((p) => {
        const name = clientName(p).toLowerCase();
        return (
          name.includes(q) ||
          (p.lead.serviceInterest?.toLowerCase().includes(q) ?? false) ||
          (p.transactionRef?.toLowerCase().includes(q) ?? false) ||
          p.id.toLowerCase().includes(q)
        );
      });
    }

    return [...result].sort((a, b) =>
      new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime(),
    );
  }, [tab, query, methodFilter, handovers, userId]);

  // KPI counts (computed once)
  const activeHandovers = handovers.filter((p) => ACTIVE_STATUSES.includes(p.status));
  const counts = {
    total: activeHandovers.length,
    newFromSales: handovers.filter((p) => p.status === 'SUBMITTED').length,
    mine: handovers.filter((p) => p.reviewedByUserId === userId && p.status === 'IN_REVIEW').length,
    correction: handovers.filter((p) => p.status === 'REJECTED').length,
  };

  const tabCounts: Record<TabKey, number> = {
    ALL: counts.total,
    SUBMITTED: counts.newFromSales,
    MINE: counts.mine,
    REJECTED: counts.correction,
    PAYMENT_RECORDED: handovers.filter((p) => p.status === 'PAYMENT_RECORDED').length,
    IN_REVIEW: handovers.filter((p) => p.status === 'IN_REVIEW').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="Finance intake"
        title={
          <>
            Verify the receipt,<br />confirm the money is ours.
          </>
        }
        description={
          <>
            {counts.total} active cases in the queue · {counts.newFromSales} waiting
            to be claimed · {counts.mine} in your active review · {counts.correction}{' '}
            sent back to Sales for fixes.
          </>
        }
        actions={
          <>
            <SecondaryButton iconLeft={<Sliders size={15} />}>More filters</SecondaryButton>
          </>
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
          label="In queue"
          value={counts.total}
          hint="All active finance cases"
          tone="accent"
          Icon={Inbox}
          footer="Across all statuses"
        />
        <MetricCard
          label="New from Sales"
          value={counts.newFromSales}
          hint="Waiting to be claimed"
          tone="info"
          Icon={Inbox}
          footer="Click a case to claim and verify"
        />
        <MetricCard
          label="My active review"
          value={counts.mine}
          hint="Verifications in progress"
          tone="warm"
          Icon={Clock}
          footer="Resume where you left off"
        />
        <MetricCard
          label="Corrections"
          value={counts.correction}
          hint="Sent back to Sales"
          tone={counts.correction > 0 ? 'danger' : 'success'}
          Icon={CalendarClock}
          footer={
            counts.correction > 0
              ? 'Sales is fixing these cases'
              : 'No pending corrections'
          }
        />
      </section>

      {/* Toolbar — tabs + search + method filter */}
      <GlassCard variant="default" padded="md">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
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
              maxWidth: '100%',
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                onClick={() => setTab(t.key)}
                className="sos-tab"
              >
                {t.label}
                <span className="sos-tab__count">{tabCounts[t.key]}</span>
              </button>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div className="sos-topbar__search" style={{ minWidth: '260px' }}>
              <Search size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by client, ref, ID…"
                aria-label="Search intake"
              />
            </div>

            <select
              className="sos-select"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              style={{ width: 'auto', minWidth: '160px' }}
              aria-label="Filter by payment method"
            >
              <option value="ALL">All methods</option>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank transfer</option>
              <option value="CARD">Card</option>
              <option value="CHEQUE">Cheque</option>
              <option value="WIRE">Wire</option>
              <option value="ONLINE">Online</option>
              <option value="MOBILE">Mobile wallet</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>
      </GlassCard>

      {/* Queue */}
      {loading ? (
        <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--sos-text-muted)' }}>
          Loading handovers…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          Icon={CheckCircle2}
          title="No cases match this view"
          description="Try the All tab or clear the search."
          action={
            <PrimaryButton
              onClick={() => {
                setTab('ALL');
                setQuery('');
                setMethodFilter('ALL');
              }}
            >
              Reset filters
            </PrimaryButton>
          }
        />
      ) : (
        <section
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {filtered.map((p) => (
            <PaymentRow key={p.id} item={p} currentUserId={userId} />
          ))}
        </section>
      )}
    </div>
  );
}

// ---------- Row ---------------------------------------------------------

function PaymentRow({ item, currentUserId }: { item: ApiHandover; currentUserId: string | null }) {
  const name = clientName(item);
  const initials = initialsOf(name);
  const unclaimed = item.reviewedByUserId == null;
  const claimedByMe = item.reviewedByUserId === currentUserId;
  const claimedByOther = !unclaimed && !claimedByMe;

  return (
    <Link
      href={`/finance/intake/${item.id}` as Route}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <GlassCard variant="default" hover padded="md">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 0.9fr) auto auto',
            gap: '16px',
            alignItems: 'center',
          }}
          className="finance-intake-row"
        >
          {/* Avatar */}
          <div
            className="sos-avatar"
            aria-hidden
          >
            {initials}
          </div>

          {/* Identity column */}
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
                  fontSize: '15px',
                  fontWeight: 700,
                  color: 'var(--sos-text-primary)',
                  letterSpacing: '-0.005em',
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
              style={{ marginTop: '6px', fontSize: '12.5px' }}
            >
              {item.lead.serviceInterest ?? '—'} → {item.lead.targetCountry ?? '—'} · {item.id.slice(0, 8)}
            </div>
            {item.status === 'REJECTED' && item.financeNotes ? (
              <div
                className="sos-text-faint"
                style={{
                  marginTop: '6px',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                <MessageSquare
                  size={11}
                  style={{
                    display: 'inline',
                    verticalAlign: '-1px',
                    marginRight: '6px',
                    color: 'var(--sos-status-warning)',
                  }}
                />
                {item.financeNotes}
              </div>
            ) : null}
          </div>

          {/* Money + method column */}
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: 'var(--sos-text-primary)',
                letterSpacing: '-0.005em',
              }}
            >
              {fmtAmount(item.submittedAmount, item.currency)}
            </div>
            <div
              style={{
                marginTop: '6px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
              }}
            >
              {item.paymentMethod ? (
                <MetaPill icon={<MethodIcon method={item.paymentMethod} />}>
                  {METHOD_LABEL[item.paymentMethod] ?? item.paymentMethod}
                </MetaPill>
              ) : null}
              <MetaPill>
                {item.receiptFileName}
              </MetaPill>
            </div>
          </div>

          {/* Submitted + assignment */}
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
                fontSize: '13.5px',
                fontWeight: 700,
                color: 'var(--sos-text-primary)',
              }}
            >
              {fmtRelative(item.submittedAt)}
            </div>
            <div
              style={{
                marginTop: '6px',
                fontSize: '11px',
                color: unclaimed
                  ? 'var(--sos-status-warning)'
                  : claimedByMe
                    ? 'var(--sos-brand-primary-strong)'
                    : 'var(--sos-text-faint)',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                justifyContent: 'flex-end',
                width: '100%',
              }}
            >
              {unclaimed ? (
                <>
                  <Inbox size={11} /> Unclaimed
                </>
              ) : claimedByMe ? (
                <>
                  <Clock size={11} /> Mine
                </>
              ) : (
                <>
                  <Phone size={11} /> Assigned
                </>
              )}
            </div>
          </div>

          {/* CTA */}
          <ArrowRight
            size={16}
            style={{ color: 'var(--sos-text-faint)', flexShrink: 0 }}
          />
        </div>

        {claimedByOther ? (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 12px',
              borderRadius: 'var(--sos-radius-sm)',
              background: 'var(--sos-surface-1)',
              border: '1px dashed var(--sos-border)',
              fontSize: '11.5px',
              color: 'var(--sos-text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <ShieldCheck
              size={12}
              style={{ color: 'var(--sos-status-info)', flexShrink: 0 }}
            />
            Currently being reviewed by another officer. You'll see a
            read-only view if you open it.
          </div>
        ) : null}
      </GlassCard>
    </Link>
  );
}

// ---------- Meta pill ---------------------------------------------------

function MetaPill({
  icon,
  children,
  tone,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  tone?: 'danger';
}) {
  if (tone === 'danger') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '999px',
          background: 'var(--sos-status-danger-soft)',
          border: '1px solid var(--sos-status-danger-border)',
          color: 'var(--sos-status-danger)',
          fontSize: '11px',
          fontWeight: 600,
        }}
      >
        {icon}
        {children}
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '999px',
        background: 'var(--sos-surface-2)',
        border: '1px solid var(--sos-border-subtle)',
        color: 'var(--sos-text-muted)',
        fontSize: '11px',
        fontWeight: 600,
      }}
    >
      {icon}
      {children}
    </span>
  );
}
