-- CA fix #1 (monotonic document numbering) + #2 (financial immutability)

-- ── #1: per-year, per-series counter that only ever increments ───────────────
CREATE TABLE "finance"."document_sequences" (
  "series"    TEXT NOT NULL,
  "year"      INTEGER NOT NULL,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("series", "year")
);

-- Seed from the highest well-formed number already issued per series/year, so
-- new numbers continue past anything on an existing document (never reused).
-- The regex filter ignores any malformed/legacy numbers so CAST can't overflow.
INSERT INTO "finance"."document_sequences" ("series", "year", "lastValue")
SELECT 'INV', CAST(split_part("invoiceNumber", '-', 2) AS INTEGER), MAX(CAST(split_part("invoiceNumber", '-', 3) AS INTEGER))
FROM "finance"."invoices" WHERE "invoiceNumber" ~ '^INV-[0-9]{4}-[0-9]+$' GROUP BY 2
ON CONFLICT ("series", "year") DO UPDATE SET "lastValue" = GREATEST("finance"."document_sequences"."lastValue", EXCLUDED."lastValue");

INSERT INTO "finance"."document_sequences" ("series", "year", "lastValue")
SELECT 'RCP', CAST(split_part("receiptNumber", '-', 2) AS INTEGER), MAX(CAST(split_part("receiptNumber", '-', 3) AS INTEGER))
FROM "finance"."receipts" WHERE "receiptNumber" ~ '^RCP-[0-9]{4}-[0-9]+$' GROUP BY 2
ON CONFLICT ("series", "year") DO UPDATE SET "lastValue" = GREATEST("finance"."document_sequences"."lastValue", EXCLUDED."lastValue");

INSERT INTO "finance"."document_sequences" ("series", "year", "lastValue")
SELECT 'SC', CAST(split_part("contractNumber", '-', 2) AS INTEGER), MAX(CAST(split_part("contractNumber", '-', 3) AS INTEGER))
FROM "finance"."service_contracts" WHERE "contractNumber" ~ '^SC-[0-9]{4}-[0-9]+$' GROUP BY 2
ON CONFLICT ("series", "year") DO UPDATE SET "lastValue" = GREATEST("finance"."document_sequences"."lastValue", EXCLUDED."lastValue");

INSERT INTO "finance"."document_sequences" ("series", "year", "lastValue")
SELECT 'AGR', CAST(split_part("agreementNumber", '-', 2) AS INTEGER), MAX(CAST(split_part("agreementNumber", '-', 3) AS INTEGER))
FROM "finance"."agreements" WHERE "agreementNumber" ~ '^AGR-[0-9]{4}-[0-9]+$' GROUP BY 2
ON CONFLICT ("series", "year") DO UPDATE SET "lastValue" = GREATEST("finance"."document_sequences"."lastValue", EXCLUDED."lastValue");

-- ── #2: soft-delete / void markers (financial docs are voided, never deleted) ─
ALTER TABLE "finance"."invoices" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "finance"."payments"  ADD COLUMN "deletedAt" TIMESTAMP(3);
