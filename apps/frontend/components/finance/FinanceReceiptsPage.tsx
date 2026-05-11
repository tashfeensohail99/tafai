'use client';
// Finance Receipts — Screen 4 of 7.
// Shows verified payments awaiting receipt generation ("Needs Receipt") and
// receipt-confirmed payments waiting to be sent to processing ("Receipt
// Confirmed"). Officer generates the formal receipt here, then marks the case
// Ready for Processing.
//
// Phase 1 scope: mock data, no real PDF generation, no real email/WhatsApp
// dispatch.  Receipt number is minted client-side for UI preview.
// Phase 2 will wire up the real backend endpoints.

import { useState, useMemo, useCallback } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Mail,
  MessageSquare,
  Printer,
  Receipt,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  ActionBar,
  EmptyState,
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
  METHOD_LABEL,
  fmtAmount,
  fmtDateTime,
  fmtRelative,
  type PaymentRecord,
  type PaymentStatus,
} from '@/components/finance-v1/mockData';

// ---------- Types --------------------------------------------------------

type TabKey = 'NEEDS_RECEIPT' | 'CONFIRMED';

interface ReceiptFormState {
  publicRemarks: string;
  internalRemarks: string;
  serviceFee: string;
  govtFee: string;
  taxRate: string;
  template: string;
}

// ---------- Constants ---------------------------------------------------

const TABS: Array<{ key: TabKey; label: string; statuses: PaymentStatus[] }> =
  [
    { key: 'NEEDS_RECEIPT', label: 'Needs Receipt', statuses: ['VERIFIED'] },
    {
      key: 'CONFIRMED',
      label: 'Receipt Confirmed',
      statuses: ['RECEIPT_CONFIRMED'],
    },
  ];

const TEMPLATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'standard', label: 'Standard — TF-1 (English)' },
  { value: 'bilingual', label: 'Bilingual — TF-2 (Urdu/English)' },
  { value: 'detailed', label: 'Detailed — TF-3 (Itemized breakdown)' },
];

const TAX_RATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '0', label: '0% (exempt)' },
  { value: '5', label: '5%' },
  { value: '13', label: '13%' },
  { value: '17', label: '17%' },
];

const STATUS_TONE: Record<string, BadgeTone> = {
  VERIFIED: 'info',
  RECEIPT_CONFIRMED: 'success',
};

// ---------- Helpers ------------------------------------------------------

function nextReceiptNumber(branch: string): string {
  const year = new Date().getFullYear();
  // Mock — real backend uses an atomic sequence.
  const seq = String(Math.floor(142 + Math.random() * 10)).padStart(6, '0');
  return `TF-${branch}-${year}-${seq}`;
}

function defaultForm(p: PaymentRecord): ReceiptFormState {
  return {
    publicRemarks: '',
    internalRemarks: '',
    serviceFee: String(p.receivedAmount),
    govtFee: '0',
    taxRate: '0',
    template: 'standard',
  };
}

// ---------- Sub-components -----------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </p>
  );
}

function ReadOnlyRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 'var(--sos-space-3)',
        padding: 'var(--sos-space-2) 0',
        borderBottom: '1px solid var(--sos-border)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--sos-text-sm)',
          color: 'var(--sos-muted)',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 'var(--sos-text-sm)',
          fontWeight: 500,
          color: 'var(--sos-text)',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ---------- Payment row card ---------------------------------------------

interface PaymentRowProps {
  payment: PaymentRecord;
  isSelected: boolean;
  onSelect: () => void;
}

