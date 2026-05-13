'use client';
// Finance Corrections — Screen 5a of 7.
// Lists REJECTED handovers (sent back for correction).

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import {
  EmptyState,
  GlassCard,
  PageHeader,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  fetchHandovers,
  fmtRelative,
  fmtAmount,
  clientName,
  type ApiHandover,
} from '@/lib/finance-api';

// ---------- Row component ------------------------------------------------

function CorrectionRow({ handover }: { handover: ApiHandover }) {
  return (
    <Link
      href={`/finance/corrections/${handover.id}` as Route}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <div
        style={{
          background: 'var(--sos-surface)',
          border: '1px solid var(--sos-border)',
          borderRadius: 'var(--sos-radius-md)',
          padding: 'var(--sos-space-4)',
          cursor: 'pointer',
          transition: 'border-color 0.15s, background 0.15s',
          display: 'flex',
          gap: 'var(--sos-space-4)',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sos-space-2)', marginBottom: 4 }}>
            <span style={{ fontSize: 'var(--sos-text-sm)', fontWeight: 600, color: 'var(--sos-text)' }}>
              {clientName(handover)}
            </span>
            <StatusBadge tone="danger" size="sm">Rejected</StatusBadge>
          </div>
          <div style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', marginBottom: 4 }}>
            {handover.lead.serviceInterest ?? '—'} · {handover.lead.targetCountry ?? '—'} ·{' '}
            {fmtAmount(handover.submittedAmount, handover.currency)}
          </div>
          {handover.financeNotes && (
            <div style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
              "{handover.financeNotes.slice(0, 80)}{handover.financeNotes.length > 80 ? '…' : ''}"
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', textAlign: 'right' }}>
          {fmtRelative(handover.updatedAt)}
        </div>
      </div>
    </Link>
  );
}

// ---------- Main page component ------------------------------------------

export function FinanceCorrectionsPage() {
  const [rejected, setRejected] = useState<ApiHandover[]>([]);

  useEffect(() => {
    fetchHandovers({ status: 'REJECTED' }).then(setRejected).catch(console.error);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sos-space-6)',
        maxWidth: 900,
        margin: '0 auto',
      }}
    >
      <PageHeader
        eyebrow="Finance"
        title="Corrections"
        description="Cases rejected — awaiting resubmission from Sales"
      />

      <GlassCard>
        <div style={{ padding: 'var(--sos-space-3) var(--sos-space-5)', display: 'flex', alignItems: 'center', gap: 'var(--sos-space-2)' }}>
          <span style={{ fontSize: 'var(--sos-text-2xl)', fontWeight: 700, color: 'var(--sos-text)' }}>
            {rejected.length}
          </span>
          <StatusBadge tone="danger">Correction Required</StatusBadge>
        </div>
      </GlassCard>

      {rejected.length === 0 ? (
        <EmptyState
          Icon={MessageSquare}
          title="No active corrections"
          description="All corrections have been resolved. New ones will appear here when Finance rejects a handover."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-3)' }}>
          {rejected.map((h) => (
            <CorrectionRow key={h.id} handover={h} />
          ))}
        </div>
      )}
    </div>
  );
}


const STATUS_TONE: Record<string, BadgeTone> = {
  awaiting_sales: 'warning',
  awaiting_finance: 'info',
  escalated: 'danger',
  resolved: 'success',
};

function bounceTone(n: number): BadgeTone {
  if (n >= 3) return 'danger';
  if (n === 2) return 'warning';
  return 'neutral';
}

function bounceLabel(n: number): string {
  if (n === 1) return '1st bounce';
  if (n === 2) return '2nd bounce';
  return `${n}th bounce`;
}

// ---------- Row component ------------------------------------------------

interface ThreadRowProps {
  thread: CorrectionThread;
}

