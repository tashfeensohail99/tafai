-- WhatsApp spam / block. A contact (Lead and/or the Client it converted to —
-- keyed by phone) can be BLOCKED. When blockedAt is set, inbound WhatsApp
-- messages are dropped (no thread/message, the AI bot stays silent) and inbound
-- WhatsApp calls are ignored (no ring, no notification). blockedByUserId records
-- the actor for audit only (no FK). Outbound is NOT blocked. Block state lives on
-- BOTH models because a phone number can resolve to a Lead or a converted Client.
-- All columns are nullable with no default, so this is a safe, non-backfill add.

ALTER TABLE "crm"."leads"   ADD COLUMN IF NOT EXISTS "blockedAt"       TIMESTAMP(3);
ALTER TABLE "crm"."leads"   ADD COLUMN IF NOT EXISTS "blockedReason"   TEXT;
ALTER TABLE "crm"."leads"   ADD COLUMN IF NOT EXISTS "blockedByUserId" TEXT;

ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "blockedAt"       TIMESTAMP(3);
ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "blockedReason"   TEXT;
ALTER TABLE "crm"."clients" ADD COLUMN IF NOT EXISTS "blockedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "leads_blockedAt_idx"   ON "crm"."leads"("blockedAt");
CREATE INDEX IF NOT EXISTS "clients_blockedAt_idx" ON "crm"."clients"("blockedAt");