function PaymentRow({ payment, isSelected, onSelect }: PaymentRowProps) {
  const tone: BadgeTone = STATUS_TONE[payment.status] ?? 'neutral';

  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        width: '100%',
        textAlign: 'left',
        background: isSelected
          ? 'var(--sos-surface-hover)'
          : 'var(--sos-surface)',
        border: isSelected
          ? '1.5px solid var(--sos-accent)'
          : '1px solid var(--sos-border)',
        borderRadius: 'var(--sos-radius-md)',
        padding: 'var(--sos-space-3) var(--sos-space-4)',
        cursor: 'pointer',
        gap: 'var(--sos-space-3)',
        alignItems: 'center',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'var(--sos-accent-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 'var(--sos-text-xs)',
          fontWeight: 700,
          color: 'var(--sos-accent)',
        }}
      >
        {payment.clientName
          .split(' ')
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)}
      </div>

      {/* Main info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sos-space-2)',
            marginBottom: 2,
          }}
        >
          <span
            style={{
              fontSize: 'var(--sos-text-sm)',
              fontWeight: 600,
              color: 'var(--sos-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {payment.clientName}
          </span>
          <StatusBadge tone={tone}>
            {payment.status === 'VERIFIED' ? 'Verified' : 'Receipted'}
          </StatusBadge>
        </div>
        <div
          style={{
            fontSize: 'var(--sos-text-xs)',
            color: 'var(--sos-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {payment.service} · {payment.targetCountry} · {payment.branch}
        </div>
      </div>

      {/* Amount */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div
          style={{
            fontSize: 'var(--sos-text-sm)',
            fontWeight: 700,
            color: 'var(--sos-text)',
          }}
        >
          {fmtAmount(payment.receivedAmount, payment.currency)}
        </div>
        <div
          style={{ fontSize: 'var(--sos-text-xs)', color: 'var(--sos-muted)' }}
        >
          {METHOD_LABEL[payment.paymentMethod]}
        </div>
      </div>

      <ChevronRight
        size={16}
        style={{ color: 'var(--sos-muted)', flexShrink: 0 }}
      />
    </button>
  );
}

// ---------- Receipt generation panel (VERIFIED → generate) ---------------

interface GenerationPanelProps {
  payment: PaymentRecord;
  onGenerated: (receiptNumber: string) => void;
}

