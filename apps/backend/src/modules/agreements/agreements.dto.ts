import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * A single row of a payment plan / Annexure-A schedule. Used both for a
 * template's default stage labels and (later) a concrete agreement's plan.
 */
export class PaymentStageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  /** e.g. "At signing", "After file submission", or a due date string. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trigger?: string;
}

export class CreateAgreementTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'categoryKey must be alphanumeric with underscores or dashes only',
  })
  categoryKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  programTitle!: string;

  /** Clause HTML; may contain {{TOKENS}} and a {{PAYMENT_PLAN}} slot. */
  @IsString()
  @IsNotEmpty()
  bodyHtml!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentStageDto)
  defaultStages?: PaymentStageDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/**
 * categoryKey is intentionally omitted — it is the stable identity of the
 * category and must not change once agreements reference it.
 */
export class UpdateAgreementTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  programTitle?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  bodyHtml?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentStageDto)
  defaultStages?: PaymentStageDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ListTemplatesQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

/**
 * Stateless preview — renders whatever is currently in the editor (new or
 * existing) to a PDF using sample applicant data, so the author sees the
 * real layout before saving.
 */
export class PreviewTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  programTitle!: string;

  @IsString()
  @IsNotEmpty()
  bodyHtml!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentStageDto)
  defaultStages?: PaymentStageDto[];
}
