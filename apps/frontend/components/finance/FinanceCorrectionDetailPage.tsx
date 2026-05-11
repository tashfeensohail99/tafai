'use client';
// Finance Correction Detail — Screen 5b of 7.
// Shows the full correction conversation thread for a single payment record.
// Finance officer can:
//   - read the thread (all past messages)
//   - post a new correction request (when it's "awaiting finance" and they need
//     another round-trip)
//   - resume verification (navigate to verification detail) when Sales has
//     resubmitted
//
// Phase 1 scope: mock data, append-only in session state (reloading resets),
// no real file upload, no real notifications.

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  MessageSquare,
  Paperclip,
  RotateCcw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  ActionBar,
  FormSelect,
  FormTextarea,
  GlassCard,
  GhostButton,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  SuccessButton,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  MOCK_FINANCE_USER,
  MOCK_PAYMENTS,
  MOCK_CORRECTION_THREADS,
  CORRECTION_REASONS,
  fmtAmount,
  fmtDateTime,
  fmtRelative,
  METHOD_LABEL,
  type CorrectionMessage,
  type CorrectionReason,
  type CorrectionThread,
  type RequiredAction,
} from '@/components/finance-v1/mockData';

// ---------- Constants ---------------------------------------------------

const REQUIRED_ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Re-upload receipt', label: 'Re-upload receipt' },
  { value: 'Provide reference number', label: 'Provide reference number' },
  { value: 'Confirm with client', label: 'Confirm with client' },
  { value: 'Contact bank', label: 'Contact bank' },
  { value: 'Other', label: 'Other' },
];

const SLA_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '4', label: '4 hours (urgent)' },
  { value: '24', label: '24 hours (standard)' },
  { value: '48', label: '48 hours' },
  { value: '120', label: '5 business days' },
];

// ---------- Status helpers ----------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  awaiting_sales: 'Awaiting Sales',
  awaiting_finance: 'Awaiting Finance',
  escalated: 'Escalated',
  resolved: 'Resolved',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  awaiting_sales: 'warning',
  awaiting_finance: 'info',
  escalated: 'danger',
  resolved: 'success',
};

function directionLabel(msg: CorrectionMessage): string {
  if (msg.direction === 'finance_to_sales') return 'Finance → Sales';
  if (msg.direction === 'sales_to_finance') return 'Sales → Finance';
  return 'System';
}

function directionTone(msg: CorrectionMessage): BadgeTone {
  if (msg.direction === 'finance_to_sales') return 'accent';
  if (msg.direction === 'sales_to_finance') return 'cyan';
  return 'neutral';
}

function msgTypeLabel(msg: CorrectionMessage): string {
  switch (msg.type) {
    case 'correction_request':     return 'Correction request';
    case 'correction_resubmission': return 'Resubmission';
    case 'internal_note':          return 'Internal note';
    case 'system_event':           return 'System event';
    case 'manager_intervention':   return 'Manager intervention';
  }
}

// ---------- Sub-components ----------------------------------------------

