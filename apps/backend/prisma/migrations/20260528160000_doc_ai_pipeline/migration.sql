-- Phase D — document-processing pipeline foundation.
--
-- Adds:
--   * DocumentKind / AiSuggestedDecision enums
--   * docType + documentKind + photoSpec on document_requirement_templates
--     and case_document_items (the per-case copy)
--   * document_ai_assessments table (shadow + auto-approve store)
--   * isAutomated / aiAssessmentId on document_review_decisions, and makes
--     reviewedByUserId nullable so an automated (auto-approve) decision can
--     exist without a human reviewer.
--   * A name-based backfill that tags the existing seeded templates (and any
--     already-created case items) with a canonical docType and flags photo
--     requirements (white background, 35x45mm) so the parser has something to
--     validate against on day one.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "processing"."DocumentKind" AS ENUM ('TEXT_DOCUMENT', 'PHOTO');
CREATE TYPE "processing"."AiSuggestedDecision" AS ENUM ('APPROVE', 'REJECT', 'NEEDS_REVIEW');

-- ---------------------------------------------------------------------------
-- Template + case-item columns
-- ---------------------------------------------------------------------------
ALTER TABLE "processing"."document_requirement_templates"
    ADD COLUMN "docType"      TEXT,
    ADD COLUMN "documentKind" "processing"."DocumentKind" NOT NULL DEFAULT 'TEXT_DOCUMENT',
    ADD COLUMN "photoSpec"    JSONB;

ALTER TABLE "processing"."case_document_items"
    ADD COLUMN "docType"      TEXT,
    ADD COLUMN "documentKind" "processing"."DocumentKind" NOT NULL DEFAULT 'TEXT_DOCUMENT',
    ADD COLUMN "photoSpec"    JSONB;

