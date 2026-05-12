/**
 * @tashfeen/shared-types — enums/finance.enums.ts
 * Matches Prisma schema: InvoiceStatus, PaymentStatus, FinanceHandoverStatus
 */

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
  DISPUTED = 'DISPUTED',
}

export enum FinanceHandoverStatus {
  SUBMITTED = 'SUBMITTED',
  IN_REVIEW = 'IN_REVIEW',
  PAYMENT_RECORDED = 'PAYMENT_RECORDED',
  PAYMENT_VERIFIED = 'PAYMENT_VERIFIED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHEQUE = 'CHEQUE',
  ONLINE = 'ONLINE',
  OTHER = 'OTHER',
}

export enum CurrencyCode {
  PKR = 'PKR',
  CAD = 'CAD',
  USD = 'USD',
  GBP = 'GBP',
  AUD = 'AUD',
  AED = 'AED',
}
