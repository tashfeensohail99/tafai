-- Associate personal databank folders/files. A row is now EITHER client-scoped
-- (clientId set) OR an associate's personal working item (ownerUserId set).
-- Relax the NOT NULL on clientId and add the personal-owner column + index.
-- Non-destructive: existing client rows keep clientId; ownerUserId stays NULL.

ALTER TABLE "processing"."databank_folders" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "processing"."databank_folders" ADD COLUMN "ownerUserId" TEXT;
CREATE INDEX "databank_folders_ownerUserId_idx" ON "processing"."databank_folders" ("ownerUserId");

ALTER TABLE "processing"."databank_files" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "processing"."databank_files" ADD COLUMN "ownerUserId" TEXT;
CREATE INDEX "databank_files_ownerUserId_idx" ON "processing"."databank_files" ("ownerUserId");
