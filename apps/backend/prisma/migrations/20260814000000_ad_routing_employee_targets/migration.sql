-- Ad routing rules can now pin specific employees (in ADDITION to whole branches).
-- Additive + idempotent: a new array column defaulting to empty on existing rows.

ALTER TABLE "crm"."ad_routing_rules"
  ADD COLUMN IF NOT EXISTS "employeeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
