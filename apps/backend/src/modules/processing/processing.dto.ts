import {
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
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
  DocumentAttestationStatus,
  DocumentCriticality,
  DocumentValidityRule,
  ProcessingCasePriority,
  ProcessingCaseStage,
  ProcessingNoteType,
  ProcessingTaskPriority,
  ProcessingTaskStatus,
} from '@prisma/client';

// Phase 4c — associate sets/overrides a document's attestation state per case
// (mark attested, waive, mark not-required, or back to pending), optionally
// adjusting the chain for this specific client.
export class UpdateAttestationDto {
  @IsEnum(DocumentAttestationStatus)
  status!: DocumentAttestationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  chain?: string;
}

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

/**
 * Optional finance snapshot for a manually-created client. The firm's ledger
 * is CAD-based, so `totalFee` (and any `amountReceived`) are entered in
 * `currency` (default PKR on the client) and converted to CAD at the live rate
 * when the invoice + payment are written — exactly how Finance records a
 * foreign-currency payment. When present, the manual client gets a real
 * Invoice (+ a verified Payment + Receipt if amountReceived > 0), so a
 * sales/finance-bypassed client still shows an authentic paid/balance.
 */
export class ManualClientFinanceDto {
  @IsNumberString()
  totalFee!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsNumberString()
  amountReceived?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentMethod?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionRef?: string;
}

/**
 * Manual client creation — a Processing Manager's second on-ramp (no Finance
 * handover). Creates Lead (sourceChannel PROCESSING_MANUAL) → Client → an
 * INTAKE_PENDING case that lands in the intake queue like a finance case.
 * Email is required (the client is provisioned a portal login and emailed
 * their credentials on create); phone stays optional (a blank phone gets a
 * unique non-dialable placeholder server-side). An optional `finance` block
 * records the agreed fee + any payment received so the client is "in the
 * complete loop" despite bypassing Sales + Finance.
 */
export class CreateManualClientCaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lastName!: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsString()
  @IsIn(SERVICE_TYPE_CODES)
  service!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  targetCountry!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nationality?: string;

  @IsOptional()
  @IsEnum(ProcessingCasePriority)
  priority?: ProcessingCasePriority;

  @IsOptional()
  @ValidateNested()
  @Type(() => ManualClientFinanceDto)
  finance?: ManualClientFinanceDto;
}

/**
 * Manager acknowledges a Finance handover. Per the Processing workflow
 * (Manager → Associate hierarchy), the manager MUST nominate a processing
 * associate at this step — the case never lands in a general queue where
 * associates self-pick. Optionally the manager can re-confirm or override
 * the case's service code if Sales picked the wrong category.
 */
export class AcknowledgeIntakeDto {
  @IsUUID()
  assignOfficerId!: string;

  /** Optional override of the case's service code (one of the 9 canonical
   *  service types). When set, the checklist is re-templated against the
   *  new (service, targetCountry) pair. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsIn(SERVICE_TYPE_CODES, { message: 'service must be one of the canonical service codes' })
  service?: string;

  /** Optional specific program (e.g. C11, ICT, LMIA, VISIT). When set, the
   *  checklist is built from the program-specific requirement set
   *  (programCode, targetCountry) instead of the generic (service, *) list —
   *  so a C11 case gets the C11 documents, not the generic WORK_PERMIT list. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  programCode?: string;
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

  /**
   * Multi-stage filter — accepts a comma-separated list of stages or a
   * repeated query param (`?stages=COMPLETED&stages=CANCELLED`). Used by the
   * History page to surface all terminal cases in a single fetch instead of
   * three parallel calls. Takes precedence over the single `stage` field
   * when both are present.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
    return value;
  })
  @IsArray()
  @IsEnum(ProcessingCaseStage, { each: true })
  stages?: ProcessingCaseStage[];

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

/**
 * Mark a REJECTED case as having refund initiated. Workflow doc: when the
 * authority rejects, the case either gets refunded (back to Finance) or
 * escalated to APPEAL_IN_PROGRESS. Escalation reuses ChangeCaseStageDto;
 * refund needs its own marker because no stage transition fits — the case
 * stays REJECTED while Finance processes the refund out-of-band.
 */
export class MarkCaseForRefundDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
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

// Rename an ad-hoc "Additional document" (e.g. correct a wrong AI guess).
export class RenameAdditionalDocumentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}

// Phase E — file a triaged inbound document into a checklist slot.
export class FileInboundDocumentDto {
  @IsUUID()
  itemId!: string;
}

// Phase E — send a WhatsApp chat message to the case's client.
export class SendCaseWhatsAppDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

// Workspace tab keys whose "last viewed" we track per user for the new-item
// count badges. Mirrors the TabKey union in the frontend workspace.
export const CASE_TAB_KEYS = [
  'milestones', 'documents', 'timeline', 'communications', 'finance',
  'whatsapp', 'notes', 'tasks', 'submissions', 'corrections',
] as const;

export class MarkCaseTabSeenDto {
  @IsIn(CASE_TAB_KEYS as unknown as string[])
  tab!: string;
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
  @MinLength(1)
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsEnum(ProcessingNoteType)
  noteType?: ProcessingNoteType;

  @IsOptional()
  @IsUUID(undefined, { each: true })
  mentions?: string[];
}

export class UpdateProcessingNoteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content?: string;

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

/**
 * One email attachment (Phase 2). Exactly one source per entry:
 *  - `uploadKey`: a file uploaded via POST cases/:id/email-attachments, OR
 *  - `caseDocumentItemId`: an existing document on the case.
 */
export class EmailAttachmentInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  uploadKey?: string;

  @IsOptional()
  @IsUUID()
  caseDocumentItemId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;
}

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

  // Email composer (feedback #7-11). All optional — when omitted the email
  // goes to the client's on-file address with no CC/BCC, as before.
  /** Override the To address (e.g. a different contact for this client). */
  @IsOptional()
  @IsEmail()
  toEmail?: string;

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  @MaxLength(254, { each: true })
  cc?: string[];

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  @MaxLength(254, { each: true })
  bcc?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmailAttachmentInputDto)
  attachments?: EmailAttachmentInputDto[];
}

/** Save/clear the current user's email signature (processing composer). */
export class UpdateEmailSignatureDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  signature?: string;
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

// ---------------------------------------------------------------------------
// Case milestones
// ---------------------------------------------------------------------------

/**
 * Manager-only — add an ad-hoc milestone to a case beyond the per-service
 * template (e.g. one-off step a specific case needs). Associates can only
 * tick / un-tick existing milestones, not add new ones.
 */
export class CreateCaseMilestoneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Optional position in the list — defaults to end-of-list. */
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
