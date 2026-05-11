// Mock data for the Finance workspace UI build (Phase 1).
// All screens read from this file so the UI can be reviewed independently
// of the backend.
//
// The shapes here track the finance-module.md spec — §6 (status taxonomy)
// and §7 (data model). Simplified for Phase 1: no fraud flags, no
// maker-checker, no multi-currency, no payment plans, no refunds.

import { MOCK_LEADS, type Lead } from '@/components/sales-v2/mockData';

// ---------- Types --------------------------------------------------------

export type PaymentStatus =
  | 'NEW_FROM_SALES'
  | 'UNDER_VERIFICATION'
  | 'ON_HOLD'
  | 'CORRECTION_REQUIRED'
  | 'REJECTED'
  | 'VERIFIED'
  | 'RECEIPT_CONFIRMED'
  | 'AWAITING_BALANCE'
  | 'SENT_TO_PROCESSING';

export type PaymentMethod = 'CASH' | 'BANK' | 'CARD' | 'CHEQUE' | 'MOBILE' | 'WIRE' | 'ONLINE' | 'OTHER';

export type Priority = 'LOW' | 'NORMAL' | 'URGENT';

export interface FinanceUser {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: 'OFFICER' | 'SENIOR' | 'MANAGER' | 'AUDITOR';
}

export interface PaymentRecord {
  id: string;
  leadId: string;
  clientName: string;
  service: string;
  targetCountry: string;
  branch: string;
  salesUserId: string;
  salesUserName: string;
  financeUserId: string | null;
  financeUserName: string | null;

  expectedAmount: number;
  receivedAmount: number;
  currency: 'CAD' | 'USD' | 'PKR' | 'AED' | 'GBP';
  paymentMethod: PaymentMethod;
  transactionReference: string | null;
  paymentReceivedAt: string;          // ISO
  sentToFinanceAt: string;            // ISO

  status: PaymentStatus;
  priority: Priority;

  salesNote: string;
  financeNote: string | null;

  slaDueAt: string;                   // ISO
  slaStatus: 'ACTIVE' | 'APPROACHING' | 'BREACHED' | 'CLEARED';

  // Verification details (filled when status >= VERIFIED)
  verifiedAt: string | null;
  receiptNumber: string | null;

  // Correction details (filled when status == CORRECTION_REQUIRED or after a bounce)
  correctionBounceCount: number;
  correctionLastReason: string | null;

  // Receipt files (mock — just count)
  receiptFileCount: number;
}

// ---------- Helpers ------------------------------------------------------

const NOW = new Date('2026-05-11T10:30:00+05:00');

function isoMinusHours(h: number): string {
  const d = new Date(NOW.getTime() - h * 3600 * 1000);
  return d.toISOString();
}
function isoPlusHours(h: number): string {
  const d = new Date(NOW.getTime() + h * 3600 * 1000);
  return d.toISOString();
}

// ---------- Mock current finance user -----------------------------------

export const MOCK_FINANCE_USER: FinanceUser = {
  id: 'fin-user-hassan',
  name: 'Hassan F.',
  email: 'hassan.f@tafsheen.com',
  initials: 'HF',
  role: 'OFFICER',
};

// ---------- Branches (suggested 3-letter codes per spec §16) -----------

export const BRANCHES = ['LHR', 'KHI', 'ISB'] as const;

// ---------- Payment records ---------------------------------------------
// Crafted to cover all six dashboard KPI buckets and the queue scenarios.

function takeLead(idx: number): Lead {
  return MOCK_LEADS[idx % MOCK_LEADS.length]!;
}

