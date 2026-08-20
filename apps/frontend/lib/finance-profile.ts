'use client';

import { apiFetch } from './api-client';

export interface FinanceProfileLead {
  id: string;
  referenceCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  nationality: string | null;
  targetCountry: string | null;
  serviceInterest: string | null;
  status: string;
  sourceChannel: string | null;
  createdAt: string;
  assignedEmployee: { firstName: string | null; lastName: string | null } | null;
}

export interface FinanceProfileAgreement {
  id: string;
  agreementNumber: string;
  status: string;
  currency: string;
  totalAmount: number;
  grossAmount: number;
  discountAmount: number;
  hasPdf: boolean;
  serviceContractId: string | null;
  /** The program/category this agreement is for (e.g. "C11", "EB2_NIW"). Names
   *  the program in the multi-agreement selector. */
  categoryKey: string;
  bioData: Record<string, unknown> | null;
  sentAt: string | null;
  signedAt: string | null;
}

export interface FinanceProfileContract {
  id: string;
  contractNumber: string;
  status: string;
  totalAmount: number;
  currency: string;
  signedDate: string | null;
  hasSignedAgreement: boolean;
  agreementFileName: string | null;
}

export interface FinanceProfileInstallment {
  id: string;
  sequence: number;
  dueDate: string;
  amount: number;
  status: string;
  description: string | null;
  paidAmount: number;
  paidStatus: string;
  recognizedAt: string | null;
}

export interface FinanceProfileProgramTotals {
  fee: number;
  paid: number;
  outstanding: number;
  currency: string;
  installmentsPaid: number;
  installmentsTotal: number;
}

/**
 * One agreement's self-contained ledger (a "program" the customer applied for).
 * A customer can hold several — each bills and tracks its own fee, paid amount,
 * outstanding balance and installment schedule. The backend attributes every
 * invoice/payment to its agreement (Invoice.agreementId) so these never mix.
 */
export interface FinanceProfileProgram {
  agreement: FinanceProfileAgreement;
  contract: FinanceProfileContract | null;
  installments: FinanceProfileInstallment[];
  totals: FinanceProfileProgramTotals;
}

export type ExpenseCategory =
  | 'GOVERNMENT_FEE'
  | 'EMBASSY'
  | 'MEDICAL'
  | 'TRANSLATION'
  | 'COURIER'
  | 'THIRD_PARTY'
  | 'OTHER';

export interface FinanceProfileExpense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: string;
  baseAmount: number;
  baseCurrency: string;
  fxRate: number;
  billable: boolean;
  incurredAt: string;
  receiptFileName: string | null;
  hasReceipt: boolean;
  createdAt: string;
}

export interface FinanceCustomerProfile {
  lead: FinanceProfileLead;
  clientId: string | null;
  /**
   * One ledger per agreement (program), newest first. A customer can hold
   * several. The flat `agreement`/`contract`/`installments`/`totals` fields
   * below mirror the PRIMARY (newest) program for backward-compat.
   */
  agreements: FinanceProfileProgram[];
  /** Per-currency roll-up across all programs (avoids mixing PKR + CAD). */
  summary: { byCurrency: Array<{ currency: string; fee: number; paid: number; outstanding: number }>; agreementCount: number };
  agreement: FinanceProfileAgreement | null;
  contract: FinanceProfileContract | null;
  installments: FinanceProfileInstallment[];
  invoices: Array<{ id: string; invoiceNumber: string; status: string; currency: string; totalAmount: number; paidAmount: number; isConsultation: boolean; dueDate: string | null; createdAt: string }>;
  /** Paid consultation fees creditable against the service fee (audit #1). These
   *  are informational — the credit already applies automatically (the consult
   *  fee's paid invoice nets into Outstanding), so this just surfaces it. */
  consultCredits: Array<{ visitId: string; amount: number; currency: string; consultInvoiceNumber: string | null; paidAt: string | null }>;
  payments: Array<{ id: string; amount: number; currency: string; baseAmount: number; baseCurrency: string; fxRate: number; status: string; paymentMethod: string | null; paidAt: string | null; verifiedAt: string | null }>;
  receipts: Array<{ id: string; receiptNumber: string; amount: number; currency: string; issuedAt: string }>;
  handovers: Array<{ id: string; status: string; amount: number; currency: string; verified: boolean; receiptFileName: string | null; submittedAt: string; reviewedAt: string | null }>;
  processingCase: { id: string; stage: string; service: string; targetCountry: string; slaStatus: string } | null;
  /**
   * Whether the "Send to Processing" handover button is currently actionable.
   * `ready` flips true after a payment is verified (a PAYMENT_VERIFIED
   * handover exists) and the file hasn't already been handed off. `alreadySent`
   * means a ProcessingCase is already open — show a passive badge instead of
   * the button. `reason` is the hover/tooltip when the button is disabled.
   */
  sendToProcessing: {
    ready: boolean;
    handoverId: string | null;
    alreadySent: boolean;
    /** True for a Judicial Review (JR_RESUBMISSION) file — routes to a JrMatter
     *  in the JR Head's queue, not a ProcessingCase. Drives the button label. */
    isJudicialReview: boolean;
    /** Where the handover goes: 'JR' (JR Head's queue) or 'PROCESSING'. */
    target: 'JR' | 'PROCESSING';
    reason: string | null;
  };
  expenses: FinanceProfileExpense[];
  totals: { fee: number; paid: number; outstanding: number; currency: string; installmentsPaid: number; installmentsTotal: number; expenses: number; billableExpenses: number; absorbedExpenses: number; margin: number };
}

