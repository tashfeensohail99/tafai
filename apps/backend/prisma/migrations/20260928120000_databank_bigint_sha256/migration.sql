-- Databank Phase 1 (resumable large uploads), step 1 of 3.
-- Generated with `prisma migrate diff` (schema → schema), additive/widening only.
--
-- fileSizeBytes int4 → BIGINT: an int4 overflows at 2,147,483,647 bytes (~2 GB);
-- databank files can be 10 GB+. int → bigint is a lossless widening. It rewrites
-- the table under a brief lock — databank_files is small today (before the
-- Google Drive migration fills it), so this is milliseconds.
-- sha256: client-computed whole-file hash (duplicate detection + resume identity).
-- uploadSessionId: the resumable-upload session that produced the row (unique →
-- a session can finalize into exactly one file). storageKey index: the direct-
-- upload commit looks files up by object key.

-- AlterTable
ALTER TABLE "processing"."databank_files" ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "uploadSessionId" TEXT,
ALTER COLUMN "fileSizeBytes" SET DATA TYPE BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "databank_files_uploadSessionId_key" ON "processing"."databank_files"("uploadSessionId");

-- CreateIndex
CREATE INDEX "databank_files_sha256_idx" ON "processing"."databank_files"("sha256");

-- CreateIndex
CREATE INDEX "databank_files_storageKey_idx" ON "processing"."databank_files"("storageKey");
