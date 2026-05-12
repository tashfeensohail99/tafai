-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ai";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "client_portal";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "core";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "crm";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "finance";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "processing";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "sales";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "whatsapp";

-- CreateEnum
CREATE TYPE "core"."UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "core"."Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "crm"."LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'FOLLOW_UP', 'CONVERTED', 'LOST', 'DUPLICATE', 'UNQUALIFIED');

-- CreateEnum
CREATE TYPE "crm"."FollowUpStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "crm"."FollowUpPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "crm"."ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'COMPLETED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "processing"."CaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DOCUMENTATION', 'PROCESSING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'COMPLETED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "processing"."DocumentStatus" AS ENUM ('PENDING', 'UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED', 'REPLACEMENT_REQUIRED');

-- CreateEnum
CREATE TYPE "crm"."AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "finance"."PaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'REFUNDED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "finance"."InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "finance"."FinanceHandoverStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'PAYMENT_RECORDED', 'PAYMENT_VERIFIED', 'REJECTED', 'CANCELLED', 'SENT_TO_PROCESSING');

-- CreateEnum
CREATE TYPE "audit"."AuditAction" AS ENUM ('USER_LOGIN', 'USER_LOGOUT', 'USER_LOGIN_FAILED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'USER_REACTIVATED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'PERMISSION_CHANGED', 'USER_ROLE_ASSIGNED', 'USER_ROLE_REMOVED', 'DEPARTMENT_CREATED', 'DEPARTMENT_UPDATED', 'DEPARTMENT_DELETED', 'BRANCH_CREATED', 'BRANCH_UPDATED', 'BRANCH_DELETED', 'LEAD_CREATED', 'LEAD_UPDATED', 'LEAD_ASSIGNED', 'LEAD_REASSIGNED', 'LEAD_CONVERTED', 'LEAD_LOST', 'LEAD_DUPLICATE_MARKED', 'FOLLOW_UP_CREATED', 'FOLLOW_UP_UPDATED', 'FOLLOW_UP_COMPLETED', 'FINANCE_HANDOVER_CREATED', 'FINANCE_HANDOVER_UPDATED', 'FINANCE_HANDOVER_REVIEWED', 'CLIENT_CREATED', 'CLIENT_UPDATED', 'CASE_CREATED', 'CASE_UPDATED', 'CASE_STATUS_CHANGED', 'CASE_HANDOVER', 'DOCUMENT_UPLOADED', 'DOCUMENT_VIEWED', 'DOCUMENT_REVIEWED', 'DOCUMENT_VERIFIED', 'DOCUMENT_REJECTED', 'DOCUMENT_REPLACED', 'INVOICE_CREATED', 'INVOICE_UPDATED', 'PAYMENT_RECORDED', 'PAYMENT_VERIFIED', 'PAYMENT_REFUNDED', 'APPOINTMENT_CREATED', 'APPOINTMENT_UPDATED', 'APPOINTMENT_CANCELLED', 'WHATSAPP_MESSAGE_SENT', 'EMAIL_SENT', 'PARTNER_CREATED', 'PARTNER_UPDATED', 'PARTNER_DELETED', 'SERVICE_CREATED', 'SERVICE_UPDATED', 'COUNTRY_CREATED', 'COUNTRY_UPDATED', 'AI_JOB_SUBMITTED', 'AI_OUTPUT_REVIEWED', 'SETTING_CHANGED', 'DEVICE_ACCESS_CHANGED', 'ATTENDANCE_OVERRIDDEN', 'REPORT_EXPORTED', 'PROCESSING_CASE_CREATED', 'PROCESSING_CASE_ASSIGNED', 'PROCESSING_STAGE_CHANGED', 'PROCESSING_DOCUMENT_REVIEWED', 'PROCESSING_DOCUMENT_WAIVED', 'PROCESSING_NOTE_ADDED', 'PROCESSING_TASK_CREATED', 'PROCESSING_CASE_COMPLETED', 'PROCESSING_CASE_CANCELLED');

-- CreateEnum
CREATE TYPE "crm"."TimelineEventType" AS ENUM ('LEAD_CREATED', 'LEAD_CONTACTED', 'LEAD_QUALIFIED', 'LEAD_ASSIGNED', 'LEAD_CONVERTED', 'FOLLOW_UP_CREATED', 'FOLLOW_UP_COMPLETED', 'CLIENT_PROFILE_UPDATED', 'CASE_OPENED', 'CASE_STATUS_CHANGED', 'CASE_HANDOVER', 'DOCUMENT_UPLOADED', 'DOCUMENT_VERIFIED', 'DOCUMENT_REJECTED', 'APPOINTMENT_SCHEDULED', 'APPOINTMENT_COMPLETED', 'PAYMENT_RECEIVED', 'FINANCE_HANDOVER_SUBMITTED', 'FINANCE_HANDOVER_REVIEWED', 'MESSAGE_SENT', 'NOTE_ADDED', 'AI_DOCUMENT_PROCESSED', 'PROCESSING_CASE_CREATED', 'PROCESSING_STAGE_CHANGED', 'PROCESSING_DOCUMENT_SUBMITTED', 'PROCESSING_DOCUMENT_ACCEPTED', 'PROCESSING_DOCUMENT_REJECTED', 'PROCESSING_MESSAGE_SENT', 'PROCESSING_SUBMISSION_FILED', 'PROCESSING_DECISION_RECEIVED', 'PROCESSING_CASE_COMPLETED', 'WHATSAPP_MESSAGE_RECEIVED', 'WHATSAPP_MESSAGE_SENT', 'WHATSAPP_LEAD_CREATED', 'WHATSAPP_ASSIGNED', 'WHATSAPP_CONVERSATION_RESOLVED', 'WHATSAPP_OPTED_OUT');

