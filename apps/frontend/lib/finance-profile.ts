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

export interface FinanceCustomerProfile {
  lead: FinanceProfileLead;
  clientId: string | null;
  agreement: FinanceProfileAgreement | null;
  contract: FinanceProfileContract | null;
  installments: Array<{ id: string; sequence: number; dueDate: string; amount: number; status: string; description: string | null; paidAmount: number; paidStatus: string }>;
  invoices: Array<{ id: string; invoiceNumber: string; status: string; currency: string; totalAmount: number; paidAmount: number; dueDate: string | null; createdAt: string }>;
  payments: Array<{ id: string; amount: number; currency: string; status: string; paymentMethod: string | null; paidAt: string | null; verifiedAt: string | null }>;
  receipts: Array<{ id: string; receiptNumber: string; amount: number; currency: string; issuedAt: string }>;
  totals: { fee: number; paid: number; outstanding: number; currency: string; installmentsPaid: number; installmentsTotal: number };
}

export function fetchFinanceCustomerProfile(leadId: string): Promise<FinanceCustomerProfile> {
  return apiFetch<FinanceCustomerProfile>(`/finance/customer/${leadId}`, { cache: 'no-store' });
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