export function fetchFinanceCustomerProfile(leadId: string): Promise<FinanceCustomerProfile> {
  return apiFetch<FinanceCustomerProfile>(`/finance/customer/${leadId}`, { cache: 'no-store' });
}


export interface FinanceCustomerRow {
  leadId: string;
  referenceCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  serviceInterest: string | null;
  targetCountry: string | null;
  status: string;
  agreementStatus: string | null;
  hasContract: boolean;
  contractStatus: string | null;
  processingStage: string | null;
  hasPendingPayment: boolean;
  fee: number;
  paid: number;
  outstanding: number;
  currency: string;
}

/** Searchable customer list — the Finance "Customers" home. */
export function fetchFinanceCustomers(search?: string): Promise<FinanceCustomerRow[]> {
  const qs = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return apiFetch<FinanceCustomerRow[]>(`/finance/customer${qs}`, { cache: 'no-store' });
}

/**
 * Finance uploads the client's signed agreement. Keyed by **agreement id**
 * (not contract id) because the ServiceContract only materialises the moment
 * the signed copy lands — before this the agreement is a proposal with no
 * ledger yet. The backend handles both first upload (creates contract +
 * installments) and re-uploads (updates an already-signed contract).
 */
export async function uploadSignedAgreement(agreementId: string, file: File): Promise<void> {
  const fd = new FormData();
  fd.append('file', file);
  await apiFetch(`/agreements/${agreementId}/upload-signed`, {
    method: 'POST',
    body: fd,
    cache: 'no-store',
  });
}

/** Signed URL to download the stored signed agreement on a contract. */
export function getContractAgreementUrl(contractId: string): Promise<{ url: string; fileName: string }> {
  return apiFetch<{ url: string; fileName: string }>(`/finance/service-contracts/${contractId}/agreement-url`, {
    cache: 'no-store',
  });
}

/**
 * Record a payment from the customer profile: uploads the receipt proof and
 * the amount as a FinanceHandover (status SUBMITTED). Finance then verifies it
 * inline from the same profile's "Payment submissions" list (Review & verify),
 * which records + verifies the payment and advances the ledger's "paid X of Y".
 * Works the same for the first payment and every installment after it.
 */
export function recordCustomerPayment(payload: {
  leadId: string;
  /** Which program (agreement) this payment is for — pins it to that ledger
   *  when the customer holds more than one agreement. */
  agreementId?: string;
  submittedAmount: string;
  currency?: string;
  paymentMethod?: string;
  transactionRef?: string;
  notes?: string;
  receiptFileName: string;
  receiptMimeType?: string;
  receiptContentBase64: string;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/finance/handovers', {
    method: 'POST',
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
}

// ─── Expenses (cost side of the ledger) ────────────────────────────────────

/** Record an expense incurred on the client's behalf (optional receipt). */
export function createExpense(payload: {
  leadId: string;
  category?: ExpenseCategory;
  description: string;
  amount: string;
  taxAmount?: string;
  currency?: string;
  billable?: boolean;
  incurredAt?: string;
  receiptFileName?: string;
  receiptMimeType?: string;
  receiptContentBase64?: string;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/finance/expenses', {
    method: 'POST',
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
}

/** Soft-delete an expense (reversible). */
export function deleteExpense(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch<{ id: string; deleted: boolean }>(`/finance/expenses/${id}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}

/** Signed URL to download an expense's attached receipt. */
export function getExpenseReceiptUrl(id: string): Promise<{ url: string; fileName: string }> {
  return apiFetch<{ url: string; fileName: string }>(`/finance/expenses/${id}/receipt-url`, {
    cache: 'no-store',
  });
}

// ─── Send to Processing (finance → processing handover) ───────────────────

/**
 * Finance manually hands a customer's file over to the Processing team after
 * verifying payment. Posts to /processing/intake which opens a ProcessingCase,
 * converts the lead → client (if not already), and marks the FinanceHandover
 * as SENT_TO_PROCESSING so the customer profile flips into "already sent".
 */
export function sendCaseToProcessing(payload: {
  financeHandoverId: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  financeHandoverNote?: string;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/processing/intake', {
    method: 'POST',
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
}
