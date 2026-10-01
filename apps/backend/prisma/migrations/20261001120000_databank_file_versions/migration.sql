-- Databank P3-2 — file versioning (PR-1). Hand-written to mirror what
-- `prisma migrate diff` (schema → schema) would produce. PURELY ADDITIVE, NO
-- data transform: one new table, plus two additive/nullable columns + a partial
-- unique index on databank_files. Trivially safe + idempotent on the tiny prod
-- table — existing files stay "implicit v1" (currentVersionId NULL, no version
-- rows); the first commitNewVersion lazily materialises v1.

-- CreateTable
CREATE TABLE "processing"."databank_file_versions" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSizeBytes" BIGINT,
    "sha256" TEXT,
    "source" "processing"."DatabankFileSource" NOT NULL DEFAULT 'UPLOAD',
    "name" TEXT,
    "uploadSessionId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "databank_file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "databank_file_versions_storageKey_key" ON "processing"."databank_file_versions"("storageKey");

-- CreateIndex: PR-2 resumable-version idempotency home; always null in PR-1.
-- Partial so the many PR-1 NULLs never collide (a plain unique already treats
-- NULLs as distinct in Postgres — this just makes the intent explicit).
CREATE UNIQUE INDEX "databank_file_versions_uploadSessionId_key" ON "processing"."databank_file_versions"("uploadSessionId") WHERE "uploadSessionId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "databank_file_versions_fileId_idx" ON "processing"."databank_file_versions"("fileId");

-- CreateIndex
CREATE INDEX "databank_file_versions_storageKey_idx" ON "processing"."databank_file_versions"("storageKey");

-- CreateIndex
CREATE INDEX "databank_file_versions_sha256_idx" ON "processing"."databank_file_versions"("sha256");

-- CreateIndex: serialised numbering backstop (max+1 + this unique).
CREATE UNIQUE INDEX "databank_file_versions_fileId_versionNumber_key" ON "processing"."databank_file_versions"("fileId", "versionNumber");

-- AddForeignKey: a version rides with its file — purging the file cascade-deletes
-- its version rows (their object keys are captured + freed BEFORE the cascade).
ALTER TABLE "processing"."databank_file_versions" ADD CONSTRAINT "databank_file_versions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "processing"."databank_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: additive/nullable version bookkeeping on the file mirror.
-- currentVersionId is a PLAIN id (no FK) → no file<->version cyclic FK.
ALTER TABLE "processing"."databank_files" ADD COLUMN     "currentVersionId" TEXT,
ADD COLUMN     "versionSeq" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex: integrity belt-and-braces — one version is current for at most one
-- file (partial so the many implicit-v1 NULLs never collide).
CREATE UNIQUE INDEX "databank_files_currentVersionId_key" ON "processing"."databank_files"("currentVersionId") WHERE "currentVersionId" IS NOT NULL;
