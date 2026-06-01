-- Phase 0 of WhatsApp call routing: log inbound calls so they can be routed to
-- the assigned rep (callback task + bell notification). Scalar table with
-- DB-level FKs; idempotent so it can re-apply safely.

CREATE TABLE IF NOT EXISTS "whatsapp"."calls" (
  "id"                 TEXT NOT NULL,
  "threadId"           TEXT,
  "channelId"          TEXT NOT NULL,
  "leadId"             TEXT,
  "clientId"           TEXT,
  "assignedEmployeeId" TEXT,
  "waCallId"           TEXT NOT NULL,
  "direction"          TEXT NOT NULL DEFAULT 'INBOUND',
  "status"             TEXT NOT NULL DEFAULT 'RINGING',
  "event"              TEXT,
  "startedAt"          TIMESTAMP(3),
  "endedAt"            TIMESTAMP(3),
  "durationSeconds"    INTEGER,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "calls_waCallId_key"
  ON "whatsapp"."calls" ("waCallId");
CREATE INDEX IF NOT EXISTS "calls_assignedEmployeeId_createdAt_idx"
  ON "whatsapp"."calls" ("assignedEmployeeId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "calls_leadId_idx"   ON "whatsapp"."calls" ("leadId");
CREATE INDEX IF NOT EXISTS "calls_clientId_idx" ON "whatsapp"."calls" ("clientId");
CREATE INDEX IF NOT EXISTS "calls_threadId_idx" ON "whatsapp"."calls" ("threadId");

-- Foreign keys (idempotent — duplicate_object swallowed on re-apply).
DO $$ BEGIN
  ALTER TABLE "whatsapp"."calls"
    ADD CONSTRAINT "calls_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "whatsapp"."channels"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp"."calls"
    ADD CONSTRAINT "calls_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "whatsapp"."threads"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp"."calls"
    ADD CONSTRAINT "calls_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp"."calls"
    ADD CONSTRAINT "calls_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp"."calls"
    ADD CONSTRAINT "calls_assignedEmployeeId_fkey"
    FOREIGN KEY ("assignedEmployeeId") REFERENCES "core"."employees"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