function ThreadMessage({
  msg,
  index,
}: {
  msg: CorrectionMessage;
  index: number;
}) {
  const isFinance = msg.direction === 'finance_to_sales';
  const isSystem = msg.direction === 'system';

  if (isSystem) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: 'var(--sos-space-3)',
          fontSize: 'var(--sos-text-xs)',
          color: 'var(--sos-muted)',
          fontStyle: 'italic',
        }}
      >
        ⚙ {msg.body}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sos-space-2)',
        padding: 'var(--sos-space-4)',
        background: isFinance ? 'var(--sos-surface-2)' : 'var(--sos-surface)',
        border: `1px solid ${isFinance ? 'color-mix(in srgb, var(--sos-accent) 25%, var(--sos-border))' : 'var(--sos-border)'}`,
        borderRadius: 'var(--sos-radius-md)',
        borderLeft: `4px solid ${isFinance ? 'var(--sos-accent)' : 'var(--sos-info)'}`,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sos-space-2)',
          flexWrap: 'wrap',
        }}
      >
        {/* Step number */}
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: isFinance ? 'var(--sos-accent)' : 'var(--sos-info)',
            color: '#fff',
            fontSize: 'var(--sos-text-xs)',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {index + 1}
        </span>

        <StatusBadge tone={directionTone(msg)}>{directionLabel(msg)}</StatusBadge>
        <StatusBadge tone="neutral">{msgTypeLabel(msg)}</StatusBadge>

        <span
          style={{
            marginLeft: 'auto',
            fontSize: 'var(--sos-text-xs)',
            color: 'var(--sos-muted)',
          }}
        >
          <strong style={{ color: 'var(--sos-text)' }}>{msg.authorName}</strong>
          {' · '}
          {fmtDateTime(msg.createdAt)}
        </span>
      </div>

      {/* Reason tags + required action (correction_request only) */}
      {msg.type === 'correction_request' && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--sos-space-2)',
            flexWrap: 'wrap',
            padding: 'var(--sos-space-2) var(--sos-space-3)',
            background: 'color-mix(in srgb, var(--sos-warning) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--sos-warning) 30%, transparent)',
            borderRadius: 'var(--sos-radius-sm)',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--sos-space-1)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', fontWeight: 600 }}>
              Reason{msg.reasons.length > 1 ? 's' : ''}:
            </span>
            {msg.reasons.map((r) => (
              <span
                key={r}
                style={{
                  fontSize: 'var(--sos-text-xs)',
                  background: 'var(--sos-surface)',
                  border: '1px solid var(--sos-border)',
                  borderRadius: 99,
                  padding: '1px 8px',
                  color: 'var(--sos-text)',
                }}
              >
                {r}
              </span>
            ))}
          </div>
          {msg.requiredAction && (
            <div style={{ display: 'flex', gap: 'var(--sos-space-1)', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', fontWeight: 600 }}>
                Required action:
              </span>
              <span style={{ fontSize: 'var(--sos-text-xs)', fontWeight: 600, color: 'var(--sos-text)' }}>
                {msg.requiredAction}
              </span>
            </div>
          )}
          {msg.slaDue && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Clock size={12} style={{ color: 'var(--sos-muted)' }} />
              <span style={{ fontSize: 'var(--sos-text-xs)', color: new Date(msg.slaDue) < new Date() ? 'var(--sos-danger)' : 'var(--sos-muted)' }}>
                SLA due {fmtRelative(msg.slaDue)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Body text */}
      <p
        style={{
          fontSize: 'var(--sos-text-sm)',
          color: 'var(--sos-text)',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}
      >
        {msg.body}
      </p>

      {/* Attachment indicator */}
      {msg.attachedFileCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 'var(--sos-text-xs)',
            color: 'var(--sos-muted)',
          }}
        >
          <Paperclip size={12} />
          {msg.attachedFileCount} file{msg.attachedFileCount > 1 ? 's' : ''} attached
          <span
            style={{
              background: 'var(--sos-surface-hover)',
              borderRadius: 4,
              padding: '1px 6px',
              cursor: 'not-allowed',
              opacity: 0.6,
            }}
          >
            Preview (Phase 2)
          </span>
        </div>
      )}
    </div>
  );
}

// ---------- New correction request form ---------------------------------

interface NewCorrectionFormProps {
  onSubmit: (msg: CorrectionMessage) => void;
  onCancel: () => void;
}

