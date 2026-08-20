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
import { Transform, Type } from 'class-transformer';
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
  JrNewEvidenceJustification,
  JrRule9ResponseType,
  JrSettlementArtifact,
  JrSettlementStage,
  JrSponsorshipRelationship,
  JrWorkReportStatus,
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

// ---------------------------------------------------------------------------
// Counsel directory CRUD (jr.counsel.manage). A JrCounsel is a lawyer/firm that
// can be set as a matter's counsel of record or record its merits view. Every
// property is decorated — the global ValidationPipe runs forbidNonWhitelisted,
// so an undecorated field 400s.
// ---------------------------------------------------------------------------

/** POST /jr/counsel — create a counsel directory entry. */
export class CreateCounselDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legalName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  firmName!: string;

  /** e.g. "ON" — a Canadian law-society province code. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  lawSocietyProvince!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  licenceNumber!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  addressForServiceCanada!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  directoryUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

/** GET /jr/counsel — optional active-only filter. */
export class ListCounselQueryDto {
  @IsOptional()
  @IsBooleanString()
  activeOnly?: string;
}

/** PATCH /jr/counsel/:id — edit a counsel entry (all fields optional). */
export class UpdateCounselDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legalName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  firmName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  lawSocietyProvince?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  licenceNumber?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  addressForServiceCanada?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  directoryUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  goodStandingVerifiedAt?: string;
}

/**
 * PATCH /jr/matters/:matterId — edit ONLY non-gated fields (court file number,
 * DOJ counsel + LEX number, hearing details, procedural dates). Never touches
 * stage / route / counselOfRecordId / decidingOfficeLocation — those go through
 * their own gated endpoints.
 */
export class UpdateMatterDto {
  // ---- case-identity fields (editable from the console detail form) ----
  @IsOptional()
  @IsEnum(JrDecisionMaker)
  decisionMaker?: JrDecisionMaker;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  applicationType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  styleOfCause?: string;

  @IsOptional()
  @IsDateString()
  decisionLetterDate?: string;

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

  /**
   * The ALJR clock anchor. Correctable after intake (e.g. an escalation seeded a
   * DRAFT from the case's decision date, or the wrong date was entered) — the
   * matter cannot leave INTAKE without it. Normalized to its legal calendar day;
   * updateMatter recomputes deadlines, so correcting it re-drives the fatal clock.
   */
  @IsOptional()
  @IsDateString()
  decisionCommunicatedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  decisionCommunicatedNote?: string;

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

  /**
   * The ALJR clock anchor — the day the client was notified of the refusal.
   * Optional: if omitted, a DRAFT is seeded from the case's authority-decision
   * date (which is the officer's decision date, not the notification date). If
   * the case has neither, supply it here or later via updateMatter — the matter
   * cannot leave INTAKE without it.
   */
  @IsOptional()
  @IsDateString()
  decisionCommunicatedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  decisionCommunicatedNote?: string;
}

// ---------------------------------------------------------------------------
// Settlement + successor-matter chain + carried evidence (PR 6). Every property
// is decorated — the global ValidationPipe runs forbidNonWhitelisted, so an
// undecorated field 400s.
// ---------------------------------------------------------------------------

/**
 * POST /jr/matters/:matterId/settlement — record the structured DOJ settlement
 * terms (§6.2). Every field is optional: a settlement firms up incrementally, so
 * the terms are recorded as they land. Recording them makes the FILED |
 * LEAVE_GRANTED → REDETERMINATION gate satisfiable; it never changes the stage
 * itself (that is changeMatterStage's job).
 */
export class RecordSettlementDto {
  @IsOptional()
  @IsDateString()
  settlementOfferedAt?: string;

  @IsOptional()
  @IsDateString()
  settlementAgreedAt?: string;

  @IsOptional()
  @IsEnum(JrSettlementStage)
  settlementStage?: JrSettlementStage;

  @IsOptional()
  @IsEnum(JrSettlementArtifact)
  settlementArtifact?: JrSettlementArtifact;

  /** (a) applicant serves + files a Notice of Discontinuance. */
  @IsOptional()
  @IsBoolean()
  termDiscontinuanceByApplicant?: boolean;

