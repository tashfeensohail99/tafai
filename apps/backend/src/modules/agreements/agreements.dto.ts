import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
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

/** Currencies the agreement payment plan accepts. */
export const AGREEMENT_CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'PKR'] as const;
export const PAYMENT_PLAN_TYPES = ['FULL', 'INSTALLMENT', 'MILESTONE'] as const;

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

// ─── Agreement authoring (Sales) ─────────────────────────────────────────

/** Applicant bio substituted into {{TOKENS}}. Most fields optional — Sales
 *  fills what the category needs; name is the minimum. */
export class BioDataDto {
  @IsString() @IsNotEmpty() @MaxLength(200) applicantName!: string;
  @IsOptional() @IsString() @MaxLength(200) fatherName?: string;
  @IsOptional() @IsString() @MaxLength(60) cnic?: string;
  @IsOptional() @IsString() @MaxLength(60) passport?: string;
  @IsOptional() @IsString() @MaxLength(60) dob?: string;
  @IsOptional() @IsString() @MaxLength(120) nationality?: string;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(80) fileNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) agreementDate?: string;
  /** Destination country — rewrites the template's Canada wording everywhere. */
  @IsOptional() @IsString() @MaxLength(120) country?: string;
}

/** One row of the payment schedule (Annexure A). */
export class PaymentInstallmentDto {
  @IsInt() @Min(1) sequence!: number;
  @IsString() @IsNotEmpty() @MaxLength(200) stage!: string;
  @IsNumber() @Min(0) amount!: number;
  /** Free-text condition, e.g. "At signing", "Before filing", "On approval". */
  @IsOptional() @IsString() @MaxLength(200) trigger?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/** Optional separate government / third-party costs (excluded from the fee). */
export class GovernmentFeeDto {
  @IsString() @IsNotEmpty() @MaxLength(200) label!: string;
  @IsNumber() @Min(0) amount!: number;
  @IsOptional() @IsString() @IsIn([...AGREEMENT_CURRENCIES]) currency?: string;
  @IsOptional() @IsString() @MaxLength(120) payableBy?: string;
}

/** The full structured payment plan. Totals are validated server-side. */
export class PaymentPlanDto {
  @IsString() @IsIn([...PAYMENT_PLAN_TYPES]) planType!: string;
  @IsString() @IsIn([...AGREEMENT_CURRENCIES]) currency!: string;
  @IsNumber() @Min(0) grossAmount!: number;
  @IsNumber() @Min(0) discountAmount!: number;
  @IsNumber() @Min(0) netPayable!: number;
  @IsOptional() @IsNumber() @Min(0) taxAmount?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentInstallmentDto)
  installments!: PaymentInstallmentDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GovernmentFeeDto)
  governmentFees?: GovernmentFeeDto[];

  @IsOptional() @IsBoolean() refundable?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) refundPolicyText?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

/** Create a draft agreement from a template for a given lead. */
export class CreateAgreementDto {
  @IsString() @IsNotEmpty() leadId!: string;
  @IsString() @IsNotEmpty() templateId!: string;
  /** Bypass the "one active agreement per lead + service" guard. Set ONLY when
   *  the rep deliberately confirms a second agreement for the SAME service on
   *  the same lead (e.g. a genuinely different applicant). Defaults false. */
  @IsOptional() @IsBoolean() allowDuplicate?: boolean;
}

/** Update a draft agreement's bio / payment plan / sales notes. */
export class UpdateAgreementDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BioDataDto)
  bioData?: BioDataDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentPlanDto)
  paymentPlan?: PaymentPlanDto;

  /** Sales-edited agreement document (HTML). When present it is stored
   *  verbatim and becomes the source for the PDF (overrides regeneration). */
  @IsOptional() @IsString() @MaxLength(200000) contentHtml?: string;

  @IsOptional() @IsString() @MaxLength(4000) salesNotes?: string;
}

export class ListAgreementsQueryDto {
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() leadId?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;
}

// ─── Finance review ──────────────────────────────────────────────────────

export class RequestChangesDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) note!: string;
}
