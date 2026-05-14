/**
 * finance-api.ts
 * Adapter layer between the backend finance REST API and Finance UI components.
 *
 * All finance components import their data via this file instead of MOCK data.
 */

import { apiFetch } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types matching the backend FinanceHandover + Payment + Invoice models
// ---------------------------------------------------------------------------

export type FinanceHandoverStatus =
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'PAYMENT_RECORDED'
  | 'PAYMENT_VERIFIED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'SENT_TO_PROCESSING';

export type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED';

export type PaymentStatus =
  | 'PENDING'
  | 'PARTIAL'
  | 'PAID'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'DISPUTED';

export type PaymentMethod =
  | 'CASH'
  | 'BANK'
  | 'CARD'
  | 'CHEQUE'
  | 'MOBILE'
  | 'WIRE'
  | 'ONLINE'
  | 'OTHER';

export interface ApiHandoverLead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  status: string;
  serviceInterest: string | null;
  targetCountry: string | null;
}

export interface ApiHandoverInvoice {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: string;
  totalAmount: string;
  paidAmount: string;
  dueDate: string | null;
  notes: string | null;
}

export interface ApiHandoverPayment {
  id: string;
  status: PaymentStatus;
  amount: string;
  currency: string;
  paymentMethod: string | null;
  transactionRef: string | null;
  paidAt: string | null;
  notes: string | null;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
}

export interface ApiHandover {
  id: string;
  leadId: string;
  invoiceId: string | null;
  paymentId: string | null;
  createdByUserId: string;
  reviewedByUserId: string | null;
  status: FinanceHandoverStatus;
  submittedAmount: string; // Decimal as string
  currency: string;
  paymentMethod: string | null;
  transactionRef: string | null;
  notes: string | null;
  financeNotes: string | null;
  receiptKey: string;
  receiptFileName: string;
  receiptMimeType: string | null;
  receiptSizeBytes: number | null;
  submittedAt: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  receiptDownloadUrl: string | null; // pre-signed S3 URL
  lead: ApiHandoverLead;
  invoice: ApiHandoverInvoice | null;
  payment: ApiHandoverPayment | null;
}

export interface ApiInvoice {
  id: string;
  leadId: string | null;
  clientId: string | null;
  caseId: string | null;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  totalAmount: string;
  paidAmount: string;
  dueDate: string | null;
  notes: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  lead: { id: string; firstName: string; lastName: string; phone: string } | null;
  client: { id: string; firstName: string; lastName: string; phone: string } | null;
}

export interface ApiRevenueByService {
  asOf: string;
  totals: {
    month: number;
    ytd: number;
    allTime: number;
  };
  byService: Array<{
    service: string;
    month: number;
    ytd: number;
    allTime: number;
  }>;
}

export type FinanceHandoverReviewAction =
  | 'MARK_IN_REVIEW'
  | 'RECORD_PAYMENT'
  | 'REJECT';

// ---------------------------------------------------------------------------
// Label helpers for UI
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<FinanceHandoverStatus, string> = {
  SUBMITTED: 'New from Sales',
  IN_REVIEW: 'Under Verification',
  PAYMENT_RECORDED: 'Payment Recorded',
  PAYMENT_VERIFIED: 'Verified',
  REJECTED: 'Correction Required',
  CANCELLED: 'Cancelled',
  SENT_TO_PROCESSING: 'Sent to Processing',
};

export const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  BANK: 'Bank Transfer',
  CARD: 'Card',
  CHEQUE: 'Cheque',
  MOBILE: 'Mobile Payment',
  WIRE: 'Wire Transfer',
  ONLINE: 'Online',
  OTHER: 'Other',
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function fmtAmount(amount: number | string, currency: string = 'CAD'): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n)) return '—';
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function fmtRelative(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

export function fmtDate(isoString: string | null): string {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString();
}

export function fmtDateTime(isoString: string | null): string {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString();
}

export function clientName(handover: ApiHandover): string {
  return `${handover.lead.firstName} ${handover.lead.lastName}`.trim();
}

// ---------------------------------------------------------------------------
// API fetch functions
// ---------------------------------------------------------------------------

/**
 * List all finance handovers. Optional status filter.
 */
export async function fetchHandovers(params?: {
  status?: FinanceHandoverStatus;
  leadId?: string;
  search?: string;
}): Promise<ApiHandover[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.leadId) qs.set('leadId', params.leadId);
  if (params?.search) qs.set('search', params.search);
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<ApiHandover[]>(`/finance/handovers${query}`);
}

/**
 * Fetch a single handover by ID.
 */
export async function fetchHandoverById(id: string): Promise<ApiHandover> {
  return apiFetch<ApiHandover>(`/finance/handovers/${id}`);
}

/**
 * Review a handover (mark in review, record payment, or reject).
 */
export async function reviewHandover(
  id: string,
  action: FinanceHandoverReviewAction,
  opts?: {
    financeNotes?: string;
    invoiceId?: string;
    dueDate?: string;
  },
): Promise<ApiHandover> {
  return apiFetch<ApiHandover>(`/finance/handovers/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({ action, ...opts }),
  });
}

/**
 * List finance invoices.
 */
export async function fetchInvoices(params?: {
  status?: InvoiceStatus;
  search?: string;
}): Promise<ApiInvoice[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<ApiInvoice[]>(`/finance/invoices${query}`);
}

/**
 * Get revenue by service (for dashboard metrics).
 */
export async function fetchRevenueByService(): Promise<ApiRevenueByService> {
  return apiFetch<ApiRevenueByService>('/finance/revenue/by-service');
}

/**
 * Get the finance payment queue (pending payments).
 */
export async function fetchQueue(params?: { search?: string }): Promise<unknown[]> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<unknown[]>(`/finance/queue${query}`);
}

/**
 * Verify a payment.
 */
export async function verifyPayment(
  paymentId: string,
  opts?: { verificationNote?: string },
): Promise<unknown> {
  return apiFetch(`/finance/payments/${paymentId}/verify`, {
    method: 'POST',
    body: JSON.stringify(opts ?? {}),
  });
}

/**
 * Refund a payment.
 */
export async function refundPayment(
  paymentId: string,
  opts?: { reason?: string; amount?: string },
): Promise<unknown> {
  return apiFetch(`/finance/payments/${paymentId}/refund`, {
    method: 'POST',
    body: JSON.stringify(opts ?? {}),
  });
}

/**
 * Result of an admin orphan-cleanup run. `scannedHandovers` is the
 * number of rejected handovers inspected; `voidedInvoices` /
 * `voidedPayments` are the actual count of rows transitioned to
 * CANCELLED. `affectedLeadIds` lets the UI report which leads had
 * their finance state cleaned up.
 */
export interface OrphanCleanupResult {
  scannedHandovers: number;
  voidedInvoices: number;
  voidedPayments: number;
  affectedLeadIds: string[];
  reason: string;
  processedAt: string;
}

/**
 * Admin maintenance — retroactively cancel Invoice/Payment rows that
 * were left orphaned by a "Verify then Reject" flow before the REJECT
 * branch was patched to auto-void them. The `reason` is required by
 * the backend and lands on every voided row's notes plus the audit
 * log and the lead activity timeline.
 */
export async function cleanupOrphanHandovers(
  reason: string,
): Promise<OrphanCleanupResult> {
  return apiFetch<OrphanCleanupResult>('/finance/maintenance/cleanup-orphans', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
