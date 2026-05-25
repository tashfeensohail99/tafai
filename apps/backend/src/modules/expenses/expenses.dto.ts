import { ExpenseCategory } from '@prisma/client';
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

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsDateString()
  incurredAt?: string;

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
