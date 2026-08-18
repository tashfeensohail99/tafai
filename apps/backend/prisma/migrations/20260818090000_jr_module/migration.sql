-- Judicial Review module (PR 1): new "legal" Postgres schema.
-- Additive + idempotent: 24 enums + 10 tables + indexes + 6 FKs, all in "legal".
-- The migration is APPLIED BY THE USER (prisma migrate deploy at boot). Keep re-runnable.

-- ── 1. schema ────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS "legal";

-- ── 2. enums (24) ────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "legal"."JrIntakeType" AS ENUM ('INTERNAL','EXTERNAL'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrDecidingOfficeLocation" AS ENUM ('IN_CANADA','OUTSIDE_CANADA','UNKNOWN'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrDecisionMaker" AS ENUM ('VISA_OFFICER','IRCC_IN_CANADA','CPC','CBSA','ID','IAD','RAD','RPD','OTHER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrRoute" AS ENUM ('UNDETERMINED','FEDERAL_COURT','IAD','RAD','NO_RECOURSE','REAPPLY_INSTEAD'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrMatterStage" AS ENUM ('INTAKE','ROUTE_DETERMINED','MERITS_REVIEW','COUNSEL_DECLINED','RETAINED','REQUIRES_EXTENSION_REQUEST','FILED','LEAVE_GRANTED','CLIENT_UNRESPONSIVE','REDETERMINATION','CLOSED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrCloseReason" AS ENUM ('REFERRED_IAD','REFERRED_RAD','REFERRED_REAPPLICATION','NO_RECOURSE','COUNSEL_DECLINED_NO_ALTERNATIVE','CLIENT_DECLINED_AFTER_REVIEW','WITHDRAWN_ON_INSTRUCTIONS','CLIENT_UNRESPONSIVE_ABANDONED','DEADLINE_MISSED_NOT_FILED','EXTENSION_REFUSED','LEAVE_REFUSED','SETTLED_REDETERMINATION','ALLOWED_AT_HEARING','DISMISSED_AT_HEARING','REDETERMINATION_APPROVED','REDETERMINATION_REFUSED','SUCCESSOR_MATTER_OPENED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrArtifactStatus" AS ENUM ('DRAFT','INTERNAL_QA','COUNSEL_REVIEW','COUNSEL_CHANGES_REQUESTED','COUNSEL_APPROVED','FILED','SERVED','SUPERSEDED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrArtifactType" AS ENUM ('ORIGINAL_APPLICATION_FORM','PASSPORT','PROOF_OF_FUNDS','ORIGINAL_COVER_LETTER','SUPPORTING_EVIDENCE','REFUSAL_LETTER','GCMS_NOTES','ALJR_FORM_IR1','ALJR_STAMPED_FILED','CERTIFICATE_OF_SERVICE','PROOF_OF_SERVICE','RULE_9_RESPONSE','AR_AFFIDAVIT','MEMORANDUM_OF_ARGUMENT','APPLICANTS_RECORD','APPLICANTS_RECORD_TOC','APPLICANTS_RECORD_BACKPAGE','ANONYMITY_REQUEST','REPLY_MEMORANDUM','LEAVE_ORDER','CERTIFIED_TRIBUNAL_RECORD','DOJ_SETTLEMENT_OFFER','NOTICE_OF_DISCONTINUANCE','CONSENT_JUDGMENT','JUDGMENT_AND_REASONS','ADDITIONAL_SUBMISSIONS','REDETERMINATION_DECISION','ENGAGEMENT_LETTER','MERITS_ASSESSMENT','ALTERNATIVES_SHEET','OTHER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrArtifactFolder" AS ENUM ('CLIENT_APPLICATION_DOCUMENTS','JUDICIAL_REVIEW_FILES','JUDICIAL_REVIEW_RAW','SETTLEMENT','REDETERMINATION','ENGAGEMENT'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrRule9ResponseType" AS ENUM ('REASONS_PRODUCED','NO_REASONS_NOTICE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrSettlementStage" AS ENUM ('PRE_PERFECTION','PRE_LEAVE','POST_LEAVE','AT_HEARING'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrSettlementArtifact" AS ENUM ('NOTICE_OF_DISCONTINUANCE','CONSENT_JUDGMENT'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrCertifiedQuestionStatus" AS ENUM ('NOT_SOUGHT','PROPOSED','REFUSED','CERTIFIED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrCounselRetainerScope" AS ENUM ('LEAVE_ONLY','FULL'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrMeritsRecommendation" AS ENUM ('FILE_JR','REAPPLY','RECONSIDER','APPEAL_IAD','APPEAL_RAD','DECLINE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrAtipStatute" AS ENUM ('PRIVACY_ACT','ATIA'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrAtipRequester" AS ENUM ('SELF','FIRM','SPONSOR'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrDocumentRecordStatus" AS ENUM ('ON_RECORD','NEW','UNKNOWN'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrNewEvidenceJustification" AS ENUM ('GENERAL_BACKGROUND','PROCEDURAL_FAIRNESS','ABSENCE_OF_EVIDENCE','OTHER_EXPLAIN'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrRuleVerificationStatus" AS ENUM ('UNVERIFIED','VERIFIED','SUPERSEDED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrDeadlineStatus" AS ENUM ('PENDING','MET','MISSED','WAIVED','NOT_APPLICABLE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrSponsorshipRelationship" AS ENUM ('NONE','SPOUSE_OR_PARTNER','CHILD','PARENT_OR_GRANDPARENT','OTHER_FAMILY'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrInadmissibilityGround" AS ENUM ('NONE','MISREPRESENTATION','SECURITY','HUMAN_RIGHTS','SANCTIONS','SERIOUS_CRIMINALITY','ORGANIZED_CRIMINALITY','MEDICAL','FINANCIAL','OTHER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrGround" AS ENUM ('INADEQUATE_REASONS','IGNORED_EVIDENCE','PF_NO_FAIRNESS_LETTER','PF_EXTRINSIC_EVIDENCE','UNREASONABLE_CREDIBILITY','FETTERED_DISCRETION','MISAPPREHENSION_OF_EVIDENCE','AUTOMATION_CHINOOK','REWEIGHING_DISAGREEMENT_WEAK','OTHER'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 3. tables ────────────────────────────────────────────────────────────────

-- 3.1 jr_matters
CREATE TABLE IF NOT EXISTS "legal"."jr_matters" (
    "id"                            TEXT NOT NULL,
    "matterNumber"                  TEXT NOT NULL,
    "styleOfCause"                  VARCHAR(200),
    "clientId"                      TEXT NOT NULL,
    "leadId"                        TEXT NOT NULL,
    "branchId"                      TEXT,
    "intakeType"                    "legal"."JrIntakeType" NOT NULL,
    "originCaseId"                  TEXT,
    "priorMatterId"                 TEXT,
    "assignedAssociateUserId"       TEXT,
    "createdByUserId"               TEXT NOT NULL,
    "updatedByUserId"               TEXT,
    "stage"                         "legal"."JrMatterStage" NOT NULL DEFAULT 'INTAKE',
    "stageEnteredAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousStage"                 "legal"."JrMatterStage",
    "unresponsiveSinceAt"           TIMESTAMP(3),
    "closeReason"                   "legal"."JrCloseReason",
    "closedAt"                      TIMESTAMP(3),
    "decisionMaker"                 "legal"."JrDecisionMaker" NOT NULL,
    "applicationType"               VARCHAR(80) NOT NULL,
    "decisionLetterDate"            DATE,
    "decisionCommunicatedAt"        TIMESTAMP(3),
    "decisionCommunicatedNote"      VARCHAR(400),
    "decidingOfficeLocation"        "legal"."JrDecidingOfficeLocation" NOT NULL DEFAULT 'UNKNOWN',
    "decidingOfficeSourceNote"      VARCHAR(400),
    "decisionMakerOffice"           VARCHAR(120),
    "decisionMakerOfficerRef"       VARCHAR(80),
    "refusalGrounds"                "legal"."JrGround"[] NOT NULL DEFAULT ARRAY[]::"legal"."JrGround"[],
    "route"                         "legal"."JrRoute" NOT NULL DEFAULT 'UNDETERMINED',
    "routeDeterminedByUserId"       TEXT,
    "routeDeterminedAt"             TIMESTAMP(3),
    "appealRightExhausted"          BOOLEAN NOT NULL DEFAULT false,
    "sponsorshipRelationship"       "legal"."JrSponsorshipRelationship",
    "inadmissibilityGround"         "legal"."JrInadmissibilityGround",
    "routeReasoning"                VARCHAR(1000),
    "deadlineRuleSetVersion"        INTEGER NOT NULL,
    "conflictReviewRequired"        BOOLEAN NOT NULL DEFAULT false,
    "originalFilerUserId"           TEXT,
    "conflictReviewClearedAt"       TIMESTAMP(3),
    "conflictReviewClearedByUserId" TEXT,
    "conflictReviewNote"            VARCHAR(1000),
    "counselOfRecordId"             TEXT,
    "counselRetainerScope"          "legal"."JrCounselRetainerScope",
    "counselRetainerSignedAt"       TIMESTAMP(3),
    "counselFeeQuoted"              DECIMAL(12,2),
    "counselFeeCurrency"            VARCHAR(3),
    "solicitorOfRecordAt"           TIMESTAMP(3),
    "counselCeasedActingAt"         TIMESTAMP(3),
    "form124EFiled"                 BOOLEAN NOT NULL DEFAULT false,
    "paidPreparerName"              VARCHAR(200),
    "paidPreparerAddress"           VARCHAR(400),
    "paidPreparerPhone"             VARCHAR(40),
    "internalSubstantiveAuthorship" BOOLEAN NOT NULL DEFAULT true,
    "meritsRecommendation"          "legal"."JrMeritsRecommendation",
    "meritsAssessedByCounselId"     TEXT,
    "meritsAssessedAt"              TIMESTAMP(3),
    "expectationsAcknowledgedAt"    TIMESTAMP(3),
    "alternativesSheetSignedAt"     TIMESTAMP(3),
    "courtFileNumber"               VARCHAR(30),
    "registryOffice"                VARCHAR(40),
    "neutralCitation"               VARCHAR(40),
    "presidingJudge"                VARCHAR(120),
    "hearingCity"                   VARCHAR(80),
    "hearingLanguage"               VARCHAR(20),
    "dojCounselName"                VARCHAR(120),
    "dojCounselEmail"               VARCHAR(200),
    "dojRegionalOffice"             VARCHAR(120),
    "dojFileNumber"                 VARCHAR(60),
    "extensionRequested"            BOOLEAN NOT NULL DEFAULT false,
    "hennellyIntention"             VARCHAR(1000),
    "hennellyMerit"                 VARCHAR(1000),
    "hennellyPrejudice"             VARCHAR(1000),
    "hennellyExplanation"           VARCHAR(1000),
    "extensionOutcome"              VARCHAR(40),
    "aljrFiledAt"                   TIMESTAMP(3),
    "aljrServedAt"                  TIMESTAMP(3),
    "reasonsPleadedAsReceived"      BOOLEAN,
    "proofOfServiceFiledAt"         TIMESTAMP(3),
    "noaReceivedAt"                 TIMESTAMP(3),
    "rule9RequestedAt"              TIMESTAMP(3),
    "rule9ResponseAt"               TIMESTAMP(3),
    "rule9ResponseType"             "legal"."JrRule9ResponseType",
    "rule9RespondingOffice"         VARCHAR(120),
    "anonymityOrderRequestedAt"     TIMESTAMP(3),
    "affidavitDraftSentAt"          TIMESTAMP(3),
    "affidavitSwornAt"              TIMESTAMP(3),
    "affidavitReceivedAt"           TIMESTAMP(3),
    "perfectedAt"                   TIMESTAMP(3),
    "applicantRecordServedAt"       TIMESTAMP(3),
    "respondentMemoServedAt"        TIMESTAMP(3),
    "replyFiledAt"                  TIMESTAMP(3),
    "leaveDecidedAt"                TIMESTAMP(3),
    "leaveGranted"                  BOOLEAN,
    "leaveOrderAt"                  TIMESTAMP(3),
    "ctrDueAt"                      TIMESTAMP(3),
    "ctrReceivedAt"                 TIMESTAMP(3),
    "hearingAt"                     TIMESTAMP(3),
    "judgmentAt"                    TIMESTAMP(3),
    "applicationAllowed"            BOOLEAN,
    "certifiedQuestionStatus"       "legal"."JrCertifiedQuestionStatus" NOT NULL DEFAULT 'NOT_SOUGHT',
    "certifiedQuestionText"         TEXT,
    "settlementOfferedAt"           TIMESTAMP(3),
    "settlementAgreedAt"            TIMESTAMP(3),
    "settlementStage"               "legal"."JrSettlementStage",
    "settlementArtifact"            "legal"."JrSettlementArtifact",
    "termDiscontinuanceByApplicant" BOOLEAN NOT NULL DEFAULT false,
    "termDecisionSetAside"          BOOLEAN NOT NULL DEFAULT false,
    "termDifferentOfficer"          BOOLEAN NOT NULL DEFAULT false,
    "termAdditionalSubmissions"     BOOLEAN NOT NULL DEFAULT false,
    "additionalSubmissionsDueAt"    DATE,
    "additionalSubmissionsOffice"   VARCHAR(120),
    "termNoCosts"                   BOOLEAN NOT NULL DEFAULT false,
    "settlementTermsOther"          TEXT,
    "redeterminationStartedAt"      TIMESTAMP(3),
    "additionalSubmissionsFiledAt"  TIMESTAMP(3),
    "redeterminationDecidedAt"      TIMESTAMP(3),
    "redeterminationApproved"       BOOLEAN,
    "successorMatterId"             TEXT,
    "reconsiderationRequestedAt"    TIMESTAMP(3),
    "reconsiderationOutcomeAt"      TIMESTAMP(3),
    "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "jr_matters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "jr_matters_matterNumber_key" ON "legal"."jr_matters" ("matterNumber");
CREATE INDEX IF NOT EXISTS "jr_matters_stage_idx" ON "legal"."jr_matters" ("stage");
CREATE INDEX IF NOT EXISTS "jr_matters_assignedAssociateUserId_idx" ON "legal"."jr_matters" ("assignedAssociateUserId");
CREATE INDEX IF NOT EXISTS "jr_matters_clientId_idx" ON "legal"."jr_matters" ("clientId");
CREATE INDEX IF NOT EXISTS "jr_matters_leadId_idx" ON "legal"."jr_matters" ("leadId");
CREATE INDEX IF NOT EXISTS "jr_matters_intakeType_stage_idx" ON "legal"."jr_matters" ("intakeType","stage");
CREATE INDEX IF NOT EXISTS "jr_matters_courtFileNumber_idx" ON "legal"."jr_matters" ("courtFileNumber");
CREATE INDEX IF NOT EXISTS "jr_matters_originCaseId_idx" ON "legal"."jr_matters" ("originCaseId");

-- 3.2 jr_artifacts
CREATE TABLE IF NOT EXISTS "legal"."jr_artifacts" (
    "id"                            TEXT NOT NULL,
    "matterId"                      TEXT NOT NULL,
    "artifactType"                  "legal"."JrArtifactType" NOT NULL,
    "folder"                        "legal"."JrArtifactFolder" NOT NULL,
    "title"                         VARCHAR(300) NOT NULL,
    "status"                        "legal"."JrArtifactStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder"                     INTEGER NOT NULL DEFAULT 0,
    "authorUserId"                  TEXT,
    "internalQaByUserId"            TEXT,
    "internalQaAt"                  TIMESTAMP(3),
    "counselReviewedById"           TEXT,
    "counselReviewRecordedByUserId" TEXT,
    "counselReviewedAt"             TIMESTAMP(3),
    "counselComments"               TEXT,
    "counselApprovedVersionId"      TEXT,
    "changesRequestedAt"            TIMESTAMP(3),
    "changesRequestedNote"          TEXT,
    "filedAt"                       TIMESTAMP(3),
    "registryStampedAt"             TIMESTAMP(3),
    "courtDocumentNumber"           VARCHAR(40),
    "servedAt"                      TIMESTAMP(3),
    "servedOn"                      VARCHAR(200),
    "serviceMethod"                 VARCHAR(60),
    "proofOfServiceKey"             VARCHAR(500),
    "serviceScreenshotKey"          VARCHAR(500),
    "recordStatus"                  "legal"."JrDocumentRecordStatus" NOT NULL DEFAULT 'UNKNOWN',
    "newEvidenceJustification"      "legal"."JrNewEvidenceJustification",
    "newEvidenceExplanation"        VARCHAR(1000),
    "carriedToRedetermination"      BOOLEAN NOT NULL DEFAULT false,
    "isPrivileged"                  BOOLEAN NOT NULL DEFAULT true,
    "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                     TIMESTAMP(3) NOT NULL,
    "deletedAt"                     TIMESTAMP(3),
    CONSTRAINT "jr_artifacts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "jr_artifacts_matterId_folder_sortOrder_idx" ON "legal"."jr_artifacts" ("matterId","folder","sortOrder");
CREATE INDEX IF NOT EXISTS "jr_artifacts_matterId_status_idx" ON "legal"."jr_artifacts" ("matterId","status");
CREATE INDEX IF NOT EXISTS "jr_artifacts_status_counselReviewedAt_idx" ON "legal"."jr_artifacts" ("status","counselReviewedAt");

-- 3.3 jr_artifact_versions
CREATE TABLE IF NOT EXISTS "legal"."jr_artifact_versions" (
    "id"               TEXT NOT NULL,
    "artifactId"       TEXT NOT NULL,
    "versionNumber"    INTEGER NOT NULL,
    "storageKey"       VARCHAR(500) NOT NULL,
    "fileName"         VARCHAR(300) NOT NULL,
    "mimeType"         VARCHAR(120) NOT NULL,
    "fileSizeBytes"    INTEGER NOT NULL,
    "changeNote"       VARCHAR(500),
    "uploadedByUserId" TEXT NOT NULL,
    "isCurrent"        BOOLEAN NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jr_artifact_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "jr_artifact_versions_artifactId_versionNumber_key" ON "legal"."jr_artifact_versions" ("artifactId","versionNumber");
CREATE INDEX IF NOT EXISTS "jr_artifact_versions_artifactId_isCurrent_idx" ON "legal"."jr_artifact_versions" ("artifactId","isCurrent");

-- 3.4 jr_counsel
CREATE TABLE IF NOT EXISTS "legal"."jr_counsel" (
    "id"                      TEXT NOT NULL,
    "legalName"               VARCHAR(200) NOT NULL,
    "firmName"                VARCHAR(200) NOT NULL,
    "lawSocietyProvince"      VARCHAR(40) NOT NULL,
    "licenceNumber"           VARCHAR(60) NOT NULL,
    "directoryUrl"            VARCHAR(500),
    "email"                   VARCHAR(200) NOT NULL,
    "phone"                   VARCHAR(40),
    "addressForServiceCanada" VARCHAR(400) NOT NULL,
    "goodStandingVerifiedAt"  TIMESTAMP(3),
    "isActive"                BOOLEAN NOT NULL DEFAULT true,
    "notes"                   TEXT,
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3) NOT NULL,
    CONSTRAINT "jr_counsel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "jr_counsel_lawSocietyProvince_licenceNumber_key" ON "legal"."jr_counsel" ("lawSocietyProvince","licenceNumber");

-- 3.5 jr_deadline_rules
CREATE TABLE IF NOT EXISTS "legal"."jr_deadline_rules" (
    "id"                 TEXT NOT NULL,
    "ruleSetVersion"     INTEGER NOT NULL,
    "milestoneKey"       VARCHAR(60) NOT NULL,
    "variantKey"         VARCHAR(40),
    "baseDays"           INTEGER NOT NULL,
    "modifierDays"       INTEGER NOT NULL DEFAULT 0,
    "offsetDirection"    VARCHAR(10) NOT NULL DEFAULT 'AFTER',
    "effectiveFrom"      DATE NOT NULL,
    "effectiveTo"        DATE,
    "authorityCitation"  VARCHAR(200) NOT NULL,
    "sourceUrl"          VARCHAR(500) NOT NULL,
    "verificationStatus" "legal"."JrRuleVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedByUserId"   TEXT,
    "verifiedAt"         TIMESTAMP(3),
    "notes"              TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jr_deadline_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "jr_deadline_rules_ruleSetVersion_milestoneKey_variantKey_key" ON "legal"."jr_deadline_rules" ("ruleSetVersion","milestoneKey","variantKey");
CREATE INDEX IF NOT EXISTS "jr_deadline_rules_milestoneKey_effectiveFrom_idx" ON "legal"."jr_deadline_rules" ("milestoneKey","effectiveFrom");

-- 3.6 jr_deadlines
CREATE TABLE IF NOT EXISTS "legal"."jr_deadlines" (
    "id"                 TEXT NOT NULL,
    "matterId"           TEXT NOT NULL,
    "milestoneKey"       VARCHAR(60) NOT NULL,
    "label"              VARCHAR(120),
    "anchorDate"         TIMESTAMP(3) NOT NULL,
    "anchorField"        VARCHAR(60) NOT NULL,
    "computedDueAt"      TIMESTAMP(3) NOT NULL,
    "ruleId"             TEXT NOT NULL,
    "ruleSetVersion"     INTEGER NOT NULL,
    "status"             "legal"."JrDeadlineStatus" NOT NULL DEFAULT 'PENDING',
    "satisfiedAt"        TIMESTAMP(3),
    "overriddenDueAt"    TIMESTAMP(3),
    "overrideReason"     VARCHAR(500),
    "overriddenByUserId" TEXT,
    "isFatal"            BOOLEAN NOT NULL DEFAULT false,
    "quotableToClient"   BOOLEAN NOT NULL DEFAULT false,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "jr_deadlines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "jr_deadlines_matterId_milestoneKey_label_key" ON "legal"."jr_deadlines" ("matterId","milestoneKey","label");
CREATE INDEX IF NOT EXISTS "jr_deadlines_status_computedDueAt_idx" ON "legal"."jr_deadlines" ("status","computedDueAt");
CREATE INDEX IF NOT EXISTS "jr_deadlines_matterId_idx" ON "legal"."jr_deadlines" ("matterId");

-- 3.7 jr_deadline_alerts
CREATE TABLE IF NOT EXISTS "legal"."jr_deadline_alerts" (
    "id"              TEXT NOT NULL,
    "matterId"        TEXT NOT NULL,
    "deadlineId"      TEXT,
    "tier"            VARCHAR(20) NOT NULL,
    "channel"         VARCHAR(20) NOT NULL,
    "recipientUserId" TEXT,
    "sentAt"          TIMESTAMP(3),
    "deliveryStatus"  VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "errorMessage"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jr_deadline_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "jr_deadline_alerts_deadlineId_tier_channel_recipientUserId_key" ON "legal"."jr_deadline_alerts" ("deadlineId","tier","channel","recipientUserId");
CREATE INDEX IF NOT EXISTS "jr_deadline_alerts_matterId_idx" ON "legal"."jr_deadline_alerts" ("matterId");

-- 3.8 jr_atip_requests
CREATE TABLE IF NOT EXISTS "legal"."jr_atip_requests" (
    "id"                   TEXT NOT NULL,
    "matterId"             TEXT NOT NULL,
    "statute"              "legal"."JrAtipStatute" NOT NULL DEFAULT 'PRIVACY_ACT',
    "requester"            "legal"."JrAtipRequester" NOT NULL DEFAULT 'SELF',
    "requestNumber"        VARCHAR(60),
    "submittedAt"          DATE,
    "statutoryDueAt"       DATE,
    "extensionNoticeAt"    DATE,
    "receivedAt"           DATE,
    "isRedacted"           BOOLEAN NOT NULL DEFAULT false,
    "wetSignatureRequired" BOOLEAN NOT NULL DEFAULT false,
    "complaintFiledAt"     DATE,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jr_atip_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "jr_atip_requests_matterId_idx" ON "legal"."jr_atip_requests" ("matterId");

-- 3.9 jr_notes
CREATE TABLE IF NOT EXISTS "legal"."jr_notes" (
    "id"              TEXT NOT NULL,
    "matterId"        TEXT NOT NULL,
    "content"         TEXT NOT NULL,
    "noteType"        VARCHAR(30) NOT NULL DEFAULT 'GENERAL',
    "isPinned"        BOOLEAN NOT NULL DEFAULT false,
    "authorUserId"    TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt"        TIMESTAMP(3),
    "deletedAt"       TIMESTAMP(3),
    "deletedByUserId" TEXT,
    CONSTRAINT "jr_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "jr_notes_matterId_idx" ON "legal"."jr_notes" ("matterId");

-- 3.10 jr_audit_logs
CREATE TABLE IF NOT EXISTS "legal"."jr_audit_logs" (
    "id"          TEXT NOT NULL,
    "matterId"    TEXT,
    "actorUserId" TEXT,
    "action"      VARCHAR(80) NOT NULL,
    "entityType"  VARCHAR(60) NOT NULL,
    "entityId"    TEXT,
    "oldValues"   JSONB,
    "newValues"   JSONB,
    "ipAddress"   VARCHAR(60),
    "userAgent"   VARCHAR(400),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jr_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "jr_audit_logs_matterId_createdAt_idx" ON "legal"."jr_audit_logs" ("matterId","createdAt");
CREATE INDEX IF NOT EXISTS "jr_audit_logs_action_idx" ON "legal"."jr_audit_logs" ("action");

-- ── 4. foreign keys (the six real @relation edges; bare-id columns get NO FK) ──
DO $$ BEGIN
  ALTER TABLE "legal"."jr_artifacts"
    ADD CONSTRAINT "jr_artifacts_matterId_fkey" FOREIGN KEY ("matterId")
    REFERENCES "legal"."jr_matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "legal"."jr_artifact_versions"
    ADD CONSTRAINT "jr_artifact_versions_artifactId_fkey" FOREIGN KEY ("artifactId")
    REFERENCES "legal"."jr_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "legal"."jr_deadlines"
    ADD CONSTRAINT "jr_deadlines_matterId_fkey" FOREIGN KEY ("matterId")
    REFERENCES "legal"."jr_matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "legal"."jr_deadline_alerts"
    ADD CONSTRAINT "jr_deadline_alerts_matterId_fkey" FOREIGN KEY ("matterId")
    REFERENCES "legal"."jr_matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "legal"."jr_atip_requests"
    ADD CONSTRAINT "jr_atip_requests_matterId_fkey" FOREIGN KEY ("matterId")
    REFERENCES "legal"."jr_matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "legal"."jr_notes"
    ADD CONSTRAINT "jr_notes_matterId_fkey" FOREIGN KEY ("matterId")
    REFERENCES "legal"."jr_matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "legal"."jr_audit_logs"
    ADD CONSTRAINT "jr_audit_logs_matterId_fkey" FOREIGN KEY ("matterId")
    REFERENCES "legal"."jr_matters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
