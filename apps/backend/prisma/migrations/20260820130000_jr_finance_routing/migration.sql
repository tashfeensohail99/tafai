-- Going-forward finance→JR routing: a paid JR_RESUBMISSION agreement opens a
-- JrMatter (in the JR Head's queue) instead of a ProcessingCase.
-- Additive + idempotent: 1 bare column + 1 unique index on "legal"."jr_matters",
-- plus 1 new enum value on "finance"."FinanceHandoverStatus".
-- The migration is APPLIED BY THE USER (prisma migrate deploy at boot). Keep re-runnable.

-- ── 1. jr_matters.financeHandoverId — bare cross-schema id (no FK), @unique ──────
ALTER TABLE "legal"."jr_matters" ADD COLUMN IF NOT EXISTS "financeHandoverId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "jr_matters_financeHandoverId_key" ON "legal"."jr_matters"("financeHandoverId");

-- ── 2. FinanceHandoverStatus.SENT_TO_JR ──────────────────────────────────────────
ALTER TYPE "finance"."FinanceHandoverStatus" ADD VALUE IF NOT EXISTS 'SENT_TO_JR';
