-- Sales disposition layer (SEPARATE from the pipeline LeadStatus). See the
-- LeadDisposition enum + Lead.disposition + LeadDispositionHistory in schema.

-- Disposition enum.
CREATE TYPE "crm"."LeadDisposition" AS ENUM (
  'NO_RESPONSE',
  'FOLLOW_UP',
  'REQUESTED_DISCOUNT',
  'PRICE_CONCERN',
  'NOT_ELIGIBLE',
  'QUALIFIED',
  'CONVERTED_TO_DEAL',
  'CONTACT_LATER',
  'JUNK',
  'DEAD'
);

-- Denormalized latest disposition on the lead (fast reads/filters).
ALTER TABLE "crm"."leads"
  ADD COLUMN "disposition" "crm"."LeadDisposition",
  ADD COLUMN "dispositionAt" TIMESTAMP(3),
  ADD COLUMN "dispositionByUserId" TEXT;

-- Partial index for the inbox's JUNK/DEAD exclusion (only the hidden rows).
CREATE INDEX "leads_disposition_idx" ON "crm"."leads" ("disposition")
  WHERE "disposition" IS NOT NULL;

-- Append-only who/when history.
CREATE TABLE "crm"."lead_disposition_history" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "disposition" "crm"."LeadDisposition" NOT NULL,
  "note" TEXT,
  "byUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lead_disposition_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_disposition_history_leadId_createdAt_idx"
  ON "crm"."lead_disposition_history" ("leadId", "createdAt" DESC);

ALTER TABLE "crm"."lead_disposition_history"
  ADD CONSTRAINT "lead_disposition_history_leadId_fkey" FOREIGN KEY ("leadId")
  REFERENCES "crm"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
