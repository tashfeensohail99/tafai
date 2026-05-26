-- Internal-only annotation on Payment, separate from the client-visible
-- `notes` column. Used for audit breadcrumbs (e.g. "handover:<id>") that
-- must NOT appear on the client's receipt PDF.

ALTER TABLE "finance"."payments" ADD COLUMN "internalReference" TEXT;
