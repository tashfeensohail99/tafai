-- Per-call liveness (heartbeat) + quality CDR for the WhatsApp softphone.
-- Additive only: all columns nullable, no backfill, safe on a live table.

ALTER TABLE "whatsapp"."calls"
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "endReason"       TEXT,
  ADD COLUMN "iceCandidateType" TEXT,
  ADD COLUMN "rttMs"           INTEGER,
  ADD COLUMN "jitterMs"        INTEGER,
  ADD COLUMN "packetLossPct"   DOUBLE PRECISION,
  ADD COLUMN "bytesSent"       INTEGER,
  ADD COLUMN "bytesReceived"   INTEGER;

-- The sweeper scans active calls by (status, lastHeartbeatAt) to find stale
-- ANSWERED calls and expired RINGING calls.
CREATE INDEX "calls_status_lastHeartbeatAt_idx" ON "whatsapp"."calls"("status", "lastHeartbeatAt");
