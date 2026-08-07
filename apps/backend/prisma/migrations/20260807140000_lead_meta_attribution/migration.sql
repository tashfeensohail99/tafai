-- Durable Meta ad attribution on the Lead (Phase 1B).
--
-- Today a CTWA lead's ad lives only as JSON on its WhatsApp thread, and ad
-- reporting is a runtime Lead→Thread join. The thread↔lead link is
-- onDelete:SetNull, so when a lead converts to a client the thread detaches and
-- the attribution ORPHANS — the converted lead can no longer be traced to its
-- ad. Denormalising the ad/adset/campaign identifiers onto the lead at creation
-- makes attribution survive conversion, which is what "which ad produced a
-- paying client?" needs.
ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "metaSource"       TEXT;
ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "metaAdId"         TEXT;
ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "metaAdName"       TEXT;
ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "metaAdsetId"      TEXT;
ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "metaAdsetName"    TEXT;
ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "metaCampaignId"   TEXT;
ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "metaCampaignName" TEXT;
ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "metaFormId"       TEXT;
ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "metaLeadId"       TEXT;
ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "ctwaClid"         TEXT;

CREATE INDEX IF NOT EXISTS "leads_metaAdId_idx"       ON "crm"."leads"("metaAdId");
CREATE INDEX IF NOT EXISTS "leads_metaCampaignId_idx" ON "crm"."leads"("metaCampaignId");
