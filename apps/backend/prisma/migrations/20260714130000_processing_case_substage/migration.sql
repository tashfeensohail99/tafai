-- Add a lightweight per-service "sub-stage" tracking label to processing cases
-- (feedback F3). Purely informational — does NOT affect the stage machine,
-- document gates, SLA, or reporting. Nullable, no default, no backfill: zero
-- risk to existing rows.

ALTER TABLE "processing"."processing_cases" ADD COLUMN IF NOT EXISTS "subStage" TEXT;
