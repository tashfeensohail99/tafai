-- AlterTable: reception consultation settings on the single org row
ALTER TABLE "core"."organizations"
  ADD COLUMN "principalEmployeeId" TEXT,
  ADD COLUMN "consultationFeeAmount" DECIMAL(12,2),
  ADD COLUMN "consultationFeeCurrency" TEXT,
  ADD COLUMN "consultationBankIban" TEXT,
  ADD COLUMN "consultationBankName" TEXT,
  ADD COLUMN "consultationBankTitle" TEXT;

-- AlterTable: paid-consultation fee fields on the visit register
ALTER TABLE "crm"."visits"
  ADD COLUMN "feeAmount" DECIMAL(12,2),
  ADD COLUMN "feeCurrency" TEXT,
  ADD COLUMN "consultFeeCreditable" BOOLEAN NOT NULL DEFAULT false;
