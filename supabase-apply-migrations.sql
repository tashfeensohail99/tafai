-- ============================================================
-- Tashfeen: Clean slate + apply all migrations + baseline
-- DROPS all public Prisma tables/enums then recreates fresh.
-- Safe for dev/staging — no real data.
-- ============================================================

-- === DROP all Prisma tables ===
DROP TABLE IF EXISTS "activity_timeline" CASCADE;
DROP TABLE IF EXISTS "ai_jobs" CASCADE;
DROP TABLE IF EXISTS "appointments" CASCADE;
DROP TABLE IF EXISTS "attendance_records" CASCADE;
DROP TABLE IF EXISTS "audit_logs" CASCADE;
DROP TABLE IF EXISTS "authority_submissions" CASCADE;
DROP TABLE IF EXISTS "branches" CASCADE;
DROP TABLE IF EXISTS "case_communications" CASCADE;
DROP TABLE IF EXISTS "case_document_items" CASCADE;
DROP TABLE IF EXISTS "cases" CASCADE;
DROP TABLE IF EXISTS "client_document_versions" CASCADE;
DROP TABLE IF EXISTS "client_documents" CASCADE;
DROP TABLE IF EXISTS "client_reminders" CASCADE;
DROP TABLE IF EXISTS "clients" CASCADE;
DROP TABLE IF EXISTS "correction_requests" CASCADE;
DROP TABLE IF EXISTS "countries" CASCADE;
DROP TABLE IF EXISTS "departments" CASCADE;
DROP TABLE IF EXISTS "designations" CASCADE;
DROP TABLE IF EXISTS "document_access_logs" CASCADE;
DROP TABLE IF EXISTS "document_requirement_templates" CASCADE;
DROP TABLE IF EXISTS "document_requirements" CASCADE;
DROP TABLE IF EXISTS "document_review_decisions" CASCADE;
DROP TABLE IF EXISTS "employees" CASCADE;
DROP TABLE IF EXISTS "finance_handovers" CASCADE;
DROP TABLE IF EXISTS "follow_ups" CASCADE;
DROP TABLE IF EXISTS "invoices" CASCADE;
DROP TABLE IF EXISTS "leads" CASCADE;
DROP TABLE IF EXISTS "login_sessions" CASCADE;
DROP TABLE IF EXISTS "organizations" CASCADE;
DROP TABLE IF EXISTS "partners" CASCADE;
DROP TABLE IF EXISTS "password_reset_tokens" CASCADE;
DROP TABLE IF EXISTS "payments" CASCADE;
DROP TABLE IF EXISTS "permissions" CASCADE;
DROP TABLE IF EXISTS "processing_audit_logs" CASCADE;
DROP TABLE IF EXISTS "processing_case_stage_history" CASCADE;
DROP TABLE IF EXISTS "processing_cases" CASCADE;
DROP TABLE IF EXISTS "processing_notes" CASCADE;
DROP TABLE IF EXISTS "processing_tasks" CASCADE;
DROP TABLE IF EXISTS "role_permissions" CASCADE;
DROP TABLE IF EXISTS "roles" CASCADE;
DROP TABLE IF EXISTS "services" CASCADE;
DROP TABLE IF EXISTS "user_accounts" CASCADE;
DROP TABLE IF EXISTS "user_roles" CASCADE;
DROP TABLE IF EXISTS "_prisma_migrations" CASCADE;

