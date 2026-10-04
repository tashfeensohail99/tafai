-- Processing / JR databank separation (Step 2 of the department-separation work).
-- Additive + reversible: adds a `department` discriminator to every databank row
-- (existing rows backfill to PROCESSING via the column default) and a
-- `databank_shares` grant table. Nothing enforces separation yet — the read/write
-- paths start honoring `department` + shares only once the separation flag is
-- flipped on in a later step. There is NO grandfather/auto-share backfill: a
-- share row exists only when a Processing manager creates one.

-- CreateEnum
CREATE TYPE "processing"."DatabankDepartment" AS ENUM ('PROCESSING', 'JR');

-- CreateEnum
CREATE TYPE "processing"."DatabankShareAccess" AS ENUM ('READ', 'WRITE');

-- AlterTable
ALTER TABLE "processing"."databank_folders" ADD COLUMN     "department" "processing"."DatabankDepartment" NOT NULL DEFAULT 'PROCESSING';

-- AlterTable
ALTER TABLE "processing"."databank_files" ADD COLUMN     "department" "processing"."DatabankDepartment" NOT NULL DEFAULT 'PROCESSING';

-- AlterTable
ALTER TABLE "processing"."databank_uploads" ADD COLUMN     "department" "processing"."DatabankDepartment" NOT NULL DEFAULT 'PROCESSING';

-- CreateTable
CREATE TABLE "processing"."databank_shares" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "folderId" TEXT,
    "fromDepartment" "processing"."DatabankDepartment" NOT NULL DEFAULT 'PROCESSING',
    "toDepartment" "processing"."DatabankDepartment" NOT NULL DEFAULT 'JR',
    "accessLevel" "processing"."DatabankShareAccess" NOT NULL DEFAULT 'READ',
    "grantedByUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "note" VARCHAR(400),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "databank_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "databank_shares_clientId_toDepartment_revokedAt_idx" ON "processing"."databank_shares"("clientId", "toDepartment", "revokedAt");

-- CreateIndex
CREATE INDEX "databank_shares_folderId_idx" ON "processing"."databank_shares"("folderId");

-- CreateIndex
CREATE INDEX "databank_folders_clientId_department_idx" ON "processing"."databank_folders"("clientId", "department");

-- CreateIndex
CREATE INDEX "databank_files_clientId_department_idx" ON "processing"."databank_files"("clientId", "department");

-- AddForeignKey
ALTER TABLE "processing"."databank_shares" ADD CONSTRAINT "databank_shares_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing"."databank_shares" ADD CONSTRAINT "databank_shares_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "processing"."databank_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One ACTIVE grant per (client, folder-target, toDepartment). A whole-client
-- share has folderId NULL, so COALESCE maps it to a fixed sentinel to collide
-- with other whole-client shares; revoked rows (revokedAt NOT NULL) are excluded
-- so re-sharing after a revoke keeps full history. Prisma can't express a partial
-- index, so it is created in raw SQL here.
CREATE UNIQUE INDEX "databank_shares_active_uq"
    ON "processing"."databank_shares" ("clientId", COALESCE("folderId", '00000000-0000-0000-0000-000000000000'), "toDepartment")
    WHERE "revokedAt" IS NULL;
