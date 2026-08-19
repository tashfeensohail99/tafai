import {
  IsBoolean,
  IsBooleanString,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  JrArtifactFolder,
  JrArtifactType,
  JrCloseReason,
  JrCounselRetainerScope,
  JrDecidingOfficeLocation,
  JrDecisionMaker,
  JrInadmissibilityGround,
  JrIntakeType,
  JrMatterStage,
  JrMeritsRecommendation,
  JrRule9ResponseType,
  JrSponsorshipRelationship,
} from '@prisma/client';

/**
 * Query filters for GET /jr/matters. The global ValidationPipe runs with
 * forbidNonWhitelisted, so every accepted property MUST be decorated or the
 * request 400s — do not add a bare field here.
 */
export class ListMattersQueryDto {
  @IsOptional()
  @IsEnum(JrMatterStage)
  stage?: JrMatterStage;

  @IsOptional()
  @IsEnum(JrIntakeType)
  intakeType?: JrIntakeType;

  /** Free-text over matter number, style of cause, or court file number. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

// ---------------------------------------------------------------------------
// Artifact lifecycle DTOs (PR 2). Every property is decorated — the global
// ValidationPipe runs forbidNonWhitelisted, so an undecorated field 400s.
// ---------------------------------------------------------------------------

/** POST /jr/matters/:matterId/artifacts — create an artifact (status defaults DRAFT). */
export class CreateArtifactDto {
  @IsEnum(JrArtifactType)
  artifactType!: JrArtifactType;

  @IsEnum(JrArtifactFolder)
  folder!: JrArtifactFolder;

  @IsString()
  @MaxLength(300)
  title!: string;

  /** r.10(2) mandatory order for the Applicant's Record. Defaults to 0. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

/**
 * POST /jr/artifacts/:artifactId/counsel-review — counsel approves or requests
 * changes. `counselId` is a JrCounsel.id (validated to exist + be active).
 */
export class CounselReviewDto {
  @IsIn(['APPROVE', 'REQUEST_CHANGES'])
  decision!: 'APPROVE' | 'REQUEST_CHANGES';

  @IsUUID()
  counselId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  counselComments?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changesRequestedNote?: string;
}

/** POST /jr/artifacts/:artifactId/file — COUNSEL_APPROVED → FILED. */
export class FileArtifactDto {
  @IsString()
  @MaxLength(40)
  courtDocumentNumber!: string;

  /** Defaults to now if omitted. */
  @IsOptional()
  @IsDateString()
  filedAt?: string;

  /** Defaults to `filedAt` if omitted. */
  @IsOptional()
  @IsDateString()
  registryStampedAt?: string;
}

/** POST /jr/artifacts/:artifactId/serve — FILED → SERVED (proof is per artifact). */
export class ServeArtifactDto {
  @IsString()
  @MaxLength(200)
  servedOn!: string;

  @IsIn(['PERSONAL', 'EMAIL', 'COURIER', 'REGISTRY_EFILE'])
  serviceMethod!: string;

  /** Defaults to now if omitted. */
  @IsOptional()
  @IsDateString()
  servedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofOfServiceKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  serviceScreenshotKey?: string;
}

// ---------------------------------------------------------------------------
// Matter stage machine + route tree DTOs (PR 3). Every property is decorated —
// the global ValidationPipe runs forbidNonWhitelisted, so an undecorated field
// 400s. Fields carried here are the per-transition inputs the §6.2 gates read;
// fields owned by other endpoints (route/merits/counsel/conflict/updateMatter)
// are NOT accepted here.
// ---------------------------------------------------------------------------

/** PATCH /jr/matters/:matterId/stage — the gated stage machine (§6.1 + §6.2). */
export class ChangeStageDto {
  @IsEnum(JrMatterStage)
  targetStage!: JrMatterStage;

  /** Required for any → CLOSED. */
  @IsOptional()
  @IsEnum(JrCloseReason)
  closeReason?: JrCloseReason;

  // RETAINED → FILED: asserted on the filed Form IR-1.
  @IsOptional()
  @IsEnum(JrDecidingOfficeLocation)
  decidingOfficeLocation?: JrDecidingOfficeLocation;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  decidingOfficeSourceNote?: string;

  // → REQUIRES_EXTENSION_REQUEST: the four Hennelly narrative fields.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hennellyIntention?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hennellyMerit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hennellyPrejudice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hennellyExplanation?: string;

  // FILED → LEAVE_GRANTED.
  @IsOptional()
  @IsDateString()
  leaveDecidedAt?: string;

  @IsOptional()
  @IsDateString()
  leaveOrderAt?: string;

  @IsOptional()
  @IsBoolean()
  leaveGranted?: boolean;

