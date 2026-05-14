-- Stage 2 of finance refactor: introduce industrial-grade reference codes
-- that flow Lead → Client → Invoice → Receipt, plus a formal Receipt model
-- generated per verified payment.
--
-- Format choices:
--   Customer reference  TIS-YYYY-NNNNN   (sticks to lead, copies to client)
--   Invoice number      INV-YYYY-NNNNN   (replaces timestamp+random scheme)
--   Receipt number      RCP-YYYY-NNNNN   (sequential per verified payment)
--
-- All sequences are year-scoped: NNNNN resets on Jan 1. Year-scoped
-- sequences make audit reports easier ("show me all receipts from 2026")
-- and are what most local-jurisdiction tax authorities expect.
--
-- Backfill: existing rows get sequential codes assigned in createdAt order
-- so history stays auditable. Existing invoice numbers are LEFT ALONE —
-- they were unique, so the upgrade only affects newly-issued invoices.

-- ─── 1. referenceCode on Lead ───────────────────────────────────────────────
ALTER TABLE "crm"."leads"
  ADD COLUMN IF NOT EXISTS "referenceCode" TEXT;

-- Backfill existing leads with codes in createdAt order, year-scoped.
DO $$
DECLARE
  rec RECORD;
  cur_year TEXT;
  prev_year TEXT := '';
  counter INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT id, "createdAt"
    FROM "crm"."leads"
    WHERE "referenceCode" IS NULL
    ORDER BY "createdAt" ASC
  LOOP
    cur_year := to_char(rec."createdAt", 'YYYY');
    IF cur_year <> prev_year THEN
      counter := 1;
      prev_year := cur_year;
    ELSE
      counter := counter + 1;
    END IF;
    UPDATE "crm"."leads"
    SET "referenceCode" = 'TIS-' || cur_year || '-' || lpad(counter::text, 5, '0')
    WHERE id = rec.id;
  END LOOP;
END $$;

-- Now make it required + unique. Skip the NOT NULL when in dev with empty tables.
ALTER TABLE "crm"."leads"
  ALTER COLUMN "referenceCode" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "leads_referenceCode_key"
  ON "crm"."leads" ("referenceCode");

-- ─── 2. referenceCode on Client (inherits lead's code on conversion) ───────
ALTER TABLE "crm"."clients"
  ADD COLUMN IF NOT EXISTS "referenceCode" TEXT;

-- Backfill: clients copy the converted-from lead's reference code, else
-- get their own sequential.
UPDATE "crm"."clients" c
SET "referenceCode" = l."referenceCode"
FROM "crm"."leads" l
WHERE l."convertedClientId" = c.id
  AND c."referenceCode" IS NULL;

-- Any orphan client (not converted from a lead) gets its own code.
DO $$
DECLARE
  rec RECORD;
  cur_year TEXT;
  prev_year TEXT := '';
  counter INTEGER := 1000;
BEGIN
  -- Start orphan-client codes at 1000 within the year to keep them
  -- visually separated from lead-derived codes.
  FOR rec IN
    SELECT id, "createdAt"
    FROM "crm"."clients"
    WHERE "referenceCode" IS NULL
    ORDER BY "createdAt" ASC
  LOOP
    cur_year := to_char(rec."createdAt", 'YYYY');
    IF cur_year <> prev_year THEN
      counter := 1000;
      prev_year := cur_year;
    ELSE
      counter := counter + 1;
    END IF;
    UPDATE "crm"."clients"
    SET "referenceCode" = 'TIS-' || cur_year || '-' || lpad(counter::text, 5, '0')
    WHERE id = rec.id;
  END LOOP;
END $$;

ALTER TABLE "crm"."clients"
  ALTER COLUMN "referenceCode" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "clients_referenceCode_key"
  ON "crm"."clients" ("referenceCode");

-- ─── 3. Receipt model ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "finance"."receipts" (
  "id"               TEXT PRIMARY KEY,
  "receiptNumber"    TEXT NOT NULL UNIQUE,
  "paymentId"        TEXT NOT NULL UNIQUE,
  "leadId"           TEXT,
  "clientId"         TEXT,
  "invoiceId"        TEXT NOT NULL,
  "amount"           DECIMAL(12, 2) NOT NULL,
  "currency"         TEXT NOT NULL,
  "paymentMethod"    TEXT,
  "transactionRef"   TEXT,
  "issuedByUserId"   TEXT NOT NULL,
  "issuedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  -- Storage key for the generated PDF in S3. NULL while the PDF job is
  -- pending; populated once the render completes. The receipt row itself
  -- is the source of truth — the PDF is a regeneratable artifact.
  "pdfStorageKey"    TEXT,
  "pdfGeneratedAt"   TIMESTAMP(3),
  "voidedAt"         TIMESTAMP(3),
  "voidReason"       TEXT,
  "voidedByUserId"   TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT "receipts_paymentId_fk"  FOREIGN KEY ("paymentId")
    REFERENCES "finance"."payments" ("id") ON DELETE RESTRICT,
  CONSTRAINT "receipts_invoiceId_fk"  FOREIGN KEY ("invoiceId")
    REFERENCES "finance"."invoices" ("id") ON DELETE RESTRICT,
  CONSTRAINT "receipts_leadId_fk"     FOREIGN KEY ("leadId")
    REFERENCES "crm"."leads"   ("id") ON DELETE SET NULL,
  CONSTRAINT "receipts_clientId_fk"   FOREIGN KEY ("clientId")
    REFERENCES "crm"."clients" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "receipts_leadId_idx"
  ON "finance"."receipts" ("leadId");
CREATE INDEX IF NOT EXISTS "receipts_clientId_idx"
  ON "finance"."receipts" ("clientId");
CREATE INDEX IF NOT EXISTS "receipts_invoiceId_idx"
  ON "finance"."receipts" ("invoiceId");
CREATE INDEX IF NOT EXISTS "receipts_issuedAt_idx"
  ON "finance"."receipts" ("issuedAt");