function ReceiptGenerationPanel({ payment, onGenerated }: GenerationPanelProps) {
  const [form, setForm] = useState<ReceiptFormState>(() => defaultForm(payment));
  const [generating, setGenerating] = useState(false);

  const serviceFeeNum = parseFloat(form.serviceFee) || 0;
  const govtFeeNum = parseFloat(form.govtFee) || 0;
  const taxRateNum = parseFloat(form.taxRate) || 0;
  const taxAmount = ((serviceFeeNum + govtFeeNum) * taxRateNum) / 100;
  const totalAmount = serviceFeeNum + govtFeeNum + taxAmount;

  function handleGenerate() {
    setGenerating(true);
    // Simulate async mint
    setTimeout(() => {
      onGenerated(nextReceiptNumber(payment.branch));
    }, 800);
  }

  const set = (field: keyof ReceiptFormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-5)' }}>
      {/* Auto-generated fields */}
      <GlassCard>
        <div style={{ padding: 'var(--sos-space-5)' }}>
          <SectionLabel>Auto-generated fields (read-only)</SectionLabel>
          <div
            style={{
              background: 'var(--sos-surface-2)',
              borderRadius: 'var(--sos-radius-sm)',
              padding: 'var(--sos-space-1) var(--sos-space-3)',
              marginBottom: 'var(--sos-space-2)',
            }}
          >
            <ReadOnlyRow label="Receipt number" value={<em style={{ color: 'var(--sos-muted)' }}>Will be generated on confirmation</em>} />
            <ReadOnlyRow label="Client" value={payment.clientName} />
            <ReadOnlyRow label="Service" value={payment.service} />
            <ReadOnlyRow label="Target country" value={payment.targetCountry} />
            <ReadOnlyRow label="Verified amount" value={fmtAmount(payment.receivedAmount, payment.currency)} />
            <ReadOnlyRow label="Payment method" value={METHOD_LABEL[payment.paymentMethod]} />
            {payment.transactionReference && (
              <ReadOnlyRow label="Transaction reference" value={payment.transactionReference} />
            )}
            <ReadOnlyRow label="Verified at" value={payment.verifiedAt ? fmtDateTime(payment.verifiedAt) : '—'} />
            <ReadOnlyRow label="Verified by" value={payment.financeUserName ?? MOCK_FINANCE_USER.name} />
            <ReadOnlyRow label="Branch" value={payment.branch} />
          </div>
        </div>
      </GlassCard>

      {/* Editable fields */}
      <GlassCard>
        <div
          style={{
            padding: 'var(--sos-space-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sos-space-4)',
          }}
        >
          <SectionLabel>Receipt details (editable)</SectionLabel>

          <FormSelect
            label="Receipt template"
            value={form.template}
            options={TEMPLATE_OPTIONS}
            onChange={(e) => set('template')(e.target.value)}
          />

          <FormTextarea
            label="Public remarks (shown on printed receipt)"
            value={form.publicRemarks}
            placeholder="e.g. Full payment received for Study Visa — Canada consultation."
            rows={2}
            onChange={(e) => set('publicRemarks')(e.target.value)}
          />

          <FormTextarea
            label="Internal remarks (hidden from client)"
            value={form.internalRemarks}
            placeholder="e.g. Bank transfer confirmed via branch manager. No outstanding balance."
            rows={2}
            onChange={(e) => set('internalRemarks')(e.target.value)}
          />
        </div>
      </GlassCard>

      {/* Fee breakdown */}
      <GlassCard>
        <div
          style={{
            padding: 'var(--sos-space-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sos-space-4)',
          }}
        >
          <SectionLabel>Fee itemization (final review)</SectionLabel>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--sos-space-3)',
            }}
          >
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 'var(--sos-text-sm)',
                  fontWeight: 500,
                  color: 'var(--sos-text)',
                  marginBottom: 'var(--sos-space-1)',
                }}
              >
                Service fee ({payment.currency})
              </label>
              <input
                type="number"
                value={form.serviceFee}
                onChange={(e) => set('serviceFee')(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--sos-radius-sm)',
                  border: '1px solid var(--sos-border)',
                  background: 'var(--sos-input-bg)',
                  color: 'var(--sos-text)',
                  fontSize: 'var(--sos-text-sm)',
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 'var(--sos-text-sm)',
                  fontWeight: 500,
                  color: 'var(--sos-text)',
                  marginBottom: 'var(--sos-space-1)',
                }}
              >
                Govt. / filing fee ({payment.currency})
              </label>
              <input
                type="number"
                value={form.govtFee}
                onChange={(e) => set('govtFee')(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--sos-radius-sm)',
                  border: '1px solid var(--sos-border)',
                  background: 'var(--sos-input-bg)',
                  color: 'var(--sos-text)',
                  fontSize: 'var(--sos-text-sm)',
                }}
              />
            </div>
          </div>
          <FormSelect
            label="Tax rate"
            value={form.taxRate}
            options={TAX_RATE_OPTIONS}
            onChange={(e) => set('taxRate')(e.target.value)}
          />

          {/* Summary */}
          <div
            style={{
              background: 'var(--sos-surface-2)',
              borderRadius: 'var(--sos-radius-sm)',
              padding: 'var(--sos-space-3)',
            }}
          >
            <ReadOnlyRow label="Service fee" value={`${payment.currency} ${serviceFeeNum.toFixed(2)}`} />
            <ReadOnlyRow label="Govt. / filing fee" value={`${payment.currency} ${govtFeeNum.toFixed(2)}`} />
            <ReadOnlyRow label={`Tax (${form.taxRate}%)`} value={`${payment.currency} ${taxAmount.toFixed(2)}`} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: 'var(--sos-space-2)',
                marginTop: 'var(--sos-space-1)',
                borderTop: '2px solid var(--sos-border)',
              }}
            >
              <span
                style={{ fontSize: 'var(--sos-text-sm)', fontWeight: 700, color: 'var(--sos-text)' }}
              >
                Total
              </span>
              <span
                style={{ fontSize: 'var(--sos-text-sm)', fontWeight: 700, color: 'var(--sos-accent)' }}
              >
                {payment.currency} {totalAmount.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Action bar */}
      <ActionBar
        left={
          <GhostButton disabled>
            <Eye size={15} /> Preview PDF
          </GhostButton>
        }
        right={
          <PrimaryButton onClick={handleGenerate} disabled={generating}>
            {generating ? (
              'Generating…'
            ) : (
              <>
                <Receipt size={15} /> Generate Receipt
              </>
            )}
          </PrimaryButton>
        }
      />
    </div>
  );
}

