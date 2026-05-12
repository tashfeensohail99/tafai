-- CreateEnum
CREATE TYPE "public"."PresenceStatus" AS ENUM ('ONLINE', 'AWAY', 'OFFLINE');

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

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."TimelineEventType" ADD VALUE 'WHATSAPP_MESSAGE_RECEIVED';
ALTER TYPE "public"."TimelineEventType" ADD VALUE 'WHATSAPP_MESSAGE_SENT';
ALTER TYPE "public"."TimelineEventType" ADD VALUE 'WHATSAPP_LEAD_CREATED';
ALTER TYPE "public"."TimelineEventType" ADD VALUE 'WHATSAPP_ASSIGNED';
ALTER TYPE "public"."TimelineEventType" ADD VALUE 'WHATSAPP_CONVERSATION_RESOLVED';
ALTER TYPE "public"."TimelineEventType" ADD VALUE 'WHATSAPP_OPTED_OUT';

-- DropForeignKey
ALTER TABLE "public"."audit_log" DROP CONSTRAINT "audit_log_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."calls" DROP CONSTRAINT "calls_agent_device_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."calls" DROP CONSTRAINT "calls_qa_reviewed_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."consent_log" DROP CONSTRAINT "consent_log_acted_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."consent_log" DROP CONSTRAINT "consent_log_device_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."device_photos" DROP CONSTRAINT "device_photos_device_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."devices" DROP CONSTRAINT "devices_group_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."groups" DROP CONSTRAINT "groups_policy_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."telemetry" DROP CONSTRAINT "telemetry_device_id_fkey";

-- AlterTable
ALTER TABLE "public"."employees" ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "presenceChangedAt" TIMESTAMP(3),
ADD COLUMN     "presenceStatus" "public"."PresenceStatus" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "whatsappInboxMember" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."leads" ADD COLUMN     "preferredEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "afterHoursTemplate" TEXT,
ADD COLUMN     "afterHoursTemplateLang" TEXT DEFAULT 'en',
ADD COLUMN     "hoursClose" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "hoursOpen" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "rrCursorEmployeeId" TEXT,
ADD COLUMN     "slaFirstResponseSeconds" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
ADD COLUMN     "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[];

-- DropTable
DROP TABLE "public"."audit_log";

-- DropTable
DROP TABLE "public"."calls";

-- DropTable
DROP TABLE "public"."consent_log";

-- DropTable
DROP TABLE "public"."device_photos";

-- DropTable
DROP TABLE "public"."devices";

-- DropTable
DROP TABLE "public"."disclosure_log";

-- DropTable
DROP TABLE "public"."groups";

-- DropTable
DROP TABLE "public"."policies";

-- DropTable
DROP TABLE "public"."telemetry";

-- DropTable
DROP TABLE "public"."users";

-- DropTable
DROP TABLE "public"."webhook_endpoints";

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

-- CreateIndex
CREATE INDEX "employees_whatsappInboxMember_presenceStatus_idx" ON "public"."employees"("whatsappInboxMember", "presenceStatus");

-- CreateIndex
CREATE INDEX "leads_preferredEmployeeId_idx" ON "public"."leads"("preferredEmployeeId");

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_preferredEmployeeId_fkey" FOREIGN KEY ("preferredEmployeeId") REFERENCES "public"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."threads" ADD CONSTRAINT "threads_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "whatsapp"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."threads" ADD CONSTRAINT "threads_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."threads" ADD CONSTRAINT "threads_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "whatsapp"."threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "whatsapp"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_sentByEmployeeId_fkey" FOREIGN KEY ("sentByEmployeeId") REFERENCES "public"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."messages" ADD CONSTRAINT "messages_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "whatsapp"."campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."templates" ADD CONSTRAINT "templates_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "whatsapp"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."campaigns" ADD CONSTRAINT "campaigns_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "whatsapp"."channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."campaigns" ADD CONSTRAINT "campaigns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "whatsapp"."templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