  // REDETERMINATION → CLOSED.
  @IsOptional()
  @IsDateString()
  redeterminationDecidedAt?: string;

  @IsOptional()
  @IsBoolean()
  redeterminationApproved?: boolean;
}

/** POST /jr/matters/:matterId/route — decision-tree submission (§6.4). */
export class DetermineRouteDto {
  @IsOptional()
  @IsEnum(JrSponsorshipRelationship)
  sponsorshipRelationship?: JrSponsorshipRelationship;

  @IsOptional()
  @IsEnum(JrInadmissibilityGround)
  inadmissibilityGround?: JrInadmissibilityGround;

  /** IRPA s.72(2)(a) — filing where an IAD appeal lies is fatal. */
  @IsBoolean()
  appealRightExhausted!: boolean;

  /** RPD only: an s.110(2) exclusion applies (→ Federal Court, not the RAD). */
  @IsOptional()
  @IsBoolean()
  rpdS110Exclusion?: boolean;

  /** VISA_OFFICER/IRCC/CPC/CBSA: does an s.63 appeal right lie? */
  @IsOptional()
  @IsBoolean()
  hasS63AppealRight?: boolean;

  /** Citizenship Act refusal — v1 rejects (s.22.1, 30-day, not IRPA 15/60). */
  @IsOptional()
  @IsBoolean()
  isCitizenshipMatter?: boolean;
}

/** PATCH /jr/matters/:matterId/assign — keep (assign to self) or delegate. */
export class AssignMatterDto {
  @IsUUID()
  assignedAssociateUserId!: string;
}

/** POST /jr/matters/:matterId/merits — record counsel's merits view. */
export class RecordMeritsDto {
  @IsEnum(JrMeritsRecommendation)
  meritsRecommendation!: JrMeritsRecommendation;

  /** A JrCounsel.id — validated to exist + be active. */
  @IsUUID()
  meritsAssessedByCounselId!: string;
}

/** POST /jr/matters/:matterId/conflict-review — clear conflict review. */
export class ClearConflictReviewDto {
  @IsString()
  @MaxLength(1000)
  note!: string;
}

/** POST /jr/matters/:matterId/counsel — set counsel of record + retainer scope. */
export class SetCounselOfRecordDto {
  /** A JrCounsel.id — validated to exist + be active. */
  @IsUUID()
  counselOfRecordId!: string;

  @IsEnum(JrCounselRetainerScope)
  counselRetainerScope!: JrCounselRetainerScope;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  counselFeeQuoted?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  counselFeeCurrency?: string;

  @IsOptional()
  @IsDateString()
  counselRetainerSignedAt?: string;
}

/**
 * PATCH /jr/matters/:matterId — edit ONLY non-gated fields (court file number,
 * DOJ counsel + LEX number, hearing details, procedural dates). Never touches
 * stage / route / counselOfRecordId / decidingOfficeLocation — those go through
 * their own gated endpoints.
 */
export class UpdateMatterDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  courtFileNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  registryOffice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  neutralCitation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  presidingJudge?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  hearingCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hearingLanguage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  dojCounselName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dojCounselEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  dojRegionalOffice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  dojFileNumber?: string;

  /** The IR-1 field that forks Rule 9. */
  @IsOptional()
  @IsBoolean()
  reasonsPleadedAsReceived?: boolean;

  @IsOptional()
  @IsEnum(JrRule9ResponseType)
  rule9ResponseType?: JrRule9ResponseType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  rule9RespondingOffice?: string;

  // ---- procedural dated fields (the deadline engine keys off these) ----
  @IsOptional()
  @IsDateString()
  aljrFiledAt?: string;

  @IsOptional()
  @IsDateString()
  aljrServedAt?: string;

  @IsOptional()
  @IsDateString()
  noaReceivedAt?: string;

  @IsOptional()
  @IsDateString()
  rule9RequestedAt?: string;

  @IsOptional()
  @IsDateString()
  rule9ResponseAt?: string;

  @IsOptional()
  @IsDateString()
  anonymityOrderRequestedAt?: string;

  @IsOptional()
  @IsDateString()
  affidavitDraftSentAt?: string;

  @IsOptional()
  @IsDateString()
  affidavitSwornAt?: string;

  @IsOptional()
  @IsDateString()
  affidavitReceivedAt?: string;

  @IsOptional()
  @IsDateString()
  perfectedAt?: string;

  @IsOptional()
  @IsDateString()
  applicantRecordServedAt?: string;

  @IsOptional()
  @IsDateString()
  respondentMemoServedAt?: string;

  @IsOptional()
  @IsDateString()
  replyFiledAt?: string;

