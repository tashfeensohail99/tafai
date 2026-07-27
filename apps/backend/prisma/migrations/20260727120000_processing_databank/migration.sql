-- Databank: a per-client document repository for the Processing team, the
-- close-loop replacement for Google Drive. Two new tables in the processing
-- schema plus one enum. Purely additive — no existing table is touched, so
-- there is zero risk to current rows.
--
--   databank_folders  a real nested folder tree, one per client
--                     (parentFolderId NULL = the client's root)
--   databank_files    one row per file; folderId NULL = the client's root.
--                     Files belong to the CLIENT so they persist across every
--                     one of that client's cases.
--
-- Bytes live in the S3/R2 bucket (StorageService); these rows hold only the
-- object key. Access is scoped in the application layer via the existing
-- processing case permissions — nothing here enforces it.

-- How a file arrived — audit + Google Drive migration reconciliation only.
CREATE TYPE "processing"."DatabankFileSource" AS ENUM ('UPLOAD', 'CLIPBOARD', 'COPIED', 'MIGRATED');

CREATE TABLE "processing"."databank_folders" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "parentFolderId" TEXT,
    "name" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "databank_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "processing"."databank_files" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "folderId" TEXT,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "source" "processing"."DatabankFileSource" NOT NULL DEFAULT 'UPLOAD',
    "migrationSourcePath" TEXT,
    "copiedFromFileId" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "databank_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "databank_folders_clientId_idx" ON "processing"."databank_folders"("clientId");
CREATE INDEX "databank_folders_parentFolderId_idx" ON "processing"."databank_folders"("parentFolderId");
CREATE INDEX "databank_folders_deletedAt_idx" ON "processing"."databank_folders"("deletedAt");

CREATE INDEX "databank_files_clientId_idx" ON "processing"."databank_files"("clientId");
CREATE INDEX "databank_files_folderId_idx" ON "processing"."databank_files"("folderId");
CREATE INDEX "databank_files_clientId_folderId_idx" ON "processing"."databank_files"("clientId", "folderId");
CREATE INDEX "databank_files_deletedAt_idx" ON "processing"."databank_files"("deletedAt");

-- A folder belongs to a client; a hard-deleted client takes its databank tree.
ALTER TABLE "processing"."databank_folders"
    ADD CONSTRAINT "databank_folders_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Self-referential tree: hard-deleting a folder removes its subtree.
ALTER TABLE "processing"."databank_folders"
    ADD CONSTRAINT "databank_folders_parentFolderId_fkey"
    FOREIGN KEY ("parentFolderId") REFERENCES "processing"."databank_folders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "processing"."databank_files"
    ADD CONSTRAINT "databank_files_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- A file's folder; hard-deleting a folder removes its files.
ALTER TABLE "processing"."databank_files"
    ADD CONSTRAINT "databank_files_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "processing"."databank_folders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
