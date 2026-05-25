-- CA audit round 2: input tax on expenses, period lock, revenue recognition,
-- and credit-note contra-documents.

-- #2 Recoverable input tax (ITC) captured per expense.
ALTER TABLE "finance"."expenses"
  ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- #8 Period lock (book close) — payments/invoices before this are rejected.
ALTER TABLE "core"."organizations"
  ADD COLUMN "booksLockedBefore" TIMESTAMP(3);

-- #1 Revenue recognition (accrual): when a milestone/installment is delivered.
ALTER TABLE "finance"."installments"
  ADD COLUMN "recognizedAt" TIMESTAMP(3);
ALTER TABLE "finance"."installments"
  ADD COLUMN "recognizedByUserId" TEXT;

-- #3 Credit notes — sequential contra-documents for refunds / corrections.
CREATE TABLE "finance"."credit_notes" (
  "id" TEXT NOT NULL,
  "creditNoteNumber" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT,
  "leadId" TEXT,
  "clientId" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "reason" TEXT,
  "issuedByUserId" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_notes_creditNoteNumber_key" ON "finance"."credit_notes"("creditNoteNumber");
CREATE INDEX "credit_notes_invoiceId_idx" ON "finance"."credit_notes"("invoiceId");
CREATE INDEX "credit_notes_clientId_idx" ON "finance"."credit_notes"("clientId");
CREATE INDEX "credit_notes_leadId_idx" ON "finance"."credit_notes"("leadId");
CREATE INDEX "credit_notes_issuedAt_idx" ON "finance"."credit_notes"("issuedAt");

ALTER TABLE "finance"."credit_notes"
  ADD CONSTRAINT "credit_notes_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "finance"."invoices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
