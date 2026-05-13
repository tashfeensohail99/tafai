-- CreateTable
CREATE TABLE "crm"."lead_files" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileMimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_files_leadId_idx" ON "crm"."lead_files"("leadId");

-- AddForeignKey
ALTER TABLE "crm"."lead_files" ADD CONSTRAINT "lead_files_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
