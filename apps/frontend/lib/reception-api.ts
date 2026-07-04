/**
 * reception-api.ts
 * Front-desk / Reception module API adapter. Backend routes live under
 * /reception (see apps/backend/src/modules/reception).
 */
import { apiFetch, buildQuery } from './api-client';

export type VisitType = 'WALK_IN' | 'EXISTING_CLIENT' | 'PAID_CONSULT';
export type VisitStatus = 'WAITING' | 'IN_MEETING' | 'DONE' | 'NO_SHOW' | 'CANCELLED';

export interface LookupHit {
  kind: 'lead' | 'client';
  id: string;
  name: string;
  phone: string | null;
  referenceCode: string;
  status: string;
  owner: string | null;
}

export interface Host {
  id: string;
  name: string;
  department: string | null;
}

export interface VisitRow {
  id: string;
  visitType: VisitType;
  status: VisitStatus;
  name: string;
  phone: string | null;
  purpose: string | null;
  notes: string | null;
  leadId: string | null;
  clientId: string | null;
  hostEmployeeId: string | null;
  referenceCode: string | null;
  hostName: string | null;
  // Paid consultation (phase 2 / P4a)
  paid: boolean;
  pendingPayment?: boolean;
  feeAmount: number | null;
  feeCurrency: string | null;
  appointmentAt: string | null;
  checkedInAt: string;
  checkedOutAt: string | null;
}

export interface ReceptionSettings {
  principal: { id: string; name: string } | null;
  feeAmount: number | null;
  feeCurrency: string | null;
  bank: { iban: string | null; name: string | null; title: string | null };
  configured: boolean;
}

export interface AvailabilitySlot {
  start: string;
  end: string;
}
export interface Availability {
  employeeId: string;
  date: string;
  workStart: string;
  workEnd: string;
  busy: Array<{ id: string; title: string; start: string; end: string }>;
  freeSlots: AvailabilitySlot[];
}

export type VisitorPaymentMethod = 'CASH' | 'BANK_TRANSFER';
export type VisitorPaymentStatus = 'AWAITING_PROOF' | 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';

export interface CollectConsultationResult {
  /** 'confirmed' = cash, verified now; 'pending' = bank transfer, awaiting finance. */
  status: 'confirmed' | 'pending';
  method: VisitorPaymentMethod;
  receiptNumber: string | null;
  invoiceNumber: string | null;
  appointmentId: string;
  scheduledAt: string;
  feeAmount: number;
  feeCurrency: string;
  visitorPaymentId?: string;
}

export interface VisitorPaymentRow {
  id: string;
  visitId: string;
  name: string;
  phone: string | null;
  method: VisitorPaymentMethod;
  status: VisitorPaymentStatus;
  amount: number;
  currency: string;
  transactionRef: string | null;
  receiptNumber: string | null;
  hasProof: boolean;
  proofUrl: string | null;
  // Advisory OCR read of the uploaded receipt (P4c) — finance still confirms.
  ocrStatus: string | null; // SKIPPED | READING | DONE | FAILED | null
  ocrAmount: number | null;
  ocrCurrency: string | null;
  ocrReference: string | null;
  ocrBankName: string | null;
  ocrPaidAt: string | null;
  ocrConfidence: number | null;
  createdAt: string;
  verifiedAt: string | null;
  rejectedReason: string | null;
}

export interface VisitorPaymentList {
  rows: VisitorPaymentRow[];
  totals: {
    pendingCount: number;
    byCurrency: Record<string, { cash: number; bank: number; pending: number }>;
  };
}

export interface VisitCounts {
  total: number;
  waiting: number;
  inMeeting: number;
  done: number;
  noShow: number;
  cancelled: number;
  walkIn: number;
  existing: number;
  paid: number;
}

export interface VisitList {
  label: string;
  total: number;
  limit: number;
  offset: number;
  counts: VisitCounts;
  visits: VisitRow[];
}

export interface CreateVisitInput {
  visitType: VisitType;
  name: string;
  phone?: string;
  leadId?: string;
  clientId?: string;
  hostEmployeeId?: string;
  purpose?: string;
  notes?: string;
}

export interface ListVisitsParams {
  date?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: VisitStatus;
  type?: VisitType;
  limit?: number;
  offset?: number;
}

export async function receptionLookup(q: string): Promise<{ results: LookupHit[] }> {
  return apiFetch<{ results: LookupHit[] }>(`/reception/lookup${buildQuery({ q })}`, { cache: 'no-store' });
}

export async function listHosts(): Promise<{ hosts: Host[] }> {
  return apiFetch<{ hosts: Host[] }>('/reception/hosts');
}

