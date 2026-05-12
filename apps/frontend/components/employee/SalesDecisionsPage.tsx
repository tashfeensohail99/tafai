'use client';
// Sales OS — Decisions (premium dark glass redesign).
//
// This is the hand-off screen — money or meeting. Two clear paths:
//   PAY  → capture receipt + send to Finance (the high-stakes path).
//   BOOK → schedule the next consultation.
//
// Patterns inspired by Stripe / Pipedrive / HubSpot deal-close flows:
//   1. Active-lead chooser with rich preview (avatar, stage, owner, priority).
//   2. Path picker with clear consequences ("what happens when you click").
//   3. Live receipt summary that builds as the rep types — what Finance will see.
//   4. Currency-aware amount input with quick chips for common deposit sizes.
//   5. Drag/drop upload with file list, size, and remove.
//   6. Sales note for finance + checklist of pre-flight items before send.
//   7. Sticky-feeling success banner with stage transition explanation.

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowRight,
  Banknote,
  CalendarPlus,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  FileImage,
  Loader2,
  Receipt,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import {
  type Lead,
  PRIORITY_LABEL,
  STAGE_LABEL,
  initialsOf,
  stageDotColor,
} from '@/components/sales-v2/mockData';
import {
  ButtonLink,
  Field,
  FormInput,
  FormSelect,
  FormTextarea,
  GlassCard,
  PageHeader,
  SecondaryButton,
  StatusBadge,
  SuccessButton,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { fetchLeads } from '@/lib/sales-api';

type Path = 'BOOK' | 'PAY';

const PAY_METHODS: Array<{
  key: string;
  label: string;
  caption: string;
  Icon: typeof CreditCard;
  tone: string;
}> = [
  {
    key: 'CASH',
    label: 'Cash',
    caption: 'Received in office',
    Icon: Banknote,
    tone: 'var(--sos-brand-accent)',
  },
  {
    key: 'BANK',
    label: 'Bank Transfer',
    caption: 'Slip / IBAN transfer',
    Icon: ShieldCheck,
    tone: 'var(--sos-status-info)',
  },
  {
    key: 'CARD',
    label: 'Card',
    caption: 'POS or online',
    Icon: CreditCard,
    tone: 'var(--sos-status-violet)',
  },
  {
    key: 'OTHER',
    label: 'Other',
    caption: 'JazzCash, EasyPaisa…',
    Icon: Wallet,
    tone: 'var(--sos-status-cyan)',
  },
];

const CURRENCIES = ['CAD', 'USD', 'GBP', 'EUR', 'AED', 'PKR'] as const;

const AMOUNT_PRESETS = [
  { amount: '500', label: '500' },
  { amount: '1000', label: '1,000' },
  { amount: '1500', label: '1,500' },
  { amount: '2500', label: '2,500' },
];

const MEETING_TYPE_LABEL: Record<string, string> = {
  OFFICE_MEETING: 'Office Meeting',
  VIDEO_CALL: 'Video Call',
  PHONE_CONSULT: 'Phone Consult',
  OFFICE_VISIT: 'Office Visit',
};

function priorityTone(p: Lead['priority']): BadgeTone {
  return p === 'HIGH' ? 'danger' : p === 'MEDIUM' ? 'warning' : 'neutral';
}

function stageBadgeTone(stage: Lead['stage']): BadgeTone {
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

export function SalesDecisionsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeads().then((l) => {
      setLeads(l);
      const def = l.find((x) => x.stage === 'PAYMENT_INTERESTED') ?? l[0];
      if (def) setLeadId(def.id);
    }).finally(() => setLoading(false));
  }, []);

  const [leadId, setLeadId] = useState('');
  const [path, setPath] = useState<Path>('PAY');
  const lead = useMemo(() => leads.find((l) => l.id === leadId), [leads, leadId]);

  // Payment state
  const [amount, setAmount] = useState('1500');
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('CAD');
  const [method, setMethod] = useState('CASH');
  const [receivedDate, setReceivedDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [receivedBy, setReceivedBy] = useState('Awais Q.');
  const [financeNote, setFinanceNote] = useState(
    'Client paid full deposit in cash at the office. Receipt attached.',
  );
  const [files, setFiles] = useState<Array<{ name: string; size: string }>>([
    { name: 'receipt-cash-1500cad.jpg', size: '184 KB' },
  ]);
  const [sent, setSent] = useState(false);

  // Appointment state
  const [meetingType, setMeetingType] = useState('OFFICE_MEETING');
  const [meetingDate, setMeetingDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  });
  const [meetingTime, setMeetingTime] = useState('15:00');

  function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    if (!list.length) return;
    setFiles((prev) => [
      ...prev,
      ...list.map((f) => ({
        name: f.name,
        size: `${Math.max(1, Math.round(f.size / 1024))} KB`,
      })),
    ]);
  }

  function removeFile(name: string) {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }

  function onSendToFinance(e: FormEvent) {
    e.preventDefault();
    setSent(true);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: '10px', color: 'var(--sos-text-muted)' }}>
        <Loader2 size={20} className="sos-spin" />
        <span>Loading leads…</span>
      </div>
    );
  }

  if (!lead) {
    return (
      <GlassCard variant="strong" padded="lg">
        <div style={{ textAlign: 'center', padding: '36px 16px' }}>
          <h3 className="sos-title" style={{ fontSize: '17px' }}>
            No active leads
          </h3>
          <p
            className="sos-text-muted"
            style={{ marginTop: '6px', fontSize: '13.5px' }}
          >
            Create or import a lead to start a decision flow.
          </p>
          <div style={{ marginTop: '16px' }}>
            <ButtonLink
              href={'/sales/create-lead' as Route}
              variant="primary"
              iconLeft={<Sparkles size={15} />}
            >
              Create new lead
            </ButtonLink>
          </div>
        </div>
      </GlassCard>
    );
  }

  const formattedAmount = `${currency} ${Number(amount || 0).toLocaleString()}`;
  const checklist: Array<{ label: string; done: boolean }> = [
    { label: 'Active lead selected', done: !!lead },
    { label: 'Amount entered', done: Number(amount) > 0 },
    { label: 'Payment method chosen', done: !!method },
    { label: 'Receipt or proof uploaded', done: files.length > 0 },
    { label: 'Note for finance written', done: financeNote.trim().length > 8 },
  ];
  const allReady = checklist.every((c) => c.done);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="Decisions"
        title={
          <>
            What does the client<br />want to do next?
          </>
        }
        description={
          <>
            Pick the lead, then choose either to book a follow-up meeting or
            capture the payment receipt and send the case to Finance for
            verification.
          </>
        }
        actions={
          <>
            <ButtonLink
              href={`/sales/leads/${lead.id}` as Route}
              variant="ghost"
              iconRight={<ArrowRight size={14} />}
            >
              View lead profile
            </ButtonLink>
            <ButtonLink
              href={'/sales/leads' as Route}
              variant="secondary"
              iconLeft={<ArrowRight size={14} />}
            >
              Open queue
            </ButtonLink>
          </>
        }
      />

      <ActiveLeadCard
        lead={lead}
        leads={leads}
        leadId={leadId}
        setLeadId={setLeadId}
      />

      <PathPicker path={path} setPath={setPath} />

      {path === 'BOOK' ? (
        <BookPath
          meetingType={meetingType}
          setMeetingType={setMeetingType}
          meetingDate={meetingDate}
          setMeetingDate={setMeetingDate}
          meetingTime={meetingTime}
          setMeetingTime={setMeetingTime}
        />
      ) : (
        <PayPath
          lead={lead}
          amount={amount}
          setAmount={setAmount}
          currency={currency}
          setCurrency={setCurrency}
          method={method}
          setMethod={setMethod}
          receivedDate={receivedDate}
          setReceivedDate={setReceivedDate}
          receivedBy={receivedBy}
          setReceivedBy={setReceivedBy}
          financeNote={financeNote}
          setFinanceNote={setFinanceNote}
          files={files}
          onUpload={onUpload}
          removeFile={removeFile}
          onSendToFinance={onSendToFinance}
          sent={sent}
          formattedAmount={formattedAmount}
          checklist={checklist}
          allReady={allReady}
        />
      )}
    </div>
  );
}

