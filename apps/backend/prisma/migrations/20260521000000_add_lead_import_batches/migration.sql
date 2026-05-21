-- CSV/Excel lead ingestion: batch + per-row tracking.
-- Adds two tables in the `crm` schema with the supporting enums.
--
-- Pattern matches existing crm tables:
--   * TEXT primary keys with caller-supplied UUIDs
--   * camelCase columns (Prisma default)
--   * Snake-case table names via @@map
--   * Schema = "crm"

-- =============================================================================
-- ENUMS
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "crm"."LeadImportStatus" AS ENUM (
    'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'PAUSED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "crm"."LeadImportRowOutcome" AS ENUM (
    'IMPORTED', 'DUPLICATE', 'INVALID', 'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS "crm"."lead_import_batches" (
  "id"                  TEXT NOT NULL,
  "batchNumber"         TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "uploadedByUserId"    TEXT NOT NULL,
  "uploadedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "fileName"            TEXT NOT NULL,
  "fileKey"             TEXT NOT NULL,
  "fileMimeType"        TEXT,
  "fileSizeBytes"       INTEGER,

  "totalRows"           INTEGER NOT NULL DEFAULT 0,
  "importedCount"       INTEGER NOT NULL DEFAULT 0,
  "duplicateCount"      INTEGER NOT NULL DEFAULT 0,
  "invalidCount"        INTEGER NOT NULL DEFAULT 0,
  "assignedCount"       INTEGER NOT NULL DEFAULT 0,

  "status"              "crm"."LeadImportStatus" NOT NULL DEFAULT 'QUEUED',
  "selectedAgentIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "columnMapping"       JSONB NOT NULL,
  "defaultCountry"      TEXT NOT NULL DEFAULT 'PK',
  "welcomeMessage"      TEXT,
  "errorReportKey"      TEXT,

  "startedAt"           TIMESTAMP(3),
  "completedAt"         TIMESTAMP(3),
  "pausedAt"            TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "lead_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_import_batches_batchNumber_key"
  ON "crm"."lead_import_batches" ("batchNumber");

CREATE INDEX IF NOT EXISTS "lead_import_batches_uploadedByUserId_idx"
  ON "crm"."lead_import_batches" ("uploadedByUserId");

CREATE INDEX IF NOT EXISTS "lead_import_batches_status_idx"
  ON "crm"."lead_import_batches" ("status");

CREATE INDEX IF NOT EXISTS "lead_import_batches_uploadedAt_idx"
  ON "crm"."lead_import_batches" ("uploadedAt" DESC);


CREATE TABLE IF NOT EXISTS "crm"."lead_import_rows" (
  "id"                  TEXT NOT NULL,
  "batchId"             TEXT NOT NULL,
  "rowNumber"           INTEGER NOT NULL,
  "rawData"             JSONB NOT NULL,
  "normalisedPhone"     TEXT,
  "outcome"             "crm"."LeadImportRowOutcome" NOT NULL,
  "errorMessage"        TEXT,
  "leadId"              TEXT,
  "assignedEmployeeId"  TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lead_import_rows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lead_import_rows_batchId_idx"
  ON "crm"."lead_import_rows" ("batchId");

CREATE INDEX IF NOT EXISTS "lead_import_rows_leadId_idx"
  ON "crm"."lead_import_rows" ("leadId");

CREATE INDEX IF NOT EXISTS "lead_import_rows_outcome_idx"
  ON "crm"."lead_import_rows" ("outcome");

-- =============================================================================
-- FOREIGN KEYS
-- =============================================================================

ALTER TABLE "crm"."lead_import_batches"
  DROP CONSTRAINT IF EXISTS "lead_import_batches_uploadedByUserId_fkey",
  ADD CONSTRAINT "lead_import_batches_uploadedByUserId_fkey"
    FOREIGN KEY ("uploadedByUserId") REFERENCES "core"."user_accounts" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crm"."lead_import_rows"
  DROP CONSTRAINT IF EXISTS "lead_import_rows_batchId_fkey",
  ADD CONSTRAINT "lead_import_rows_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "crm"."lead_import_batches" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm"."lead_import_rows"
  DROP CONSTRAINT IF EXISTS "lead_import_rows_leadId_fkey",
  ADD CONSTRAINT "lead_import_rows_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "crm"."leads" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