-- === DROP all custom ENUM types ===
DROP TYPE IF EXISTS "AiJobStatus" CASCADE;
DROP TYPE IF EXISTS "AiJobType" CASCADE;
DROP TYPE IF EXISTS "AppointmentStatus" CASCADE;
DROP TYPE IF EXISTS "AttendanceStatus" CASCADE;
DROP TYPE IF EXISTS "AuditAction" CASCADE;
DROP TYPE IF EXISTS "AuthorityDecision" CASCADE;
DROP TYPE IF EXISTS "AuthorityResponseType" CASCADE;
DROP TYPE IF EXISTS "AuthoritySubmissionStatus" CASCADE;
DROP TYPE IF EXISTS "CaseStatus" CASCADE;
DROP TYPE IF EXISTS "ClientStatus" CASCADE;
DROP TYPE IF EXISTS "CommunicationDirection" CASCADE;
DROP TYPE IF EXISTS "CommunicationMessageType" CASCADE;
DROP TYPE IF EXISTS "CorrectionRequiredAction" CASCADE;
DROP TYPE IF EXISTS "CorrectionStatus" CASCADE;
DROP TYPE IF EXISTS "CorrectionType" CASCADE;
DROP TYPE IF EXISTS "DocAccessType" CASCADE;
DROP TYPE IF EXISTS "DocReviewDecisionType" CASCADE;
DROP TYPE IF EXISTS "DocumentCriticality" CASCADE;
DROP TYPE IF EXISTS "DocumentItemStatus" CASCADE;
DROP TYPE IF EXISTS "DocumentStatus" CASCADE;
DROP TYPE IF EXISTS "DocumentValidityRule" CASCADE;
DROP TYPE IF EXISTS "FinanceHandoverStatus" CASCADE;
DROP TYPE IF EXISTS "FollowUpPriority" CASCADE;
DROP TYPE IF EXISTS "FollowUpStatus" CASCADE;
DROP TYPE IF EXISTS "Gender" CASCADE;
DROP TYPE IF EXISTS "InvoiceStatus" CASCADE;
DROP TYPE IF EXISTS "LeadStatus" CASCADE;
DROP TYPE IF EXISTS "PartnerStatus" CASCADE;
DROP TYPE IF EXISTS "PaymentStatus" CASCADE;
DROP TYPE IF EXISTS "ProcessingCasePriority" CASCADE;
DROP TYPE IF EXISTS "ProcessingCaseStage" CASCADE;
DROP TYPE IF EXISTS "ProcessingNoteType" CASCADE;
DROP TYPE IF EXISTS "ProcessingSlaStatus" CASCADE;
DROP TYPE IF EXISTS "ProcessingTaskPriority" CASCADE;
DROP TYPE IF EXISTS "ProcessingTaskStatus" CASCADE;
DROP TYPE IF EXISTS "ReminderChannel" CASCADE;
DROP TYPE IF EXISTS "ReminderDeliveryStatus" CASCADE;
DROP TYPE IF EXISTS "ReminderType" CASCADE;
DROP TYPE IF EXISTS "TimelineEventType" CASCADE;
DROP TYPE IF EXISTS "UserStatus" CASCADE;
DROP TYPE IF EXISTS "VirusScanStatus" CASCADE;

-- === 20260508181144_init ===
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'FOLLOW_UP', 'CONVERTED', 'LOST', 'DUPLICATE', 'UNQUALIFIED');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'COMPLETED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DOCUMENTATION', 'PROCESSING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED', 'REPLACEMENT_REQUIRED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'REFUNDED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_LOGIN', 'USER_LOGOUT', 'USER_LOGIN_FAILED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'USER_REACTIVATED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'PERMISSION_CHANGED', 'USER_ROLE_ASSIGNED', 'USER_ROLE_REMOVED', 'DEPARTMENT_CREATED', 'DEPARTMENT_UPDATED', 'DEPARTMENT_DELETED', 'LEAD_CREATED', 'LEAD_UPDATED', 'LEAD_ASSIGNED', 'LEAD_REASSIGNED', 'LEAD_CONVERTED', 'LEAD_LOST', 'LEAD_DUPLICATE_MARKED', 'CLIENT_CREATED', 'CLIENT_UPDATED', 'CASE_CREATED', 'CASE_UPDATED', 'CASE_STATUS_CHANGED', 'CASE_HANDOVER', 'DOCUMENT_UPLOADED', 'DOCUMENT_VIEWED', 'DOCUMENT_REVIEWED', 'DOCUMENT_VERIFIED', 'DOCUMENT_REJECTED', 'DOCUMENT_REPLACED', 'INVOICE_CREATED', 'INVOICE_UPDATED', 'PAYMENT_RECORDED', 'PAYMENT_VERIFIED', 'PAYMENT_REFUNDED', 'APPOINTMENT_CREATED', 'APPOINTMENT_UPDATED', 'APPOINTMENT_CANCELLED', 'WHATSAPP_MESSAGE_SENT', 'EMAIL_SENT', 'AI_JOB_SUBMITTED', 'AI_OUTPUT_REVIEWED', 'SETTING_CHANGED', 'DEVICE_ACCESS_CHANGED', 'ATTENDANCE_OVERRIDDEN', 'REPORT_EXPORTED');

