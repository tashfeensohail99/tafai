import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SERVICE_TYPE_CODES } from '../../common/service-types';
import { Transform, Type } from 'class-transformer';
import {
  AuthorityDecision,
  AuthorityResponseType,
  AuthoritySubmissionStatus,
  CorrectionRequiredAction,
  CorrectionStatus,
  CorrectionType,
  DocReviewDecisionType,
  DocumentCriticality,
  DocumentValidityRule,
  ProcessingCasePriority,
  ProcessingCaseStage,
  ProcessingNoteType,
  ProcessingTaskPriority,
  ProcessingTaskStatus,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

export class CreateProcessingCaseDto {
  @IsUUID()
  financeHandoverId!: string;

  @IsOptional()
  @IsEnum(ProcessingCasePriority)
  priority?: ProcessingCasePriority;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  financeHandoverNote?: string;
}

export class AcknowledgeIntakeDto {
  @IsOptional()
  @IsUUID()
  assignOfficerId?: string; // if omitted, assigns to self
}

export class ListIntakeQueueQueryDto {
  @IsOptional()
  @IsEnum(ProcessingCasePriority)
  priority?: ProcessingCasePriority;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export class ListProcessingCasesQueryDto {
  @IsOptional()
  @IsEnum(ProcessingCaseStage)
  stage?: ProcessingCaseStage;

  @IsOptional()
  @IsEnum(ProcessingCasePriority)
  priority?: ProcessingCasePriority;

  @IsOptional()
  @IsUUID()
  assignedOfficerId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string; // client name, case id, service

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  targetCountry?: string;

  // Workflow doc's "filters: duration, last activity". ISO date-time strings
  // (yyyy-mm-dd is fine — Prisma coerces). `createdFrom/To` filter by intake
  // date; `updatedFrom/To` filter by last activity (any field write bumps
  // updatedAt, so this captures the "no movement in N days" case).
  @IsOptional()
  @IsString()
  @MaxLength(40)
  createdFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  createdTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  updatedFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  updatedTo?: string;

  /**
   * Filter by authority decision (PENDING / APPROVED / REJECTED). Used by the
   * Refund / Escalation view to surface cases that came back REJECTED from
   * the authority and need refund/escalation handling per the workflow doc.
   */
  @IsOptional()
  @IsEnum(AuthorityDecision)
  authorityDecision?: AuthorityDecision;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

export class UpdateCasePriorityDto {
  @IsEnum(ProcessingCasePriority)
  priority!: ProcessingCasePriority;
}

export class AssignCaseDto {
  @IsUUID()
  officerId!: string;
}

export class ChangeCaseStageDto {
  @IsEnum(ProcessingCaseStage)
  toStage!: ProcessingCaseStage;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // For SUBMITTED stage — submission reference required
  @IsOptional()
  @IsString()
  @MaxLength(200)
  submissionReference?: string;

  // For UNDER_AUTHORITY_REVIEW — tracking number required
  @IsOptional()
  @IsString()
  @MaxLength(200)
  authorityTrackingRef?: string;

  // For CANCELLED — reason required
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cancellationReason?: string;

  // For COMPLETED — completion notes required
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  completionNotes?: string;
}

// ---------------------------------------------------------------------------
// Checklist templates
// ---------------------------------------------------------------------------

export class CreateDocumentTemplateDto {
  // Must be one of the 9 canonical service codes — matches Lead.serviceInterest
  // so the per-case checklist can be looked up by code at acknowledge-intake
  // time without any fuzzy matching. (See SERVICE_TYPE_CODES.)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @IsIn(SERVICE_TYPE_CODES, { message: 'service must be one of the canonical service codes' })
  service!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  targetCountry!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  documentName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsEnum(DocumentCriticality)
  criticality!: DocumentCriticality;

  @IsOptional()
  conditionRule?: Record<string, unknown>;

  @IsOptional()
  @IsString({ each: true })
  expectedFormats?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  maxFileSizeMb?: number;

  @IsEnum(DocumentValidityRule)
  validityRule!: DocumentValidityRule;

  @IsOptional()
  @IsInt()
  @Min(1)
  validityMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  validityBufferDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  guidanceUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateDocumentTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  documentName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @IsEnum(DocumentCriticality)
  criticality?: DocumentCriticality;

  @IsOptional()
  conditionRule?: Record<string, unknown>;

  @IsOptional()
  @IsString({ each: true })
  expectedFormats?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  maxFileSizeMb?: number;

  @IsOptional()
  @IsEnum(DocumentValidityRule)
  validityRule?: DocumentValidityRule;

  @IsOptional()
  @IsInt()
  @Min(1)
  validityMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  validityBufferDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  guidanceUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export class AddDocumentItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  documentName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsEnum(DocumentCriticality)
  criticality!: DocumentCriticality;

  @IsOptional()
  @IsString({ each: true })
  expectedFormats?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  maxFileSizeMb?: number;

  @IsEnum(DocumentValidityRule)
  validityRule!: DocumentValidityRule;

  @IsOptional()
  @IsInt()
  @Min(1)
  validityMonths?: number;
}

export class WaiveDocumentItemDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  waiveReason!: string;
}

export class RequestDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string; // custom message to client
}

export class ReviewDocumentDto {
  @IsEnum(DocReviewDecisionType)
  decision!: DocReviewDecisionType;

  @IsOptional()
  @IsString({ each: true })
  rejectionReasonCodes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionNote?: string;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export class CreateProcessingNoteDto {
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsEnum(ProcessingNoteType)
  noteType?: ProcessingNoteType;

  @IsOptional()
  @IsUUID(undefined, { each: true })
  mentions?: string[];
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export class CreateProcessingTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @IsOptional()
  @IsString()
  dueDate?: string; // ISO date string yyyy-mm-dd

  @IsOptional()
  @IsEnum(ProcessingTaskPriority)
  priority?: ProcessingTaskPriority;
}

export class UpdateProcessingTaskDto {
  @IsOptional()
  @IsEnum(ProcessingTaskStatus)
  status?: ProcessingTaskStatus;

  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(ProcessingTaskPriority)
  priority?: ProcessingTaskPriority;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export class SendCommunicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content!: string;

  @IsString({ each: true })
  channelsSent!: string[]; // ['PORTAL', 'WHATSAPP', 'EMAIL']
}

// ---------------------------------------------------------------------------
// Authority submissions
// ---------------------------------------------------------------------------

export class CreateAuthoritySubmissionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  authority!: string;

  @IsString()
  @IsNotEmpty()
  submissionDate!: string; // ISO date string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  submissionReference?: string;

  @IsOptional()
  @IsString({ each: true })
  documentsIncluded?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  trackingNumber?: string;
}

export class UpdateAuthoritySubmissionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trackingNumber?: string;

  @IsOptional()
  @IsEnum(AuthoritySubmissionStatus)
  status?: AuthoritySubmissionStatus;

  @IsOptional()
  @IsEnum(AuthorityResponseType)
  responseType?: AuthorityResponseType;

  @IsOptional()
  @IsString()
  responseNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nextAction?: string;

  /** ISO datetime string — when the authority response was received. */
  @IsOptional()
  @IsString()
  responseReceivedAt?: string;
}

