'use client';

import { apiFetch, buildQuery } from './api-client';
import type { BioDataInput, PaymentPlanInput, AgreementStatus } from './agreements';

/** Dashboard counters for the Signed-Agreements console. */
export interface SignedStats {
  total: number;
  newToday: number;
  thisWeek: number;
  changeRequested: number;
}

/** One row in the Signed-Agreements table. Money fields are Prisma Decimals
 *  serialised as strings. */
export interface SignedAgreementRow {
  id: string;
  agreementNumber: string;
  categoryKey: string;
  status: AgreementStatus;
  currency: string;
  totalAmount: string;
  grossAmount: string;
  discountAmount: string;
  paymentPlanType: string | null;
  leadId: string | null;
  clientId: string | null;
  serviceContractId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    referenceCode: string;
  } | null;
  /** How many pending correction requests this agreement has. */
  pendingChangeCount: number;
}

export interface SignedFilters {
  search?: string;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
  changeRequested?: boolean;
}

// ─── Detail shapes ──────────────────────────────────────────────────────────

export interface LedgerInstallment {
  id: string;
  sequence: number;
  amount: string;
  dueDate: string | null;
  description: string | null;
  status: string;
}
export interface LedgerContract {
  id: string;
  contractNumber: string;
  status: string;
  currency: string;
  totalAmount: string;
  signedDate: string | null;
  installments: LedgerInstallment[];
}
export interface LedgerPayment {
  id: string;
  amount: string;
  currency: string;
  status: string;
  paymentMethod: string | null;
  paidAt: string | null;
  verifiedAt: string | null;
}
export interface LedgerReceipt {
  id: string;
  receiptNumber: string;
  amount: string;
  currency: string;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}
export interface LedgerCreditNote {
  id: string;
  creditNoteNumber: string;
  amount: string;
  currency: string;
  reason: string | null;
  issuedAt: string;
}
export interface LedgerInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  subtotal: string;
  totalAmount: string;
  paidAmount: string;
  createdAt: string;
  payments: LedgerPayment[];
  receipts: LedgerReceipt[];
  creditNotes: LedgerCreditNote[];
}
export interface AgreementEventRow {
  id: string;
  type: string;
  summary: string;
  actorUserId: string | null;
  createdAt: string;
}
export interface ChangeRequestRow {
  id: string;
  type: 'BIO' | 'PAYMENT_PLAN';
  status: 'PENDING' | 'APPLIED' | 'REJECTED' | 'CANCELLED';
  reason: string | null;
  requestedByUserId: string;
  before: unknown;
  after: unknown;
  appliedByUserId: string | null;
  appliedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

export interface SignedAgreementDetail {
  id: string;
  agreementNumber: string;
  categoryKey: string;
  status: AgreementStatus;
  currency: string;
  totalAmount: string;
  grossAmount: string;
  discountAmount: string;
  paymentPlanType: string | null;
  bioData: Partial<BioDataInput> | null;
  paymentPlan: PaymentPlanInput | null;
  serviceContractId: string | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  signedAt: string | null;
  template: { id: string; name: string; categoryKey: string; programTitle: string } | null;
  lead:
    | { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; emailVerified: boolean | null; referenceCode: string }
    | null;
  client:
    | { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; referenceCode: string }
    | null;
  events: AgreementEventRow[];
  changeRequests: ChangeRequestRow[];
  contract: LedgerContract | null;
  invoices: LedgerInvoice[];
}

export function fetchSignedStats(): Promise<SignedStats> {
  return apiFetch<SignedStats>('/agreements/signed/stats', { cache: 'no-store' });
}

export function listSignedAgreements(filters: SignedFilters): Promise<SignedAgreementRow[]> {
  return apiFetch<SignedAgreementRow[]>(`/agreements/signed/list${buildQuery({ ...filters })}`, {
    cache: 'no-store',
  });
}

export function getSignedAgreementDetail(id: string): Promise<SignedAgreementDetail> {
  return apiFetch<SignedAgreementDetail>(`/agreements/signed/${id}`, { cache: 'no-store' });
}