function ActiveLeadCard({
  lead,
  leads,
  leadId,
  setLeadId,
}: {
  lead: Lead;
  leads: Lead[];
  leadId: string;
  setLeadId: (id: string) => void;
}) {
  return (
    <GlassCard variant="strong" padded="lg" glow="accent">
      <div
        style={{
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
        }}
        className="sos-detail-grid"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="sos-eyebrow">Active lead</div>
          <FormSelect
            label=""
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            options={leads.map((l) => ({
              value: l.id,
              label: `${l.firstName} ${l.lastName} · ${l.service} · ${STAGE_LABEL[l.stage]}`,
            }))}
            inputSize="lg"
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '14px 16px',
              borderRadius: 'var(--sos-radius-sm)',
              background: 'var(--sos-surface-1)',
              border: '1px solid var(--sos-border-subtle)',
            }}
          >
            <div
              className="sos-avatar sos-avatar--lg"
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
                    fontSize: '15px',
                    fontWeight: 700,
                    color: 'var(--sos-text-primary)',
                  }}
                >
                  {lead.firstName} {lead.lastName}
                </span>
                <StatusBadge tone={stageBadgeTone(lead.stage)}>
                  {STAGE_LABEL[lead.stage]}
                </StatusBadge>
                <StatusBadge tone={priorityTone(lead.priority)} size="sm">
                  {PRIORITY_LABEL[lead.priority]}
                </StatusBadge>
              </div>
              <div
                className="sos-text-muted"
                style={{ marginTop: '6px', fontSize: '12.5px' }}
              >
                {lead.service} → {lead.targetCountry} · {lead.phone}
              </div>
            </div>
            <Link
              href={`/sales/leads/${lead.id}` as Route}
              className="sos-btn sos-btn--ghost sos-btn--sm"
              style={{ textDecoration: 'none', flexShrink: 0 }}
            >
              Profile <ArrowRight size={12} />
            </Link>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '10px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          }}
        >
          <SnapshotMini
            label="Sales owner"
            value={lead.assignedBy?.replace('Admin · ', '') ?? 'Auto CRM'}
          />
          <SnapshotMini label="Service" value={lead.service} />
          <SnapshotMini label="Country" value={lead.targetCountry} />
          <SnapshotMini
            label="Source"
            value={lead.source.replace('_', ' ').toLowerCase()}
          />
        </div>
      </div>
    </GlassCard>
  );
}

