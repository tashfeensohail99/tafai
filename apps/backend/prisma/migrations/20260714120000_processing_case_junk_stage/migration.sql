-- Add a JUNK terminal stage to ProcessingCaseStage (feedback F12).
--
-- JUNK marks a case that was never real work (spam / duplicate / dead lead).
-- It behaves like CANCELLED for active-list exclusion and reuses the existing
-- cancelledAt / cancellationReason columns — no new columns for the stage.
--
-- Postgres requires each enum value addition to be its own ALTER TYPE, and the
-- new value must commit before being USED in DDL that references it. This
-- migration only ADDS the value (no DDL uses it), so it is safe in one step.
-- IF NOT EXISTS keeps it idempotent across re-runs.

ALTER TYPE "processing"."ProcessingCaseStage" ADD VALUE IF NOT EXISTS 'JUNK';