// ---------------------------------------------------------------------------
// Correction Requests
// ---------------------------------------------------------------------------

export class CreateCorrectionRequestDto {
  /**
   * DOCUMENT — linked to a specific document item (documentItemId required).
   * INFORMATION — free-form information/data correction request.
   */
  @IsEnum(CorrectionType)
  correctionType!: CorrectionType;

  /**
   * Required when correctionType === DOCUMENT.
   * Must be a valid UUID of a CaseDocumentItem belonging to this case.
   */
  @IsOptional()
  @IsUUID()
  documentItemId?: string;

  /** Short subject line shown to client and in the officer list view. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  /**
   * Reason codes — free string array (officer picks from UI list or types).
   * At least one is required.
   */
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  reasonCodes!: string[];

  /** Private officer note — never sent to client. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  officerNote?: string;

  /** The message text shown to the client. Must be non-empty. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  clientMessage!: string;

  /** What action the client must take. */
  @IsEnum(CorrectionRequiredAction)
  requiredAction!: CorrectionRequiredAction;

  /**
   * SLA in hours for client to respond.
   * Defaults to 120 h (5 business days) in service if omitted.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  slaHours?: number;
}

export class ResolveCorrectionRequestDto {
  /** Brief resolution note (optional but recommended). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;
}

export class EscalateCorrectionRequestDto {
  /** Reason for escalation — required so manager has context. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  escalationReason!: string;
}

export class ListCorrectionRequestsQueryDto {
  /** Filter by status. Omit to return all statuses. */
  @IsOptional()
  @IsEnum(CorrectionStatus)
  status?: CorrectionStatus;

  /** Filter by correction type. */
  @IsOptional()
  @IsEnum(CorrectionType)
  correctionType?: CorrectionType;
}

// ---------------------------------------------------------------------------
// Reports (shared query DTO)
// ---------------------------------------------------------------------------

export class ReportDateRangeQueryDto {
  /** ISO date string — start of range (inclusive). Defaults to 30 days ago. */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** ISO date string — end of range (inclusive). Defaults to now. */
  @IsOptional()
  @IsString()
  dateTo?: string;

  /** Restrict results to a single officer (manager use). */
  @IsOptional()
  @IsUUID()
  officerId?: string;
}

export class ReportExportQueryDto {
  /** Which report to export. */
  @IsEnum(['workload', 'throughput', 'doc-quality', 'sla', 'expiry-risk'])
  reportType!: string;

  /** ISO date string — start of range. */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** ISO date string — end of range. */
  @IsOptional()
  @IsString()
  dateTo?: string;

  /** Filter to a single officer. */
  @IsOptional()
  @IsUUID()
  officerId?: string;
}