function NewCorrectionForm({ onSubmit, onCancel }: NewCorrectionFormProps) {
  const [selectedReasons, setSelectedReasons] = useState<Set<CorrectionReason>>(new Set());
  const [requiredAction, setRequiredAction] = useState<string>('Re-upload receipt');
  const [slaDuration, setSlaDuration] = useState<string>('24');
  const [body, setBody] = useState('');
  const [otherText, setOtherText] = useState('');
  const [touched, setTouched] = useState(false);

  function toggleReason(r: CorrectionReason) {
    setSelectedReasons((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  const bodyToUse = body.trim();
  const canSubmit =
    selectedReasons.size > 0 &&
    bodyToUse.length >= 20 &&
    (!selectedReasons.has('Other') || otherText.trim().length > 0);

  function handleSubmit() {
    setTouched(true);
    if (!canSubmit) return;

    const slaDue = new Date(Date.now() + Number(slaDuration) * 3600 * 1000).toISOString();
    const reasons = [...selectedReasons] as CorrectionReason[];

    const msg: CorrectionMessage = {
      id: `cm-new-${Date.now()}`,
      type: 'correction_request',
      direction: 'finance_to_sales',
      authorId: MOCK_FINANCE_USER.id,
      authorName: MOCK_FINANCE_USER.name,
      authorRole: 'Finance Officer',
      createdAt: new Date().toISOString(),
      reasons,
      requiredAction: requiredAction as RequiredAction,
      slaDue,
      body: bodyToUse,
      attachedFileCount: 0,
      isInternal: false,
    };

    onSubmit(msg);
  }

  return (
    <GlassCard>
      <div
        style={{
          padding: 'var(--sos-space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--sos-space-4)',
        }}
      >
        <p
          style={{
            fontSize: 'var(--sos-text-sm)',
            fontWeight: 600,
            color: 'var(--sos-text)',
          }}
        >
          New correction request
        </p>

        {/* Reason picker (multi-select chips) */}
        <div>
          <p
            style={{
              fontSize: 'var(--sos-text-sm)',
              fontWeight: 500,
              color: 'var(--sos-text)',
              marginBottom: 'var(--sos-space-2)',
            }}
          >
            Reason(s) — select one or more *
          </p>
          <div style={{ display: 'flex', gap: 'var(--sos-space-2)', flexWrap: 'wrap' }}>
            {CORRECTION_REASONS.map((r) => {
              const active = selectedReasons.has(r);
              return (
                <button
                  key={r}
                  onClick={() => toggleReason(r)}
                  style={{
                    fontSize: 'var(--sos-text-xs)',
                    padding: '4px 12px',
                    borderRadius: 99,
                    border: `1px solid ${active ? 'var(--sos-accent)' : 'var(--sos-border)'}`,
                    background: active ? 'var(--sos-accent-muted)' : 'var(--sos-surface)',
                    color: active ? 'var(--sos-accent)' : 'var(--sos-muted)',
                    cursor: 'pointer',
                    fontWeight: active ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {r}
                </button>
              );
            })}
          </div>
          {touched && selectedReasons.size === 0 && (
            <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-danger)', marginTop: 4 }}>
              Select at least one reason.
            </p>
          )}
          {selectedReasons.has('Other') && (
            <div style={{ marginTop: 'var(--sos-space-2)' }}>
              <FormTextarea
                label="Describe the other reason *"
                value={otherText}
                placeholder="e.g. Client changed their mind about payment method after submission."
                rows={2}
                onChange={(e) => setOtherText(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Required action + SLA */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sos-space-3)' }}>
          <FormSelect
            label="Required action *"
            value={requiredAction}
            options={REQUIRED_ACTION_OPTIONS}
            onChange={(e) => setRequiredAction(e.target.value)}
          />
          <FormSelect
            label="Sales SLA *"
            value={slaDuration}
            options={SLA_OPTIONS}
            onChange={(e) => setSlaDuration(e.target.value)}
          />
        </div>

        {/* Officer note */}
        <FormTextarea
          label="Officer note (min 20 characters) *"
          value={body}
          placeholder="Describe exactly what Sales needs to do. Be concrete — e.g. 'Re-upload a clearer photo of the bank slip showing reference TFN-XXXX and the date.'"
          rows={4}
          onChange={(e) => setBody(e.target.value)}
        />
        {touched && bodyToUse.length < 20 && (
          <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-danger)', marginTop: -12 }}>
            Note must be at least 20 characters ({bodyToUse.length} / 20).
          </p>
        )}

        <ActionBar
          left={
            <GhostButton onClick={onCancel}>Cancel</GhostButton>
          }
          right={
            <PrimaryButton onClick={handleSubmit}>
              <Send size={15} /> Send correction request
            </PrimaryButton>
          }
        />
      </div>
    </GlassCard>
  );
}

// ---------- Main page ----------------------------------------------------

export function FinanceCorrectionDetailPage({ paymentId }: { paymentId: string }) {
  const payment = MOCK_PAYMENTS.find((p) => p.id === paymentId);
  const mockThread = MOCK_CORRECTION_THREADS.find((t) => t.paymentId === paymentId);

  // Session state — messages appended this session
  const [sessionMessages, setSessionMessages] = useState<CorrectionMessage[]>([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Synthesise thread (mock + session appended)
  const allMessages = [
    ...(mockThread?.messages ?? []),
    ...sessionMessages,
  ];

  // Determine current status
  const lastMsg = allMessages[allMessages.length - 1];
  const currentStatus = sessionMessages.length > 0
    ? (sessionMessages[sessionMessages.length - 1].direction === 'finance_to_sales'
      ? 'awaiting_sales'
      : 'awaiting_finance')
    : (mockThread?.status ?? 'awaiting_finance');

  const canRaiseCorrection = currentStatus === 'awaiting_finance';
  const canResumeVerification = currentStatus === 'awaiting_finance';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages.length]);

  if (!payment) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <PageHeader
          eyebrow="Finance corrections"
          title="Case not found"
          description={`No payment record found for ID: ${paymentId}`}
        />
        <Link href="/finance/corrections" style={{ color: 'var(--sos-accent)', textDecoration: 'none', fontSize: 'var(--sos-text-sm)' }}>
          ← Back to corrections
        </Link>
      </div>
    );
  }

  function handleNewMessageSubmit(msg: CorrectionMessage) {
    setSessionMessages((prev) => [...prev, msg]);
    setShowNewForm(false);
  }

  // If no thread exists but we navigate here (e.g. from verification screen
  // via "Request correction" — show the new-form immediately)
  const isFirstCorrection = !mockThread && sessionMessages.length === 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sos-space-5)',
        maxWidth: 900,
        margin: '0 auto',
      }}
    >
      {/* Back link */}
      <Link
        href={'/finance/corrections' as Route}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 'var(--sos-text-sm)',
          color: 'var(--sos-muted)',
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={14} /> Corrections
      </Link>

      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--sos-space-4)',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <p
            style={{
              fontSize: 'var(--sos-text-xs)',
              color: 'var(--sos-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 4,
            }}
          >
            Finance corrections · {paymentId}
            {mockThread && <> · {mockThread.caseRef}</>}
          </p>
          <h1
            style={{
              fontSize: 'var(--sos-text-2xl)',
              fontWeight: 700,
              color: 'var(--sos-text)',
              marginBottom: 4,
            }}
          >
            {payment.clientName}
          </h1>
          <p style={{ fontSize: 'var(--sos-text-sm)', color: 'var(--sos-muted)' }}>
            {payment.service} · {payment.targetCountry} ·{' '}
            {fmtAmount(payment.receivedAmount, payment.currency)} ·{' '}
            {METHOD_LABEL[payment.paymentMethod]}
            {payment.transactionReference && ` · Ref: ${payment.transactionReference}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sos-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusBadge tone={STATUS_TONE[currentStatus]}>
            {STATUS_LABEL[currentStatus]}
          </StatusBadge>
          {(mockThread?.bounceCount ?? 0) + sessionMessages.filter(m => m.type === 'correction_request').length > 0 && (
            <StatusBadge tone={(mockThread?.bounceCount ?? 0) >= 2 ? 'warning' : 'neutral'}>
              <RotateCcw size={10} />{' '}
              {(mockThread?.bounceCount ?? 0) + sessionMessages.filter(m => m.type === 'correction_request').length} bounce(s)
            </StatusBadge>
          )}
        </div>
      </div>

      {/* Payment meta card */}
      <GlassCard>
        <div
          style={{
            padding: 'var(--sos-space-4) var(--sos-space-5)',
            display: 'flex',
            gap: 'var(--sos-space-6)',
            flexWrap: 'wrap',
          }}
        >
          {[
            { label: 'Sales person', value: payment.salesUserName },
            { label: 'Finance officer', value: payment.financeUserName ?? MOCK_FINANCE_USER.name },
            { label: 'Branch', value: payment.branch },
            { label: 'Sent to Finance', value: fmtRelative(payment.sentToFinanceAt) },
            { label: 'Sales note', value: payment.salesNote },
          ].map(({ label, value }) => (
            <div key={label}>
              <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', marginBottom: 2 }}>{label}</p>
              <p style={{ fontSize: 'var(--sos-text-sm)', fontWeight: 500, color: 'var(--sos-text)' }}>{value}</p>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Status banner */}
      {currentStatus === 'awaiting_finance' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sos-space-3)',
            padding: 'var(--sos-space-3) var(--sos-space-4)',
            background: 'color-mix(in srgb, var(--sos-success) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--sos-success) 30%, transparent)',
            borderRadius: 'var(--sos-radius-md)',
          }}
        >
          <CheckCircle2 size={18} style={{ color: 'var(--sos-success)', flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 'var(--sos-text-sm)', fontWeight: 600, color: 'var(--sos-success)' }}>
              Sales has resubmitted — your turn
            </p>
            <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)' }}>
              Review the latest resubmission below, then resume verification or raise another correction.
            </p>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sos-space-2)' }}>
            <SecondaryButton onClick={() => setShowNewForm(true)} disabled={showNewForm}>
              <RotateCcw size={14} /> Another correction
            </SecondaryButton>
            <SuccessButton>
              <ShieldCheck size={14} />
              <Link
                href={`/finance/intake/${paymentId}` as Route}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                Resume verification
              </Link>
            </SuccessButton>
          </div>
        </div>
      )}

      {currentStatus === 'awaiting_sales' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sos-space-3)',
            padding: 'var(--sos-space-3) var(--sos-space-4)',
            background: 'color-mix(in srgb, var(--sos-warning) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--sos-warning) 30%, transparent)',
            borderRadius: 'var(--sos-radius-md)',
          }}
        >
          <ArrowRight size={18} style={{ color: 'var(--sos-warning)', flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 'var(--sos-text-sm)', fontWeight: 600, color: 'var(--sos-warning)' }}>
              Waiting for {payment.salesUserName}
            </p>
            <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)' }}>
              Correction request has been sent. No further action needed until Sales responds.
            </p>
          </div>
        </div>
      )}

      {/* Thread header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sos-space-2)',
        }}
      >
        <MessageSquare size={16} style={{ color: 'var(--sos-muted)' }} />
        <span
          style={{
            fontSize: 'var(--sos-text-xs)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--sos-muted)',
          }}
        >
          Correction thread · {allMessages.length} message{allMessages.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Thread messages */}
      {allMessages.length === 0 && !isFirstCorrection ? (
        <GlassCard>
          <div style={{ padding: 'var(--sos-space-8)', textAlign: 'center', color: 'var(--sos-muted)' }}>
            No messages yet.
          </div>
        </GlassCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-3)' }}>
          {allMessages.map((msg, i) => (
            <ThreadMessage key={msg.id} msg={msg} index={i} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* New correction form or first-correction trigger */}
      {(isFirstCorrection || showNewForm) ? (
        <NewCorrectionForm
          onSubmit={handleNewMessageSubmit}
          onCancel={() => setShowNewForm(false)}
        />
      ) : (
        currentStatus !== 'awaiting_sales' && (
          <ActionBar
            right={
              <PrimaryButton onClick={() => setShowNewForm(true)}>
                <RotateCcw size={15} /> Raise another correction
              </PrimaryButton>
            }
          />
        )
      )}
    </div>
  );
}