function ThreadRow({ thread }: ThreadRowProps) {
  const payment = MOCK_PAYMENTS.find((p) => p.id === thread.paymentId);
  if (!payment) return null;

  const lastMsg = thread.messages[thread.messages.length - 1];
  const preview = lastMsg ? lastMsg.body.slice(0, 72) + (lastMsg.body.length > 72 ? '…' : '') : '';
  const isAwaitingSales = thread.status === 'awaiting_sales';

  // Latest correction_request for SLA due date
  const latestRequest = [...thread.messages]
    .reverse()
    .find((m) => m.type === 'correction_request');
  const slaBreached = latestRequest?.slaDue
    ? new Date(latestRequest.slaDue) < new Date()
    : false;

  return (
    <Link
      href={`/finance/corrections/${thread.paymentId}` as Route}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <div
        style={{
          background: 'var(--sos-surface)',
          border: `1px solid ${slaBreached ? 'var(--sos-danger)' : 'var(--sos-border)'}`,
          borderRadius: 'var(--sos-radius-md)',
          padding: 'var(--sos-space-4)',
          cursor: 'pointer',
          transition: 'border-color 0.15s, background 0.15s',
          display: 'flex',
          gap: 'var(--sos-space-4)',
          alignItems: 'flex-start',
        }}
      >
        {/* Direction icon */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isAwaitingSales
              ? 'color-mix(in srgb, var(--sos-warning) 15%, transparent)'
              : 'color-mix(in srgb, var(--sos-info) 15%, transparent)',
          }}
        >
          {isAwaitingSales ? (
            <ArrowRight size={16} style={{ color: 'var(--sos-warning)' }} />
          ) : (
            <ArrowLeft size={16} style={{ color: 'var(--sos-info)' }} />
          )}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Top row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sos-space-2)',
              flexWrap: 'wrap',
              marginBottom: 'var(--sos-space-1)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--sos-text-sm)',
                fontWeight: 600,
                color: 'var(--sos-text)',
              }}
            >
              {payment.clientName}
            </span>
            <span
              style={{
                fontSize: 'var(--sos-text-xs)',
                color: 'var(--sos-muted)',
              }}
            >
              {fmtAmount(payment.receivedAmount, payment.currency)} · {payment.service}
            </span>
            <StatusBadge tone={STATUS_TONE[thread.status]}>
              {STATUS_LABEL[thread.status]}
            </StatusBadge>
            <StatusBadge tone={bounceTone(thread.bounceCount)}>
              <RotateCcw size={10} /> {bounceLabel(thread.bounceCount)}
            </StatusBadge>
            {slaBreached && (
              <StatusBadge tone="danger">
                <AlertTriangle size={10} /> SLA breached
              </StatusBadge>
            )}
          </div>

          {/* Reason tags */}
          {lastMsg?.reasons && lastMsg.reasons.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 'var(--sos-space-1)',
                flexWrap: 'wrap',
                marginBottom: 'var(--sos-space-1)',
              }}
            >
              {lastMsg.reasons.map((r) => (
                <span
                  key={r}
                  style={{
                    fontSize: 'var(--sos-text-xs)',
                    background: 'var(--sos-surface-2)',
                    border: '1px solid var(--sos-border)',
                    borderRadius: 99,
                    padding: '1px 8px',
                    color: 'var(--sos-muted)',
                  }}
                >
                  {r}
                </span>
              ))}
            </div>
          )}

          {/* Preview */}
          <p
            style={{
              fontSize: 'var(--sos-text-xs)',
              color: 'var(--sos-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <strong style={{ color: 'var(--sos-text)' }}>{lastMsg?.authorName}:</strong>{' '}
            {preview}
          </p>
        </div>

        {/* Right meta */}
        <div
          style={{
            flexShrink: 0,
            textAlign: 'right',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            alignItems: 'flex-end',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 'var(--sos-text-xs)',
              color: slaBreached ? 'var(--sos-danger)' : 'var(--sos-muted)',
            }}
          >
            <Clock size={12} />
            {lastMsg ? fmtRelative(lastMsg.createdAt) : '—'}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 'var(--sos-text-xs)',
              color: 'var(--sos-muted)',
            }}
          >
            <MessageSquare size={12} />
            {thread.messages.length} messages
          </div>
          <div
            style={{
              fontSize: 'var(--sos-text-xs)',
              color: 'var(--sos-muted)',
            }}
          >
            {payment.branch} · {thread.caseRef}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ---------- Main page component ------------------------------------------

export function FinanceCorrectionsPage() {
  const active = MOCK_CORRECTION_THREADS.filter(
    (t) => t.status !== 'resolved',
  );

  const awaitingSales = active.filter((t) => t.status === 'awaiting_sales');
  const awaitingFinance = active.filter((t) => t.status === 'awaiting_finance');
  const escalated = active.filter((t) => t.status === 'escalated');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sos-space-6)',
        maxWidth: 900,
        margin: '0 auto',
      }}
    >
      <PageHeader
        eyebrow="Finance"
        title="Corrections"
        description="Cases sent back to Sales requiring a fix before verification can continue"
      />

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 'var(--sos-space-3)', flexWrap: 'wrap' }}>
        {[
          { label: 'Awaiting Sales', count: awaitingSales.length, tone: 'warning' as BadgeTone },
          { label: 'Awaiting Finance', count: awaitingFinance.length, tone: 'info' as BadgeTone },
          { label: 'Escalated', count: escalated.length, tone: 'danger' as BadgeTone },
        ].map(({ label, count, tone }) => (
          <GlassCard key={label}>
            <div
              style={{
                padding: 'var(--sos-space-3) var(--sos-space-5)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sos-space-2)',
              }}
            >
              <span
                style={{
                  fontSize: 'var(--sos-text-2xl)',
                  fontWeight: 700,
                  color: 'var(--sos-text)',
                }}
              >
                {count}
              </span>
              <StatusBadge tone={tone}>{label}</StatusBadge>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Thread list */}
      {active.length === 0 ? (
        <EmptyState
          Icon={MessageSquare}
          title="No active corrections"
          description="All corrections have been resolved. New ones will appear here when Finance raises a correction request."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-3)' }}>
          {/* Awaiting Finance first (needs officer action) */}
          {awaitingFinance.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 'var(--sos-text-xs)',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--sos-muted)',
                  marginBottom: 'var(--sos-space-2)',
                }}
              >
                Action needed from you
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-2)' }}>
                {awaitingFinance.map((t) => (
                  <ThreadRow key={t.id} thread={t} />
                ))}
              </div>
            </div>
          )}

          {/* Awaiting Sales */}
          {awaitingSales.length > 0 && (
            <div style={{ marginTop: awaitingFinance.length > 0 ? 'var(--sos-space-4)' : 0 }}>
              <p
                style={{
                  fontSize: 'var(--sos-text-xs)',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--sos-muted)',
                  marginBottom: 'var(--sos-space-2)',
                }}
              >
                Waiting for Sales
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-2)' }}>
                {awaitingSales.map((t) => (
                  <ThreadRow key={t.id} thread={t} />
                ))}
              </div>
            </div>
          )}

          {/* Escalated */}
          {escalated.length > 0 && (
            <div style={{ marginTop: 'var(--sos-space-4)' }}>
              <p
                style={{
                  fontSize: 'var(--sos-text-xs)',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--sos-danger)',
                  marginBottom: 'var(--sos-space-2)',
                }}
              >
                Escalated — manager attention required
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-2)' }}>
                {escalated.map((t) => (
                  <ThreadRow key={t.id} thread={t} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