  /** (b) Respondent sets aside the officer's decision. */
  @IsOptional()
  @IsBoolean()
  termDecisionSetAside?: boolean;

  /** (c) re-determined by a DIFFERENT officer. */
  @IsOptional()
  @IsBoolean()
  termDifferentOfficer?: boolean;

  /** (d) opportunity to make ADDITIONAL SUBMISSIONS — the successor trigger. */
  @IsOptional()
  @IsBoolean()
  termAdditionalSubmissions?: boolean;

  /** (e) no costs to either party. */
  @IsOptional()
  @IsBoolean()
  termNoCosts?: boolean;

  /** The deadline from the DOJ letter — required when termAdditionalSubmissions. */
  @IsOptional()
  @IsDateString()
  additionalSubmissionsDueAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  additionalSubmissionsOffice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  settlementTermsOther?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  dojCounselName?: string;

  @IsOptional()
  @IsEmail()
  dojCounselEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  dojRegionalOffice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  dojFileNumber?: string;
}

/**
 * POST /jr/matters/:matterId/open-successor — open a fresh-clock successor matter
 * after a redetermination was decided and REFUSED (§6.2). All fields optional:
 * each defaults from the source matter.
 */
export class OpenSuccessorDto {
  /** The refusal-notification date — the fresh 15/60 clock anchor. */
  @IsOptional()
  @IsDateString()
  decisionCommunicatedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  decisionCommunicatedNote?: string;

  @IsOptional()
  @IsEnum(JrDecisionMaker)
  decisionMaker?: JrDecisionMaker;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  applicationType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  styleOfCause?: string;
}

/**
 * POST /jr/artifacts/:artifactId/carry-to-redetermination — mark a NEW artifact as
 * carried into the post-settlement additional-submissions package (§11.2), where
 * new evidence IS admissible.
 */
export class CarryToRedeterminationDto {
  @IsOptional()
  @IsEnum(JrNewEvidenceJustification)
  newEvidenceJustification?: JrNewEvidenceJustification;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  newEvidenceExplanation?: string;
}

// ---------------------------------------------------------------------------
// Case-workspace notes (text/voice/image). Every property is decorated — the
// global ValidationPipe runs forbidNonWhitelisted, so an undecorated field 400s.
// Voice/image notes carry their file + optional caption via multipart and are
// NOT validated through a DTO class (see JrNotesController).
// ---------------------------------------------------------------------------

/** POST /jr/matters/:matterId/notes — a text note (noteType defaults GENERAL). */
export class CreateJrNoteDto {
  @IsString()
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  noteType?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isPinned?: boolean;
}

/** PATCH /jr/notes/:noteId — edit a note's body and/or pin state. */
export class UpdateJrNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isPinned?: boolean;
}

// ---------------------------------------------------------------------------
// Associate work-report subsystem (§11.7, PR 10A). Every property is decorated —
// the global ValidationPipe runs forbidNonWhitelisted, so an undecorated field
// 400s.
// ---------------------------------------------------------------------------

/**
 * POST /jr/reports — compile a work report for a period. `subjectAssociateId` is
 * resolved SERVER-SIDE: a caller without jr.report.view_all has it forced to their
 * own id (never merely rejected), so it is optional here.
 */
export class CreateWorkReportDto {
  /** A core.UserAccount.id — the associate the report is about (Head only). */
  @IsOptional()
  @IsUUID()
  subjectAssociateId?: string;

  /** Inclusive period start (calendar day). */
  @IsDateString()
  periodFrom!: string;

  /** Inclusive period end (calendar day). */
  @IsDateString()
  periodTo!: string;
}

/** GET /jr/reports — list filters. */
export class ListWorkReportsQueryDto {
  @IsOptional()
  @IsEnum(JrWorkReportStatus)
  status?: JrWorkReportStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

/** POST /jr/reports/:id/notes — a report-level narrative note (DRAFT-only). */
export class CreateWorkReportNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}

/**
 * POST /jr/reports/:id/email — email the report PDF outbound (jr.report.share).
 * `emails` is optional; when omitted the report is sent to the caller. An
 * optional short covering `note` is included in the email body.
 */
export class EmailWorkReportDto {
  @IsOptional()
  @IsEmail({}, { each: true })
  emails?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