-- CreateEnum
CREATE TYPE "TimelineEventType" AS ENUM ('LEAD_CREATED', 'LEAD_CONTACTED', 'LEAD_QUALIFIED', 'LEAD_ASSIGNED', 'LEAD_CONVERTED', 'CLIENT_PROFILE_UPDATED', 'CASE_OPENED', 'CASE_STATUS_CHANGED', 'CASE_HANDOVER', 'DOCUMENT_UPLOADED', 'DOCUMENT_VERIFIED', 'DOCUMENT_REJECTED', 'APPOINTMENT_SCHEDULED', 'APPOINTMENT_COMPLETED', 'PAYMENT_RECEIVED', 'MESSAGE_SENT', 'NOTE_ADDED', 'AI_DOCUMENT_PROCESSED');

-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM ('OCR', 'DOCUMENT_CLASSIFICATION', 'DOCUMENT_EXPIRY_DETECTION', 'TRANSCRIPTION', 'CALL_SUMMARY', 'INTERVIEW_SUMMARY', 'SUGGESTED_REPLY', 'BUSINESS_PLAN_DRAFT');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVIEW_PENDING', 'REVIEWED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'ON_LEAVE');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,
    "branchId" TEXT,
    "designationId" TEXT,
    "employeeCode" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "gender" "Gender",
    "dateOfBirth" TIMESTAMP(3),
    "nationalId" TEXT,
    "passportNumber" TEXT,
    "nationality" TEXT,
    "joiningDate" TIMESTAMP(3),
    "profilePhotoKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "branchId" TEXT,
    "assignedEmployeeId" TEXT,
    "createdByUserId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "nationality" TEXT,
    "targetCountry" TEXT,
    "serviceInterest" TEXT,
    "sourceChannel" TEXT,
    "referralPartnerId" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "priority" TEXT,
    "notes" TEXT,
    "lostReason" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "branchId" TEXT,
    "createdByUserId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "nationality" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "passportNumber" TEXT,
    "passportExpiry" TIMESTAMP(3),
    "nationalId" TEXT,
    "address" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "portalAccessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "departmentId" TEXT,
    "assignedEmployeeId" TEXT,
    "caseNumber" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "targetCountry" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "priority" TEXT,
    "notes" TEXT,
    "submissionDeadline" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decisionNotes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requirements" (
    "id" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "targetCountry" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_documents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT,
    "documentRequirementId" TEXT,
    "uploadedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fileKey" TEXT NOT NULL,
    "fileMimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "expiryDate" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isConfidential" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT,
    "assignedEmployeeId" TEXT,
    "createdByUserId" TEXT,
    "title" TEXT NOT NULL,
    "appointmentType" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "location" TEXT,
    "meetingLink" TEXT,
    "notes" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "transactionRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "receiptKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_timeline" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "caseId" TEXT,
    "eventType" "TimelineEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "actorUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" TEXT NOT NULL,
    "jobType" "AiJobType" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'QUEUED',
    "inputReference" TEXT,
    "documentId" TEXT,
    "promptVersion" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "inputPayload" JSONB,
    "outputPayload" JSONB,
    "errorMessage" TEXT,
    "reviewedByUserId" TEXT,
    "reviewStatus" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "processingStart" TIMESTAMP(3),
    "processingEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "notes" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overriddenByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_organizationId_idx" ON "branches"("organizationId");

-- CreateIndex
CREATE INDEX "departments_organizationId_idx" ON "departments"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_email_key" ON "user_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_phone_key" ON "user_accounts"("phone");

-- CreateIndex
CREATE INDEX "user_accounts_email_idx" ON "user_accounts"("email");

-- CreateIndex
CREATE INDEX "user_accounts_phone_idx" ON "user_accounts"("phone");

-- CreateIndex
CREATE INDEX "user_accounts_status_idx" ON "user_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "login_sessions_refreshToken_key" ON "login_sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "login_sessions_userId_idx" ON "login_sessions"("userId");

-- CreateIndex
CREATE INDEX "login_sessions_refreshToken_idx" ON "login_sessions"("refreshToken");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_idx" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key" ON "employees"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeCode_key" ON "employees"("employeeCode");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE INDEX "employees_branchId_idx" ON "employees"("branchId");

-- CreateIndex
CREATE INDEX "leads_phone_idx" ON "leads"("phone");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_assignedEmployeeId_idx" ON "leads"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "leads_branchId_idx" ON "leads"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "clients_email_key" ON "clients"("email");

-- CreateIndex
CREATE UNIQUE INDEX "clients_phone_key" ON "clients"("phone");

