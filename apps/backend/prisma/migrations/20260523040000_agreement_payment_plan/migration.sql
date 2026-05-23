-- Structured payment plans on agreements + per-agreement change history.
CREATE TYPE "finance"."PaymentPlanType" AS ENUM ('FULL', 'INSTALLMENT', 'MILESTONE');

ALTER TABLE "finance"."agreements"
  ADD COLUMN "grossAmount"               DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discountAmount"            DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paymentPlanType"          "finance"."PaymentPlanType",
  ADD COLUMN "paymentPlanLockedAt"      TIMESTAMP(3),
  ADD COLUMN "paymentPlanLockedByUserId" TEXT;

-- Append-only audit trail: who changed what on an agreement, with before/after.
CREATE TABLE "finance"."agreement_events" (
  "id"          TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "type"        TEXT NOT NULL,
  "summary"     TEXT NOT NULL,
  "dataBefore"  JSONB,
  "dataAfter"   JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agreement_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agreement_events_agreementId_idx" ON "finance"."agreement_events"("agreementId");
CREATE INDEX "agreement_events_createdAt_idx"   ON "finance"."agreement_events"("createdAt");