export const MOCK_PAYMENTS: PaymentRecord[] = [
  // --- New from Sales (just arrived) ---
  {
    id: 'PR-3201',
    leadId: takeLead(0).id,
    clientName: `${takeLead(0).firstName} ${takeLead(0).lastName}`,
    service: takeLead(0).service,
    targetCountry: takeLead(0).targetCountry,
    branch: 'LHR',
    salesUserId: 'sales-awais',
    salesUserName: 'Awais Q.',
    financeUserId: null,
    financeUserName: null,
    expectedAmount: 1500,
    receivedAmount: 1500,
    currency: 'CAD',
    paymentMethod: 'CASH',
    transactionReference: null,
    paymentReceivedAt: isoMinusHours(0.5),
    sentToFinanceAt: isoMinusHours(0.4),
    status: 'NEW_FROM_SALES',
    priority: 'URGENT',
    salesNote: 'Walk-in, paid full deposit in cash. Client is travelling tomorrow night.',
    financeNote: null,
    slaDueAt: isoPlusHours(1.5),
    slaStatus: 'ACTIVE',
    verifiedAt: null,
    receiptNumber: null,
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 1,
  },
  {
    id: 'PR-3202',
    leadId: takeLead(1).id,
    clientName: `${takeLead(1).firstName} ${takeLead(1).lastName}`,
    service: takeLead(1).service,
    targetCountry: takeLead(1).targetCountry,
    branch: 'LHR',
    salesUserId: 'sales-sara',
    salesUserName: 'Sara K.',
    financeUserId: null,
    financeUserName: null,
    expectedAmount: 2000,
    receivedAmount: 2000,
    currency: 'USD',
    paymentMethod: 'BANK',
    transactionReference: 'TFN-4421',
    paymentReceivedAt: isoMinusHours(1.2),
    sentToFinanceAt: isoMinusHours(1),
    status: 'NEW_FROM_SALES',
    priority: 'NORMAL',
    salesNote: 'Bank transfer received yesterday, slip attached.',
    financeNote: null,
    slaDueAt: isoPlusHours(22),
    slaStatus: 'ACTIVE',
    verifiedAt: null,
    receiptNumber: null,
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 1,
  },
  {
    id: 'PR-3203',
    leadId: takeLead(2).id,
    clientName: `${takeLead(2).firstName} ${takeLead(2).lastName}`,
    service: takeLead(2).service,
    targetCountry: takeLead(2).targetCountry,
    branch: 'KHI',
    salesUserId: 'sales-fatima',
    salesUserName: 'Fatima Z.',
    financeUserId: null,
    financeUserName: null,
    expectedAmount: 500,
    receivedAmount: 500,
    currency: 'CAD',
    paymentMethod: 'CARD',
    transactionReference: 'POS-89234',
    paymentReceivedAt: isoMinusHours(2.5),
    sentToFinanceAt: isoMinusHours(2.2),
    status: 'NEW_FROM_SALES',
    priority: 'NORMAL',
    salesNote: 'Card payment at branch POS terminal.',
    financeNote: null,
    slaDueAt: isoPlusHours(1.5),
    slaStatus: 'APPROACHING',
    verifiedAt: null,
    receiptNumber: null,
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 1,
  },

  // --- Under Verification (claimed by me — Hassan) ---
  {
    id: 'PR-3204',
    leadId: takeLead(3).id,
    clientName: `${takeLead(3).firstName} ${takeLead(3).lastName}`,
    service: takeLead(3).service,
    targetCountry: takeLead(3).targetCountry,
    branch: 'LHR',
    salesUserId: 'sales-imran',
    salesUserName: 'Imran R.',
    financeUserId: MOCK_FINANCE_USER.id,
    financeUserName: MOCK_FINANCE_USER.name,
    expectedAmount: 1500,
    receivedAmount: 1500,
    currency: 'CAD',
    paymentMethod: 'BANK',
    transactionReference: 'TFN-2391',
    paymentReceivedAt: isoMinusHours(5),
    sentToFinanceAt: isoMinusHours(3.5),
    status: 'UNDER_VERIFICATION',
    priority: 'NORMAL',
    salesNote: 'Bank slip uploaded. Client paid full amount on Friday.',
    financeNote: null,
    slaDueAt: isoPlusHours(0.5),
    slaStatus: 'APPROACHING',
    verifiedAt: null,
    receiptNumber: null,
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 1,
  },
  {
    id: 'PR-3205',
    leadId: takeLead(4).id,
    clientName: `${takeLead(4).firstName} ${takeLead(4).lastName}`,
    service: takeLead(4).service,
    targetCountry: takeLead(4).targetCountry,
    branch: 'ISB',
    salesUserId: 'sales-awais',
    salesUserName: 'Awais Q.',
    financeUserId: MOCK_FINANCE_USER.id,
    financeUserName: MOCK_FINANCE_USER.name,
    expectedAmount: 3500,
    receivedAmount: 3500,
    currency: 'CAD',
    paymentMethod: 'WIRE',
    transactionReference: 'WIRE-118832',
    paymentReceivedAt: isoMinusHours(6),
    sentToFinanceAt: isoMinusHours(4),
    status: 'UNDER_VERIFICATION',
    priority: 'URGENT',
    salesNote: 'High-value wire transfer. Client departing next week.',
    financeNote: null,
    slaDueAt: isoPlusHours(8),
    slaStatus: 'ACTIVE',
    verifiedAt: null,
    receiptNumber: null,
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 2,
  },

  // --- Awaiting Balance (deposit verified, balance owed) ---
  {
    id: 'PR-3206',
    leadId: takeLead(5).id,
    clientName: `${takeLead(5).firstName} ${takeLead(5).lastName}`,
    service: takeLead(5).service,
    targetCountry: takeLead(5).targetCountry,
    branch: 'LHR',
    salesUserId: 'sales-sara',
    salesUserName: 'Sara K.',
    financeUserId: MOCK_FINANCE_USER.id,
    financeUserName: MOCK_FINANCE_USER.name,
    expectedAmount: 3000,
    receivedAmount: 1000, // only deposit
    currency: 'CAD',
    paymentMethod: 'CASH',
    transactionReference: null,
    paymentReceivedAt: isoMinusHours(48),
    sentToFinanceAt: isoMinusHours(47),
    status: 'AWAITING_BALANCE',
    priority: 'NORMAL',
    salesNote: 'Deposit verified. Balance CAD 2,000 due by end of week.',
    financeNote: 'Deposit confirmed and receipted (TF-LHR-2026-000138).',
    slaDueAt: isoPlusHours(72),
    slaStatus: 'ACTIVE',
    verifiedAt: isoMinusHours(46),
    receiptNumber: 'TF-LHR-2026-000138',
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 1,
  },

  // --- Correction Required (sent back to sales) ---
  {
    id: 'PR-3207',
    leadId: takeLead(6).id,
    clientName: `${takeLead(6).firstName} ${takeLead(6).lastName}`,
    service: takeLead(6).service,
    targetCountry: takeLead(6).targetCountry,
    branch: 'KHI',
    salesUserId: 'sales-fatima',
    salesUserName: 'Fatima Z.',
    financeUserId: MOCK_FINANCE_USER.id,
    financeUserName: MOCK_FINANCE_USER.name,
    expectedAmount: 1200,
    receivedAmount: 1200,
    currency: 'CAD',
    paymentMethod: 'BANK',
    transactionReference: null,
    paymentReceivedAt: isoMinusHours(20),
    sentToFinanceAt: isoMinusHours(19),
    status: 'CORRECTION_REQUIRED',
    priority: 'NORMAL',
    salesNote: 'Bank transfer slip attached.',
    financeNote: 'Reference number not visible on the slip. Re-upload required.',
    slaDueAt: isoPlusHours(4),
    slaStatus: 'ACTIVE',
    verifiedAt: null,
    receiptNumber: null,
    correctionBounceCount: 1,
    correctionLastReason: 'Receipt image unclear',
    receiptFileCount: 1,
  },
  {
    id: 'PR-3208',
    leadId: takeLead(7).id,
    clientName: `${takeLead(7).firstName} ${takeLead(7).lastName}`,
    service: takeLead(7).service,
    targetCountry: takeLead(7).targetCountry,
    branch: 'LHR',
    salesUserId: 'sales-imran',
    salesUserName: 'Imran R.',
    financeUserId: MOCK_FINANCE_USER.id,
    financeUserName: MOCK_FINANCE_USER.name,
    expectedAmount: 1500,
    receivedAmount: 1450,
    currency: 'CAD',
    paymentMethod: 'BANK',
    transactionReference: 'TFN-2401',
    paymentReceivedAt: isoMinusHours(28),
    sentToFinanceAt: isoMinusHours(26),
    status: 'CORRECTION_REQUIRED',
    priority: 'NORMAL',
    salesNote: 'Bank transfer received.',
    financeNote: 'Amount on slip is 1,450 but expected 1,500. Confirm with client.',
    slaDueAt: isoMinusHours(2), // breached
    slaStatus: 'BREACHED',
    verifiedAt: null,
    receiptNumber: null,
    correctionBounceCount: 2,
    correctionLastReason: 'Amount mismatch',
    receiptFileCount: 2,
  },

  // --- Verified — awaiting receipt generation ---
  {
    id: 'PR-3213',
    leadId: takeLead(11).id,
    clientName: `${takeLead(11).firstName} ${takeLead(11).lastName}`,
    service: takeLead(11).service,
    targetCountry: takeLead(11).targetCountry,
    branch: 'LHR',
    salesUserId: 'sales-awais',
    salesUserName: 'Awais Q.',
    financeUserId: MOCK_FINANCE_USER.id,
    financeUserName: MOCK_FINANCE_USER.name,
    expectedAmount: 3200,
    receivedAmount: 3200,
    currency: 'CAD',
    paymentMethod: 'BANK',
    transactionReference: 'TFN-6610',
    paymentReceivedAt: isoMinusHours(3),
    sentToFinanceAt: isoMinusHours(2.5),
    status: 'VERIFIED',
    priority: 'NORMAL',
    salesNote: 'Full payment, IELTS preparation package.',
    financeNote: 'Verified — bank slip matches. Ready for receipt.',
    slaDueAt: isoPlusHours(6),
    slaStatus: 'ACTIVE',
    verifiedAt: isoMinusHours(0.5),
    receiptNumber: null,
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 1,
  },

  // --- Ready for processing (receipt confirmed, awaiting handover) ---
  {
    id: 'PR-3209',
    leadId: takeLead(8).id,
    clientName: `${takeLead(8).firstName} ${takeLead(8).lastName}`,
    service: takeLead(8).service,
    targetCountry: takeLead(8).targetCountry,
    branch: 'LHR',
    salesUserId: 'sales-awais',
    salesUserName: 'Awais Q.',
    financeUserId: MOCK_FINANCE_USER.id,
    financeUserName: MOCK_FINANCE_USER.name,
    expectedAmount: 1800,
    receivedAmount: 1800,
    currency: 'CAD',
    paymentMethod: 'CASH',
    transactionReference: null,
    paymentReceivedAt: isoMinusHours(8),
    sentToFinanceAt: isoMinusHours(7.5),
    status: 'RECEIPT_CONFIRMED',
    priority: 'NORMAL',
    salesNote: 'Full payment in cash at office.',
    financeNote: 'Verified, receipt issued.',
    slaDueAt: isoPlusHours(2),
    slaStatus: 'ACTIVE',
    verifiedAt: isoMinusHours(4),
    receiptNumber: 'TF-LHR-2026-000141',
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 1,
  },
  {
    id: 'PR-3210',
    leadId: takeLead(9).id,
    clientName: `${takeLead(9).firstName} ${takeLead(9).lastName}`,
    service: takeLead(9).service,
    targetCountry: takeLead(9).targetCountry,
    branch: 'ISB',
    salesUserId: 'sales-sara',
    salesUserName: 'Sara K.',
    financeUserId: MOCK_FINANCE_USER.id,
    financeUserName: MOCK_FINANCE_USER.name,
    expectedAmount: 2200,
    receivedAmount: 2200,
    currency: 'CAD',
    paymentMethod: 'BANK',
    transactionReference: 'TFN-4502',
    paymentReceivedAt: isoMinusHours(10),
    sentToFinanceAt: isoMinusHours(9),
    status: 'RECEIPT_CONFIRMED',
    priority: 'URGENT',
    salesNote: 'Bank transfer, urgent — client departs Sunday.',
    financeNote: 'Verified.',
    slaDueAt: isoPlusHours(1),
    slaStatus: 'APPROACHING',
    verifiedAt: isoMinusHours(3),
    receiptNumber: 'TF-ISB-2026-000044',
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 1,
  },

  // --- Verified today (counts toward "Collected Today") ---
  {
    id: 'PR-3211',
    leadId: takeLead(10).id,
    clientName: `${takeLead(10).firstName} ${takeLead(10).lastName}`,
    service: takeLead(10).service,
    targetCountry: takeLead(10).targetCountry,
    branch: 'LHR',
    salesUserId: 'sales-fatima',
    salesUserName: 'Fatima Z.',
    financeUserId: MOCK_FINANCE_USER.id,
    financeUserName: MOCK_FINANCE_USER.name,
    expectedAmount: 1500,
    receivedAmount: 1500,
    currency: 'CAD',
    paymentMethod: 'CASH',
    transactionReference: null,
    paymentReceivedAt: isoMinusHours(7),
    sentToFinanceAt: isoMinusHours(6.5),
    status: 'SENT_TO_PROCESSING',
    priority: 'NORMAL',
    salesNote: 'Walk-in cash.',
    financeNote: 'Verified and sent.',
    slaDueAt: isoMinusHours(1),
    slaStatus: 'CLEARED',
    verifiedAt: isoMinusHours(5),
    receiptNumber: 'TF-LHR-2026-000139',
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 1,
  },
  {
    id: 'PR-3212',
    leadId: takeLead(0).id,
    clientName: 'Maria Khan',
    service: 'Visit Visa',
    targetCountry: 'United Kingdom',
    branch: 'LHR',
    salesUserId: 'sales-awais',
    salesUserName: 'Awais Q.',
    financeUserId: MOCK_FINANCE_USER.id,
    financeUserName: MOCK_FINANCE_USER.name,
    expectedAmount: 800,
    receivedAmount: 800,
    currency: 'CAD',
    paymentMethod: 'CARD',
    transactionReference: 'POS-89240',
    paymentReceivedAt: isoMinusHours(9),
    sentToFinanceAt: isoMinusHours(8),
    status: 'SENT_TO_PROCESSING',
    priority: 'NORMAL',
    salesNote: 'Card payment at office.',
    financeNote: 'Verified.',
    slaDueAt: isoMinusHours(2),
    slaStatus: 'CLEARED',
    verifiedAt: isoMinusHours(6),
    receiptNumber: 'TF-LHR-2026-000140',
    correctionBounceCount: 0,
    correctionLastReason: null,
    receiptFileCount: 1,
  },
];

