-- Databank Phase 1 (resumable large uploads), step 3: upload sessions.
-- Generated with `prisma migrate diff` (schema -> schema). Purely ADDITIVE: two new
-- enums + one new table; nothing existing is altered.

-- CreateEnum
CREATE TYPE "processing"."DatabankUploadStatus" AS ENUM ('UPLOADING', 'COMPLETING', 'COMPLETED', 'ABORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "processing"."DatabankUploadStrategy" AS ENUM ('SINGLE', 'MULTIPART');

-- CreateTable
CREATE TABLE "processing"."databank_uploads" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "clientId" TEXT,
    "ownerUserId" TEXT,
    "folderId" TEXT,
    "relativePath" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "fileLastModified" TIMESTAMP(3),
    "sha256" TEXT NOT NULL,
    "strategy" "processing"."DatabankUploadStrategy" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "r2UploadId" TEXT,
    "partSize" INTEGER,
    "partCount" INTEGER,
    "status" "processing"."DatabankUploadStatus" NOT NULL DEFAULT 'UPLOADING',
    "completingAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "r2CleanedAt" TIMESTAMP(3),
    "fileId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "databank_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "databank_uploads_storageKey_key" ON "processing"."databank_uploads"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "databank_uploads_fileId_key" ON "processing"."databank_uploads"("fileId");

-- CreateIndex
CREATE INDEX "databank_uploads_createdByUserId_status_idx" ON "processing"."databank_uploads"("createdByUserId", "status");

-- CreateIndex
CREATE INDEX "databank_uploads_status_expiresAt_idx" ON "processing"."databank_uploads"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "databank_uploads_status_completingAt_idx" ON "processing"."databank_uploads"("status", "completingAt");