export async function listVisits(params: ListVisitsParams = {}): Promise<VisitList> {
  return apiFetch<VisitList>(`/reception/visits${buildQuery(params as Record<string, unknown>)}`, {
    cache: 'no-store',
  });
}

export async function createVisit(input: CreateVisitInput): Promise<VisitRow> {
  return apiFetch<VisitRow>('/reception/visits', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateVisit(
  id: string,
  patch: { status?: VisitStatus; hostEmployeeId?: string | null; notes?: string },
): Promise<VisitRow> {
  return apiFetch<VisitRow>(`/reception/visits/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// ── Paid consultation (phase 2) ──────────────────────────────────────────────

export async function getReceptionSettings(): Promise<ReceptionSettings> {
  return apiFetch<ReceptionSettings>('/reception/settings', { cache: 'no-store' });
}

export async function updateReceptionSettings(patch: {
  principalEmployeeId?: string;
  feeAmount?: string;
  feeCurrency?: string;
  bankIban?: string;
  bankName?: string;
  bankTitle?: string;
}): Promise<ReceptionSettings> {
  return apiFetch<ReceptionSettings>('/reception/settings', { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function getConsultAvailability(date: string): Promise<Availability> {
  return apiFetch<Availability>(`/reception/consult/availability${buildQuery({ date })}`, { cache: 'no-store' });
}

export async function collectConsultation(
  visitId: string,
  input: {
    method?: VisitorPaymentMethod;
    scheduledAt?: string;
    paymentMethod?: string;
    transactionRef?: string;
  },
): Promise<CollectConsultationResult> {
  return apiFetch<CollectConsultationResult>(`/reception/visits/${visitId}/collect-consultation`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listVisitorPayments(
  params: { status?: VisitorPaymentStatus; method?: VisitorPaymentMethod; from?: string; to?: string } = {},
): Promise<VisitorPaymentList> {
  return apiFetch<VisitorPaymentList>(`/reception/visitor-payments${buildQuery(params as Record<string, unknown>)}`, {
    cache: 'no-store',
  });
}

export async function verifyVisitorPayment(
  id: string,
): Promise<{ alreadyVerified: boolean; receiptNumber: string | null; invoiceNumber?: string; appointmentId?: string }> {
  return apiFetch(`/reception/visitor-payments/${id}/verify`, { method: 'POST' });
}

export async function rejectVisitorPayment(id: string, reason: string): Promise<{ status: 'rejected' }> {
  return apiFetch(`/reception/visitor-payments/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/** Finance re-runs the advisory OCR read on a pending payment's receipt. */
export async function reReadVisitorPaymentOcr(id: string): Promise<{ ocrStatus: string }> {
  return apiFetch(`/reception/visitor-payments/${id}/ocr`, { method: 'POST' });
}

/** Send the customer a WhatsApp reminder (with pay link) to complete a pending
 *  bank transfer. */
export async function remindVisitorPayment(id: string): Promise<{ sent: boolean; reason?: string }> {
  return apiFetch(`/reception/visitor-payments/${id}/remind`, { method: 'POST' });
}

export interface PayQr {
  token: string;
  payUrl: string;
  qrDataUrl: string;
  expiresAt: string;
}

/** A QR + link the desk shows so the customer can scan + upload their receipt. */
export async function getPayQr(visitorPaymentId: string): Promise<PayQr> {
  return apiFetch<PayQr>(`/reception/visitor-payments/${visitorPaymentId}/pay-qr`, { cache: 'no-store' });
}

// ── Reports / insights (phase 3) ─────────────────────────────────────────────

export interface ReceptionReport {
  range: { from: string; to: string; days: number };
  footfall: {
    total: number;
    walkIn: number;
    existingClient: number;
    paidConsult: number;
    daily: Array<{ date: string; walkIn: number; existingClient: number; paidConsult: number; total: number }>;
  };
  outcomes: {
    waiting: number;
    inMeeting: number;
    done: number;
    noShow: number;
    cancelled: number;
    noShowRate: number;
  };
  conversion: { walkIns: number; leads: number; converted: number; conversionRate: number };
  consult: { count: number; noShow: number; collected: Array<{ currency: string; amount: number }> };
  hosts: Array<{ id: string; name: string; visits: number }>;
}

export async function getReceptionReport(params: { from?: string; to?: string } = {}): Promise<ReceptionReport> {
  return apiFetch<ReceptionReport>(`/reception/reports${buildQuery(params as Record<string, unknown>)}`, {
    cache: 'no-store',
  });
}
