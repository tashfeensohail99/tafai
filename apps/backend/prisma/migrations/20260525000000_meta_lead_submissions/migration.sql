-- Meta Lead Ads integration.
--   1. New timeline event type for "lead created from Meta Lead Form".
--      (PG12+ allows ADD VALUE inside the migration txn as long as the new
--      value isn't USED in the same txn — the table below doesn't reference it.)
--   2. Per-submission attribution + raw answers, 1:many to crm.leads.
--      leadgenId is UNIQUE → idempotency for Meta webhook retries + dedupe.

ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'META_LEAD_CREATED';

-- CreateTable
CREATE TABLE "crm"."lead_meta_submissions" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "leadgenId" TEXT NOT NULL,
    "formId" TEXT,
    "formName" TEXT,
    "adId" TEXT,
    "adName" TEXT,
    "adsetId" TEXT,
    "adsetName" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "pageId" TEXT,
    "platform" TEXT,
    "isOrganic" BOOLEAN,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "formAnswers" JSONB,
    "rawPayload" JSONB,
    "metaCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_meta_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_meta_submissions_leadgenId_key" ON "crm"."lead_meta_submissions"("leadgenId");

-- CreateIndex
CREATE INDEX "lead_meta_submissions_leadId_idx" ON "crm"."lead_meta_submissions"("leadId");

-- CreateIndex
CREATE INDEX "lead_meta_submissions_campaignId_idx" ON "crm"."lead_meta_submissions"("campaignId");

-- CreateIndex
CREATE INDEX "lead_meta_submissions_formId_idx" ON "crm"."lead_meta_submissions"("formId");

-- AddForeignKey
ALTER TABLE "crm"."lead_meta_submissions" ADD CONSTRAINT "lead_meta_submissions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
