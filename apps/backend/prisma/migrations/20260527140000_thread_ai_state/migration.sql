-- Per-thread AI bot state: hard on/off toggle, human-handover lockout
-- timestamp, and conversation phase tracker for the appointment funnel.
ALTER TABLE "whatsapp"."threads"
  ADD COLUMN "aiEnabled"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "aiDisabledAt" TIMESTAMP(3),
  ADD COLUMN "aiState"      TEXT    NOT NULL DEFAULT 'INITIAL';

-- Index so the orchestrator's "are we within the 4h human-lockout window?"
-- check is cheap.
CREATE INDEX "threads_aiDisabledAt_idx" ON "whatsapp"."threads" ("aiDisabledAt");
