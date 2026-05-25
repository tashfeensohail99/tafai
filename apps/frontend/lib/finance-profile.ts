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
  incurredAt: string;
  receiptFileName: string | null;
  hasReceipt: boolean;
  createdAt: string;
}

export interface FinanceCustomerProfile {
  lead: FinanceProfileLead;
  clientId: string | null;
  agreement: FinanceProfileAgreement | null;
  contract: FinanceProfileContract | null;
  installments: Array<{ id: string; sequence: number; dueDate: string; amount: number; status: string; description: string | null; paidAmount: number; paidStatus: string }>;
  invoices: Array<{ id: string; invoiceNumber: string; status: string; currency: string; totalAmount: number; paidAmount: number; dueDate: string | null; createdAt: string }>;
  payments: Array<{ id: string; amount: number; currency: string; status: string; paymentMethod: string | null; paidAt: string | null; verifiedAt: string | null }>;
  receipts: Array<{ id: string; receiptNumber: string; amount: number; currency: string; issuedAt: string }>;
  handovers: Array<{ id: string; status: string; amount: number; currency: string; verified: boolean; receiptFileName: string | null; submittedAt: string; reviewedAt: string | null }>;
  processingCase: { id: string; stage: string; service: string; targetCountry: string; slaStatus: string } | null;
  expenses: FinanceProfileExpense[];
  totals: { fee: number; paid: number; outstanding: number; currency: string; installmentsPaid: number; installmentsTotal: number; expenses: number; margin: number };
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

/** Finance uploads the signed agreement PDF onto the customer's contract. */
export async function uploadSignedAgreement(contractId: string, file: File): Promise<void> {
  const fd = new FormData();
  fd.append('file', file);
  await apiFetch(`/finance/service-contracts/${contractId}/upload-signed`, {
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
  currency?: string;
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
