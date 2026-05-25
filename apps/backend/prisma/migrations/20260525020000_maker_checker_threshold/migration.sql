-- Maker-checker (segregation of duties): payments >= this amount must be
-- verified by a different finance officer than the one who recorded them.
-- 0 disables. Additive only.
ALTER TABLE "core"."organizations"
  ADD COLUMN "makerCheckerThreshold" DECIMAL(12,2) NOT NULL DEFAULT 100000;
