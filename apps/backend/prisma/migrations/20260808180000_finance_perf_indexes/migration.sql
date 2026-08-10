-- Finance perf bundle — composite indexes to kill the seq-scan-on-deletedAt
-- pattern behind Finance list/profile slowness. Additive + idempotent
-- (CREATE INDEX IF NOT EXISTS) so re-running is a no-op.
--
-- CONCURRENTLY is NOT used here because prisma db execute wraps the file in a
-- transaction and CIC can't run inside one. These tables are small (<10^5 rows
-- at time of writing) so a brief lock during CREATE INDEX is acceptable. If any
-- of these later grow past 10^6 rows, re-create with CONCURRENTLY out-of-band
-- and drop-then-rename over these.

-- Payment: the reports query filters status IN + verifiedAt + deletedAt.
CREATE INDEX IF NOT EXISTS "payments_status_verifiedAt_deletedAt_idx"
  ON "finance"."payments" ("status", "verifiedAt", "deletedAt");
-- Payment: per-invoice loads always add deletedAt IS NULL.
CREATE INDEX IF NOT EXISTS "payments_invoiceId_deletedAt_idx"
  ON "finance"."payments" ("invoiceId", "deletedAt");

-- Invoice / Expense / Agreement / ServiceContract: every finance-side owner
-- lookup adds `deletedAt IS NULL` alongside leadId / clientId. Composite
-- avoids the heap-scan for the tombstone.
CREATE INDEX IF NOT EXISTS "invoices_leadId_deletedAt_idx"
  ON "finance"."invoices" ("leadId", "deletedAt");
CREATE INDEX IF NOT EXISTS "invoices_clientId_deletedAt_idx"
  ON "finance"."invoices" ("clientId", "deletedAt");

CREATE INDEX IF NOT EXISTS "expenses_leadId_deletedAt_idx"
  ON "finance"."expenses" ("leadId", "deletedAt");
CREATE INDEX IF NOT EXISTS "expenses_clientId_deletedAt_idx"
  ON "finance"."expenses" ("clientId", "deletedAt");

CREATE INDEX IF NOT EXISTS "agreements_leadId_deletedAt_idx"
  ON "finance"."agreements" ("leadId", "deletedAt");
CREATE INDEX IF NOT EXISTS "agreements_clientId_deletedAt_idx"
  ON "finance"."agreements" ("clientId", "deletedAt");

CREATE INDEX IF NOT EXISTS "service_contracts_leadId_deletedAt_idx"
  ON "finance"."service_contracts" ("leadId", "deletedAt");
CREATE INDEX IF NOT EXISTS "service_contracts_clientId_deletedAt_idx"
  ON "finance"."service_contracts" ("clientId", "deletedAt");
