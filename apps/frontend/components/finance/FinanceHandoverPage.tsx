'use client';
// Finance Send to Processing — Screen 7 of 7.
// Shows RECEIPT_CONFIRMED cases ready for dispatch to Processing department.
// Officer selects processing assignment + adds a handover note, then fires
// "Send to Processing". Phase 1: mock data, session-state transitions.

import { useState, useEffect } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Inbox,
  Send,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  DangerButton,
  EmptyState,
  GhostButton,
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  SuccessButton,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import {
  fetchHandovers,
  reviewHandover,
  METHOD_LABEL,
  STATUS_LABEL,
  fmtAmount,
  fmtRelative,
  fmtDateTime,
  clientName,
  type ApiHandover,
  type FinanceHandoverStatus,
} from '@/lib/finance-api';

// ---------- Config -------------------------------------------------------

// Processing departments inferred from service
const DEPT_OPTIONS = [
  { value: 'study_visa', label: 'Study Visa' },
  { value: 'work_permit', label: 'Work Permit' },
  { value: 'visitor_visa', label: 'Visitor Visa' },
  { value: 'spouse_visa', label: 'Spouse / Family Visa' },
  { value: 'skilled_immigration', label: 'Skilled Immigration' },
  { value: 'general', label: 'General Processing' },
];

const OFFICER_OPTIONS = [
  { value: 'proc-usman', label: 'Usman T.' },
  { value: 'proc-aisha', label: 'Aisha N.' },
  { value: 'proc-khalid', label: 'Khalid B.' },
  { value: 'proc-sana', label: 'Sana R.' },
];

const DISPATCH_PRIORITY_OPTIONS: Array<{ value: string; label: string; tone: BadgeTone }> = [
  { value: 'Normal', label: 'Normal', tone: 'info' },
  { value: 'Rush', label: 'Rush', tone: 'warning' },
  { value: 'Critical', label: 'Critical', tone: 'danger' },
];

// Auto-suggest dept from service name
function suggestDept(service: string): string {
  const s = service.toLowerCase();
  if (s.includes('study')) return 'study_visa';
  if (s.includes('work')) return 'work_permit';
  if (s.includes('visit')) return 'visitor_visa';
  if (s.includes('spouse') || s.includes('family')) return 'spouse_visa';
  if (s.includes('skilled') || s.includes('immigration')) return 'skilled_immigration';
  return 'general';
}

// ---------- Types --------------------------------------------------------

interface HandoverForm {
  dept: string;
  officer: string;
  dispatchPriority: string;
  note: string;
}

type PanelState =
  | { type: 'none' }
  | { type: 'form'; payment: ApiHandover; form: HandoverForm }
  | { type: 'sent'; payment: ApiHandover; sentAt: string };

// ---------- Sub-components -----------------------------------------------

function QueueRow({
  payment,
  selected,
  isSent,
  onClick,
}: {
  payment: ApiHandover;
  selected: boolean;
  isSent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        background: selected
          ? 'var(--sos-accent-muted)'
          : isSent
          ? 'var(--sos-success-muted, color-mix(in srgb, var(--sos-success) 8%, transparent))'
          : 'var(--sos-surface)',
        border: selected
          ? '1px solid var(--sos-accent)'
          : '1px solid var(--sos-border)',
        borderRadius: 'var(--sos-radius-md)',
        padding: '14px 16px',
        cursor: 'pointer',
        transition: 'all 0.12s',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        opacity: isSent ? 0.65 : 1,
      }}
    >
      {/* Status indicator */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isSent
            ? 'var(--sos-success-muted, color-mix(in srgb, var(--sos-success) 12%, transparent))'
            : 'var(--sos-surface-2)',
          flexShrink: 0,
        }}
      >
        {isSent ? (
          <CheckCircle2 size={18} color="var(--sos-success)" />
        ) : (
          <FileText
            size={18}
            color='var(--sos-muted)'
          />
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 'var(--sos-text-sm)',
              fontWeight: 600,
              color: 'var(--sos-text)',
            }}
          >
            {payment.clientName}
          </span>
          {!isSent && (
            <StatusBadge tone="info" size="sm">
              Verified
            </StatusBadge>
          )}
          {isSent && (
            <StatusBadge tone="success" size="sm">
              Sent
            </StatusBadge>
          )}
        </div>
        <div
          style={{
            fontSize: 'var(--sos-text-xs)',
            color: 'var(--sos-muted)',
            marginTop: 3,
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span>{payment.lead.serviceInterest ?? '—'}</span>
          <span>·</span>
          <span>{payment.lead.targetCountry ?? '—'}</span>
          <span>·</span>
          <span style={{ fontFamily: 'monospace' }}>
            {fmtAmount(payment.submittedAmount, payment.currency)}
          </span>
        </div>
      </div>

      {/* Chevron */}
      <ChevronRight
        size={16}
        style={{ color: 'var(--sos-muted)', flexShrink: 0 }}
      />
    </button>
  );
}

