import {
  IsBase64,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { FinanceHandoverStatus, InvoiceStatus, PaymentStatus } from '@prisma/client';

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