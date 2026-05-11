'use client';
// Finance Intake Queue — Phase 1 / Screen 2 of 7.
// Lists every payment record currently in an active finance state.
// Officer claims an unclaimed case OR resumes one already in their queue.
//
// What's IN Phase 1: status tabs, search, filter by payment method, row
// list with full meta. What's NOT in Phase 1: bulk actions, reassignment,
// concurrent-edit locks, fraud-flag indicators — those land in Phase 2.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowRight,
  AtSign,
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
  User,
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
  MOCK_FINANCE_USER,
  MOCK_PAYMENTS,
  METHOD_LABEL,
  STATUS_LABEL,
  countByStatus,
  countMine,
  fmtAmount,
  fmtRelative,
  initialsOf,
  type PaymentMethod,
  type PaymentRecord,
  type PaymentStatus,
} from '@/components/finance-v1/mockData';

// ---------- Tab filter system -------------------------------------------

type TabKey =
  | 'ALL'
  | 'NEW_FROM_SALES'
  | 'MINE'
  | 'CORRECTION_REQUIRED'
  | 'AWAITING_BALANCE'
  | 'ON_HOLD';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'ALL', label: 'All active' },
  { key: 'NEW_FROM_SALES', label: 'New from Sales' },
  { key: 'MINE', label: 'My queue' },
  { key: 'CORRECTION_REQUIRED', label: 'Corrections' },
  { key: 'AWAITING_BALANCE', label: 'Awaiting balance' },
  { key: 'ON_HOLD', label: 'On hold' },
];

const ACTIVE_STATUSES: PaymentStatus[] = [
  'NEW_FROM_SALES',
  'UNDER_VERIFICATION',
  'ON_HOLD',
  'CORRECTION_REQUIRED',
  'AWAITING_BALANCE',
];

function applyTab(items: PaymentRecord[], tab: TabKey): PaymentRecord[] {
  switch (tab) {
    case 'NEW_FROM_SALES':
      return items.filter((p) => p.status === 'NEW_FROM_SALES');
    case 'MINE':
      return items.filter(
        (p) =>
          p.financeUserId === MOCK_FINANCE_USER.id &&
          p.status === 'UNDER_VERIFICATION',
      );
    case 'CORRECTION_REQUIRED':
      return items.filter((p) => p.status === 'CORRECTION_REQUIRED');
    case 'AWAITING_BALANCE':
      return items.filter((p) => p.status === 'AWAITING_BALANCE');
    case 'ON_HOLD':
      return items.filter((p) => p.status === 'ON_HOLD');
    case 'ALL':
    default:
      return items.filter((p) => ACTIVE_STATUSES.includes(p.status));
  }
}

// ---------- Tone mappers -------------------------------------------------

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

function slaToneFromStatus(s: PaymentRecord['slaStatus']): BadgeTone {
  if (s === 'BREACHED') return 'danger';
  if (s === 'APPROACHING') return 'warning';
  if (s === 'CLEARED') return 'success';
  return 'info';
}

function MethodIcon({
  method,
  size = 13,
}: {
  method: PaymentMethod;
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
    case 'ONLINE':
      return <AtSign size={size} />;
    default:
      return <Wallet size={size} />;
  }
}

// ---------- Main page ----------------------------------------------------

