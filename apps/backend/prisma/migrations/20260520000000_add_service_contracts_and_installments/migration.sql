-- Service contracts and installments.
-- Adds two new tables in the `finance` schema and a back-reference column
-- on `invoices` so an Invoice can be tied to the installment it bills.
--
-- Pattern matches the existing finance schema:
--   * TEXT primary keys with caller-supplied UUIDs
--   * Decimal(12,2) for money
--   * camelCase columns (matches Prisma default)
--   * Snake-case table names via @@map

-- =============================================================================
-- ENUMS
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "finance"."ServiceContractStatus" AS ENUM (
    'DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "finance"."InstallmentStatus" AS ENUM (
    'PENDING', 'INVOICED', 'PAID', 'OVERDUE', 'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS "finance"."service_contracts" (
  "id"                  TEXT NOT NULL,
  "contractNumber"      TEXT NOT NULL,
  "leadId"              TEXT,
  "clientId"            TEXT,
  "totalAmount"         DECIMAL(12, 2) NOT NULL,
  "currency"            TEXT NOT NULL DEFAULT 'CAD',
  "signedDate"          TIMESTAMP(3),
  "agreementKey"        TEXT,
  "agreementFileName"   TEXT,
  "agreementMimeType"   TEXT,
  "agreementSizeBytes"  INTEGER,
  "status"              "finance"."ServiceContractStatus" NOT NULL DEFAULT 'DRAFT',
  "notes"               TEXT,
  "createdByUserId"     TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  "deletedAt"           TIMESTAMP(3),

  CONSTRAINT "service_contracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_contracts_contractNumber_key"
  ON "finance"."service_contracts" ("contractNumber");

CREATE INDEX IF NOT EXISTS "service_contracts_leadId_idx"
  ON "finance"."service_contracts" ("leadId");

CREATE INDEX IF NOT EXISTS "service_contracts_clientId_idx"
  ON "finance"."service_contracts" ("clientId");

CREATE INDEX IF NOT EXISTS "service_contracts_status_idx"
  ON "finance"."service_contracts" ("status");


CREATE TABLE IF NOT EXISTS "finance"."installments" (
  "id"           TEXT NOT NULL,
  "contractId"   TEXT NOT NULL,
  "sequence"     INTEGER NOT NULL,
  "dueDate"      TIMESTAMP(3) NOT NULL,
  "amount"       DECIMAL(12, 2) NOT NULL,
  "description"  TEXT,
  "status"       "finance"."InstallmentStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "installments_contractId_sequence_key"
  ON "finance"."installments" ("contractId", "sequence");

CREATE INDEX IF NOT EXISTS "installments_contractId_idx"
  ON "finance"."installments" ("contractId");

CREATE INDEX IF NOT EXISTS "installments_status_idx"
  ON "finance"."installments" ("status");

CREATE INDEX IF NOT EXISTS "installments_dueDate_idx"
  ON "finance"."installments" ("dueDate");

-- =============================================================================
-- FOREIGN KEYS
-- =============================================================================

ALTER TABLE "finance"."service_contracts"
  DROP CONSTRAINT IF EXISTS "service_contracts_leadId_fkey",
  ADD CONSTRAINT "service_contracts_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "crm"."leads" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "finance"."service_contracts"
  DROP CONSTRAINT IF EXISTS "service_contracts_clientId_fkey",
  ADD CONSTRAINT "service_contracts_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "crm"."clients" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "finance"."installments"
  DROP CONSTRAINT IF EXISTS "installments_contractId_fkey",
  ADD CONSTRAINT "installments_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "finance"."service_contracts" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- INVOICES: add nullable installmentId back-reference
-- =============================================================================

ALTER TABLE "finance"."invoices"
  ADD COLUMN IF NOT EXISTS "installmentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_installmentId_key"
  ON "finance"."invoices" ("installmentId");

ALTER TABLE "finance"."invoices"
  DROP CONSTRAINT IF EXISTS "invoices_installmentId_fkey",
  ADD CONSTRAINT "invoices_installmentId_fkey"
    FOREIGN KEY ("installmentId") REFERENCES "finance"."installments" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
