-- CreateEnum
CREATE TYPE "ProcessingCaseStage" AS ENUM ('INTAKE_PENDING', 'DOCUMENTS_COLLECTION', 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_INCOMPLETE', 'DOCUMENTS_COMPLETE', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'UNDER_AUTHORITY_REVIEW', 'ADDITIONAL_INFO_REQUESTED', 'DECISION_RECEIVED', 'APPROVED', 'REJECTED', 'APPEAL_IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProcessingCasePriority" AS ENUM ('LOW', 'NORMAL', 'URGENT', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ProcessingSlaStatus" AS ENUM ('ACTIVE', 'APPROACHING', 'BREACHED', 'EXTENDED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AuthorityDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DocumentCriticality" AS ENUM ('CRITICAL', 'REQUIRED', 'CONDITIONAL', 'SUPPORTING', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "DocumentItemStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'EXPIRING_SOON', 'WAIVED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "DocumentValidityRule" AS ENUM ('NONE', 'MUST_NOT_EXPIRE', 'MUST_BE_VALID_FOR_N_MONTHS');

-- CreateEnum
CREATE TYPE "VirusScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED');

-- CreateEnum
CREATE TYPE "DocReviewDecisionType" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocAccessType" AS ENUM ('VIEW', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "CorrectionType" AS ENUM ('DOCUMENT', 'INFORMATION');

-- CreateEnum
CREATE TYPE "CorrectionRequiredAction" AS ENUM ('REUPLOAD', 'CONFIRM', 'CORRECT', 'CALL_BACK');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('SENT', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('OFFICER_TO_CLIENT', 'CLIENT_TO_OFFICER', 'SYSTEM_TO_CLIENT');

-- CreateEnum
CREATE TYPE "CommunicationMessageType" AS ENUM ('WELCOME', 'DOCS_REQUEST', 'DOCS_REJECTED_NOTICE', 'GENERAL_UPDATE', 'STAGE_UPDATE', 'INFORMATION_REQUEST', 'SUBMISSION_NOTICE', 'DECISION_NOTICE', 'APPOINTMENT_REQUEST', 'REMINDER');

-- CreateEnum
CREATE TYPE "ProcessingNoteType" AS ENUM ('GENERAL', 'ESCALATION', 'STRATEGY', 'CLIENT_INSIGHT', 'AUTHORITY_NOTE', 'MANAGER_ONLY');

-- CreateEnum
CREATE TYPE "ProcessingTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ProcessingTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuthoritySubmissionStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'RESPONDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AuthorityResponseType" AS ENUM ('APPROVAL', 'REJECTION', 'INFO_REQUEST', 'BIOMETRICS_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('WELCOME', 'DOCS_REQUEST', 'DOCS_DEADLINE_7D', 'DOCS_DEADLINE_1D', 'DOCS_OVERDUE', 'DOC_REJECTED', 'EXPIRY_30D', 'EXPIRY_7D', 'STAGE_UPDATE', 'SUBMISSION_CONFIRMED', 'DECISION_RECEIVED');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('PORTAL', 'WHATSAPP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "ReminderDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PROCESSING_CASE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSING_CASE_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSING_STAGE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSING_DOCUMENT_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSING_DOCUMENT_WAIVED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSING_NOTE_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSING_TASK_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSING_CASE_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSING_CASE_CANCELLED';

-- AlterEnum
ALTER TYPE "FinanceHandoverStatus" ADD VALUE 'SENT_TO_PROCESSING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TimelineEventType" ADD VALUE 'PROCESSING_CASE_CREATED';
ALTER TYPE "TimelineEventType" ADD VALUE 'PROCESSING_STAGE_CHANGED';
ALTER TYPE "TimelineEventType" ADD VALUE 'PROCESSING_DOCUMENT_SUBMITTED';
ALTER TYPE "TimelineEventType" ADD VALUE 'PROCESSING_DOCUMENT_ACCEPTED';
ALTER TYPE "TimelineEventType" ADD VALUE 'PROCESSING_DOCUMENT_REJECTED';
ALTER TYPE "TimelineEventType" ADD VALUE 'PROCESSING_MESSAGE_SENT';
ALTER TYPE "TimelineEventType" ADD VALUE 'PROCESSING_SUBMISSION_FILED';
ALTER TYPE "TimelineEventType" ADD VALUE 'PROCESSING_DECISION_RECEIVED';
ALTER TYPE "TimelineEventType" ADD VALUE 'PROCESSING_CASE_COMPLETED';

-- CreateTable
CREATE TABLE "document_requirement_templates" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "targetCountry" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "criticality" "DocumentCriticality" NOT NULL DEFAULT 'REQUIRED',
    "conditionRule" JSONB,
    "expectedFormats" TEXT[] DEFAULT ARRAY['PDF']::TEXT[],
    "maxFileSizeMb" INTEGER NOT NULL DEFAULT 10,
    "validityRule" "DocumentValidityRule" NOT NULL DEFAULT 'NONE',
    "validityMonths" INTEGER,
    "validityBufferDays" INTEGER NOT NULL DEFAULT 30,
    "guidanceUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "document_requirement_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_cases" (
    "id" TEXT NOT NULL,
    "financeHandoverId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "clientId" TEXT,
    "branchId" TEXT,
    "assignedOfficerId" TEXT,
    "priority" "ProcessingCasePriority" NOT NULL DEFAULT 'NORMAL',
    "stage" "ProcessingCaseStage" NOT NULL DEFAULT 'INTAKE_PENDING',
    "slaStatus" "ProcessingSlaStatus" NOT NULL DEFAULT 'ACTIVE',
    "slaDueAt" TIMESTAMP(3),
    "service" TEXT NOT NULL,
    "targetCountry" TEXT NOT NULL,
    "financeHandoverNote" TEXT,
    "processingNote" TEXT,
    "estimatedSubmissionDate" DATE,
    "actualSubmissionDate" DATE,
    "authorityTrackingRef" TEXT,
    "authorityDecision" "AuthorityDecision" NOT NULL DEFAULT 'PENDING',
    "authorityDecisionDate" DATE,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "processing_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_case_stage_history" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromStage" "ProcessingCaseStage",
    "toStage" "ProcessingCaseStage" NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "gateCheckResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_case_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_document_items" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "templateId" TEXT,
    "documentName" TEXT NOT NULL,
    "description" TEXT,
    "criticality" "DocumentCriticality" NOT NULL DEFAULT 'REQUIRED',
    "expectedFormats" TEXT[] DEFAULT ARRAY['PDF']::TEXT[],
    "maxFileSizeMb" INTEGER NOT NULL DEFAULT 10,
    "validityRule" "DocumentValidityRule" NOT NULL DEFAULT 'NONE',
    "validityMonths" INTEGER,
    "validityBufferDays" INTEGER NOT NULL DEFAULT 30,
    "status" "DocumentItemStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "latestVersionId" TEXT,
    "validityExpiryDate" DATE,
    "expiryAlertSentAt" TIMESTAMP(3),
    "lastRequestedAt" TIMESTAMP(3),
    "requestDeadline" DATE,
    "waivedByUserId" TEXT,
    "waiveReason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isAddedManually" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_document_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_document_versions" (
    "id" TEXT NOT NULL,
    "documentItemId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "clientId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "mimeType" TEXT,
    "versionNumber" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedByUserId" TEXT,
    "virusScanStatus" "VirusScanStatus" NOT NULL DEFAULT 'PENDING',
    "virusScanAt" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "client_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_review_decisions" (
    "id" TEXT NOT NULL,
    "documentItemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "decision" "DocReviewDecisionType" NOT NULL,
    "rejectionReasonCodes" TEXT[],
    "rejectionNote" TEXT,
    "reviewedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access_logs" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "accessedByUserId" TEXT NOT NULL,
    "accessType" "DocAccessType" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signedUrlIssuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_requests" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentItemId" TEXT,
    "raisedByOfficerId" TEXT NOT NULL,
    "correctionType" "CorrectionType" NOT NULL,
    "subject" TEXT NOT NULL,
    "reasonCodes" TEXT[],
    "officerNote" TEXT,
    "clientMessage" TEXT NOT NULL,
    "requiredAction" "CorrectionRequiredAction" NOT NULL,
    "slaHours" INTEGER NOT NULL DEFAULT 120,
    "slaDueAt" TIMESTAMP(3),
    "status" "CorrectionStatus" NOT NULL DEFAULT 'SENT',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_communications" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "messageType" "CommunicationMessageType" NOT NULL,
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "channelsSent" TEXT[],
    "sentByUserId" TEXT,
    "readByClientAt" TIMESTAMP(3),
    "whatsappMessageId" TEXT,
    "emailMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_reminders" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "clientId" TEXT,
    "reminderType" "ReminderType" NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveryStatus" "ReminderDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "templateId" TEXT,
    "renderedContent" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_notes" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "noteType" "ProcessingNoteType" NOT NULL DEFAULT 'GENERAL',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "mentions" TEXT[],
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_tasks" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "assignedToUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "dueDate" DATE,
    "priority" "ProcessingTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "ProcessingTaskStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authority_submissions" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "submissionNumber" INTEGER NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "submissionDate" DATE NOT NULL,
    "submissionReference" TEXT,
    "authority" TEXT NOT NULL,
    "documentsIncluded" TEXT[],
    "trackingNumber" TEXT,
    "status" "AuthoritySubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "responseReceivedAt" TIMESTAMP(3),
    "responseType" "AuthorityResponseType",
    "responseNotes" TEXT,
    "nextAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authority_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_audit_logs" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_requirement_templates_service_targetCountry_idx" ON "document_requirement_templates"("service", "targetCountry");

-- CreateIndex
CREATE INDEX "document_requirement_templates_isActive_idx" ON "document_requirement_templates"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "processing_cases_financeHandoverId_key" ON "processing_cases"("financeHandoverId");

-- CreateIndex
CREATE INDEX "processing_cases_assignedOfficerId_idx" ON "processing_cases"("assignedOfficerId");

-- CreateIndex
CREATE INDEX "processing_cases_stage_idx" ON "processing_cases"("stage");

-- CreateIndex
CREATE INDEX "processing_cases_clientId_idx" ON "processing_cases"("clientId");

-- CreateIndex
CREATE INDEX "processing_cases_leadId_idx" ON "processing_cases"("leadId");

-- CreateIndex
CREATE INDEX "processing_cases_priority_stage_idx" ON "processing_cases"("priority", "stage");

-- CreateIndex
CREATE INDEX "processing_case_stage_history_caseId_idx" ON "processing_case_stage_history"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "case_document_items_latestVersionId_key" ON "case_document_items"("latestVersionId");

-- CreateIndex
CREATE INDEX "case_document_items_caseId_idx" ON "case_document_items"("caseId");

-- CreateIndex
CREATE INDEX "case_document_items_status_caseId_idx" ON "case_document_items"("status", "caseId");

-- CreateIndex
CREATE INDEX "case_document_items_validityExpiryDate_idx" ON "case_document_items"("validityExpiryDate");

-- CreateIndex
CREATE INDEX "client_document_versions_documentItemId_idx" ON "client_document_versions"("documentItemId");

-- CreateIndex
CREATE INDEX "client_document_versions_caseId_idx" ON "client_document_versions"("caseId");

-- CreateIndex
CREATE INDEX "document_review_decisions_documentItemId_idx" ON "document_review_decisions"("documentItemId");

-- CreateIndex
CREATE INDEX "document_access_logs_documentVersionId_idx" ON "document_access_logs"("documentVersionId");

-- CreateIndex
CREATE INDEX "document_access_logs_accessedByUserId_idx" ON "document_access_logs"("accessedByUserId");

-- CreateIndex
CREATE INDEX "correction_requests_caseId_idx" ON "correction_requests"("caseId");

-- CreateIndex
CREATE INDEX "correction_requests_status_idx" ON "correction_requests"("status");

-- CreateIndex
CREATE INDEX "case_communications_caseId_createdAt_idx" ON "case_communications"("caseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "client_reminders_caseId_idx" ON "client_reminders"("caseId");

-- CreateIndex
CREATE INDEX "client_reminders_scheduledAt_idx" ON "client_reminders"("scheduledAt");

-- CreateIndex
CREATE INDEX "processing_notes_caseId_idx" ON "processing_notes"("caseId");

-- CreateIndex
CREATE INDEX "processing_tasks_caseId_idx" ON "processing_tasks"("caseId");

-- CreateIndex
CREATE INDEX "processing_tasks_assignedToUserId_status_idx" ON "processing_tasks"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "authority_submissions_caseId_idx" ON "authority_submissions"("caseId");

-- CreateIndex
CREATE INDEX "processing_audit_logs_caseId_createdAt_idx" ON "processing_audit_logs"("caseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "processing_audit_logs_entityType_entityId_idx" ON "processing_audit_logs"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "document_requirement_templates" ADD CONSTRAINT "document_requirement_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_cases" ADD CONSTRAINT "processing_cases_financeHandoverId_fkey" FOREIGN KEY ("financeHandoverId") REFERENCES "finance_handovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_cases" ADD CONSTRAINT "processing_cases_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_cases" ADD CONSTRAINT "processing_cases_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_cases" ADD CONSTRAINT "processing_cases_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_cases" ADD CONSTRAINT "processing_cases_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_cases" ADD CONSTRAINT "processing_cases_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_cases" ADD CONSTRAINT "processing_cases_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_case_stage_history" ADD CONSTRAINT "processing_case_stage_history_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_case_stage_history" ADD CONSTRAINT "processing_case_stage_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_document_items" ADD CONSTRAINT "case_document_items_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_document_items" ADD CONSTRAINT "case_document_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_requirement_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_document_items" ADD CONSTRAINT "case_document_items_waivedByUserId_fkey" FOREIGN KEY ("waivedByUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_document_items" ADD CONSTRAINT "case_document_items_latestVersionId_fkey" FOREIGN KEY ("latestVersionId") REFERENCES "client_document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_document_versions" ADD CONSTRAINT "client_document_versions_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "case_document_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_document_versions" ADD CONSTRAINT "client_document_versions_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_review_decisions" ADD CONSTRAINT "document_review_decisions_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "case_document_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_review_decisions" ADD CONSTRAINT "document_review_decisions_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "client_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_review_decisions" ADD CONSTRAINT "document_review_decisions_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "client_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_accessedByUserId_fkey" FOREIGN KEY ("accessedByUserId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "case_document_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_raisedByOfficerId_fkey" FOREIGN KEY ("raisedByOfficerId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_communications" ADD CONSTRAINT "case_communications_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_communications" ADD CONSTRAINT "case_communications_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reminders" ADD CONSTRAINT "client_reminders_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reminders" ADD CONSTRAINT "client_reminders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_notes" ADD CONSTRAINT "processing_notes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_notes" ADD CONSTRAINT "processing_notes_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_tasks" ADD CONSTRAINT "processing_tasks_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_tasks" ADD CONSTRAINT "processing_tasks_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_tasks" ADD CONSTRAINT "processing_tasks_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_tasks" ADD CONSTRAINT "processing_tasks_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_submissions" ADD CONSTRAINT "authority_submissions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_submissions" ADD CONSTRAINT "authority_submissions_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_audit_logs" ADD CONSTRAINT "processing_audit_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_audit_logs" ADD CONSTRAINT "processing_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
