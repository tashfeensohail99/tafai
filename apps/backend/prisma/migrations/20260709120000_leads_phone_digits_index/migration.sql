-- Kill the full-table regex scan behind ~11% of ALL database CPU.
--
-- `findLeadByNormalizedPhone` (common/phone/lead-dedupe.ts) matches a lead by
-- its digits-only phone. Postgres had no way to serve that predicate, so every
-- call did a Seq Scan over all ~21k live leads, running a regex on each row:
--   Seq Scan on leads  Filter: (regexp_replace(phone,'[^0-9]','','g') = ANY(...))
-- Measured at ~21.5s per call (pg_stat_statements), and it runs on the WhatsApp
-- webhook ingest hot path whenever the exact-phone lookup misses. Worse: the
-- self-heal only canonicalises the phone on a MATCH, so an unknown number
-- (no lead) re-ran the whole scan on every inbound message.
--
-- `regexp_replace(text,text,text,text)` is IMMUTABLE (verified: provolatile='i'),
-- so it can back an expression index. The expression here must match the query
-- byte-for-byte; lead-dedupe.ts uses the same '[^0-9]' character class (chosen
-- over '\D' — provably identical on all 21,037 live leads — because it carries
-- no backslash-escaping hazard between the TS template, the driver and SQL).
--
-- Partial on "deletedAt" IS NULL: the query always filters on it, so the index
-- stays small and is still usable. Plain (non-CONCURRENT) CREATE INDEX is safe
-- inside Prisma's migration transaction — crm.leads is ~13MB / 21k rows, so it
-- builds in milliseconds.
--
-- NOTE: Prisma's schema.prisma cannot express expression indexes, so this index
-- is intentionally invisible to the schema. Do not "fix" the drift by dropping it.
CREATE INDEX IF NOT EXISTS "leads_phone_digits_idx"
  ON "crm"."leads" ((regexp_replace(phone, '[^0-9]', '', 'g')))
  WHERE "deletedAt" IS NULL;

-- Refresh planner statistics so the new index is used immediately.
ANALYZE "crm"."leads";
