-- Per-client expense ledger (cost side) — pairs with invoices/payments to
-- give a per-client margin. Additive only: new enum + new table.
CREATE TYPE "finance"."ExpenseCategory" AS ENUM (
  'GOVERNMENT_FEE','EMBASSY','MEDICAL','TRANSLATION','COURIER','THIRD_PARTY','OTHER'
);

CREATE TABLE "finance"."expenses" (
  "id"               TEXT NOT NULL,
  "leadId"           TEXT NOT NULL,
  "clientId"         TEXT,
  "caseId"           TEXT,
  "category"         "finance"."ExpenseCategory" NOT NULL DEFAULT 'OTHER',
  "description"      TEXT NOT NULL,
  "amount"           DECIMAL(12,2) NOT NULL,
  "currency"         TEXT NOT NULL DEFAULT 'CAD',
  "incurredAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receiptKey"       TEXT,
  "receiptFileName"  TEXT,
  "receiptMimeType"  TEXT,
  "receiptSizeBytes" INTEGER,
  "createdByUserId"  TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "deletedAt"        TIMESTAMP(3),
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expenses_leadId_idx"   ON "finance"."expenses"("leadId");
CREATE INDEX "expenses_clientId_idx" ON "finance"."expenses"("clientId");
CREATE INDEX "expenses_caseId_idx"   ON "finance"."expenses"("caseId");
CREATE INDEX "expenses_category_idx" ON "finance"."expenses"("category");
