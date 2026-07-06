-- Truthful call telemetry:
--  * answeredAt      — when the rep actually picked up. startedAt is the RING
--                      start for inbound calls, so durations computed from it
--                      include ring time; talk time must anchor on answeredAt.
--  * answeredByUserId — the answering USER even when they have no Employee row
--                      (the admin account answers ~half of all inbound calls;
--                      with only answeredByEmployeeId those calls silently
--                      no-op heartbeat/CDR/zombie-protection).
ALTER TABLE "whatsapp"."calls" ADD COLUMN "answeredAt" TIMESTAMP(3);
ALTER TABLE "whatsapp"."calls" ADD COLUMN "answeredByUserId" TEXT;
