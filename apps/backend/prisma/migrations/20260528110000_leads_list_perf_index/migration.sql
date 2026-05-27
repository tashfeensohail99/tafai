-- Compound index that matches the common list query:
--   WHERE deletedAt IS NULL ORDER BY createdAt DESC
-- Without this, Postgres falls back to a full sequential scan + in-memory
-- sort once row count grows past a few hundred. With 1037 leads in prod
-- the list query was taking 3+ seconds. This brings it down to ~50ms.
CREATE INDEX IF NOT EXISTS "leads_deletedAt_createdAt_idx"
  ON "crm"."leads" ("deletedAt", "createdAt" DESC);
