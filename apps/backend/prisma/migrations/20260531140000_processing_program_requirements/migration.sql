-- Phase 0: program-specific requirement sets + attestation + staging + dependents-ready roles.
-- Fully additive: new enums, new nullable/defaulted columns, one new table.
-- Safe on existing rows (every new column is nullable or has a default).

-- ── New enums (processing schema) ──────────────────────────────────────────
CREATE TYPE "processing"."DocumentStageGroup" AS ENUM ('PROVIDE_FIRST', 'NEXT', 'LATER');
CREATE TYPE "processing"."ApplicantRole" AS ENUM ('PRIMARY', 'SPOUSE', 'DEPENDENT', 'EMPLOYER', 'OTHER');
CREATE TYPE "processing"."DocumentAttestationStatus" AS ENUM ('NOT_REQUIRED', 'REQUIRED_PENDING', 'DONE', 'WAIVED');

-- ── DocumentRequirementTemplate additions ──────────────────────────────────
ALTER TABLE "processing"."document_requirement_templates"
  ADD COLUMN "programCode"            TEXT,
  ADD COLUMN "applicantRole"          "processing"."ApplicantRole"      NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN "stageGroup"             "processing"."DocumentStageGroup" NOT NULL DEFAULT 'NEXT',
  ADD COLUMN "attestationRequired"    BOOLEAN                           NOT NULL DEFAULT false,
  ADD COLUMN "attestationChain"       TEXT,
  ADD COLUMN "translationRequired"    BOOLEAN                           NOT NULL DEFAULT false,
  ADD COLUMN "prerequisiteTemplateId" TEXT,
  ADD COLUMN "whyText"                TEXT,
  ADD COLUMN "exampleGoodUrl"         TEXT,
  ADD COLUMN "exampleBadUrl"          TEXT;

CREATE INDEX "document_requirement_templates_programCode_targetCountry_idx"
  ON "processing"."document_requirement_templates" ("programCode", "targetCountry");

-- ── CaseDocumentItem additions (per-case copies of the above) ───────────────
ALTER TABLE "processing"."case_document_items"
  ADD COLUMN "applicantRole"      "processing"."ApplicantRole"             NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN "stageGroup"         "processing"."DocumentStageGroup"        NOT NULL DEFAULT 'NEXT',
  ADD COLUMN "attestationStatus"  "processing"."DocumentAttestationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "attestationChain"   TEXT,
  ADD COLUMN "translationStatus"  "processing"."DocumentAttestationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "prerequisiteItemId" TEXT,
  ADD COLUMN "whyText"            TEXT,
  ADD COLUMN "exampleGoodUrl"     TEXT,
  ADD COLUMN "exampleBadUrl"      TEXT;

-- ── ProgramRequirementSet (catalog) ─────────────────────────────────────────
CREATE TABLE "processing"."program_requirement_sets" (
  "id"               TEXT NOT NULL,
  "programCode"      TEXT NOT NULL,
  "targetCountry"    TEXT NOT NULL,
  "displayName"      TEXT NOT NULL,
  "notes"            TEXT,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "lastVerifiedAt"   TIMESTAMP(3),
  "verifiedByUserId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "program_requirement_sets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_requirement_sets_programCode_targetCountry_key"
  ON "processing"."program_requirement_sets" ("programCode", "targetCountry");
