-- Durable reminder ledger (crm schema).
--
-- Replaces the in-memory setInterval appointment-reminder sweeper with a
-- DB-backed job table so reminders survive a process restart. The dispatcher
-- reconciles upcoming appointments + follow-ups into this table, then fires the
-- rows whose `runAt` has arrived. `dedupeKey` is unique so reconciling the same
-- source row twice is a harmless no-op.
--
-- Pattern matches existing crm tables: TEXT UUID primary keys, camelCase
-- columns, snake_case table name via @@map, schema = "crm". No foreign keys by
-- design — the ledger is decoupled from its sources and the dispatcher
-- re-validates each job against the live appointment / follow-up at send time.

-- =============================================================================
-- ENUMS
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "crm"."ReminderJobKind" AS ENUM (
    'APPOINTMENT_REMINDER', 'FOLLOWUP_DUE', 'FOLLOWUP_OVERDUE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "crm"."ReminderJobStatus" AS ENUM (
    'PENDING', 'SENT', 'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "crm"."reminder_jobs" (
  "id"            TEXT NOT NULL,
  "kind"          "crm"."ReminderJobKind" NOT NULL,
  "status"        "crm"."ReminderJobStatus" NOT NULL DEFAULT 'PENDING',
  "runAt"         TIMESTAMP(3) NOT NULL,
  "dedupeKey"     TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "leadId"        TEXT,
  "appointmentId" TEXT,
  "followUpId"    TEXT,
  "title"         TEXT NOT NULL,
  "body"          TEXT,
  "link"          TEXT,
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "sentAt"        TIMESTAMP(3),
  "lastError"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "reminder_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "reminder_jobs_dedupeKey_key"
  ON "crm"."reminder_jobs" ("dedupeKey");

CREATE INDEX IF NOT EXISTS "reminder_jobs_status_runAt_idx"
  ON "crm"."reminder_jobs" ("status", "runAt");

CREATE INDEX IF NOT EXISTS "reminder_jobs_appointmentId_idx"
  ON "crm"."reminder_jobs" ("appointmentId");

CREATE INDEX IF NOT EXISTS "reminder_jobs_followUpId_idx"
  ON "crm"."reminder_jobs" ("followUpId");

CREATE INDEX IF NOT EXISTS "reminder_jobs_userId_idx"
  ON "crm"."reminder_jobs" ("userId");
