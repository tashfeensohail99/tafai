-- Multi-currency: book every payment/expense in CAD (base currency) while
-- keeping the original foreign amount + the FX rate used at record time.

ALTER TABLE "finance"."payments" ADD COLUMN "baseAmount" DECIMAL(12,2);
ALTER TABLE "finance"."payments" ADD COLUMN "baseCurrency" TEXT NOT NULL DEFAULT 'CAD';
ALTER TABLE "finance"."payments" ADD COLUMN "fxRate" DECIMAL(18,8);

ALTER TABLE "finance"."expenses" ADD COLUMN "baseAmount" DECIMAL(12,2);
ALTER TABLE "finance"."expenses" ADD COLUMN "baseCurrency" TEXT NOT NULL DEFAULT 'CAD';
ALTER TABLE "finance"."expenses" ADD COLUMN "fxRate" DECIMAL(18,8);

-- Backfill existing rows: recorded directly before multi-currency, so treat the
-- stored amount as already-CAD at rate 1. New rows are converted at entry.
UPDATE "finance"."payments" SET "baseAmount" = "amount", "fxRate" = 1 WHERE "baseAmount" IS NULL;
UPDATE "finance"."expenses" SET "baseAmount" = "amount", "fxRate" = 1 WHERE "baseAmount" IS NULL;
