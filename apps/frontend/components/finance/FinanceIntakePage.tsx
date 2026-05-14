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

  /**
   * Group filtered handovers by lead so multiple transactions for the
   * same person collapse into one card. Each group lists its handovers
   * newest-first; groups themselves are ordered by whichever lead has
   * the most recent handover so fresh activity bubbles to the top.
   *
   * Why this matters: leads pay in installments (deposit → milestone →
   * balance). Without grouping, every new transaction added another
   * top-level row and the queue looked like 10 different cases when it
   * was really 3 leads paying multiple times.
   */
  const groupedByLead = useMemo(() => {
    const map = new Map<string, ApiHandover[]>();
    for (const h of filtered) {
      const key = h.lead.id;
      const arr = map.get(key);
      if (arr) arr.push(h);
      else map.set(key, [h]);
    }
    const groups = Array.from(map.entries()).map(([leadId, items]) => {
      const sorted = [...items].sort(
        (a, b) =>
          new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
      );
      return {
        leadId,
        lead: sorted[0].lead,
        items: sorted,
        latestAt: sorted[0].submittedAt,
      };
    });
    groups.sort(
      (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
    );
    return groups;
  }, [filtered]);

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
        title={<>Verify the receipt, confirm the money is ours.</>}
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
            <div className="sos-topbar__search sos-search-input">
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
              style={{ flex: '1 1 140px', minWidth: 0, maxWidth: '200px' }}
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
          style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}
        >
          {groupedByLead.map((g) => (
            <LeadGroup
              key={g.leadId}
              lead={g.lead}
              items={g.items}
              currentUserId={userId}
            />
          ))}
        </section>
      )}
    </div>
  );
}

// ---------- Lead group --------------------------------------------------
/**
 * A single lead's "finance card" — wraps every active handover for that
 * lead under one identity header. Leads pay in installments (deposit,
 * milestone, balance) so the intake queue can have multiple handovers
 * per person; without grouping the queue read like 10 separate cases
 * when it was really 3 leads paying multiple times.
 *
 * The group is purely a visual aggregation; each handover row inside
 * still links to its own /finance/intake/:id detail page so the
 * reviewer flow is unchanged.
 */
