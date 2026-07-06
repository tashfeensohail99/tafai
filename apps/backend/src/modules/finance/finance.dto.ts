import {
  IsBase64,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FinanceHandoverStatus, InvoiceStatus, PaymentStatus } from '@prisma/client';

/** Mark/unmark a contract milestone (installment) as delivered → earned revenue. */
// (internalReference is captured below on CreatePaymentDto.)

export class RecognizeInstallmentDto {
  @IsOptional()
  @IsBoolean()
  recognize?: boolean;
}

/** Set or clear the accounting period-lock (book-close) date. */
export class LockPeriodDto {
  @IsOptional()
  @IsDateString()
  date?: string | null;
}

export enum FinanceHandoverReviewAction {
  MARK_IN_REVIEW = 'MARK_IN_REVIEW',
  RECORD_PAYMENT = 'RECORD_PAYMENT',
  REJECT = 'REJECT',
}

export class ListInvoicesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  ownerType?: 'lead' | 'client';

  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;
}

export class ListFinanceQueueQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;
}

export class ListFinanceHandoversQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(FinanceHandoverStatus)
  status?: FinanceHandoverStatus;

  @IsOptional()
  @IsUUID()
  leadId?: string;
}

export class CreateInvoiceDto {
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  caseId?: string;

  /**
   * The service agreement this invoice bills against. Set by internal callers
   * (installment-linked invoicing, handover billing) so the finance ledger can
   * attribute the invoice + its payments to a specific agreement now that a
   * person can hold multiple. NULL for consult / ad-hoc invoices.
   */
  @IsOptional()
  @IsUUID()
  agreementId?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsNumberString()
  subtotal!: string;

  @IsOptional()
  @IsNumberString()
  taxAmount?: string;

  @IsOptional()
  @IsNumberString()
  discountAmount?: string;

  @IsOptional()
  @IsNumberString()
  totalAmount?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Standalone consultation-fee invoice (Reception paid-consult flow). When set,
   * the agreement-readiness gate is skipped — a paid meeting isn't part of the
   * customer's service-fee ledger, so it must not require an approved agreement.
   */
  @IsOptional()
  @IsBoolean()
  isConsultation?: boolean;
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsNumberString()
  subtotal?: string;

  @IsOptional()
  @IsNumberString()
  taxAmount?: string;

  @IsOptional()
  @IsNumberString()
  discountAmount?: string;

  @IsOptional()
  @IsNumberString()
  totalAmount?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreatePaymentDto {
  @IsUUID()
  invoiceId!: string;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionRef?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Internal-only annotation (NOT shown on client PDFs) — e.g. "handover:<id>"
   *  to link a payment back to the workflow row that created it. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  internalReference?: string;
}

export class VerifyPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateFinanceHandoverDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  /**
   * The agreement (program) this payment is for. Set by the customer profile
   * when the customer holds more than one agreement, so review-time invoice
   * resolution credits the right program's ledger instead of the newest one.
   */
  @IsOptional()
  @IsUUID()
  agreementId?: string;

  @IsNumberString()
  submittedAmount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  receiptFileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  receiptMimeType?: string;

  @IsBase64()
  receiptContentBase64!: string;
}

export class UpdateFinanceHandoverDto {
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsNumberString()
  submittedAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  receiptFileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  receiptMimeType?: string;

  @IsOptional()
  @IsBase64()
  receiptContentBase64?: string;
}

export class FinanceHandoverReviewDto {
  @IsEnum(FinanceHandoverReviewAction)
  action!: FinanceHandoverReviewAction;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  financeNotes?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class RefundPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * Admin orphan-cleanup request. The reason is required and lands on
 * every voided row's notes + the audit log + the lead activity timeline
 * so the trail is self-explanatory months later. Min length 5 to keep
 * the trail honest — a one-character placeholder isn't useful.
 */
export class CleanupOrphanHandoversDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

/**
 * Admin step-up authentication for deleting a finance handover.
 *
 * A finance officer initiates the delete from the UI — they're already
 * authenticated via JWT. To actually authorise the destructive action
 * an admin physically walks over and types THEIR email + password into
 * the modal. The backend looks up that admin account independently,
 * bcrypt-compares the password, and verifies the account is ACTIVE
 * and holds an admin role. Only then does the soft-delete proceed.
 *
 * Both identities (the initiating finance officer + the authorising
 * admin) are recorded on the audit log + the lead timeline so the
 * trail attributes responsibility cleanly.
 */
export class AdminDeleteHandoverDto {
  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  adminPassword!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}