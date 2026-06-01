-- Phase 1: WebRTC signaling fields on the call row (SDP offer/answer, answerer,
-- ring expiry). Additive + idempotent.

ALTER TABLE "whatsapp"."calls"
  ADD COLUMN IF NOT EXISTS "sdpOffer"             TEXT,
  ADD COLUMN IF NOT EXISTS "sdpAnswer"            TEXT,
  ADD COLUMN IF NOT EXISTS "answeredByEmployeeId" TEXT,
  ADD COLUMN IF NOT EXISTS "ringExpiresAt"        TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "whatsapp"."calls"
    ADD CONSTRAINT "calls_answeredByEmployeeId_fkey"
    FOREIGN KEY ("answeredByEmployeeId") REFERENCES "core"."employees"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