function LeadGroup({
  lead,
  items,
  currentUserId,
}: {
  lead: ApiHandover['lead'];
  items: ApiHandover[];
  currentUserId: string | null;
}) {
  const fullName = `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || '—';
  const initials = initialsOf(fullName);

  // Summary chips for the header — counts per status across this lead's
  // visible (post-filter) handovers, plus claim summary.
  const unclaimedCount = items.filter((i) => i.reviewedByUserId == null).length;
  const mineCount = items.filter((i) => i.reviewedByUserId === currentUserId).length;
  const otherCount = items.length - unclaimedCount - mineCount;
  const rejectedCount = items.filter((i) => i.status === 'REJECTED').length;

  // Aggregate amount per currency, but ONLY for handovers that are
  // genuinely pending finance action. Rejected and cancelled handovers
  // are not "money in flight" — they're closed-loop failures that have
  // already been bounced back. If we summed them here, a lead with one
  // rejected $1000 attempt and a successful $1500 resubmission would
  // appear to owe $2500 instead of the real $1500. (This was the
  // specific bug the user reported.)
  const PENDING_STATUSES = new Set<FinanceHandoverStatus>([
    'SUBMITTED',
    'IN_REVIEW',
    'PAYMENT_RECORDED',
  ]);
  const amountsByCurrency = items
    .filter((h) => PENDING_STATUSES.has(h.status))
    .reduce<Record<string, number>>((acc, h) => {
      const n = Number(h.submittedAmount);
      if (!Number.isNaN(n)) {
        acc[h.currency] = (acc[h.currency] ?? 0) + n;
      }
      return acc;
    }, {});
  const currencyTotals = Object.entries(amountsByCurrency).map(([c, total]) =>
    fmtAmount(String(total), c),
  );

  return (
    <GlassCard variant="strong" padded={false}>
      {/* Header — lead identity + summary */}
      <div
        style={{
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          borderBottom: '1px solid var(--sos-border-subtle)',
          flexWrap: 'wrap',
        }}
      >
        <div className="sos-avatar" aria-hidden style={{ width: 44, height: 44, fontSize: 14 }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: 'var(--sos-text-primary)',
              letterSpacing: '-0.005em',
            }}
          >
            {fullName}
          </div>
          <div
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '12.5px' }}
          >
            {lead.serviceInterest ?? '—'} → {lead.targetCountry ?? '—'}
            {lead.phone ? ` · ${lead.phone}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <StatusBadge tone="info" size="sm">
            {items.length} {items.length === 1 ? 'handover' : 'handovers'}
          </StatusBadge>
          {currencyTotals.length > 0 ? (
            <StatusBadge tone="neutral" size="sm" title="Sum of handovers still awaiting finance action — rejected attempts are excluded.">
              {currencyTotals.join(' · ')} pending
            </StatusBadge>
          ) : null}
          {unclaimedCount > 0 ? (
            <StatusBadge tone="warning" size="sm" dot>
              {unclaimedCount} unclaimed
            </StatusBadge>
          ) : null}
          {mineCount > 0 ? (
            <StatusBadge tone="success" size="sm" dot>
              {mineCount} mine
            </StatusBadge>
          ) : null}
          {otherCount > 0 ? (
            <StatusBadge tone="neutral" size="sm">
              {otherCount} other officer
            </StatusBadge>
          ) : null}
          {rejectedCount > 0 ? (
            <StatusBadge tone="danger" size="sm" dot>
              {rejectedCount} rejected
            </StatusBadge>
          ) : null}
        </div>
      </div>

      {/* Body — every handover for this lead, newest-first */}
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {items.map((h) => (
          <PaymentRow
            key={h.id}
            item={h}
            currentUserId={currentUserId}
            hideLeadIdentity
          />
        ))}
      </div>
    </GlassCard>
  );
}

// ---------- Row ---------------------------------------------------------

function PaymentRow({
  item,
  currentUserId,
  hideLeadIdentity = false,
}: {
  item: ApiHandover;
  currentUserId: string | null;
  /** When rendered inside a LeadGroup, the lead identity is already in
   *  the group header — hide the avatar + name to remove visual noise.
   */
  hideLeadIdentity?: boolean;
}) {
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
      <GlassCard variant={hideLeadIdentity ? 'soft' : 'default'} hover padded="md">
        <div
          style={{
            display: 'grid',
            // When the lead identity is in a group header above, drop
            // the avatar column entirely so the row reads as a "transaction".
            gridTemplateColumns: hideLeadIdentity
              ? 'minmax(0, 1fr) minmax(0, 0.9fr) auto auto'
              : 'auto minmax(0, 1fr) minmax(0, 0.9fr) auto auto',
            gap: '16px',
            alignItems: 'center',
          }}
          className="finance-intake-row"
        >
          {/* Avatar — skipped inside a LeadGroup since the header has it. */}
          {hideLeadIdentity ? null : (
            <div className="sos-avatar" aria-hidden>
              {initials}
            </div>
          )}

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
              {hideLeadIdentity ? null : (
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
              )}
              <StatusBadge tone={statusTone(item.status)} size="sm">
                {STATUS_LABEL[item.status]}
              </StatusBadge>
            </div>
            <div
              className="sos-text-muted"
              style={{ marginTop: '6px', fontSize: '12.5px' }}
            >
              {hideLeadIdentity
                ? `Handover ${item.id.slice(0, 8)}`
                : `${item.lead.serviceInterest ?? '—'} → ${item.lead.targetCountry ?? '—'} · ${item.id.slice(0, 8)}`}
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
