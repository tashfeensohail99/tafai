-- Processing: persist the program code on a case (previously used only
-- transiently for checklist seeding) so per-program client-email templates
-- resolve the right variant at send time. Nullable, no backfill.
ALTER TABLE "processing"."processing_cases" ADD COLUMN "programCode" TEXT;

-- Manager-editable client-email templates for the automated processing nudges
-- (missing docs / re-submit / expiring / attestation). One row per
-- (reminderType, service, programCode); programCode '' = the service-level
-- default. When no active row matches, the sender falls back to a hardcoded
-- default so email always sends.
CREATE TABLE "processing"."processing_email_templates" (
    "id" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "programCode" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "processing_email_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "processing_email_templates_reminderType_service_programCode_key" ON "processing"."processing_email_templates"("reminderType", "service", "programCode");

CREATE INDEX "processing_email_templates_service_idx" ON "processing"."processing_email_templates"("service");

ALTER TABLE "processing"."processing_email_templates" ADD CONSTRAINT "processing_email_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "core"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
