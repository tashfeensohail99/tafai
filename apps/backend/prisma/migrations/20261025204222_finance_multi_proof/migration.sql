-- Multiple proof-of-payment files per payment. Additive: a new table that holds
-- the EXTRA slips only — the primary proof still lives on
-- finance_handovers.receiptKey / payments.receiptKey, so the single-proof flow
-- is untouched. Nullable FKs let a proof hang off either the handover (recorded)
-- or the payment (added after verification). No existing columns are altered.
CREATE TABLE "finance"."finance_proofs" (
  "id"               TEXT NOT NULL,
  "handoverId"       TEXT,
  "paymentId"        TEXT,
  "storageKey"       TEXT NOT NULL,
  "fileName"         TEXT NOT NULL,
  "mimeType"         TEXT,
  "sizeBytes"        INTEGER,
  "uploadedByUserId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_proofs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "finance_proofs_handoverId_idx"
  ON "finance"."finance_proofs" ("handoverId");

CREATE INDEX "finance_proofs_paymentId_idx"
  ON "finance"."finance_proofs" ("paymentId");

ALTER TABLE "finance"."finance_proofs"
  ADD CONSTRAINT "finance_proofs_handoverId_fkey"
  FOREIGN KEY ("handoverId") REFERENCES "finance"."finance_handovers" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "finance"."finance_proofs"
  ADD CONSTRAINT "finance_proofs_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "finance"."payments" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
