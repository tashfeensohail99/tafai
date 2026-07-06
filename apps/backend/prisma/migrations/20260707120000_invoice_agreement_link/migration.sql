-- Link invoices to the agreement they bill against. A person can now hold more
-- than one agreement (multiple programs), so leadId/clientId alone no longer
-- identifies the deal an invoice belongs to. Nullable + indexed; NO FK
-- (agreements are decoupled by id, like agreement_events). Consult-fee invoices
-- (isConsultation) stay NULL — they are person-level credits, not agreement-billed.
ALTER TABLE "finance"."invoices" ADD COLUMN "agreementId" TEXT;

CREATE INDEX "invoices_agreementId_idx" ON "finance"."invoices" ("agreementId");

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Idempotent: every UPDATE is gated on "agreementId" IS NULL, so it never
-- double-writes and never clobbers a link set by application code. Safe to re-run.

-- (A) Installment-linked invoices: invoice -> installment -> service_contract ->
--     the agreement whose serviceContractId = that contract. Authoritative path.
UPDATE "finance"."invoices" i
SET "agreementId" = a."id"
FROM "finance"."installments" inst
JOIN "finance"."service_contracts" sc ON sc."id" = inst."contractId"
JOIN "finance"."agreements" a
  ON a."serviceContractId" = sc."id"
 AND a."deletedAt" IS NULL
WHERE i."installmentId" = inst."id"
  AND i."agreementId" IS NULL
  AND i."isConsultation" = false;

-- (B) Non-installment invoices with a leadId: fall back to the lead's single
--     non-deleted, non-consult agreement of the SAME currency. Today it is
--     one-per-person, so this is unambiguous; the NOT EXISTS asserts uniqueness
--     and leaves the invoice NULL rather than linking it to an arbitrary one.
UPDATE "finance"."invoices" i
SET "agreementId" = a."id"
FROM "finance"."agreements" a
WHERE i."agreementId" IS NULL
  AND i."isConsultation" = false
  AND i."installmentId" IS NULL
  AND i."leadId" IS NOT NULL
  AND a."leadId" = i."leadId"
  AND a."deletedAt" IS NULL
  AND a."currency" = i."currency"
  AND NOT EXISTS (
    SELECT 1 FROM "finance"."agreements" a2
    WHERE a2."leadId" = i."leadId"
      AND a2."deletedAt" IS NULL
      AND a2."currency" = i."currency"
      AND a2."id" <> a."id"
  );

-- (C) Non-installment invoices with only a clientId: same fallback, matched on
--     the agreement's clientId. (Agreements rarely carry clientId today, so this
--     mostly no-ops until the app starts populating agreement.clientId.)
UPDATE "finance"."invoices" i
SET "agreementId" = a."id"
FROM "finance"."agreements" a
WHERE i."agreementId" IS NULL
  AND i."isConsultation" = false
  AND i."installmentId" IS NULL
  AND i."leadId" IS NULL
  AND i."clientId" IS NOT NULL
  AND a."clientId" = i."clientId"
  AND a."deletedAt" IS NULL
  AND a."currency" = i."currency"
  AND NOT EXISTS (
    SELECT 1 FROM "finance"."agreements" a2
    WHERE a2."clientId" = i."clientId"
      AND a2."deletedAt" IS NULL
      AND a2."currency" = i."currency"
      AND a2."id" <> a."id"
  );
