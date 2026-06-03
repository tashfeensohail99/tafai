-- Notes upgrade: allow editing (editedAt drives the "edited" label) and
-- soft-deleting a processing note (deletedAt hides it from the list but keeps
-- the row for the audit trail; deletedByUserId records who removed it).

ALTER TABLE "processing"."processing_notes"
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT;
