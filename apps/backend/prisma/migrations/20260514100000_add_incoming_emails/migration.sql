-- Migration: add_incoming_emails
-- Adds the IncomingEmail model and EMAIL_RECEIVED timeline event type

-- 1. Add EMAIL_RECEIVED to the TimelineEventType enum
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'EMAIL_RECEIVED';

-- 2. Create the incoming_emails table
CREATE TABLE IF NOT EXISTS "crm"."incoming_emails" (
    "id"           TEXT NOT NULL,
    "messageId"    TEXT NOT NULL,
    "fromAddress"  TEXT NOT NULL,
    "fromName"     TEXT,
    "toAddress"    TEXT NOT NULL,
    "subject"      TEXT,
    "bodyText"     TEXT,
    "bodyHtml"     TEXT,
    "receivedAt"   TIMESTAMP(3) NOT NULL,
    "processedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId"       TEXT,
    "clientId"     TEXT,

    CONSTRAINT "incoming_emails_pkey" PRIMARY KEY ("id")
);

-- 3. Unique constraint on messageId (for deduplication)
CREATE UNIQUE INDEX IF NOT EXISTS "incoming_emails_messageId_key"
    ON "crm"."incoming_emails"("messageId");

-- 4. Indexes for common queries
CREATE INDEX IF NOT EXISTS "incoming_emails_fromAddress_idx"
    ON "crm"."incoming_emails"("fromAddress");

CREATE INDEX IF NOT EXISTS "incoming_emails_leadId_idx"
    ON "crm"."incoming_emails"("leadId");

CREATE INDEX IF NOT EXISTS "incoming_emails_clientId_idx"
    ON "crm"."incoming_emails"("clientId");

CREATE INDEX IF NOT EXISTS "incoming_emails_receivedAt_idx"
    ON "crm"."incoming_emails"("receivedAt");

-- 5. Foreign keys (nullable, SET NULL on delete)
ALTER TABLE "crm"."incoming_emails"
    ADD CONSTRAINT "incoming_emails_leadId_fkey"
    FOREIGN KEY ("leadId")
    REFERENCES "crm"."leads"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "crm"."incoming_emails"
    ADD CONSTRAINT "incoming_emails_clientId_fkey"
    FOREIGN KEY ("clientId")
    REFERENCES "crm"."clients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
    DEFERRABLE INITIALLY DEFERRED;
