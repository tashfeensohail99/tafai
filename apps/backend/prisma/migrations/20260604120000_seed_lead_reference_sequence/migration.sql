-- Seed the atomic LEAD reference-code counter so the new generator continues
-- from where the old COUNT()-based codes left off (no collisions).
--
-- Lead reference codes are TIS-YYYY-NNNNN. We reuse the existing
-- finance.document_sequences counter (series='LEAD') — the same atomic
-- INSERT...ON CONFLICT...RETURNING mechanism used for invoices, which is safe
-- under concurrency (each caller gets a distinct number regardless of when its
-- row commits). The old generator used COUNT(*) over the year, which both
-- collided under concurrent creates (CSV import racing live inbound leads) and
-- ran a full-year count on every single insert.
--
-- We seed lastValue per year to the MAX existing 5-digit sequence, ignoring any
-- 6-digit timestamp fallback codes (>= 100000) so a past fallback can't inflate
-- future codes. Idempotent: GREATEST() guard means re-running never lowers it.
INSERT INTO "finance"."document_sequences" ("series", "year", "lastValue")
SELECT
  'LEAD',
  CAST(split_part("referenceCode", '-', 2) AS INTEGER) AS yr,
  MAX(CAST(split_part("referenceCode", '-', 3) AS INTEGER)) AS maxseq
FROM "crm"."leads"
WHERE "referenceCode" ~ '^TIS-[0-9]{4}-[0-9]+$'
  AND CAST(split_part("referenceCode", '-', 3) AS INTEGER) < 100000
GROUP BY CAST(split_part("referenceCode", '-', 2) AS INTEGER)
ON CONFLICT ("series", "year")
DO UPDATE SET "lastValue" = GREATEST(
  "finance"."document_sequences"."lastValue",
  EXCLUDED."lastValue"
);
