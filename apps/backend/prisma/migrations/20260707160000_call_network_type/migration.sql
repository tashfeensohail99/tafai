-- Per-call network diagnostics: is a bad/ended call on wifi or mobile data?
-- Reported by the client on the quality CDR (recordStats). Nullable, additive.
ALTER TABLE "whatsapp"."calls" ADD COLUMN "networkType" TEXT;
ALTER TABLE "whatsapp"."calls" ADD COLUMN "clientPlatform" TEXT;