function SnapshotMini({ label, value }: { label: string; value: string }) {
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

function PathPicker({
  path,
  setPath,
}: {
  path: Path;
  setPath: (p: Path) => void;
}) {
  return (
    <section
      style={{
        display: 'grid',
        gap: '14px',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      }}
    >
      <PathTile
        active={path === 'BOOK'}
        tone="var(--sos-status-info)"
        Icon={CalendarPlus}
        title="Book Next Meeting"
        caption="Client is not ready to pay yet — schedule another consultation and queue a reminder follow-up."
        outcome="Stage → Appointment Booked"
        onClick={() => setPath('BOOK')}
      />
      <PathTile
        active={path === 'PAY'}
        tone="var(--sos-status-success)"
        Icon={Wallet}
        title="Client Wants to Pay Now"
        caption="Capture the payment receipt and send the case to Finance for verification."
        outcome="Stage → Sent to Finance"
        onClick={() => setPath('PAY')}
      />
    </section>
  );
}

function PathTile({
  active,
  tone,
  Icon,
  title,
  caption,
  outcome,
  onClick,
}: {
  active: boolean;
  tone: string;
  Icon: typeof CalendarPlus;
  title: string;
  caption: string;
  outcome: string;
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
        gap: '14px',
        padding: '20px',
        borderRadius: 'var(--sos-radius-card)',
        border: active ? '1.5px solid ' + tone : '1px solid var(--sos-border)',
        background: active
          ? 'color-mix(in srgb, ' + tone + ' 12%, transparent)'
          : 'var(--sos-surface-1)',
        boxShadow: active
          ? `0 0 0 4px color-mix(in srgb, ${tone} 18%, transparent), var(--sos-shadow-glass)`
          : 'var(--sos-shadow-xs)',
        transition: 'all 180ms ease',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '52px',
          height: '52px',
          borderRadius: '16px',
          display: 'grid',
          placeItems: 'center',
          background: 'color-mix(in srgb, ' + tone + ' 18%, transparent)',
          color: tone,
          border: '1px solid color-mix(in srgb, ' + tone + ' 30%, transparent)',
          flexShrink: 0,
        }}
      >
        <Icon size={22} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: 'var(--sos-text-primary)',
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </span>
          {active ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 10px',
                fontSize: '10.5px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                borderRadius: '999px',
                background: tone,
                color: 'var(--sos-text-on-accent)',
              }}
            >
              <CheckCircle2 size={11} /> Selected
            </span>
          ) : null}
        </div>
        <p
          className="sos-text-muted"
          style={{ marginTop: '6px', fontSize: '12.5px', lineHeight: 1.55 }}
        >
          {caption}
        </p>
        <div
          style={{
            marginTop: '10px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11.5px',
            fontWeight: 600,
            color: tone,
          }}
        >
          <ArrowRight size={12} /> {outcome}
        </div>
      </div>
    </button>
  );
}