  @IsOptional()
  @IsDateString()
  ctrDueAt?: string;

  @IsOptional()
  @IsDateString()
  ctrReceivedAt?: string;

  @IsOptional()
  @IsDateString()
  hearingAt?: string;

  @IsOptional()
  @IsDateString()
  judgmentAt?: string;

  @IsOptional()
  @IsDateString()
  reconsiderationRequestedAt?: string;

  @IsOptional()
  @IsDateString()
  reconsiderationOutcomeAt?: string;

  // ---- determination / outcome fields the stage-machine gates read ----
  /** Asserted on the filed IR-1 (must be != UNKNOWN with a source note to FILE). */
  @IsOptional()
  @IsEnum(JrDecidingOfficeLocation)
  decidingOfficeLocation?: JrDecidingOfficeLocation;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  decidingOfficeSourceNote?: string;

  @IsOptional()
  @IsDateString()
  expectationsAcknowledgedAt?: string;

  @IsOptional()
  @IsDateString()
  alternativesSheetSignedAt?: string;

  // Hennelly extension narratives — all four required to REQUIRES_EXTENSION_REQUEST.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hennellyIntention?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hennellyMerit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hennellyPrejudice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hennellyExplanation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  extensionOutcome?: string;

  @IsOptional()
  @IsDateString()
  leaveDecidedAt?: string;

  @IsOptional()
  @IsDateString()
  leaveOrderAt?: string;

  @IsOptional()
  @IsBoolean()
  leaveGranted?: boolean;

  @IsOptional()
  @IsBoolean()
  applicationAllowed?: boolean;

  @IsOptional()
  @IsDateString()
  redeterminationDecidedAt?: string;

  @IsOptional()
  @IsBoolean()
  redeterminationApproved?: boolean;
}

// ---------------------------------------------------------------------------
// Deadline engine DTOs (PR 4). Every property is decorated — the global
// ValidationPipe runs forbidNonWhitelisted, so an undecorated field 400s.
// ---------------------------------------------------------------------------

/** PATCH /jr/deadlines/:id/override — manually override a computed deadline. */
export class OverrideDeadlineDto {
  @IsDateString()
  overriddenDueAt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

/**
 * POST /jr/matters/:matterId/deadlines/underlying-doc — add an expiry watch on an
 * underlying client document (medical, police certificate, LMIA, passport, …).
 */
export class UnderlyingDocWatchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;

  @IsDateString()
  expiryDate!: string;
}

/** PATCH /jr/rules/:id/verify — mark a deadline rule VERIFIED (the Head's gate). */
export class VerifyRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** GET /jr/board — the pending-deadline board, optionally fatal-only. */
export class DeadlineBoardQueryDto {
  @IsOptional()
  @IsBooleanString()
  fatalOnly?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  take?: number;
}

// ---------------------------------------------------------------------------
// Intake (PR 5)
// ---------------------------------------------------------------------------

/**
 * POST /jr/matters — open a NEW (EXTERNAL) matter for a decision the client
 * brings in from outside our own processing. Identity is reused, never
 * duplicated: pass exactly one of `attachToClientId` (an existing client),
 * `attachToLeadId` (an existing lead to convert), or the new-client trio
 * (`firstName`+`lastName`+`phone`). A new-client create THROWS 409
 * DUPLICATE_PHONE/EMAIL on a collision — the caller retries with attachTo*.
 */
export class CreateExternalMatterDto {
  @IsEnum(JrDecisionMaker)
  decisionMaker!: JrDecisionMaker;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  applicationType!: string;

  /** THE CLOCK ANCHOR — normalized to its legal calendar day at the write boundary. */
  @IsDateString()
  decisionCommunicatedAt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  decisionCommunicatedNote!: string;

  @IsOptional()
  @IsDateString()
  decisionLetterDate?: string;

  @IsOptional()
  @IsEnum(JrDecidingOfficeLocation)
  decidingOfficeLocation?: JrDecidingOfficeLocation;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  styleOfCause?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  // ---- new-client intake (firstName + lastName + phone together) ----------
  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // ---- attach to existing identity (exactly one) --------------------------
  @IsOptional()
  @IsUUID()
  attachToLeadId?: string;

  @IsOptional()
  @IsUUID()
  attachToClientId?: string;
}

/**
 * POST /jr/matters/from-case/:caseId — escalate a REFUSED ProcessingCase to an
 * INTERNAL JR matter. Client + lead are reused from the case; conflict review is
 * required (the original filer cannot clear it later, §6.5).
 */
export class EscalateCaseDto {
  @IsEnum(JrDecisionMaker)
  decisionMaker!: JrDecisionMaker;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  applicationType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  decisionCommunicatedNote?: string;
}
