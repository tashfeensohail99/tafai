import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  VisitorPaymentMethod,
  VisitorPaymentStatus,
  VisitStatus,
  VisitType,
} from '@prisma/client';

/** Front-desk quick lookup — match an existing lead or client by phone or name. */
export class LookupQueryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(60)
  q!: string;
}

export class ListVisitsQueryDto {
  /** PKT day, YYYY-MM-DD. Defaults to today (Pakistan time) when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  date?: string;

  /** Inclusive PKT date range (log view). Both required to take effect. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  to?: string;

  /** Free-text search over visitor name / phone. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;

  @IsOptional()
  @IsEnum(VisitType)
  type?: VisitType;

  /** Pagination (log view). limit 1–200 (default 50), offset ≥ 0. */
  @IsOptional()
  @IsString()
  @MaxLength(6)
  limit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(9)
  offset?: string;
}

export class CreateVisitDto {
  @IsEnum(VisitType)
  visitType!: VisitType;

  /** Full name as the desk keys it (split into first/last only when we spin up a Lead). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /** Link to a known lead / client instead of creating a new one. */
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Whom they came to see. */
  @IsOptional()
  @IsUUID()
  hostEmployeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  purpose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateVisitDto {
  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;

  @IsOptional()
  @IsUUID()
  hostEmployeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// ── Phase 2: paid consultation with the principal ──────────────────────────

export class ConsultAvailabilityQueryDto {
  /** PKT day, YYYY-MM-DD. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

// ── Phase 3: reports / insights ────────────────────────────────────────────

export class ReceptionReportQueryDto {
  /** Inclusive PKT date window, YYYY-MM-DD. Defaults to the last 30 days. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class CollectConsultationDto {
  /** CASH = verified at the counter (instant confirm); BANK_TRANSFER = pending
   *  finance verification. Defaults to CASH for back-compat. */
  @IsOptional()
  @IsEnum(VisitorPaymentMethod)
  method?: VisitorPaymentMethod;

  /** Required only when no slot is pre-booked (schedule-at-collect / see-now). */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionRef?: string;

  /** Did the customer agree to WhatsApp updates for this consultation? Gates the
   *  business-initiated templates. Defaults to true when omitted (back-compat). */
  @IsOptional()
  @IsBoolean()
  whatsappConsent?: boolean;
}

export class RescheduleConsultDto {
  /** New slot start on the principal's calendar (ISO 8601). Date/time only. */
  @IsDateString()
  scheduledAt!: string;
}

export class VisitorPaymentQueryDto {
  @IsOptional()
  @IsEnum(VisitorPaymentStatus)
  status?: VisitorPaymentStatus;

  @IsOptional()
  @IsEnum(VisitorPaymentMethod)
  method?: VisitorPaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class RejectVisitorPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateReceptionSettingsDto {
  @IsOptional()
  @IsUUID()
  principalEmployeeId?: string;

  @IsOptional()
  @IsNumberString()
  feeAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  feeCurrency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  bankIban?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankTitle?: string;
}