export function FinanceIntakePage() {
  const [tab, setTab] = useState<TabKey>('ALL');
  const [query, setQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    let result = applyTab(MOCK_PAYMENTS, tab);

    if (methodFilter !== 'ALL') {
      result = result.filter((p) => p.paymentMethod === methodFilter);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (p) =>
          p.clientName.toLowerCase().includes(q) ||
          p.service.toLowerCase().includes(q) ||
          p.salesUserName.toLowerCase().includes(q) ||
          (p.transactionReference?.toLowerCase().includes(q) ?? false) ||
          p.id.toLowerCase().includes(q),
      );
    }

    // Sort: urgent first, then SLA-due ascending
    return [...result].sort((a, b) => {
      if (a.priority === 'URGENT' && b.priority !== 'URGENT') return -1;
      if (b.priority === 'URGENT' && a.priority !== 'URGENT') return 1;
      return +new Date(a.slaDueAt) - +new Date(b.slaDueAt);
    });
  }, [tab, query, methodFilter]);

  // KPI counts (computed once)
  const counts = {
    total: MOCK_PAYMENTS.filter((p) => ACTIVE_STATUSES.includes(p.status)).length,
    newFromSales: countByStatus('NEW_FROM_SALES'),
    mine: countMine('UNDER_VERIFICATION'),
    correction: countByStatus('CORRECTION_REQUIRED'),
  };

  const tabCounts: Record<TabKey, number> = {
    ALL: counts.total,
    NEW_FROM_SALES: counts.newFromSales,
    MINE: counts.mine,
    CORRECTION_REQUIRED: counts.correction,
    AWAITING_BALANCE: countByStatus('AWAITING_BALANCE'),
    ON_HOLD: countByStatus('ON_HOLD'),
  };

  const slaBreaches = filtered.filter((p) => p.slaStatus === 'BREACHED').length;

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
            sent back to Sales for fixes
            {slaBreaches > 0 ? (
              <>
                {' '}
                · <strong style={{ color: 'var(--sos-status-danger)' }}>
                  {slaBreaches} past SLA
                </strong>
              </>
            ) : null}
            .
          </>
        }
        actions={
          <>
            <PrimaryButton iconLeft={<Inbox size={15} />}>Claim next case</PrimaryButton>
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
          label="Past SLA"
          value={slaBreaches}
          hint="Need immediate attention"
          tone={slaBreaches > 0 ? 'danger' : 'success'}
          Icon={CalendarClock}
          footer={
            slaBreaches > 0
              ? 'Sort sorts urgent + breached to the top'
              : 'All cases within SLA window'
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
              onChange={(e) =>
                setMethodFilter(e.target.value as PaymentMethod | 'ALL')
              }
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
      {filtered.length === 0 ? (
        <EmptyState
          Icon={CheckCircle2}
          title="No cases match this view"
          description="Try the All tab, clear the search, or check Awaiting Balance / On Hold."
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
            <PaymentRow key={p.id} item={p} />
          ))}
        </section>
      )}
    </div>
  );
}

// ---------- Row ---------------------------------------------------------

function PaymentRow({ item }: { item: PaymentRecord }) {
  const initials = initialsOf(item.clientName);
  const unclaimed = item.financeUserId == null;
  const claimedByMe = item.financeUserId === MOCK_FINANCE_USER.id;
  const claimedByOther = !unclaimed && !claimedByMe;
  const isBreached = item.slaStatus === 'BREACHED';

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
            style={{
              background: isBreached
                ? 'var(--sos-avatar-danger-gradient)'
                : 'var(--sos-brand-gradient)',
            }}
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
              {isBreached ? (
                <StatusBadge tone="danger" size="sm">
                  SLA past
                </StatusBadge>
              ) : null}
              {item.correctionBounceCount > 1 ? (
                <StatusBadge tone="warning" size="sm">
                  {item.correctionBounceCount}× bounced
                </StatusBadge>
              ) : null}
            </div>
            <div
              className="sos-text-muted"
              style={{ marginTop: '6px', fontSize: '12.5px' }}
            >
              {item.service} → {item.targetCountry} · {item.id}
            </div>
            {item.status === 'CORRECTION_REQUIRED' && item.financeNote ? (
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
                {item.financeNote}
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
              {fmtAmount(item.receivedAmount, item.currency)}
            </div>
            {item.receivedAmount !== item.expectedAmount ? (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--sos-status-warning)',
                  fontWeight: 600,
                  marginTop: '2px',
                }}
              >
                Expected {fmtAmount(item.expectedAmount, item.currency)}
              </div>
            ) : null}
            <div
              style={{
                marginTop: '6px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
              }}
            >
              <MetaPill icon={<MethodIcon method={item.paymentMethod} />}>
                {METHOD_LABEL[item.paymentMethod]}
              </MetaPill>
              <MetaPill icon={<User size={11} />}>{item.salesUserName}</MetaPill>
              <MetaPill icon={<Building2 size={11} />}>{item.branch}</MetaPill>
              {item.receiptFileCount > 0 ? (
                <MetaPill>
                  {item.receiptFileCount} file{item.receiptFileCount === 1 ? '' : 's'}
                </MetaPill>
              ) : (
                <MetaPill tone="danger">No file</MetaPill>
              )}
            </div>
          </div>

          {/* SLA + assignment */}
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
                fontSize: '13.5px',
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
            <div
              style={{ marginTop: '6px', display: 'flex', justifyContent: 'flex-end' }}
            >
              <StatusBadge tone={slaToneFromStatus(item.slaStatus)} size="sm">
                {item.slaStatus.toLowerCase()}
              </StatusBadge>
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
                  <Phone size={11} /> {item.financeUserName}
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
            Currently being reviewed by {item.financeUserName}. You'll see a
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