-- CreateEnum
CREATE TYPE "core"."PresenceStatus" AS ENUM ('ONLINE', 'AWAY', 'OFFLINE');

-- CreateEnum
CREATE TYPE "ai"."AiJobType" AS ENUM ('OCR', 'DOCUMENT_CLASSIFICATION', 'DOCUMENT_EXPIRY_DETECTION', 'TRANSCRIPTION', 'CALL_SUMMARY', 'INTERVIEW_SUMMARY', 'SUGGESTED_REPLY', 'BUSINESS_PLAN_DRAFT');

-- CreateEnum
CREATE TYPE "ai"."AiJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVIEW_PENDING', 'REVIEWED');

-- CreateEnum
CREATE TYPE "core"."AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "core"."PartnerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "processing"."ProcessingCaseStage" AS ENUM ('INTAKE_PENDING', 'DOCUMENTS_COLLECTION', 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_INCOMPLETE', 'DOCUMENTS_COMPLETE', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'UNDER_AUTHORITY_REVIEW', 'ADDITIONAL_INFO_REQUESTED', 'DECISION_RECEIVED', 'APPROVED', 'REJECTED', 'APPEAL_IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "processing"."ProcessingCasePriority" AS ENUM ('LOW', 'NORMAL', 'URGENT', 'CRITICAL');

-- CreateEnum
CREATE TYPE "processing"."ProcessingSlaStatus" AS ENUM ('ACTIVE', 'APPROACHING', 'BREACHED', 'EXTENDED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "processing"."AuthorityDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "processing"."DocumentCriticality" AS ENUM ('CRITICAL', 'REQUIRED', 'CONDITIONAL', 'SUPPORTING', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "processing"."DocumentItemStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'EXPIRING_SOON', 'WAIVED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "processing"."DocumentValidityRule" AS ENUM ('NONE', 'MUST_NOT_EXPIRE', 'MUST_BE_VALID_FOR_N_MONTHS');

-- CreateEnum
CREATE TYPE "processing"."VirusScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED');

-- CreateEnum
CREATE TYPE "processing"."DocReviewDecisionType" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "processing"."DocAccessType" AS ENUM ('VIEW', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "processing"."CorrectionType" AS ENUM ('DOCUMENT', 'INFORMATION');

-- CreateEnum
CREATE TYPE "processing"."CorrectionRequiredAction" AS ENUM ('REUPLOAD', 'CONFIRM', 'CORRECT', 'CALL_BACK');

-- CreateEnum
CREATE TYPE "processing"."CorrectionStatus" AS ENUM ('SENT', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "processing"."CommunicationDirection" AS ENUM ('OFFICER_TO_CLIENT', 'CLIENT_TO_OFFICER', 'SYSTEM_TO_CLIENT');

-- CreateEnum
CREATE TYPE "processing"."CommunicationMessageType" AS ENUM ('WELCOME', 'DOCS_REQUEST', 'DOCS_REJECTED_NOTICE', 'GENERAL_UPDATE', 'STAGE_UPDATE', 'INFORMATION_REQUEST', 'SUBMISSION_NOTICE', 'DECISION_NOTICE', 'APPOINTMENT_REQUEST', 'REMINDER');

-- CreateEnum
CREATE TYPE "processing"."ProcessingNoteType" AS ENUM ('GENERAL', 'ESCALATION', 'STRATEGY', 'CLIENT_INSIGHT', 'AUTHORITY_NOTE', 'MANAGER_ONLY');

-- CreateEnum
CREATE TYPE "processing"."ProcessingTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "processing"."ProcessingTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "processing"."AuthoritySubmissionStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'RESPONDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "processing"."AuthorityResponseType" AS ENUM ('APPROVAL', 'REJECTION', 'INFO_REQUEST', 'BIOMETRICS_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "crm"."ReminderType" AS ENUM ('WELCOME', 'DOCS_REQUEST', 'DOCS_DEADLINE_7D', 'DOCS_DEADLINE_1D', 'DOCS_OVERDUE', 'DOC_REJECTED', 'EXPIRY_30D', 'EXPIRY_7D', 'STAGE_UPDATE', 'SUBMISSION_CONFIRMED', 'DECISION_RECEIVED');

-- CreateEnum
CREATE TYPE "crm"."ReminderChannel" AS ENUM ('PORTAL', 'WHATSAPP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "crm"."ReminderDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppChannelTier" AS ENUM ('TIER_1K', 'TIER_10K', 'TIER_100K', 'TIER_UNLIMITED');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppChannelStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppMessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'LOCATION', 'CONTACTS', 'INTERACTIVE', 'TEMPLATE', 'REACTION', 'SYSTEM', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppThreadStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppAssignmentReason" AS ENUM ('STICKY', 'ROUND_ROBIN', 'MANUAL', 'REASSIGN', 'TAKEOVER', 'UNASSIGN', 'AUTO_RESOLVE');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppTemplateCategory" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppTemplateStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'PAUSED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "core"."organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "hoursOpen" TEXT NOT NULL DEFAULT '09:00',
    "hoursClose" TEXT NOT NULL DEFAULT '18:00',
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "slaFirstResponseSeconds" INTEGER NOT NULL DEFAULT 60,
    "rrCursorEmployeeId" TEXT,
    "afterHoursTemplate" TEXT,
    "afterHoursTemplateLang" TEXT DEFAULT 'en',

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."branches" (
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
CREATE TABLE "core"."services" (
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
CREATE TABLE "core"."countries" (
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
CREATE TABLE "core"."departments" (
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
CREATE TABLE "core"."designations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."roles" (
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
CREATE TABLE "core"."permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."user_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "core"."UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
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
CREATE TABLE "core"."user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."login_sessions" (
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
CREATE TABLE "core"."password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."employees" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,
    "branchId" TEXT,
    "designationId" TEXT,
    "employeeCode" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "gender" "core"."Gender",
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
    "whatsappInboxMember" BOOLEAN NOT NULL DEFAULT false,
    "presenceStatus" "core"."PresenceStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastActivityAt" TIMESTAMP(3),
    "presenceChangedAt" TIMESTAMP(3),
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."partners" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "userId" TEXT,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "referralCode" TEXT NOT NULL,
    "status" "core"."PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm"."leads" (
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
    "status" "crm"."LeadStatus" NOT NULL DEFAULT 'NEW',
    "priority" TEXT,
    "notes" TEXT,
    "lostReason" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "preferredEmployeeId" TEXT,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm"."follow_ups" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assignedEmployeeId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "completedByUserId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "contactMethod" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "crm"."FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "crm"."FollowUpPriority" NOT NULL DEFAULT 'MEDIUM',
    "outcomeNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm"."clients" (
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
    "gender" "core"."Gender",
    "passportNumber" TEXT,
    "passportExpiry" TIMESTAMP(3),
    "nationalId" TEXT,
    "address" TEXT,
    "status" "crm"."ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "portalAccessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."cases" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "departmentId" TEXT,
    "assignedEmployeeId" TEXT,
    "caseNumber" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "targetCountry" TEXT NOT NULL,
    "status" "processing"."CaseStatus" NOT NULL DEFAULT 'OPEN',
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
CREATE TABLE "processing"."document_requirements" (
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
CREATE TABLE "processing"."client_documents" (
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
    "status" "processing"."DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "expiryDate" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isConfidential" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm"."appointments" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "caseId" TEXT,
    "assignedEmployeeId" TEXT,
    "createdByUserId" TEXT,
    "title" TEXT NOT NULL,
    "appointmentType" TEXT NOT NULL,
    "status" "crm"."AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
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
CREATE TABLE "finance"."invoices" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "caseId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "status" "finance"."InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
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
CREATE TABLE "finance"."payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "status" "finance"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "finance"."finance_handovers" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "status" "finance"."FinanceHandoverStatus" NOT NULL DEFAULT 'SUBMITTED',
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

-- CreateTable
CREATE TABLE "audit"."audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "audit"."AuditAction" NOT NULL,
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
CREATE TABLE "crm"."activity_timeline" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "caseId" TEXT,
    "eventType" "crm"."TimelineEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "actorUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_jobs" (
    "id" TEXT NOT NULL,
    "jobType" "ai"."AiJobType" NOT NULL,
    "status" "ai"."AiJobStatus" NOT NULL DEFAULT 'QUEUED',
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
CREATE TABLE "core"."attendance_records" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "status" "core"."AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "notes" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overriddenByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."document_requirement_templates" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "targetCountry" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "criticality" "processing"."DocumentCriticality" NOT NULL DEFAULT 'REQUIRED',
    "conditionRule" JSONB,
    "expectedFormats" TEXT[] DEFAULT ARRAY['PDF']::TEXT[],
    "maxFileSizeMb" INTEGER NOT NULL DEFAULT 10,
    "validityRule" "processing"."DocumentValidityRule" NOT NULL DEFAULT 'NONE',
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
CREATE TABLE "processing"."processing_cases" (
    "id" TEXT NOT NULL,
    "financeHandoverId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "clientId" TEXT,
    "branchId" TEXT,
    "assignedOfficerId" TEXT,
    "priority" "processing"."ProcessingCasePriority" NOT NULL DEFAULT 'NORMAL',
    "stage" "processing"."ProcessingCaseStage" NOT NULL DEFAULT 'INTAKE_PENDING',
    "slaStatus" "processing"."ProcessingSlaStatus" NOT NULL DEFAULT 'ACTIVE',
    "slaDueAt" TIMESTAMP(3),
    "service" TEXT NOT NULL,
    "targetCountry" TEXT NOT NULL,
    "financeHandoverNote" TEXT,
    "processingNote" TEXT,
    "estimatedSubmissionDate" DATE,
    "actualSubmissionDate" DATE,
    "authorityTrackingRef" TEXT,
    "authorityDecision" "processing"."AuthorityDecision" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "processing"."processing_case_stage_history" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromStage" "processing"."ProcessingCaseStage",
    "toStage" "processing"."ProcessingCaseStage" NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "gateCheckResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_case_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."case_document_items" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "templateId" TEXT,
    "documentName" TEXT NOT NULL,
    "description" TEXT,
    "criticality" "processing"."DocumentCriticality" NOT NULL DEFAULT 'REQUIRED',
    "expectedFormats" TEXT[] DEFAULT ARRAY['PDF']::TEXT[],
    "maxFileSizeMb" INTEGER NOT NULL DEFAULT 10,
    "validityRule" "processing"."DocumentValidityRule" NOT NULL DEFAULT 'NONE',
    "validityMonths" INTEGER,
    "validityBufferDays" INTEGER NOT NULL DEFAULT 30,
    "status" "processing"."DocumentItemStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
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
CREATE TABLE "processing"."client_document_versions" (
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
    "virusScanStatus" "processing"."VirusScanStatus" NOT NULL DEFAULT 'PENDING',
    "virusScanAt" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "client_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."document_review_decisions" (
    "id" TEXT NOT NULL,
    "documentItemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "decision" "processing"."DocReviewDecisionType" NOT NULL,
    "rejectionReasonCodes" TEXT[],
    "rejectionNote" TEXT,
    "reviewedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."document_access_logs" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "accessedByUserId" TEXT NOT NULL,
    "accessType" "processing"."DocAccessType" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signedUrlIssuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."correction_requests" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentItemId" TEXT,
    "raisedByOfficerId" TEXT NOT NULL,
    "correctionType" "processing"."CorrectionType" NOT NULL,
    "subject" TEXT NOT NULL,
    "reasonCodes" TEXT[],
    "officerNote" TEXT,
    "clientMessage" TEXT NOT NULL,
    "requiredAction" "processing"."CorrectionRequiredAction" NOT NULL,
    "slaHours" INTEGER NOT NULL DEFAULT 120,
    "slaDueAt" TIMESTAMP(3),
    "status" "processing"."CorrectionStatus" NOT NULL DEFAULT 'SENT',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."case_communications" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "direction" "processing"."CommunicationDirection" NOT NULL,
    "messageType" "processing"."CommunicationMessageType" NOT NULL,
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
CREATE TABLE "crm"."client_reminders" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "clientId" TEXT,
    "reminderType" "crm"."ReminderType" NOT NULL,
    "channel" "crm"."ReminderChannel" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveryStatus" "crm"."ReminderDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "templateId" TEXT,
    "renderedContent" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."processing_notes" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "noteType" "processing"."ProcessingNoteType" NOT NULL DEFAULT 'GENERAL',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "mentions" TEXT[],
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."processing_tasks" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "assignedToUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "dueDate" DATE,
    "priority" "processing"."ProcessingTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "processing"."ProcessingTaskStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."authority_submissions" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "submissionNumber" INTEGER NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "submissionDate" DATE NOT NULL,
    "submissionReference" TEXT,
    "authority" TEXT NOT NULL,
    "documentsIncluded" TEXT[],
    "trackingNumber" TEXT,
    "status" "processing"."AuthoritySubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "responseReceivedAt" TIMESTAMP(3),
    "responseType" "processing"."AuthorityResponseType",
    "responseNotes" TEXT,
    "nextAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authority_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing"."processing_audit_logs" (
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

-- CreateTable
CREATE TABLE "whatsapp"."channels" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayNumber" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "webhookVerifyToken" TEXT,
    "tier" "whatsapp"."WhatsAppChannelTier" NOT NULL DEFAULT 'TIER_1K',
    "status" "whatsapp"."WhatsAppChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."threads" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "waContactId" TEXT NOT NULL,
    "windowExpiresAt" TIMESTAMP(3),
    "status" "whatsapp"."WhatsAppThreadStatus" NOT NULL DEFAULT 'OPEN',
    "firstInboundAt" TIMESTAMP(3),
    "firstAgentReplyAt" TIMESTAMP(3),
    "slaDeadlineAt" TIMESTAMP(3),
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastAssignmentReason" "whatsapp"."WhatsAppAssignmentReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "waMessageId" TEXT,
    "idempotencyKey" TEXT,
    "direction" "whatsapp"."WhatsAppMessageDirection" NOT NULL,
    "type" "whatsapp"."WhatsAppMessageType" NOT NULL,
    "status" "whatsapp"."WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "body" TEXT,
    "payload" JSONB,
    "mediaUrl" TEXT,
    "mediaMimeType" TEXT,
    "mediaSizeBytes" INTEGER,
    "mediaSha256" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT,
    "sentByEmployeeId" TEXT,
    "campaignId" TEXT,
    "pricingCategory" TEXT,
    "errorCode" TEXT,
    "errorTitle" TEXT,
    "errorDetails" JSONB,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "repliedToWaMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."templates" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" "whatsapp"."WhatsAppTemplateCategory" NOT NULL,
    "status" "whatsapp"."WhatsAppTemplateStatus" NOT NULL,
    "components" JSONB NOT NULL,
    "qualityRating" TEXT,
    "rejectedReason" TEXT,
    "lastSyncAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."campaigns" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "variableMap" JSONB NOT NULL DEFAULT '{}',
    "scheduledFor" TIMESTAMP(3),
    "status" "whatsapp"."WhatsAppCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAudience" INTEGER NOT NULL DEFAULT 0,
    "totalQueued" INTEGER NOT NULL DEFAULT 0,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalDelivered" INTEGER NOT NULL DEFAULT 0,
    "totalRead" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."opt_outs" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."webhook_events" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "objectType" TEXT,
    "rawPayload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_organizationId_idx" ON "core"."branches"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "core"."services"("name");

-- CreateIndex
CREATE UNIQUE INDEX "services_code_key" ON "core"."services"("code");

-- CreateIndex
CREATE INDEX "services_isActive_sortOrder_idx" ON "core"."services"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "countries_name_key" ON "core"."countries"("name");

-- CreateIndex
CREATE UNIQUE INDEX "countries_code_key" ON "core"."countries"("code");

-- CreateIndex
CREATE UNIQUE INDEX "countries_isoCode_key" ON "core"."countries"("isoCode");

-- CreateIndex
CREATE INDEX "countries_isActive_sortOrder_idx" ON "core"."countries"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "departments_organizationId_idx" ON "core"."departments"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "core"."roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "core"."permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "core"."permissions"("module");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "core"."role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_email_key" ON "core"."user_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_phone_key" ON "core"."user_accounts"("phone");

-- CreateIndex
CREATE INDEX "user_accounts_email_idx" ON "core"."user_accounts"("email");

-- CreateIndex
CREATE INDEX "user_accounts_phone_idx" ON "core"."user_accounts"("phone");

-- CreateIndex
CREATE INDEX "user_accounts_status_idx" ON "core"."user_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "core"."user_roles"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "login_sessions_refreshToken_key" ON "core"."login_sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "login_sessions_userId_idx" ON "core"."login_sessions"("userId");

-- CreateIndex
CREATE INDEX "login_sessions_refreshToken_idx" ON "core"."login_sessions"("refreshToken");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "core"."password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_idx" ON "core"."password_reset_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key" ON "core"."employees"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeCode_key" ON "core"."employees"("employeeCode");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "core"."employees"("departmentId");

-- CreateIndex
CREATE INDEX "employees_branchId_idx" ON "core"."employees"("branchId");

-- CreateIndex
CREATE INDEX "employees_whatsappInboxMember_presenceStatus_idx" ON "core"."employees"("whatsappInboxMember", "presenceStatus");

-- CreateIndex
CREATE UNIQUE INDEX "partners_userId_key" ON "core"."partners"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "partners_referralCode_key" ON "core"."partners"("referralCode");

-- CreateIndex
CREATE INDEX "partners_organizationId_idx" ON "core"."partners"("organizationId");

-- CreateIndex
CREATE INDEX "partners_branchId_idx" ON "core"."partners"("branchId");

-- CreateIndex
CREATE INDEX "partners_status_idx" ON "core"."partners"("status");

-- CreateIndex
CREATE INDEX "partners_email_idx" ON "core"."partners"("email");

-- CreateIndex
CREATE INDEX "partners_phone_idx" ON "core"."partners"("phone");

-- CreateIndex
CREATE INDEX "leads_phone_idx" ON "crm"."leads"("phone");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "crm"."leads"("email");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "crm"."leads"("status");

-- CreateIndex
CREATE INDEX "leads_assignedEmployeeId_idx" ON "crm"."leads"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "leads_branchId_idx" ON "crm"."leads"("branchId");

-- CreateIndex
CREATE INDEX "leads_referralPartnerId_idx" ON "crm"."leads"("referralPartnerId");

-- CreateIndex
CREATE INDEX "leads_preferredEmployeeId_idx" ON "crm"."leads"("preferredEmployeeId");

-- CreateIndex
CREATE INDEX "follow_ups_leadId_idx" ON "crm"."follow_ups"("leadId");

-- CreateIndex
CREATE INDEX "follow_ups_assignedEmployeeId_idx" ON "crm"."follow_ups"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "follow_ups_status_idx" ON "crm"."follow_ups"("status");

-- CreateIndex
CREATE INDEX "follow_ups_dueAt_idx" ON "crm"."follow_ups"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "clients_email_key" ON "crm"."clients"("email");

-- CreateIndex
CREATE UNIQUE INDEX "clients_phone_key" ON "crm"."clients"("phone");

-- CreateIndex
CREATE INDEX "clients_phone_idx" ON "crm"."clients"("phone");

-- CreateIndex
CREATE INDEX "clients_email_idx" ON "crm"."clients"("email");

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "crm"."clients"("status");

-- CreateIndex
CREATE INDEX "clients_branchId_idx" ON "crm"."clients"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "cases_caseNumber_key" ON "processing"."cases"("caseNumber");

-- CreateIndex
CREATE INDEX "cases_clientId_idx" ON "processing"."cases"("clientId");

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "processing"."cases"("status");

-- CreateIndex
CREATE INDEX "cases_assignedEmployeeId_idx" ON "processing"."cases"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "cases_departmentId_idx" ON "processing"."cases"("departmentId");

-- CreateIndex
CREATE INDEX "document_requirements_serviceType_idx" ON "processing"."document_requirements"("serviceType");

-- CreateIndex
CREATE INDEX "client_documents_clientId_idx" ON "processing"."client_documents"("clientId");

-- CreateIndex
CREATE INDEX "client_documents_caseId_idx" ON "processing"."client_documents"("caseId");

-- CreateIndex
CREATE INDEX "client_documents_status_idx" ON "processing"."client_documents"("status");

-- CreateIndex
CREATE INDEX "appointments_leadId_idx" ON "crm"."appointments"("leadId");

-- CreateIndex
CREATE INDEX "appointments_clientId_idx" ON "crm"."appointments"("clientId");

-- CreateIndex
CREATE INDEX "appointments_caseId_idx" ON "crm"."appointments"("caseId");

-- CreateIndex
CREATE INDEX "appointments_scheduledAt_idx" ON "crm"."appointments"("scheduledAt");

-- CreateIndex
CREATE INDEX "appointments_status_idx" ON "crm"."appointments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "finance"."invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_leadId_idx" ON "finance"."invoices"("leadId");

-- CreateIndex
CREATE INDEX "invoices_clientId_idx" ON "finance"."invoices"("clientId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "finance"."invoices"("status");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "finance"."payments"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "finance"."payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "finance_handovers_paymentId_key" ON "finance"."finance_handovers"("paymentId");

-- CreateIndex
CREATE INDEX "finance_handovers_leadId_idx" ON "finance"."finance_handovers"("leadId");

-- CreateIndex
CREATE INDEX "finance_handovers_invoiceId_idx" ON "finance"."finance_handovers"("invoiceId");

-- CreateIndex
CREATE INDEX "finance_handovers_status_idx" ON "finance"."finance_handovers"("status");

-- CreateIndex
CREATE INDEX "finance_handovers_createdByUserId_idx" ON "finance"."finance_handovers"("createdByUserId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit"."audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit"."audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit"."audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit"."audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "activity_timeline_entityType_entityId_idx" ON "crm"."activity_timeline"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activity_timeline_leadId_idx" ON "crm"."activity_timeline"("leadId");

-- CreateIndex
CREATE INDEX "activity_timeline_clientId_idx" ON "crm"."activity_timeline"("clientId");

-- CreateIndex
CREATE INDEX "activity_timeline_caseId_idx" ON "crm"."activity_timeline"("caseId");

-- CreateIndex
CREATE INDEX "activity_timeline_createdAt_idx" ON "crm"."activity_timeline"("createdAt");

-- CreateIndex
CREATE INDEX "ai_jobs_status_idx" ON "ai"."ai_jobs"("status");

-- CreateIndex
CREATE INDEX "ai_jobs_jobType_idx" ON "ai"."ai_jobs"("jobType");

-- CreateIndex
CREATE INDEX "ai_jobs_documentId_idx" ON "ai"."ai_jobs"("documentId");

-- CreateIndex
CREATE INDEX "attendance_records_employeeId_idx" ON "core"."attendance_records"("employeeId");

-- CreateIndex
CREATE INDEX "attendance_records_date_idx" ON "core"."attendance_records"("date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employeeId_date_key" ON "core"."attendance_records"("employeeId", "date");

-- CreateIndex
CREATE INDEX "document_requirement_templates_service_targetCountry_idx" ON "processing"."document_requirement_templates"("service", "targetCountry");

-- CreateIndex
CREATE INDEX "document_requirement_templates_isActive_idx" ON "processing"."document_requirement_templates"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "processing_cases_financeHandoverId_key" ON "processing"."processing_cases"("financeHandoverId");

-- CreateIndex
CREATE INDEX "processing_cases_assignedOfficerId_idx" ON "processing"."processing_cases"("assignedOfficerId");

-- CreateIndex
CREATE INDEX "processing_cases_stage_idx" ON "processing"."processing_cases"("stage");

-- CreateIndex
CREATE INDEX "processing_cases_clientId_idx" ON "processing"."processing_cases"("clientId");

-- CreateIndex
CREATE INDEX "processing_cases_leadId_idx" ON "processing"."processing_cases"("leadId");

-- CreateIndex
CREATE INDEX "processing_cases_priority_stage_idx" ON "processing"."processing_cases"("priority", "stage");

-- CreateIndex
CREATE INDEX "processing_case_stage_history_caseId_idx" ON "processing"."processing_case_stage_history"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "case_document_items_latestVersionId_key" ON "processing"."case_document_items"("latestVersionId");

-- CreateIndex
CREATE INDEX "case_document_items_caseId_idx" ON "processing"."case_document_items"("caseId");

-- CreateIndex
CREATE INDEX "case_document_items_status_caseId_idx" ON "processing"."case_document_items"("status", "caseId");

-- CreateIndex
CREATE INDEX "case_document_items_validityExpiryDate_idx" ON "processing"."case_document_items"("validityExpiryDate");

-- CreateIndex
CREATE INDEX "client_document_versions_documentItemId_idx" ON "processing"."client_document_versions"("documentItemId");

-- CreateIndex
CREATE INDEX "client_document_versions_caseId_idx" ON "processing"."client_document_versions"("caseId");

-- CreateIndex
CREATE INDEX "document_review_decisions_documentItemId_idx" ON "processing"."document_review_decisions"("documentItemId");

-- CreateIndex
CREATE INDEX "document_access_logs_documentVersionId_idx" ON "processing"."document_access_logs"("documentVersionId");

-- CreateIndex
CREATE INDEX "document_access_logs_accessedByUserId_idx" ON "processing"."document_access_logs"("accessedByUserId");

-- CreateIndex
CREATE INDEX "correction_requests_caseId_idx" ON "processing"."correction_requests"("caseId");

-- CreateIndex
CREATE INDEX "correction_requests_status_idx" ON "processing"."correction_requests"("status");

-- CreateIndex
CREATE INDEX "case_communications_caseId_createdAt_idx" ON "processing"."case_communications"("caseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "client_reminders_caseId_idx" ON "crm"."client_reminders"("caseId");

-- CreateIndex
CREATE INDEX "client_reminders_scheduledAt_idx" ON "crm"."client_reminders"("scheduledAt");

-- CreateIndex
CREATE INDEX "processing_notes_caseId_idx" ON "processing"."processing_notes"("caseId");

-- CreateIndex
CREATE INDEX "processing_tasks_caseId_idx" ON "processing"."processing_tasks"("caseId");

-- CreateIndex
CREATE INDEX "processing_tasks_assignedToUserId_status_idx" ON "processing"."processing_tasks"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "authority_submissions_caseId_idx" ON "processing"."authority_submissions"("caseId");

-- CreateIndex
CREATE INDEX "processing_audit_logs_caseId_createdAt_idx" ON "processing"."processing_audit_logs"("caseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "processing_audit_logs_entityType_entityId_idx" ON "processing"."processing_audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "channels_phoneNumberId_key" ON "whatsapp"."channels"("phoneNumberId");

-- CreateIndex
CREATE INDEX "channels_status_idx" ON "whatsapp"."channels"("status");

-- CreateIndex
CREATE UNIQUE INDEX "threads_leadId_key" ON "whatsapp"."threads"("leadId");

-- CreateIndex
CREATE INDEX "threads_leadId_idx" ON "whatsapp"."threads"("leadId");

-- CreateIndex
CREATE INDEX "threads_clientId_idx" ON "whatsapp"."threads"("clientId");

-- CreateIndex
CREATE INDEX "threads_status_lastMessageAt_idx" ON "whatsapp"."threads"("status", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "threads_slaDeadlineAt_idx" ON "whatsapp"."threads"("slaDeadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "threads_channelId_waContactId_key" ON "whatsapp"."threads"("channelId", "waContactId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_waMessageId_key" ON "whatsapp"."messages"("waMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_idempotencyKey_key" ON "whatsapp"."messages"("idempotencyKey");

-- CreateIndex
CREATE INDEX "messages_threadId_createdAt_idx" ON "whatsapp"."messages"("threadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "messages_direction_status_idx" ON "whatsapp"."messages"("direction", "status");

-- CreateIndex
CREATE INDEX "messages_campaignId_idx" ON "whatsapp"."messages"("campaignId");

-- CreateIndex
CREATE INDEX "messages_createdAt_idx" ON "whatsapp"."messages"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "templates_status_idx" ON "whatsapp"."templates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "templates_channelId_name_language_key" ON "whatsapp"."templates"("channelId", "name", "language");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "whatsapp"."campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_scheduledFor_idx" ON "whatsapp"."campaigns"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "opt_outs_waId_key" ON "whatsapp"."opt_outs"("waId");

-- CreateIndex
CREATE INDEX "webhook_events_createdAt_idx" ON "whatsapp"."webhook_events"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "webhook_events_processedAt_idx" ON "whatsapp"."webhook_events"("processedAt");

-- AddForeignKey
ALTER TABLE "core"."branches" ADD CONSTRAINT "branches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."departments" ADD CONSTRAINT "departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "core"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "core"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "core"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."login_sessions" ADD CONSTRAINT "login_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "core"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "core"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "core"."designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."partners" ADD CONSTRAINT "partners_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "core"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."partners" ADD CONSTRAINT "partners_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "core"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."partners" ADD CONSTRAINT "partners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."leads" ADD CONSTRAINT "leads_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "core"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."leads" ADD CONSTRAINT "leads_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "core"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."leads" ADD CONSTRAINT "leads_preferredEmployeeId_fkey" FOREIGN KEY ("preferredEmployeeId") REFERENCES "core"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."leads" ADD CONSTRAINT "leads_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."leads" ADD CONSTRAINT "leads_referralPartnerId_fkey" FOREIGN KEY ("referralPartnerId") REFERENCES "core"."partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."follow_ups" ADD CONSTRAINT "follow_ups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."follow_ups" ADD CONSTRAINT "follow_ups_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "core"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."clients" ADD CONSTRAINT "clients_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "core"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."clients" ADD CONSTRAINT "clients_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."cases" ADD CONSTRAINT "cases_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."cases" ADD CONSTRAINT "cases_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "core"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."cases" ADD CONSTRAINT "cases_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "core"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."client_documents" ADD CONSTRAINT "client_documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."client_documents" ADD CONSTRAINT "client_documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."client_documents" ADD CONSTRAINT "client_documents_documentRequirementId_fkey" FOREIGN KEY ("documentRequirementId") REFERENCES "processing"."document_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."appointments" ADD CONSTRAINT "appointments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."appointments" ADD CONSTRAINT "appointments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."appointments" ADD CONSTRAINT "appointments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."invoices" ADD CONSTRAINT "invoices_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."invoices" ADD CONSTRAINT "invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "finance"."invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."finance_handovers" ADD CONSTRAINT "finance_handovers_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."finance_handovers" ADD CONSTRAINT "finance_handovers_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "finance"."invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."finance_handovers" ADD CONSTRAINT "finance_handovers_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "finance"."payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."activity_timeline" ADD CONSTRAINT "activity_timeline_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."activity_timeline" ADD CONSTRAINT "activity_timeline_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."activity_timeline" ADD CONSTRAINT "activity_timeline_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_jobs" ADD CONSTRAINT "ai_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "processing"."client_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."document_requirement_templates" ADD CONSTRAINT "document_requirement_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_cases" ADD CONSTRAINT "processing_cases_financeHandoverId_fkey" FOREIGN KEY ("financeHandoverId") REFERENCES "finance"."finance_handovers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_cases" ADD CONSTRAINT "processing_cases_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_cases" ADD CONSTRAINT "processing_cases_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_cases" ADD CONSTRAINT "processing_cases_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "core"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_cases" ADD CONSTRAINT "processing_cases_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_cases" ADD CONSTRAINT "processing_cases_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_cases" ADD CONSTRAINT "processing_cases_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_case_stage_history" ADD CONSTRAINT "processing_case_stage_history_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_case_stage_history" ADD CONSTRAINT "processing_case_stage_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."case_document_items" ADD CONSTRAINT "case_document_items_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."case_document_items" ADD CONSTRAINT "case_document_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "processing"."document_requirement_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."case_document_items" ADD CONSTRAINT "case_document_items_waivedByUserId_fkey" FOREIGN KEY ("waivedByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."case_document_items" ADD CONSTRAINT "case_document_items_latestVersionId_fkey" FOREIGN KEY ("latestVersionId") REFERENCES "processing"."client_document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."client_document_versions" ADD CONSTRAINT "client_document_versions_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "processing"."case_document_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."client_document_versions" ADD CONSTRAINT "client_document_versions_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."document_review_decisions" ADD CONSTRAINT "document_review_decisions_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "processing"."case_document_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."document_review_decisions" ADD CONSTRAINT "document_review_decisions_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "processing"."client_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."document_review_decisions" ADD CONSTRAINT "document_review_decisions_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."document_access_logs" ADD CONSTRAINT "document_access_logs_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "processing"."client_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."document_access_logs" ADD CONSTRAINT "document_access_logs_accessedByUserId_fkey" FOREIGN KEY ("accessedByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."correction_requests" ADD CONSTRAINT "correction_requests_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."correction_requests" ADD CONSTRAINT "correction_requests_documentItemId_fkey" FOREIGN KEY ("documentItemId") REFERENCES "processing"."case_document_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."correction_requests" ADD CONSTRAINT "correction_requests_raisedByOfficerId_fkey" FOREIGN KEY ("raisedByOfficerId") REFERENCES "core"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."correction_requests" ADD CONSTRAINT "correction_requests_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."case_communications" ADD CONSTRAINT "case_communications_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."case_communications" ADD CONSTRAINT "case_communications_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."client_reminders" ADD CONSTRAINT "client_reminders_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."client_reminders" ADD CONSTRAINT "client_reminders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_notes" ADD CONSTRAINT "processing_notes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_notes" ADD CONSTRAINT "processing_notes_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_tasks" ADD CONSTRAINT "processing_tasks_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_tasks" ADD CONSTRAINT "processing_tasks_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_tasks" ADD CONSTRAINT "processing_tasks_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_tasks" ADD CONSTRAINT "processing_tasks_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."authority_submissions" ADD CONSTRAINT "authority_submissions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."authority_submissions" ADD CONSTRAINT "authority_submissions_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_audit_logs" ADD CONSTRAINT "processing_audit_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."processing_audit_logs" ADD CONSTRAINT "processing_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."threads" ADD CONSTRAINT "threads_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "whatsapp"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."threads" ADD CONSTRAINT "threads_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."threads" ADD CONSTRAINT "threads_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "whatsapp"."threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "whatsapp"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_sentByEmployeeId_fkey" FOREIGN KEY ("sentByEmployeeId") REFERENCES "core"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "whatsapp"."campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."templates" ADD CONSTRAINT "templates_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "whatsapp"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."campaigns" ADD CONSTRAINT "campaigns_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "whatsapp"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."campaigns" ADD CONSTRAINT "campaigns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "whatsapp"."templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