// ---------- Correction thread types & mock data --------------------------

export type CorrectionMessageType =
  | 'correction_request'
  | 'correction_resubmission'
  | 'internal_note'
  | 'system_event'
  | 'manager_intervention';

export type CorrectionDirection = 'finance_to_sales' | 'sales_to_finance' | 'system';

export type CorrectionStatus = 'awaiting_sales' | 'awaiting_finance' | 'escalated' | 'resolved';

export const CORRECTION_REASONS = [
  'Receipt image unclear / unreadable',
  'Amount mismatch',
  'Payment not yet received in our account',
  'Wrong client / wrong reference on receipt',
  'Duplicate receipt',
  'Suspected fraudulent receipt',
  'Missing transaction reference',
  'Wrong payment method category',
  'Sales uploaded wrong file',
  'Other',
] as const;

export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

export type RequiredAction =
  | 'Re-upload receipt'
  | 'Provide reference number'
  | 'Confirm with client'
  | 'Contact bank'
  | 'Other';

export interface CorrectionMessage {
  id: string;
  type: CorrectionMessageType;
  direction: CorrectionDirection;
  authorId: string;
  authorName: string;
  authorRole: 'Finance Officer' | 'Sales' | 'Manager' | 'System';
  createdAt: string;                   // ISO
  reasons: CorrectionReason[];         // correction_request only
  requiredAction: RequiredAction | null; // correction_request only
  slaDue: string | null;               // ISO — correction_request only
  body: string;
  attachedFileCount: number;
  isInternal: boolean;
}

