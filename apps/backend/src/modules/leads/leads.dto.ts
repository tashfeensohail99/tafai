import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { LeadPriority, LeadStatus } from '@prisma/client';
import { SERVICE_TYPE_CODES } from '../../common/service-types';

export class ListLeadsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsUUID()
  assignedEmployeeId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceChannel?: string;

  /**
   * When true, restricts the list to leads that originated from a CSV/Excel
   * import (at least one `LeadImportRow` exists). This is more reliable than
   * filtering by sourceChannel='csv-upload' since custom source labels from
   * the mapping take precedence on the lead row itself.
   *
   * The query-string value arrives as the literal "true" or "false". The
   * @Transform coerces to a boolean before validation, so @IsBoolean
   * (NOT @IsBooleanString) matches the post-transform type.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  fromCsv?: boolean;

  // Coded service type — must match the canonical list in
  // src/common/service-types.ts. Optional so legacy leads + WhatsApp-
  // sourced leads (which arrive unclassified) still validate; the
  // Sales→Finance gate enforces "must be set + canonical" at submit time.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @IsIn(SERVICE_TYPE_CODES, { message: 'serviceInterest must be one of the canonical service codes' })
  serviceInterest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetCountry?: string;

  /** ISO date — filters leads created on/after. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  createdFrom?: string;

  /** ISO date — filters leads created on/before (inclusive of that day). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  createdTo?: string;

  /** Only leads that arrived via a Click-to-WhatsApp ad. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  fromAd?: boolean;

  /** Restrict to one ad (Meta source_id from the leaderboard). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  adSourceId?: string;

  /**
   * Maximum rows to return. Defaults applied in the service (250 for admins,
   * 10000 for agents so a rep loads their full assigned book). Capped at 10000
   * so a curious agent can't kill the backend with `?limit=999999`.
   */
  @IsOptional()
  @IsNumberString()
  limit?: string;
}

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  alternatePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetCountry?: string;

  // Coded service type — must match the canonical list in
  // src/common/service-types.ts. Optional so legacy leads + WhatsApp-
  // sourced leads (which arrive unclassified) still validate; the
  // Sales→Finance gate enforces "must be set + canonical" at submit time.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @IsIn(SERVICE_TYPE_CODES, { message: 'serviceInterest must be one of the canonical service codes' })
  serviceInterest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceChannel?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  assignedEmployeeId?: string;

  @IsOptional()
  @IsUUID()
  referralPartnerId?: string;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  /**
   * Agreed total fee for the service the lead signed up for. Captured
   * at creation time when known, otherwise editable later via the
   * "Edit lead" modal. Becomes the totalAmount on the single Invoice
   * that future installment Payments roll up to. Passed as a string
   * to preserve decimal precision over the wire.
   */
  @IsOptional()
  @IsNumberString()
  serviceFeeAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  serviceFeeCurrency?: string;

  /**
   * If provided, the new Lead is linked to this existing WhatsApp thread
   * after creation (thread.leadId = newLead.id). Used by the inbox
   * "Convert to Lead" flow so a raw WhatsApp contact becomes a tracked
   * Lead and the chat history continues against the same thread.
   */
  @IsOptional()
  @IsUUID()
  whatsAppThreadId?: string;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  alternatePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetCountry?: string;

  // Coded service type — must match the canonical list in
  // src/common/service-types.ts. Optional so legacy leads + WhatsApp-
  // sourced leads (which arrive unclassified) still validate; the
  // Sales→Finance gate enforces "must be set + canonical" at submit time.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @IsIn(SERVICE_TYPE_CODES, { message: 'serviceInterest must be one of the canonical service codes' })
  serviceInterest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceChannel?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  assignedEmployeeId?: string;

  @IsOptional()
  @IsUUID()
  referralPartnerId?: string;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  lostReason?: string;

  /** Agreed total fee for the lead's service. See CreateLeadDto. */
  @IsOptional()
  @IsNumberString()
  serviceFeeAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  serviceFeeCurrency?: string;
}

export class AssignLeadDto {
  @IsUUID()
  assignedEmployeeId!: string;
}

export class ConvertLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * Bulk soft-delete a set of leads from the admin "Delete selected" UI.
 * Cap at 500 per call so the audit-log inserts stay quick and the
 * payload stays under reasonable POST-body limits — admin can repeat
 * if they need to nuke more than that in one sitting.
 */
export class BulkDeleteLeadsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids!: string[];
}