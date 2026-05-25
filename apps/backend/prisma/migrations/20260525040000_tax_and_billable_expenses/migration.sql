-- CA fix #7 (tax rate) + #8 (billable disbursements). Additive, safe defaults
-- that preserve current behaviour (no tax; all expenses absorbed).
ALTER TABLE "core"."organizations" ADD COLUMN "taxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "finance"."expenses"   ADD COLUMN "billable" BOOLEAN NOT NULL DEFAULT false;