// ---------- Receipt confirmed panel (view + distribute + mark ready) ------

interface ConfirmedPanelProps {
  payment: PaymentRecord;
  receiptNumber: string;
  onMarkReady: () => void;
  alreadyReady: boolean;
}

function ReceiptConfirmedPanel({
  payment,
  receiptNumber,
  onMarkReady,
  alreadyReady,
}: ConfirmedPanelProps) {
  const [markedReady, setMarkedReady] = useState(alreadyReady);

  function handleMarkReady() {
    setMarkedReady(true);
    onMarkReady();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-5)' }}>
      {/* Receipt summary */}
      <GlassCard>
        <div style={{ padding: 'var(--sos-space-5)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sos-space-2)',
              marginBottom: 'var(--sos-space-4)',
            }}
          >
            <CheckCircle2 size={20} style={{ color: 'var(--sos-success)' }} />
            <p
              style={{
                fontSize: 'var(--sos-text-base)',
                fontWeight: 700,
                color: 'var(--sos-success)',
              }}
            >
              Receipt confirmed
            </p>
          </div>
          <SectionLabel>Receipt details</SectionLabel>
          <div
            style={{
              background: 'var(--sos-surface-2)',
              borderRadius: 'var(--sos-radius-sm)',
              padding: 'var(--sos-space-1) var(--sos-space-3)',
            }}
          >
            <ReadOnlyRow
              label="Receipt number"
              value={
                <span
                  style={{
                    fontFamily: 'monospace',
                    color: 'var(--sos-accent)',
                    fontWeight: 700,
                  }}
                >
                  {receiptNumber}
                </span>
              }
            />
            <ReadOnlyRow label="Client" value={payment.clientName} />
            <ReadOnlyRow label="Service" value={payment.service} />
            <ReadOnlyRow label="Amount" value={fmtAmount(payment.receivedAmount, payment.currency)} />
            <ReadOnlyRow label="Payment method" value={METHOD_LABEL[payment.paymentMethod]} />
            {payment.transactionReference && (
              <ReadOnlyRow label="Transaction ref." value={payment.transactionReference} />
            )}
            <ReadOnlyRow
              label="Verified at"
              value={payment.verifiedAt ? fmtDateTime(payment.verifiedAt) : fmtRelative(new Date().toISOString())}
            />
            <ReadOnlyRow label="Verified by" value={payment.financeUserName ?? MOCK_FINANCE_USER.name} />
          </div>
        </div>
      </GlassCard>

      {/* Distribution actions */}
      <GlassCard>
        <div style={{ padding: 'var(--sos-space-5)' }}>
          <SectionLabel>Distribute receipt</SectionLabel>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--sos-space-3)',
            }}
          >
            <SecondaryButton>
              <Eye size={15} /> Preview PDF
            </SecondaryButton>
            <SecondaryButton>
              <Download size={15} /> Download PDF
            </SecondaryButton>
            <SecondaryButton>
              <Mail size={15} /> Email to client
            </SecondaryButton>
            <SecondaryButton>
              <MessageSquare size={15} /> WhatsApp
            </SecondaryButton>
            <SecondaryButton>
              <Printer size={15} /> Print
            </SecondaryButton>
            <SecondaryButton>
              <FileText size={15} /> Duplicate copy
            </SecondaryButton>
          </div>
        </div>
      </GlassCard>

      {/* Next step */}
      <ActionBar
        hint={
          markedReady
            ? '✓ Moved to processing queue'
            : 'Once receipt is confirmed, mark this case ready for processing.'
        }
        right={
          <SuccessButton onClick={handleMarkReady} disabled={markedReady}>
            <Send size={15} /> Mark Ready for Processing
          </SuccessButton>
        }
      />
    </div>
  );
}

