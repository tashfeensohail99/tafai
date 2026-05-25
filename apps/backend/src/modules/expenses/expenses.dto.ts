import { ExpenseCategory } from '@prisma/client';
import {
  IsBase64,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateExpenseDto {
  @IsUUID()
  leadId!: string;

  @IsOptional()
  @IsUUID()
  caseId?: string;

  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @IsNumberString()
  amount!: string;

  /** Recoverable input tax (GST/HST/VAT) included in/charged on this expense. */
  @IsOptional()
  @IsNumberString()
  taxAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsDateString()
  incurredAt?: string;

  /** Rebillable to the client (recoverable) vs absorbed firm cost (default). */
  @IsOptional()
  @IsBoolean()
  billable?: boolean;

  // Optional proof-of-spend receipt (base64), mirroring the handover upload.
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
