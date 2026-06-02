-- Manual client creation (Processing Manager on-ramp):
-- a ProcessingCase created manually has no FinanceHandover.
-- Make financeHandoverId nullable. The @unique index remains; Postgres allows
-- multiple NULLs under a unique index, so one-case-per-handover still holds for
-- the finance-originated path.

ALTER TABLE "processing"."processing_cases"
  ALTER COLUMN "financeHandoverId" DROP NOT NULL;