function BookPath({
  meetingType,
  setMeetingType,
  meetingDate,
  setMeetingDate,
  meetingTime,
  setMeetingTime,
}: {
  meetingType: string;
  setMeetingType: (s: string) => void;
  meetingDate: string;
  setMeetingDate: (s: string) => void;
  meetingTime: string;
  setMeetingTime: (s: string) => void;
}) {
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
          <div className="sos-eyebrow">Path A · Book next meeting</div>
          <h2
            className="sos-title"
            style={{ fontSize: '17px', marginTop: '6px' }}
          >
            Schedule the follow-up consultation
          </h2>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '13px' }}
          >
            Pick the format and slot. The lead stage will move to{' '}
            <strong style={{ color: 'var(--sos-text-primary)' }}>
              Appointment Booked
            </strong>{' '}
            and a reminder follow-up will be queued automatically.
          </p>
        </div>
      </div>

      <div
        style={{
          marginTop: '20px',
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <FormSelect
          label="Meeting type"
          required
          value={meetingType}
          onChange={(e) => setMeetingType(e.target.value)}
          options={[
            { value: 'OFFICE_MEETING', label: 'Office Meeting' },
            { value: 'VIDEO_CALL', label: 'Video Call' },
            { value: 'PHONE_CONSULT', label: 'Phone Consult' },
            { value: 'OFFICE_VISIT', label: 'Office Visit' },
          ]}
        />
        <Field label="Date" required>
          <input
            type="date"
            className="sos-input"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
          />
        </Field>
        <Field label="Time" required>
          <input
            type="time"
            className="sos-input"
            value={meetingTime}
            onChange={(e) => setMeetingTime(e.target.value)}
          />
        </Field>
      </div>

      <div className="sos-banner sos-banner--info" style={{ marginTop: '18px' }}>
        <Sparkles size={14} />
        <span>
          Booking will move the lead to{' '}
          <strong style={{ color: 'var(--sos-status-info)' }}>
            Appointment Booked
          </strong>{' '}
          and queue a reminder one hour before the slot.
        </span>
      </div>

      <div
        style={{
          marginTop: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        <SecondaryButton>Save draft</SecondaryButton>
        <ButtonLink
          href={'/sales/appointments' as Route}
          variant="primary"
          iconLeft={<CalendarPlus size={15} />}
        >
          Confirm booking
        </ButtonLink>
      </div>
    </GlassCard>
  );
}

function PayPath({
  lead,
  amount,
  setAmount,
  currency,
  setCurrency,
  method,
  setMethod,
  receivedDate,
  setReceivedDate,
  receivedBy,
  setReceivedBy,
  financeNote,
  setFinanceNote,
  files,
  onUpload,
  removeFile,
  onSendToFinance,
  sent,
  formattedAmount,
  checklist,
  allReady,
}: {
  lead: Lead;
  amount: string;
  setAmount: (s: string) => void;
  currency: (typeof CURRENCIES)[number];
  setCurrency: (c: (typeof CURRENCIES)[number]) => void;
  method: string;
  setMethod: (s: string) => void;
  receivedDate: string;
  setReceivedDate: (s: string) => void;
  receivedBy: string;
  setReceivedBy: (s: string) => void;
  financeNote: string;
  setFinanceNote: (s: string) => void;
  files: Array<{ name: string; size: string }>;
  onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  removeFile: (name: string) => void;
  onSendToFinance: (e: FormEvent) => void;
  sent: boolean;
  formattedAmount: string;
  checklist: Array<{ label: string; done: boolean }>;
  allReady: boolean;
}) {
  return (
    <section
      style={{
        display: 'grid',
        gap: '20px',
        gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
      }}
      className="sos-detail-grid"
    >
      <GlassCard variant="strong" padded="lg" glow="accent">
        <form onSubmit={onSendToFinance}>
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
              <div className="sos-eyebrow">Path B · Payment receipt</div>
              <h2
                className="sos-title"
                style={{ fontSize: '17px', marginTop: '6px' }}
              >
                Capture and send to Finance
              </h2>
              <p
                className="sos-text-muted"
                style={{ marginTop: '4px', fontSize: '13px' }}
              >
                Sales records the receipt — Finance verifies the actual money.
              </p>
            </div>
            <StatusBadge tone="warm" size="sm">
              <Receipt size={11} /> Pre-finance
            </StatusBadge>
          </div>

          {/* Amount + currency */}
          <div style={{ marginTop: '20px' }}>
            <Field
              label="Amount"
              required
              hint="Use whole numbers in the deposit currency."
            >
              <div
                style={{
                  display: 'grid',
                  gap: '10px',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                }}
              >
                <FormInput
                  iconLeft={<Receipt size={14} />}
                  inputSize="lg"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                />
                <select
                  className="sos-select sos-input--lg"
                  value={currency}
                  onChange={(e) =>
                    setCurrency(e.target.value as (typeof CURRENCIES)[number])
                  }
                  style={{ minWidth: '110px' }}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div
                style={{
                  marginTop: '10px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px',
                }}
              >
                {AMOUNT_PRESETS.map((p) => (
                  <button
                    key={p.amount}
                    type="button"
                    onClick={() => setAmount(p.amount)}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      padding: '6px 12px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '999px',
                      border:
                        amount === p.amount
                          ? '1px solid var(--sos-border-accent)'
                          : '1px solid var(--sos-border)',
                      background:
                        amount === p.amount
                          ? 'var(--sos-brand-primary-soft)'
                          : 'var(--sos-surface-1)',
                      color:
                        amount === p.amount
                          ? 'var(--sos-brand-primary-strong)'
                          : 'var(--sos-text-secondary)',
                      transition: 'all 160ms ease',
                    }}
                  >
                    {currency} {p.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {/* Payment method */}
          <div style={{ marginTop: '20px' }}>
            <Field label="Payment method" required>
              <div
                style={{
                  display: 'grid',
                  gap: '10px',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                }}
              >
                {PAY_METHODS.map(({ key, label, caption, Icon, tone }) => (
                  <MethodTile
                    key={key}
                    active={method === key}
                    onClick={() => setMethod(key)}
                    label={label}
                    caption={caption}
                    Icon={Icon}
                    tone={tone}
                  />
                ))}
              </div>
            </Field>
          </div>

          {/* Date + receiver */}
          <div
            style={{
              marginTop: '20px',
              display: 'grid',
              gap: '16px',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <Field label="Payment received date" required>
              <input
                type="date"
                className="sos-input"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
              />
            </Field>
            <FormInput
              label="Received by"
              required
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
            />
          </div>

          {/* Upload */}
          <div style={{ marginTop: '20px' }}>
            <Field
              label="Receipt / proof of payment"
              required
              hint="Bank slip, cash receipt, transfer screenshot, or card receipt."
            >
              <label className="sos-dropzone" style={{ display: 'block' }}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    alignItems: 'center',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '14px',
                      display: 'grid',
                      placeItems: 'center',
                      background: 'var(--sos-brand-primary-soft)',
                      color: 'var(--sos-brand-primary-strong)',
                      border: '1px solid var(--sos-brand-primary-border)',
                    }}
                  >
                    <Upload size={20} />
                  </div>
                  <div
                    style={{
                      fontSize: '13.5px',
                      fontWeight: 600,
                      color: 'var(--sos-text-primary)',
                    }}
                  >
                    Drop files here or click to browse
                  </div>
                  <div
                    className="sos-text-faint"
                    style={{ fontSize: '11.5px' }}
                  >
                    PNG, JPG, or PDF up to 10 MB · multiple files supported
                  </div>
                </div>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={onUpload}
                  hidden
                />
              </label>

              {files.length > 0 ? (
                <div
                  style={{
                    marginTop: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  {files.map((f) => (
                    <FileRow
                      key={f.name}
                      name={f.name}
                      size={f.size}
                      onRemove={() => removeFile(f.name)}
                    />
                  ))}
                </div>
              ) : null}
            </Field>
          </div>

          <div style={{ marginTop: '20px' }}>
            <FormTextarea
              label="Sales note for Finance"
              hint="Anything finance should know about this transaction."
              value={financeNote}
              onChange={(e) => setFinanceNote(e.target.value)}
              placeholder="e.g. Client paid full deposit in cash at the office. Receipt attached."
              style={{ minHeight: 110 }}
            />
          </div>

          {sent ? (
            <div
              className="sos-banner sos-banner--success"
              style={{ marginTop: '16px' }}
            >
              <CheckCircle2 size={15} />
              <span>
                Sent to Finance. Lead stage is now{' '}
                <strong style={{ color: 'var(--sos-status-success)' }}>
                  Sent to Finance
                </strong>
                . You will be notified once payment is verified.
              </span>
            </div>
          ) : null}

          <div
            style={{
              marginTop: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              paddingTop: '20px',
              borderTop: '1px solid var(--sos-divider)',
            }}
          >
            <span
              className="sos-text-muted"
              style={{ fontSize: '12.5px' }}
            >
              {allReady
                ? 'Everything looks ready to send.'
                : 'Complete the checklist on the right before sending.'}
            </span>
            <div
              style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}
            >
              <SecondaryButton type="button">Save draft</SecondaryButton>
              <SuccessButton
                type="submit"
                disabled={!allReady || sent}
                iconLeft={<Send size={15} />}
              >
                {sent ? 'Sent to Finance' : 'Send to Finance'}
              </SuccessButton>
            </div>
          </div>
        </form>
      </GlassCard>

      <aside
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          minWidth: 0,
        }}
      >
        <FinanceSummaryCard
          lead={lead}
          formattedAmount={formattedAmount}
          method={method}
          receivedDate={receivedDate}
          receivedBy={receivedBy}
          fileCount={files.length}
        />
        <ChecklistCard checklist={checklist} />
        <HandoffNoteCard />
      </aside>
    </section>
  );
}

function MethodTile({
  active,
  onClick,
  label,
  caption,
  Icon,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  caption: string;
  Icon: typeof CreditCard;
  tone: string;
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
        gap: '10px',
        padding: '12px 14px',
        borderRadius: 'var(--sos-radius-sm)',
        border: active
          ? '1.5px solid ' + tone
          : '1px solid var(--sos-border)',
        background: active
          ? 'color-mix(in srgb, ' + tone + ' 12%, transparent)'
          : 'var(--sos-surface-1)',
        boxShadow: active
          ? `0 0 0 3px color-mix(in srgb, ${tone} 18%, transparent)`
          : 'none',
        transition: 'all 160ms ease',
      }}
    >
      <div
        style={{
          width: '34px',
          height: '34px',
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
          {label}
        </div>
        <div
          className="sos-text-muted"
          style={{ marginTop: '2px', fontSize: '11.5px' }}
        >
          {caption}
        </div>
      </div>
    </button>
  );
}

function FileRow({
  name,
  size,
  onRemove,
}: {
  name: string;
  size: string;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '10px',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--sos-brand-primary-soft)',
          color: 'var(--sos-brand-primary-strong)',
          border: '1px solid var(--sos-brand-primary-border)',
          flexShrink: 0,
        }}
      >
        <FileImage size={14} />
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
          {name}
        </div>
        <div className="sos-text-faint" style={{ fontSize: '11px', marginTop: '2px' }}>
          {size}
        </div>
      </div>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        style={{
          border: 'none',
          background: 'transparent',
          color: 'var(--sos-text-faint)',
          cursor: 'pointer',
          display: 'inline-flex',
          padding: '6px',
          borderRadius: '6px',
          transition: 'color 160ms ease',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.color = 'var(--sos-status-danger)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = 'var(--sos-text-faint)';
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function FinanceSummaryCard({
  lead,
  formattedAmount,
  method,
  receivedDate,
  receivedBy,
  fileCount,
}: {
  lead: Lead;
  formattedAmount: string;
  method: string;
  receivedDate: string;
  receivedBy: string;
  fileCount: number;
}) {
  const methodMeta = PAY_METHODS.find((m) => m.key === method);

  return (
    <GlassCard variant="strong" padded="lg" glow="warm">
      <div className="sos-eyebrow">Hand-off summary</div>
      <h3
        className="sos-title"
        style={{ fontSize: '17px', marginTop: '6px' }}
      >
        What Finance will see
      </h3>
      <p
        className="sos-text-muted"
        style={{ marginTop: '4px', fontSize: '12.5px' }}
      >
        Live preview — updates as you fill the form.
      </p>

      <div
        style={{
          marginTop: '18px',
          padding: '18px',
          borderRadius: 'var(--sos-radius-card)',
          background: 'var(--sos-brand-primary-soft)',
          border: '1px solid var(--sos-border-accent)',
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
          Receipt amount
        </div>
        <div
          style={{
            marginTop: '6px',
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--sos-text-primary)',
            letterSpacing: '-0.02em',
            fontFamily: 'var(--sos-font-display, inherit)',
          }}
        >
          {formattedAmount}
        </div>
        <div
          className="sos-text-secondary"
          style={{ marginTop: '4px', fontSize: '12px' }}
        >
          {methodMeta?.label ?? method} · received{' '}
          {new Date(receivedDate).toLocaleDateString('en-PK', {
            dateStyle: 'medium',
          })}
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
        <SummaryRow
          label="Client"
          value={`${lead.firstName} ${lead.lastName}`}
        />
        <SummaryRow label="Service" value={lead.service} />
        <SummaryRow label="Country" value={lead.targetCountry} />
        <SummaryRow label="Received by" value={receivedBy} />
        <SummaryRow
          label="Attachments"
          value={`${fileCount} file${fileCount === 1 ? '' : 's'}`}
        />
      </div>
    </GlassCard>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: 'var(--sos-radius-sm)',
        background: 'var(--sos-surface-1)',
        border: '1px solid var(--sos-border-subtle)',
      }}
    >
      <span
        className="sos-text-faint"
        style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--sos-text-primary)',
          textAlign: 'right',
          textTransform: 'capitalize',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '60%',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ChecklistCard({
  checklist,
}: {
  checklist: Array<{ label: string; done: boolean }>;
}) {
  const doneCount = checklist.filter((c) => c.done).length;
  const total = checklist.length;
  const pct = Math.round((doneCount / total) * 100);

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
          <div className="sos-eyebrow">Pre-flight checklist</div>
          <p
            className="sos-text-muted"
            style={{ marginTop: '4px', fontSize: '12px' }}
          >
            Every item must be done before Finance can verify.
          </p>
        </div>
        <StatusBadge tone={doneCount === total ? 'success' : 'warning'} size="sm">
          {doneCount}/{total} ready
        </StatusBadge>
      </div>

      <div className="sos-progress" style={{ height: '6px', marginTop: '14px' }}>
        <div className="sos-progress__fill" style={{ width: pct + '%' }} />
      </div>

      <ul
        style={{
          marginTop: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          listStyle: 'none',
          padding: 0,
        }}
      >
        {checklist.map((c) => (
          <li
            key={c.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              borderRadius: 'var(--sos-radius-sm)',
              background: c.done
                ? 'var(--sos-status-success-soft)'
                : 'var(--sos-surface-1)',
              border: c.done
                ? '1px solid var(--sos-status-success-border)'
                : '1px solid var(--sos-border-subtle)',
            }}
          >
            <span
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '999px',
                display: 'grid',
                placeItems: 'center',
                background: c.done
                  ? 'var(--sos-status-success)'
                  : 'var(--sos-surface-3)',
                color: c.done
                  ? 'var(--sos-text-on-accent)'
                  : 'var(--sos-text-faint)',
                border: c.done
                  ? '1px solid transparent'
                  : '1px solid var(--sos-border)',
                flexShrink: 0,
              }}
            >
              {c.done ? <FileCheck2 size={11} /> : null}
            </span>
            <span
              style={{
                fontSize: '12.5px',
                fontWeight: 600,
                color: c.done
                  ? 'var(--sos-status-success)'
                  : 'var(--sos-text-secondary)',
                textDecoration: c.done ? 'none' : 'none',
              }}
            >
              {c.label}
            </span>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function HandoffNoteCard() {
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
            width: '34px',
            height: '34px',
            borderRadius: '11px',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--sos-status-success-soft)',
            color: 'var(--sos-status-success)',
            border: '1px solid var(--sos-status-success-border)',
            flexShrink: 0,
          }}
        >
          <ShieldCheck size={16} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="sos-eyebrow">Verification flow</div>
          <p
            className="sos-text-secondary"
            style={{ marginTop: '4px', fontSize: '12.5px', lineHeight: 1.55 }}
          >
            Sales records the receipt.{' '}
            <strong style={{ color: 'var(--sos-text-primary)' }}>
              Finance verifies the actual money.
            </strong>{' '}
            Visa processing only starts after Finance marks the payment as
            verified — you will see the lead stage flip to{' '}
            <strong style={{ color: 'var(--sos-status-success)' }}>
              Verified
            </strong>{' '}
            on your dashboard.
          </p>
        </div>
      </div>
    </GlassCard>
  );
}

