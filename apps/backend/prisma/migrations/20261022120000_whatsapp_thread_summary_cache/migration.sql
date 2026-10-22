-- On-demand WhatsApp chat "Summary & Suggested reply" cache. Re-opening a
-- thread reuses the cached brief (keyed on the newest message id) so we never
-- re-bill gpt-4o-mini unless the conversation has actually moved on or the rep
-- hits Regenerate. All three columns are nullable with no default → the ADD
-- COLUMN is instant and zero-downtime on Postgres; existing rows get NULL (no
-- summary generated yet).
ALTER TABLE "whatsapp"."threads" ADD COLUMN "aiSummary" JSONB, ADD COLUMN "aiSummaryThroughMessageId" TEXT, ADD COLUMN "aiSummaryAt" TIMESTAMP(3);