-- CreateIndex
CREATE INDEX "clients_phone_idx" ON "clients"("phone");

-- CreateIndex
CREATE INDEX "clients_email_idx" ON "clients"("email");

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "clients"("status");

-- CreateIndex
CREATE INDEX "clients_branchId_idx" ON "clients"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "cases_caseNumber_key" ON "cases"("caseNumber");

-- CreateIndex
CREATE INDEX "cases_clientId_idx" ON "cases"("clientId");

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "cases"("status");

-- CreateIndex
CREATE INDEX "cases_assignedEmployeeId_idx" ON "cases"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "cases_departmentId_idx" ON "cases"("departmentId");

-- CreateIndex
CREATE INDEX "document_requirements_serviceType_idx" ON "document_requirements"("serviceType");

-- CreateIndex
CREATE INDEX "client_documents_clientId_idx" ON "client_documents"("clientId");

-- CreateIndex
CREATE INDEX "client_documents_caseId_idx" ON "client_documents"("caseId");

-- CreateIndex
CREATE INDEX "client_documents_status_idx" ON "client_documents"("status");

-- CreateIndex
CREATE INDEX "appointments_clientId_idx" ON "appointments"("clientId");

-- CreateIndex
CREATE INDEX "appointments_caseId_idx" ON "appointments"("caseId");

-- CreateIndex
CREATE INDEX "appointments_scheduledAt_idx" ON "appointments"("scheduledAt");

-- CreateIndex
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_clientId_idx" ON "invoices"("clientId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "activity_timeline_entityType_entityId_idx" ON "activity_timeline"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activity_timeline_leadId_idx" ON "activity_timeline"("leadId");

-- CreateIndex
CREATE INDEX "activity_timeline_clientId_idx" ON "activity_timeline"("clientId");

-- CreateIndex
CREATE INDEX "activity_timeline_caseId_idx" ON "activity_timeline"("caseId");

-- CreateIndex
CREATE INDEX "activity_timeline_createdAt_idx" ON "activity_timeline"("createdAt");

-- CreateIndex
CREATE INDEX "ai_jobs_status_idx" ON "ai_jobs"("status");

-- CreateIndex
CREATE INDEX "ai_jobs_jobType_idx" ON "ai_jobs"("jobType");

-- CreateIndex
CREATE INDEX "ai_jobs_documentId_idx" ON "ai_jobs"("documentId");

-- CreateIndex
CREATE INDEX "attendance_records_employeeId_idx" ON "attendance_records"("employeeId");

