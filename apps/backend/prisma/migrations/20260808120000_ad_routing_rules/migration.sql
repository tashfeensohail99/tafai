-- Phase 1E — editable ad-routing rules.
-- Additive + idempotent: new enum + new table.

DO $$ BEGIN
  CREATE TYPE "crm"."AdRoutingTargetType" AS ENUM ('AD', 'CAMPAIGN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "crm"."ad_routing_rules" (
    "id"              TEXT NOT NULL,
    "targetType"      "crm"."AdRoutingTargetType" NOT NULL,
    "targetId"        TEXT NOT NULL,
    "branchIds"       TEXT[] NOT NULL,
    "notes"           TEXT,
    "createdByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ad_routing_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ad_routing_rules_targetType_targetId_key"
  ON "crm"."ad_routing_rules"("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "ad_routing_rules_targetType_idx"
  ON "crm"."ad_routing_rules"("targetType");
