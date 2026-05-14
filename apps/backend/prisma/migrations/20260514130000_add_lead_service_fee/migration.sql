-- Stage 1 of finance refactor: capture the agreed service fee on the Lead.
--
-- Why on Lead and not a separate ServiceContract table:
--   - The lead-to-client lifecycle already exists; piggybacking on it avoids
--     a new model that lives in parallel and stays in sync.
--   - One service contract per lead is the 99% case. Multi-service-per-lead
--     is rare here and can be handled later by promoting these columns to a
--     dedicated table without breaking existing rows.
--
-- Optional columns: existing leads have no fee captured, so they stay NULL.
-- When NULL, the finance layer falls back to the first handover's
-- submittedAmount (current behaviour) — backwards compatible.

ALTER TABLE "crm"."leads"
  ADD COLUMN IF NOT EXISTS "serviceFeeAmount"   DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "serviceFeeCurrency" TEXT;