-- CreateIndex
CREATE INDEX "attendance_records_date_idx" ON "attendance_records"("date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employeeId_date_key" ON "attendance_records"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_documentRequirementId_fkey" FOREIGN KEY ("documentRequirementId") REFERENCES "document_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_timeline" ADD CONSTRAINT "activity_timeline_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_timeline" ADD CONSTRAINT "activity_timeline_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_timeline" ADD CONSTRAINT "activity_timeline_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "client_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- === 20260508184847_week3_admin_core ===
-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'BRANCH_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'BRANCH_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'BRANCH_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'SERVICE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SERVICE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'COUNTRY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'COUNTRY_UPDATED';

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isoCode" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "userId" TEXT,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "referralCode" TEXT NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- CreateIndex
CREATE UNIQUE INDEX "services_code_key" ON "services"("code");

-- CreateIndex
CREATE INDEX "services_isActive_sortOrder_idx" ON "services"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "countries_name_key" ON "countries"("name");

-- CreateIndex
CREATE UNIQUE INDEX "countries_code_key" ON "countries"("code");

-- CreateIndex
CREATE UNIQUE INDEX "countries_isoCode_key" ON "countries"("isoCode");

-- CreateIndex
CREATE INDEX "countries_isActive_sortOrder_idx" ON "countries"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "partners_userId_key" ON "partners"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "partners_referralCode_key" ON "partners"("referralCode");

-- CreateIndex
CREATE INDEX "partners_organizationId_idx" ON "partners"("organizationId");

-- CreateIndex
CREATE INDEX "partners_branchId_idx" ON "partners"("branchId");

-- CreateIndex
CREATE INDEX "partners_status_idx" ON "partners"("status");

-- CreateIndex
CREATE INDEX "partners_email_idx" ON "partners"("email");

-- CreateIndex
CREATE INDEX "partners_phone_idx" ON "partners"("phone");

-- CreateIndex
CREATE INDEX "leads_referralPartnerId_idx" ON "leads"("referralPartnerId");

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_referralPartnerId_fkey" FOREIGN KEY ("referralPartnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- === 20260508194047_workflow_phase1 ===
-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_clientId_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_clientId_fkey";

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "leadId" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "leadId" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "appointments_leadId_idx" ON "appointments"("leadId");

-- CreateIndex
CREATE INDEX "invoices_leadId_idx" ON "invoices"("leadId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- === 20260508212753_sales_followups_handover ===
-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FollowUpPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "FinanceHandoverStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'PAYMENT_RECORDED', 'PAYMENT_VERIFIED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'FOLLOW_UP_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'FOLLOW_UP_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'FOLLOW_UP_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'FINANCE_HANDOVER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'FINANCE_HANDOVER_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'FINANCE_HANDOVER_REVIEWED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TimelineEventType" ADD VALUE 'FOLLOW_UP_CREATED';
ALTER TYPE "TimelineEventType" ADD VALUE 'FOLLOW_UP_COMPLETED';
ALTER TYPE "TimelineEventType" ADD VALUE 'FINANCE_HANDOVER_SUBMITTED';
ALTER TYPE "TimelineEventType" ADD VALUE 'FINANCE_HANDOVER_REVIEWED';

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assignedEmployeeId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "completedByUserId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "contactMethod" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "FollowUpPriority" NOT NULL DEFAULT 'MEDIUM',
    "outcomeNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_handovers" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "status" "FinanceHandoverStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "paymentMethod" TEXT,
    "transactionRef" TEXT,
    "notes" TEXT,
    "financeNotes" TEXT,
    "receiptKey" TEXT NOT NULL,
    "receiptFileName" TEXT NOT NULL,
    "receiptMimeType" TEXT,
    "receiptSizeBytes" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follow_ups_leadId_idx" ON "follow_ups"("leadId");

-- CreateIndex
CREATE INDEX "follow_ups_assignedEmployeeId_idx" ON "follow_ups"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "follow_ups_status_idx" ON "follow_ups"("status");

-- CreateIndex
CREATE INDEX "follow_ups_dueAt_idx" ON "follow_ups"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "finance_handovers_paymentId_key" ON "finance_handovers"("paymentId");

-- CreateIndex
CREATE INDEX "finance_handovers_leadId_idx" ON "finance_handovers"("leadId");

-- CreateIndex
CREATE INDEX "finance_handovers_invoiceId_idx" ON "finance_handovers"("invoiceId");

-- CreateIndex
CREATE INDEX "finance_handovers_status_idx" ON "finance_handovers"("status");

-- CreateIndex
CREATE INDEX "finance_handovers_createdByUserId_idx" ON "finance_handovers"("createdByUserId");

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_handovers" ADD CONSTRAINT "finance_handovers_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_handovers" ADD CONSTRAINT "finance_handovers_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_handovers" ADD CONSTRAINT "finance_handovers_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- === 20260511063147_processing_module_phase1a ===
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

-- === Baseline _prisma_migrations ===
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id"                      VARCHAR(36)  NOT NULL PRIMARY KEY,
  "checksum"                VARCHAR(64)  NOT NULL,
  "finished_at"             TIMESTAMPTZ,
  "migration_name"          VARCHAR(255) NOT NULL,
  "logs"                    TEXT,
  "rolled_back_at"          TIMESTAMPTZ,
  "started_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count"     INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count") VALUES
  ('aaaaaaaa-0001-0001-0001-aaaaaaaaaaaa','baseline',now(),'20260508181144_init',NULL,NULL,now(),1),
  ('aaaaaaaa-0002-0002-0002-aaaaaaaaaaaa','baseline',now(),'20260508184847_week3_admin_core',NULL,NULL,now(),1),
  ('aaaaaaaa-0003-0003-0003-aaaaaaaaaaaa','baseline',now(),'20260508194047_workflow_phase1',NULL,NULL,now(),1),
  ('aaaaaaaa-0004-0004-0004-aaaaaaaaaaaa','baseline',now(),'20260508212753_sales_followups_handover',NULL,NULL,now(),1),
  ('aaaaaaaa-0005-0005-0005-aaaaaaaaaaaa','baseline',now(),'20260511063147_processing_module_phase1a',NULL,NULL,now(),1)
ON CONFLICT ("id") DO NOTHING;

SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at;