export interface CorrectionThread {
  id: string;
  paymentId: string;                   // FK to PaymentRecord.id
  caseRef: string;                     // e.g. TF-LHR-2026-000142
  status: CorrectionStatus;
  bounceCount: number;                 // total round-trips
  messages: CorrectionMessage[];
  createdAt: string;
  updatedAt: string;
}

// Helper — build ISO timestamps relative to NOW
function threadIso(hoursAgo: number): string {
  const d = new Date(NOW.getTime() - hoursAgo * 3600 * 1000);
  return d.toISOString();
}

export const MOCK_CORRECTION_THREADS: CorrectionThread[] = [
  // ── PR-3207: 1 bounce, awaiting sales ─────────────────────────────────
  {
    id: 'ct-001',
    paymentId: 'PR-3207',
    caseRef: 'TF-KHI-2026-000042',
    status: 'awaiting_sales',
    bounceCount: 1,
    createdAt: threadIso(19),
    updatedAt: threadIso(18),
    messages: [
      {
        id: 'cm-001-1',
        type: 'correction_request',
        direction: 'finance_to_sales',
        authorId: MOCK_FINANCE_USER.id,
        authorName: MOCK_FINANCE_USER.name,
        authorRole: 'Finance Officer',
        createdAt: threadIso(18),
        reasons: ['Receipt image unclear / unreadable'],
        requiredAction: 'Re-upload receipt',
        slaDue: threadIso(-6),          // 6h from now
        body: 'The bank slip you uploaded is too blurry to read the transaction reference number. Please ask the client to send a clearer photo or a PDF statement showing the reference, date and amount.',
        attachedFileCount: 0,
        isInternal: false,
      },
    ],
  },

  // ── PR-3208: 2 bounces, awaiting finance (Sales has resubmitted) ───────
  {
    id: 'ct-002',
    paymentId: 'PR-3208',
    caseRef: 'TF-LHR-2026-000142',
    status: 'awaiting_finance',
    bounceCount: 2,
    createdAt: threadIso(28),
    updatedAt: threadIso(2),
    messages: [
      {
        id: 'cm-002-1',
        type: 'correction_request',
        direction: 'finance_to_sales',
        authorId: MOCK_FINANCE_USER.id,
        authorName: MOCK_FINANCE_USER.name,
        authorRole: 'Finance Officer',
        createdAt: threadIso(26),
        reasons: ['Receipt image unclear / unreadable'],
        requiredAction: 'Re-upload receipt',
        slaDue: threadIso(2),
        body: "Cannot read the transaction reference on the bank slip. Need a clearer photo or screenshot with the reference number visible. Expected reference format: TFN-XXXX.",
        attachedFileCount: 0,
        isInternal: false,
      },
      {
        id: 'cm-002-2',
        type: 'correction_resubmission',
        direction: 'sales_to_finance',
        authorId: 'sales-imran',
        authorName: 'Imran R.',
        authorRole: 'Sales',
        createdAt: threadIso(22),
        reasons: [],
        requiredAction: null,
        slaDue: null,
        body: 'Called client and got a better copy of the slip. Reference is TFN-2401. Attached clearer photo.',
        attachedFileCount: 1,
        isInternal: false,
      },
      {
        id: 'cm-002-3',
        type: 'correction_request',
        direction: 'finance_to_sales',
        authorId: MOCK_FINANCE_USER.id,
        authorName: MOCK_FINANCE_USER.name,
        authorRole: 'Finance Officer',
        createdAt: threadIso(20),
        reasons: ['Amount mismatch'],
        requiredAction: 'Confirm with client',
        slaDue: threadIso(4),
        body: "Reference is now clear, thank you. However the slip shows CAD 1,450 but the agreed amount is CAD 1,500. Confirm with the client what amount was actually paid and update the lead accordingly.",
        attachedFileCount: 0,
        isInternal: false,
      },
      {
        id: 'cm-002-4',
        type: 'correction_resubmission',
        direction: 'sales_to_finance',
        authorId: 'sales-imran',
        authorName: 'Imran R.',
        authorRole: 'Sales',
        createdAt: threadIso(2),
        reasons: [],
        requiredAction: null,
        slaDue: null,
        body: "Confirmed with client — they paid CAD 1,450 (they received a small loyalty discount). Please verify at 1,450 and I will update the lead amount on my side.",
        attachedFileCount: 0,
        isInternal: false,
      },
    ],
  },
];

