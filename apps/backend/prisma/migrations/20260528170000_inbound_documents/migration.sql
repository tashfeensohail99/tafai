-- Phase E — multi-channel document intake (WhatsApp / email / portal).
-- An InboundDocument is a file that arrived without a checklist slot; the AI
-- classifies it + suggests a CaseDocumentItem, and an associate files or
-- discards it.

CREATE TYPE "processing"."InboundDocumentSource" AS ENUM ('WHATSAPP', 'EMAIL', 'PORTAL');
CREATE TYPE "processing"."InboundDocumentStatus" AS ENUM ('PENDING', 'FILED', 'DISCARDED');

CREATE TABLE "processing"."inbound_documents" (
    "id"                 TEXT NOT NULL,
    "caseId"             TEXT NOT NULL,
    "source"             "processing"."InboundDocumentSource" NOT NULL,
    "storageKey"         TEXT NOT NULL,
    "fileName"           TEXT NOT NULL,
    "mimeType"           TEXT,
    "fileSizeBytes"      INTEGER,
    "whatsappMessageId"  TEXT,
    "detectedDocType"    TEXT,
    "classifyConfidence" DOUBLE PRECISION,
    "suggestedItemId"    TEXT,
    "status"             "processing"."InboundDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "filedItemId"        TEXT,
    "filedVersionId"     TEXT,
    "filedByUserId"      TEXT,
    "triagedAt"          TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inbound_documents_caseId_status_idx"
    ON "processing"."inbound_documents"("caseId", "status");

ALTER TABLE "processing"."inbound_documents"
    ADD CONSTRAINT "inbound_documents_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "processing"."processing_cases"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
