-- Agreement corrections — rep-raised change requests against finalised agreements.
-- Additive + idempotent: two new enums + one new table (finance schema).

DO $$ BEGIN
  CREATE TYPE "finance"."AgreementChangeType" AS ENUM ('BIO', 'PAYMENT_PLAN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "finance"."AgreementChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "finance"."agreement_change_requests" (
    "id"                TEXT NOT NULL,
    "agreementId"       TEXT NOT NULL,
    "agreementNumber"   TEXT NOT NULL,
    "leadId"            TEXT,
    "clientId"          TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "type"              "finance"."AgreementChangeType" NOT NULL,
    "status"            "finance"."AgreementChangeStatus" NOT NULL DEFAULT 'PENDING',
    "reason"            TEXT,
    "before"            JSONB NOT NULL,
    "after"             JSONB NOT NULL,
    "appliedByUserId"   TEXT,
    "appliedAt"         TIMESTAMP(3),
    "rejectedByUserId"  TEXT,
    "rejectedAt"        TIMESTAMP(3),
    "reviewNote"        TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agreement_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agreement_change_requests_agreementId_idx" ON "finance"."agreement_change_requests" ("agreementId");
CREATE INDEX IF NOT EXISTS "agreement_change_requests_status_idx" ON "finance"."agreement_change_requests" ("status");
CREATE INDEX IF NOT EXISTS "agreement_change_requests_createdAt_idx" ON "finance"."agreement_change_requests" ("createdAt" DESC);
