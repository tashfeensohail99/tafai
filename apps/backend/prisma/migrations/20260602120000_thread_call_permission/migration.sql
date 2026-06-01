-- Outbound call-permission hint on WhatsApp threads (Meta business-initiated
-- calls). A business call requires prior user permission; this mirrors the
-- permission-response webhook so the UI can hint GRANTED/PENDING/REJECTED.
-- Meta remains the source of truth (it rejects unpermitted calls). Additive +
-- idempotent.

ALTER TABLE "whatsapp"."threads"
  ADD COLUMN IF NOT EXISTS "callPermissionStatus"    TEXT,
  ADD COLUMN IF NOT EXISTS "callPermissionUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "callPermissionExpiresAt" TIMESTAMP(3);
