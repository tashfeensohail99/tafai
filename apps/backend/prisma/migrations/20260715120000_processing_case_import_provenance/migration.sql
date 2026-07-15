-- Import provenance columns for the bulk client import (processing).
-- Both preserve source-sheet data that has no existing home:
--   externalRef = the source "Case ID" (e.g. "0001") — cross-reference +
--                 idempotency hint on re-import. NOT unique (IDs can repeat).
--   signupDate  = the client's original signup date — descriptive only, kept
--                 separate from createdAt so it never feeds SLA / aging.
-- Nullable, no default, no backfill: zero risk to existing rows.

ALTER TABLE "processing"."processing_cases" ADD COLUMN IF NOT EXISTS "externalRef" TEXT;
ALTER TABLE "processing"."processing_cases" ADD COLUMN IF NOT EXISTS "signupDate" DATE;

CREATE INDEX IF NOT EXISTS "processing_cases_externalRef_idx" ON "processing"."processing_cases"("externalRef");