export function findThread(paymentId: string): CorrectionThread | undefined {
  return MOCK_CORRECTION_THREADS.find((t) => t.paymentId === paymentId);
}

// ---------- Derived helpers used by the dashboard ------------------------

export function countByStatus(status: PaymentStatus): number {
  return MOCK_PAYMENTS.filter((p) => p.status === status).length;
}

export function countMine(status: PaymentStatus): number {
  return MOCK_PAYMENTS.filter(
    (p) => p.status === status && p.financeUserId === MOCK_FINANCE_USER.id,
  ).length;
}

export function collectedToday(): { amount: number; currency: 'CAD' } {
  // Anything verified today in our base currency.
  const todayStart = new Date(NOW);
  todayStart.setHours(0, 0, 0, 0);
  const amount = MOCK_PAYMENTS
    .filter((p) => p.verifiedAt && new Date(p.verifiedAt) >= todayStart)
    .reduce((sum, p) => sum + p.receivedAmount, 0);
  return { amount, currency: 'CAD' };
}

export function verifiedTodayCount(): number {
  const todayStart = new Date(NOW);
  todayStart.setHours(0, 0, 0, 0);
  return MOCK_PAYMENTS.filter(
    (p) => p.verifiedAt && new Date(p.verifiedAt) >= todayStart,
  ).length;
}

