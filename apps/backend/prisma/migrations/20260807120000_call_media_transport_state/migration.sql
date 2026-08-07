-- Where the media path actually breaks.
--
-- 7% of answered calls (54/813 over 30d) carry ZERO audio in both directions
-- while reporting a healthy RTT -- so ICE checks were passing and the network
-- path existed. The CDR could show the path was fine and the audio was absent,
-- but nothing about the step in between. These columns record the WebRTC
-- transport states at CDR time so a dead call names its own failure point.
ALTER TABLE "whatsapp"."calls" ADD COLUMN IF NOT EXISTS "dtlsState" TEXT;
ALTER TABLE "whatsapp"."calls" ADD COLUMN IF NOT EXISTS "iceConnectionState" TEXT;
ALTER TABLE "whatsapp"."calls" ADD COLUMN IF NOT EXISTS "connectionState" TEXT;

-- Set when the client's own watchdog observed zero inbound audio while the peer
-- was connected -- i.e. the fault was caught DURING the call, not inferred
-- afterwards from byte counters.
ALTER TABLE "whatsapp"."calls" ADD COLUMN IF NOT EXISTS "deadAudioDetectedAt" TIMESTAMP(3);
