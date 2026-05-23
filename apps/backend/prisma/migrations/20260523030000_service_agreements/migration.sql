-- Service agreements: template-driven authoring + Sales→Finance→Client workflow.
CREATE TYPE "finance"."AgreementStatus" AS ENUM (
  'DRAFT','SUBMITTED','FINANCE_REVIEW','CHANGES_REQUESTED','APPROVED',
  'EDITED_PENDING_SALES','SENT','SIGNED','CANCELLED'
);

CREATE TABLE "finance"."agreement_templates" (
  "id"            TEXT NOT NULL,
  "categoryKey"   TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "programTitle"  TEXT NOT NULL,
  "bodyHtml"      TEXT NOT NULL,
  "defaultStages" JSONB,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agreement_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agreement_templates_categoryKey_key"
  ON "finance"."agreement_templates"("categoryKey");

CREATE TABLE "finance"."agreements" (
  "id"                      TEXT NOT NULL,
  "agreementNumber"         TEXT NOT NULL,
  "leadId"                  TEXT NOT NULL,
  "clientId"                TEXT,
  "templateId"              TEXT NOT NULL,
  "categoryKey"             TEXT NOT NULL,
  "status"                  "finance"."AgreementStatus" NOT NULL DEFAULT 'DRAFT',
  "currency"                TEXT NOT NULL DEFAULT 'CAD',
  "totalAmount"             DECIMAL(12,2) NOT NULL DEFAULT 0,
  "bioData"                 JSONB NOT NULL,
  "paymentPlan"             JSONB NOT NULL,
  "contentHtml"             TEXT NOT NULL,
  "generatedPdfKey"         TEXT,
  "generatedPdfAt"          TIMESTAMP(3),
  "serviceContractId"       TEXT,
  "salesNotes"              TEXT,
  "financeNotes"            TEXT,
  "createdByUserId"         TEXT NOT NULL,
  "financeReviewedByUserId" TEXT,
  "submittedAt"             TIMESTAMP(3),
  "reviewedAt"              TIMESTAMP(3),
  "sentAt"                  TIMESTAMP(3),
  "signedAt"                TIMESTAMP(3),
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  "deletedAt"               TIMESTAMP(3),
  CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agreements_agreementNumber_key" ON "finance"."agreements"("agreementNumber");
CREATE INDEX "agreements_leadId_idx"      ON "finance"."agreements"("leadId");
CREATE INDEX "agreements_clientId_idx"    ON "finance"."agreements"("clientId");
CREATE INDEX "agreements_status_idx"      ON "finance"."agreements"("status");
CREATE INDEX "agreements_categoryKey_idx" ON "finance"."agreements"("categoryKey");