-- ---------------------------------------------------------------------------
-- AI assessment store
-- ---------------------------------------------------------------------------
CREATE TABLE "processing"."document_ai_assessments" (
    "id"                TEXT NOT NULL,
    "documentItemId"    TEXT NOT NULL,
    "versionId"         TEXT NOT NULL,
    "caseId"            TEXT NOT NULL,
    "detectedDocType"   TEXT,
    "expectedDocType"   TEXT,
    "confidence"        DOUBLE PRECISION,
    "extracted"         JSONB,
    "checks"            JSONB,
    "suggestedDecision" "processing"."AiSuggestedDecision" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "reasonCodes"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "ocrTier"           TEXT,
    "costCents"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cacheHit"          BOOLEAN NOT NULL DEFAULT false,
    "autoApproved"      BOOLEAN NOT NULL DEFAULT false,
    "modelVersion"      TEXT,
    "errorMessage"      TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_ai_assessments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_ai_assessments_documentItemId_idx"
    ON "processing"."document_ai_assessments"("documentItemId");
CREATE INDEX "document_ai_assessments_versionId_idx"
    ON "processing"."document_ai_assessments"("versionId");
CREATE INDEX "document_ai_assessments_caseId_idx"
    ON "processing"."document_ai_assessments"("caseId");

ALTER TABLE "processing"."document_ai_assessments"
    ADD CONSTRAINT "document_ai_assessments_documentItemId_fkey"
    FOREIGN KEY ("documentItemId") REFERENCES "processing"."case_document_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "processing"."document_ai_assessments"
    ADD CONSTRAINT "document_ai_assessments_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "processing"."client_document_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Automation fields on the human review-decision record
-- ---------------------------------------------------------------------------
ALTER TABLE "processing"."document_review_decisions"
    ALTER COLUMN "reviewedByUserId" DROP NOT NULL;

ALTER TABLE "processing"."document_review_decisions"
    ADD COLUMN "isAutomated"    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "aiAssessmentId" TEXT;

CREATE UNIQUE INDEX "document_review_decisions_aiAssessmentId_key"
    ON "processing"."document_review_decisions"("aiAssessmentId");

ALTER TABLE "processing"."document_review_decisions"
    ADD CONSTRAINT "document_review_decisions_aiAssessmentId_fkey"
    FOREIGN KEY ("aiAssessmentId") REFERENCES "processing"."document_ai_assessments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: tag known doc types + flag photo requirements.
--
-- Photo first (so "Passport-sized photographs" is classified PHOTOGRAPH, not
-- PASSPORT); every later UPDATE is guarded by "docType" IS NULL so it never
-- clobbers an earlier classification. Applied to both the templates and any
-- case items that were already created from them.
-- ---------------------------------------------------------------------------

-- Photographs -> PHOTO kind + default spec (white background, 35x45mm portrait)
UPDATE "processing"."document_requirement_templates"
   SET "docType" = 'PHOTOGRAPH',
       "documentKind" = 'PHOTO',
       "photoSpec" = '{"background":"WHITE","sizeMm":"35x45","faceRequired":true,"maxBlur":100}'::jsonb
 WHERE "docType" IS NULL
   AND ("documentName" ILIKE '%photo%' OR "documentName" ILIKE '%photograph%');

UPDATE "processing"."case_document_items"
   SET "docType" = 'PHOTOGRAPH',
       "documentKind" = 'PHOTO',
       "photoSpec" = '{"background":"WHITE","sizeMm":"35x45","faceRequired":true,"maxBlur":100}'::jsonb
 WHERE "docType" IS NULL
   AND ("documentName" ILIKE '%photo%' OR "documentName" ILIKE '%photograph%');

-- Text documents -> canonical docType tags (applied to templates, then items).
DO $$
DECLARE
    rules CONSTANT TEXT[][] := ARRAY[
        ['PASSPORT',             '%passport%'],
        ['NATIONAL_ID',          '%national id%'],
        ['NATIONAL_ID',          '%cnic%'],
        ['NATIONAL_ID',          '%identity card%'],
        ['BANK_STATEMENT',       '%bank statement%'],
        ['BANK_STATEMENT',       '%proof of funds%'],
        ['LANGUAGE_TEST',        '%language%'],
        ['LANGUAGE_TEST',        '%ielts%'],
        ['LANGUAGE_TEST',        '%toefl%'],
        ['LANGUAGE_TEST',        '%duolingo%'],
        ['ACADEMIC_TRANSCRIPT',  '%transcript%'],
        ['EDUCATION_CERTIFICATE','%educational cert%'],
        ['EDUCATION_CERTIFICATE','%degree%'],
        ['EDUCATION_CERTIFICATE','%diploma%'],
        ['ACCEPTANCE_LETTER',    '%acceptance%'],
        ['ACCEPTANCE_LETTER',    '%admission%'],
        ['STATEMENT_OF_PURPOSE', '%statement of purpose%'],
        ['STATEMENT_OF_PURPOSE', '%(sop)%'],
        ['RESUME',               '%resume%'],
        ['RESUME',               '%curriculum vitae%'],
        ['RESUME',               '% cv%'],
        ['POLICE_CLEARANCE',     '%police%'],
        ['POLICE_CLEARANCE',     '%clearance certificate%'],
        ['MEDICAL_EXAM',         '%medical%'],
        ['MARRIAGE_CERTIFICATE', '%marriage%'],
        ['BIRTH_CERTIFICATE',    '%birth certificate%'],
        ['EMPLOYMENT_LETTER',    '%employment letter%'],
        ['EMPLOYMENT_LETTER',    '%offer letter%'],
        ['EMPLOYMENT_LETTER',    '%experience letter%'],
        ['LMIA',                 '%lmia%'],
        ['BUSINESS_PLAN',        '%business plan%'],
        ['INCORPORATION',        '%incorporation%'],
        ['INCORPORATION',        '%business registration%'],
        ['TAX_RETURN',           '%tax return%'],
        ['TAX_RETURN',           '%tax document%'],
        ['SPONSORSHIP_LETTER',   '%sponsor%'],
        ['TRAVEL_ITINERARY',     '%itinerary%'],
        ['VISA',                 '%previous visa%'],
        ['VISA',                 '%visa copy%']
    ];
    r TEXT[];
BEGIN
    FOREACH r SLICE 1 IN ARRAY rules LOOP
        UPDATE "processing"."document_requirement_templates"
           SET "docType" = r[1]
         WHERE "docType" IS NULL AND "documentName" ILIKE r[2];

        UPDATE "processing"."case_document_items"
           SET "docType" = r[1]
         WHERE "docType" IS NULL AND "documentName" ILIKE r[2];
    END LOOP;
END $$;