export function readyForProcessingCount(): number {
  return MOCK_PAYMENTS.filter(
    (p) => p.status === 'RECEIPT_CONFIRMED',
  ).length;
}

export function problemPile(): PaymentRecord[] {
  return MOCK_PAYMENTS.filter(
    (p) =>
      p.status === 'CORRECTION_REQUIRED' ||
      p.status === 'REJECTED' ||
      p.status === 'ON_HOLD' ||
      (p.slaStatus === 'BREACHED'),
  );
}

export function myActiveQueue(): PaymentRecord[] {
  return MOCK_PAYMENTS
    .filter(
      (p) =>
        p.financeUserId === MOCK_FINANCE_USER.id &&
        (p.status === 'UNDER_VERIFICATION' || p.status === 'NEW_FROM_SALES'),
    )
    .sort((a, b) => +new Date(a.slaDueAt) - +new Date(b.slaDueAt));
}

// ---------- Status / method display helpers ------------------------------

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  NEW_FROM_SALES: 'New from Sales',
  UNDER_VERIFICATION: 'Under Verification',
  ON_HOLD: 'On Hold',
  CORRECTION_REQUIRED: 'Correction Required',
  REJECTED: 'Rejected',
  VERIFIED: 'Verified',
  RECEIPT_CONFIRMED: 'Receipt Confirmed',
  AWAITING_BALANCE: 'Awaiting Balance',
  SENT_TO_PROCESSING: 'Sent to Processing',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK: 'Bank Transfer',
  CARD: 'Card',
  CHEQUE: 'Cheque',
  MOBILE: 'Mobile Wallet',
  WIRE: 'Wire',
  ONLINE: 'Online',
  OTHER: 'Other',
};

// ---------- Time formatting helpers --------------------------------------

export function fmtRelative(iso: string): string {
  const target = new Date(iso).getTime();
  const diff = target - NOW.getTime();
  const abs = Math.abs(diff);
  const past = diff < 0;
  const mins = Math.round(abs / 60000);
  if (mins < 60) return past ? `${mins}m ago` : `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return past ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return past ? `${days}d ago` : `in ${days}d`;
}

export function fmtAmount(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString()}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-PK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function initialsOf(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) ?? 'U').toUpperCase();
}
