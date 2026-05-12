/**
 * @tashfeen/shared-types — entities/finance.types.ts
 * Finance entity shapes as returned by the API.
 */

import {
  InvoiceStatus,
  PaymentStatus,
  FinanceHandoverStatus,
  PaymentMethod,
  CurrencyCode,
} from '../enums/finance.enums';

export interface InvoiceSummary {
  id: string;
  clientId: string;
  clientName: string;
  caseId: string | null;
  invoiceNumber: string;
  status: InvoiceStatus;
  totalAmount: number;
  paidAmount: number;
  currency: CurrencyCode;
  dueDate: string | null;
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSummary {
  id: string;
  invoiceId: string;
  clientId: string;
  amount: number;
  currency: CurrencyCode;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string | null;
  paidAt: string | null;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface FinanceHandoverSummary {
  id: string;
  leadId: string | null;
  clientId: string | null;
  submittedByUserId: string;
  submittedByName: string;
  status: FinanceHandoverStatus;
  amountCollected: number;
  currency: CurrencyCode;
  paymentMethod: PaymentMethod;
  notes: string | null;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}
