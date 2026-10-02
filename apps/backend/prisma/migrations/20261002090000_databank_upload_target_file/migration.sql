-- Databank P3 PR-2 — resumable (> 2 GB) new-version uploads. Hand-written to
-- mirror what `prisma migrate diff` (schema -> schema) would produce. PURELY
-- ADDITIVE, nullable, no backfill: one new plain-id column on the upload-session
-- table. When set, the session records a NEW VERSION of the target DatabankFile
-- (via DatabankService.attachUploadedVersion at commit) instead of a new file.
-- No index needed — the value is only ever read from the session row itself.

-- AlterTable
ALTER TABLE "processing"."databank_uploads" ADD COLUMN "targetFileId" TEXT;