// ---------- Handover detail panel ----------------------------------------

interface HandoverPanelProps {
  payment: ApiHandover;
  form: HandoverForm;
  onChange: (form: HandoverForm) => void;
  onSend: () => void;
  onCancel: () => void;
}

function HandoverPanel({
  payment,
  form,
  onChange,
  onSend,
  onCancel,
}: HandoverPanelProps) {
  const [noteError, setNoteError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const set = <K extends keyof HandoverForm>(k: K) =>
    (v: HandoverForm[K]) => {
      onChange({ ...form, [k]: v });
      if (k === 'note' && noteError) setNoteError('');
    };

  function handleSendClick() {
    if (form.note.trim().length < 10) {
      setNoteError('Handover note must be at least 10 characters.');
      return;
    }
    setConfirmOpen(true);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sos-space-4)',
      }}
    >
      {/* Client summary card */}
      <GlassCard>
        <div style={{ padding: 'var(--sos-space-4) var(--sos-space-5)' }}>
          <p
            style={{
              fontSize: 'var(--sos-text-xs)',
              color: 'var(--sos-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
              marginBottom: 10,
            }}
          >
            Client &amp; Payment Summary
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px 20px',
            }}
          >
            {[
              ['Client', clientName(payment)],
              ['Service', payment.lead.serviceInterest ?? '—'],
              ['Target country', payment.lead.targetCountry ?? '—'],
              ['Amount', fmtAmount(payment.submittedAmount, payment.currency)],
              ['Method', payment.paymentMethod ? (METHOD_LABEL[payment.paymentMethod] ?? payment.paymentMethod) : '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <p
                  style={{
                    fontSize: 'var(--sos-text-xs)',
                    color: 'var(--sos-muted)',
                  }}
                >
                  {label}
                </p>
                <p
                  style={{
                    fontSize: 'var(--sos-text-sm)',
                    fontWeight: 500,
                    color: 'var(--sos-text)',
                  }}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </GlassCard>

      {/* Notes (read-only) */}
      {(payment.notes || payment.financeNotes) && (
        <GlassCard>
          <div style={{ padding: 'var(--sos-space-4) var(--sos-space-5)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {payment.notes && (
              <div>
                <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', fontWeight: 600, marginBottom: 4 }}>
                  Sales note
                </p>
                <p style={{ fontSize: 'var(--sos-text-sm)', color: 'var(--sos-text)' }}>
                  {payment.notes}
                </p>
              </div>
            )}
            {payment.financeNotes && (
              <div>
                <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', fontWeight: 600, marginBottom: 4 }}>
                  Finance note
                </p>
                <p style={{ fontSize: 'var(--sos-text-sm)', color: 'var(--sos-text)' }}>
                  {payment.financeNotes}
                </p>
              </div>
            )}
          </div>
        </GlassCard>
      )}

      {/* Processing assignment */}
      <GlassCard>
        <div style={{ padding: 'var(--sos-space-4) var(--sos-space-5)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Processing Assignment
          </p>

          {/* Department */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', fontWeight: 500 }}>
              Processing department
            </label>
            <select
              value={form.dept}
              onChange={(e) => set('dept')(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--sos-radius-sm)',
                border: '1px solid var(--sos-border)',
                background: 'var(--sos-input-bg)',
                color: 'var(--sos-text)',
                fontSize: 'var(--sos-text-sm)',
              }}
            >
              {DEPT_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Officer */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', fontWeight: 500 }}>
              Processing officer
              <span style={{ marginLeft: 6, color: 'var(--sos-accent)', fontSize: 10, fontWeight: 400 }}>
                (auto-assigned by load balancer)
              </span>
            </label>
            <select
              value={form.officer}
              onChange={(e) => set('officer')(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--sos-radius-sm)',
                border: '1px solid var(--sos-border)',
                background: 'var(--sos-input-bg)',
                color: 'var(--sos-text)',
                fontSize: 'var(--sos-text-sm)',
              }}
            >
              {OFFICER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Dispatch priority */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', fontWeight: 500 }}>
              Dispatch priority
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {DISPATCH_PRIORITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => set('dispatchPriority')(opt.value)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 99,
                    border:
                      form.dispatchPriority === opt.value
                        ? '1.5px solid var(--sos-accent)'
                        : '1px solid var(--sos-border)',
                    background:
                      form.dispatchPriority === opt.value
                        ? 'var(--sos-accent-muted)'
                        : 'var(--sos-surface)',
                    color:
                      form.dispatchPriority === opt.value
                        ? 'var(--sos-accent)'
                        : 'var(--sos-muted)',
                    fontSize: 'var(--sos-text-xs)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Finance handover note */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', fontWeight: 500 }}>
              Finance handover note
              <span style={{ marginLeft: 4, color: 'var(--sos-danger)' }}>*</span>
            </label>
            <textarea
              value={form.note}
              onChange={(e) => set('note')(e.target.value)}
              rows={4}
              placeholder="What should Processing know first? Include any special instructions, client urgency, partial payment notes, etc."
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--sos-radius-sm)',
                border: noteError
                  ? '1.5px solid var(--sos-danger)'
                  : '1px solid var(--sos-border)',
                background: 'var(--sos-input-bg)',
                color: 'var(--sos-text)',
                fontSize: 'var(--sos-text-sm)',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            {noteError && (
              <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <TriangleAlert size={12} /> {noteError}
              </p>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Action bar */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--sos-space-3)',
          justifyContent: 'flex-end',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <GhostButton onClick={onCancel}>
          <X size={14} /> Cancel
        </GhostButton>
        <SecondaryButton>
          <Clock size={14} /> Hold dispatch
        </SecondaryButton>
        <SuccessButton onClick={handleSendClick}>
          <Send size={15} /> Send to Processing
        </SuccessButton>
      </div>

      {/* Confirm dialog */}
      {confirmOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: 'var(--sos-surface)',
              border: '1px solid var(--sos-border)',
              borderRadius: 'var(--sos-radius-lg)',
              padding: 'var(--sos-space-6)',
              maxWidth: 440,
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--sos-space-4)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: 'color-mix(in srgb, var(--sos-success) 14%, transparent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ArrowRight size={20} color="var(--sos-success)" />
              </div>
              <div>
                <p style={{ fontSize: 'var(--sos-text-base)', fontWeight: 700, color: 'var(--sos-text)' }}>
                  Send to Processing?
                </p>
                <p style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)', marginTop: 2 }}>
                  {clientName(payment)} · {fmtAmount(payment.submittedAmount, payment.currency)}
                </p>
              </div>
            </div>

            <div
              style={{
                background: 'var(--sos-surface-2)',
                borderRadius: 'var(--sos-radius-sm)',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                fontSize: 'var(--sos-text-xs)',
                color: 'var(--sos-muted)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Department</span>
                <span style={{ color: 'var(--sos-text)', fontWeight: 500 }}>
                  {DEPT_OPTIONS.find((d) => d.value === form.dept)?.label}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Officer</span>
                <span style={{ color: 'var(--sos-text)', fontWeight: 500 }}>
                  {OFFICER_OPTIONS.find((o) => o.value === form.officer)?.label}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Priority</span>
                <span style={{ color: 'var(--sos-text)', fontWeight: 500 }}>
                  {form.dispatchPriority}
                </span>
              </div>
            </div>

            <p style={{ fontSize: 'var(--sos-text-sm)', color: 'var(--sos-muted)' }}>
              This will move the case to the Processing department. The sales
              person and admin will be notified. This action is logged.
            </p>

            <div style={{ display: 'flex', gap: 'var(--sos-space-3)', justifyContent: 'flex-end' }}>
              <SecondaryButton onClick={() => setConfirmOpen(false)}>
                Go back
              </SecondaryButton>
              <SuccessButton
                onClick={() => {
                  setConfirmOpen(false);
                  onSend();
                }}
              >
                <Send size={14} /> Confirm — Send to Processing
              </SuccessButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Sent confirmation panel --------------------------------------

function SentPanel({ payment }: { payment: ApiHandover }) {
  return (
    <GlassCard>
      <div
        style={{
          padding: 'var(--sos-space-6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--sos-space-4)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'color-mix(in srgb, var(--sos-success) 14%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CheckCircle2 size={32} color="var(--sos-success)" />
        </div>
        <div>
          <p
            style={{
              fontSize: 'var(--sos-text-lg)',
              fontWeight: 700,
              color: 'var(--sos-text)',
            }}
          >
            Sent to Processing
          </p>
          <p
            style={{
              fontSize: 'var(--sos-text-sm)',
              color: 'var(--sos-muted)',
              marginTop: 4,
            }}
          >
            {clientName(payment)} ·{' '}
            {fmtAmount(payment.submittedAmount, payment.currency)} has been
            dispatched to the Processing department.
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 'var(--sos-space-2)',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <StatusBadge tone="success" size="sm">
            Status updated to Sent to Processing
          </StatusBadge>
          <StatusBadge tone="info" size="sm">
            Sales notified
          </StatusBadge>
          <StatusBadge tone="info" size="sm">
            Audit logged
          </StatusBadge>
        </div>
      </div>
    </GlassCard>
  );
}

// ---------- Empty panel --------------------------------------------------

function NonePanel() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 280,
      }}
    >
      <div style={{ textAlign: 'center', color: 'var(--sos-muted)' }}>
        <ArrowRight size={32} style={{ opacity: 0.25, margin: '0 auto 12px' }} />
        <p style={{ fontSize: 'var(--sos-text-sm)' }}>
          Select a case from the queue to review and send.
        </p>
      </div>
    </div>
  );
}

// ---------- Main page ----------------------------------------------------

export function FinanceHandoverPage() {
  const [handovers, setHandovers] = useState<ApiHandover[]>([]);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<PanelState>({ type: 'none' });

  useEffect(() => {
    fetchHandovers({ status: 'PAYMENT_VERIFIED' }).then(setHandovers).catch(console.error);
  }, []);

  // Keep sent items visible in the list
  const queue = handovers.filter(
    (p) => p.status === 'PAYMENT_VERIFIED' || sentIds.has(p.id),
  );

  // Sort: sent last
  const sortedQueue = [...queue].sort((a, b) => {
    const aSent = sentIds.has(a.id) ? 1 : 0;
    const bSent = sentIds.has(b.id) ? 1 : 0;
    return aSent - bSent;
  });

  const pendingCount = queue.filter((p) => !sentIds.has(p.id)).length;
  const sentCount = sentIds.size;
  const totalAmount = queue
    .filter((p) => !sentIds.has(p.id))
    .reduce((s, p) => s + parseFloat(p.submittedAmount), 0);

  function openPayment(handover: ApiHandover) {
    if (sentIds.has(handover.id)) {
      setPanel({ type: 'sent', payment: handover, sentAt: new Date().toISOString() });
      return;
    }
    setPanel({
      type: 'form',
      payment: handover,
      form: {
        dept: suggestDept(handover.lead.serviceInterest ?? ''),
        officer: 'proc-aisha',
        dispatchPriority: 'Normal',
        note: '',
      },
    });
  }

  async function handleSend() {
    if (panel.type !== 'form') return;
    const { payment } = panel;
    try {
      await reviewHandover(payment.id, 'RECORD_PAYMENT', { financeNotes: panel.form.note || 'Sent to processing' });
      setSentIds((prev) => new Set([...prev, payment.id]));
      setPanel({ type: 'sent', payment, sentAt: new Date().toISOString() });
    } catch {
      // fail silently for now
    }
  }

  function handleCancel() {
    setPanel({ type: 'none' });
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sos-space-5)',
        maxWidth: 1280,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <PageHeader
        eyebrow="Finance"
        title="Send to Processing"
        description="Dispatch receipt-confirmed cases to the Processing department"
      />

      {/* Metrics strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 'var(--sos-space-4)',
        }}
      >
        <MetricCard
          label="Ready to dispatch"
          value={String(pendingCount)}
          tone={pendingCount > 0 ? 'warning' : 'success'}
        />
        <MetricCard
          label="Dispatched this session"
          value={String(sentCount)}
          tone="success"
        />
        <MetricCard
          label="Pending amount"
          value={`CAD ${totalAmount.toLocaleString()}`}
          tone="neutral"
        />
      </div>

      {/* Two-column layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
          gap: 'var(--sos-space-5)',
          alignItems: 'start',
        }}
      >
        {/* Left: queue list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-3)' }}>
          <p
            style={{
              fontSize: 'var(--sos-text-xs)',
              color: 'var(--sos-muted)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Handover Queue · {queue.length} case{queue.length !== 1 ? 's' : ''}
          </p>

          {sortedQueue.length === 0 ? (
            <EmptyState
              Icon={Inbox}
              title="Queue is clear"
              description="No receipt-confirmed cases waiting for dispatch."
            />
          ) : (
            sortedQueue.map((p) => (
              <QueueRow
                key={p.id}
                payment={p}
                selected={
                  panel.type !== 'none' && panel.payment.id === p.id
                }
                isSent={sentIds.has(p.id)}
                onClick={() => openPayment(p)}
              />
            ))
          )}
        </div>

        {/* Right: detail panel */}
        <div>
          {panel.type === 'none' && <NonePanel />}
          {panel.type === 'form' && (
            <HandoverPanel
              payment={panel.payment}
              form={panel.form}
              onChange={(form) =>
                setPanel({ type: 'form', payment: panel.payment, form })
              }
              onSend={handleSend}
              onCancel={handleCancel}
            />
          )}
          {panel.type === 'sent' && <SentPanel payment={panel.payment} />}
        </div>
      </div>
    </div>
  );
}