// ---------- Main page component ------------------------------------------

export function FinanceReceiptsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('NEEDS_RECEIPT');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Track which payments have been receipted this session (VERIFIED → minted)
  const [mintedReceipts, setMintedReceipts] = useState<
    Record<string, string>
  >({});
  // Track which payments have been marked ready this session
  const [readySet, setReadySet] = useState<Set<string>>(new Set());

  const needsReceiptPayments = useMemo(
    () => MOCK_PAYMENTS.filter((p) => p.status === 'VERIFIED'),
    [],
  );

  const confirmedPayments = useMemo(
    () => MOCK_PAYMENTS.filter((p) => p.status === 'RECEIPT_CONFIRMED'),
    [],
  );

  const activeList =
    activeTab === 'NEEDS_RECEIPT' ? needsReceiptPayments : confirmedPayments;

  const selectedPayment = useMemo(
    () => activeList.find((p) => p.id === selectedId) ?? null,
    [activeList, selectedId],
  );

  // Merge: session-minted receipts override mock receiptNumber
  function resolveReceiptNumber(p: PaymentRecord): string {
    return mintedReceipts[p.id] ?? p.receiptNumber ?? '';
  }

  const handleGenerated = useCallback(
    (id: string, receiptNumber: string) => {
      setMintedReceipts((prev) => ({ ...prev, [id]: receiptNumber }));
    },
    [],
  );

  const handleMarkReady = useCallback((id: string) => {
    setReadySet((prev) => new Set([...prev, id]));
  }, []);

  const needsCount =
    needsReceiptPayments.length +
    Object.keys(mintedReceipts).length;
  const confirmedCount =
    confirmedPayments.length + Object.keys(mintedReceipts).length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sos-space-6)',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      {/* Page header */}
      <PageHeader
        eyebrow="Finance"
        title="Receipts"
        description="Generate and confirm official payment receipts"
      />

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--sos-space-1)',
          borderBottom: '1px solid var(--sos-border)',
          paddingBottom: 0,
        }}
      >
        {TABS.map((tab) => {
          const count =
            tab.key === 'NEEDS_RECEIPT'
              ? needsReceiptPayments.length
              : confirmedPayments.length + Object.keys(mintedReceipts).length;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setSelectedId(null);
              }}
              style={{
                padding: 'var(--sos-space-2) var(--sos-space-4)',
                fontSize: 'var(--sos-text-sm)',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--sos-accent)' : 'var(--sos-muted)',
                borderBottom: isActive
                  ? '2px solid var(--sos-accent)'
                  : '2px solid transparent',
                background: 'transparent',
                border: 'none',
                borderRadius: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sos-space-2)',
                transition: 'color 0.15s',
                marginBottom: -1,
              }}
            >
              {tab.label}
              {count > 0 && (
                <span
                  style={{
                    background: isActive
                      ? 'var(--sos-accent)'
                      : 'var(--sos-surface-hover)',
                    color: isActive ? '#fff' : 'var(--sos-text)',
                    borderRadius: 99,
                    padding: '0 6px',
                    fontSize: 'var(--sos-text-xs)',
                    fontWeight: 600,
                    minWidth: 18,
                    textAlign: 'center',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main layout — list + panel side by side */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selectedPayment ? '380px 1fr' : '1fr',
          gap: 'var(--sos-space-5)',
          alignItems: 'start',
        }}
      >
        {/* Left: payment list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sos-space-2)' }}>
          {activeList.length === 0 &&
          Object.keys(mintedReceipts).length === 0 ? (
            <EmptyState
              Icon={ShieldCheck}
              title={
                activeTab === 'NEEDS_RECEIPT'
                  ? 'No verified payments'
                  : 'No confirmed receipts'
              }
              description={
                activeTab === 'NEEDS_RECEIPT'
                  ? 'Verified payments will appear here when ready for receipt generation.'
                  : 'Receipts confirmed today will appear here.'
              }
            />
          ) : (
            <>
              {/* Payments from mock data */}
              {activeList.map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  isSelected={selectedId === p.id}
                  onSelect={() =>
                    setSelectedId(selectedId === p.id ? null : p.id)
                  }
                />
              ))}

              {/* Freshly minted receipts (moved from NEEDS_RECEIPT this session) */}
              {activeTab === 'CONFIRMED' &&
                Object.entries(mintedReceipts).map(([id]) => {
                  const original = MOCK_PAYMENTS.find((p) => p.id === id);
                  if (!original) return null;
                  const synthetic: PaymentRecord = {
                    ...original,
                    status: 'RECEIPT_CONFIRMED',
                    receiptNumber: mintedReceipts[id],
                  };
                  return (
                    <PaymentRow
                      key={`session-${id}`}
                      payment={synthetic}
                      isSelected={selectedId === `session-${id}`}
                      onSelect={() =>
                        setSelectedId(
                          selectedId === `session-${id}`
                            ? null
                            : `session-${id}`,
                        )
                      }
                    />
                  );
                })}
            </>
          )}
        </div>

        {/* Right: receipt panel */}
        {selectedPayment && (
          <div>
            {/* Panel header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 'var(--sos-space-3)',
                marginBottom: 'var(--sos-space-4)',
              }}
            >
              <div>
                <p
                  style={{
                    fontSize: 'var(--sos-text-xs)',
                    color: 'var(--sos-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginBottom: 2,
                  }}
                >
                  Finance receipts · {selectedPayment.id}
                </p>
                <h1
                  style={{
                    fontSize: 'var(--sos-text-xl)',
                    fontWeight: 700,
                    color: 'var(--sos-text)',
                  }}
                >
                  {activeTab === 'NEEDS_RECEIPT' &&
                  !mintedReceipts[selectedPayment.id]
                    ? `Generate: ${selectedPayment.clientName}`
                    : `Receipt: ${selectedPayment.clientName}`}
                </h1>
                <p
                  style={{
                    fontSize: 'var(--sos-text-sm)',
                    color: 'var(--sos-muted)',
                    marginTop: 'var(--sos-space-1)',
                  }}
                >
                  {selectedPayment.service} · {selectedPayment.targetCountry} ·{' '}
                  {fmtAmount(selectedPayment.receivedAmount, selectedPayment.currency)}
                  {' · '}
                  {METHOD_LABEL[selectedPayment.paymentMethod]}
                </p>
              </div>
            </div>

            {/* Generation vs. confirmed panel */}
            {activeTab === 'NEEDS_RECEIPT' &&
            !mintedReceipts[selectedPayment.id] ? (
              <ReceiptGenerationPanel
                key={selectedPayment.id}
                payment={selectedPayment}
                onGenerated={(rn) => handleGenerated(selectedPayment.id, rn)}
              />
            ) : (
              <ReceiptConfirmedPanel
                key={selectedPayment.id}
                payment={selectedPayment}
                receiptNumber={resolveReceiptNumber(selectedPayment)}
                onMarkReady={() => handleMarkReady(selectedPayment.id)}
                alreadyReady={readySet.has(selectedPayment.id)}
              />
            )}
          </div>
        )}

        {/* No selection hint when list has items */}
        {!selectedPayment && activeList.length > 0 && (
          <div
            style={{
              display: 'none', // single-column hides this column
            }}
          />
        )}
      </div>
    </div>
  );
}
