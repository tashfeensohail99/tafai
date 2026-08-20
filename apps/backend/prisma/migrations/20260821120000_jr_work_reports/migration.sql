-- Judicial Review associate work-report subsystem (§11.7, PR 10A).
-- Additive + idempotent: 3 enums + 3 tables + indexes + 2 FKs, all in "legal".
-- The report BODY is never stored — only the parameters, the manual enrichments,
-- and (at finalize, 10C) the frozen PDF snapshot persist.
-- The migration is APPLIED BY THE USER (prisma migrate deploy at boot). Keep re-runnable.

-- ── 1. enums ─────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "legal"."JrWorkReportStatus" AS ENUM ('DRAFT','FINALIZED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrWorkReportAttachmentKind" AS ENUM ('IMAGE','VOICE_NOTE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "legal"."JrTranscriptStatus" AS ENUM ('PENDING','DONE','FAILED'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 2. jr_work_reports ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "legal"."jr_work_reports" (
    "id"                     TEXT NOT NULL,
    "subjectAssociateUserId" TEXT NOT NULL,
    "periodFrom"             DATE NOT NULL,
    "periodTo"               DATE NOT NULL,
    "canViewAllAtCompile"    BOOLEAN NOT NULL DEFAULT false,
    "status"                 "legal"."JrWorkReportStatus" NOT NULL DEFAULT 'DRAFT',
    "frozenPdfKey"           VARCHAR(500),
    "frozenPdfSha256"        VARCHAR(64),
    "snapshotMeta"           JSONB,
    "matterIdsSnapshot"      JSONB,
    "createdByUserId"        TEXT NOT NULL,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,
    CONSTRAINT "jr_work_reports_pkey" PRIMARY KEY ("id")
);
-- DB-level double-click idempotency: one DRAFT per (subject, period).
CREATE UNIQUE INDEX IF NOT EXISTS "jr_work_reports_subject_period_status_key" ON "legal"."jr_work_reports" ("subjectAssociateUserId","periodFrom","periodTo","status");
CREATE INDEX IF NOT EXISTS "jr_work_reports_subjectAssociateUserId_idx" ON "legal"."jr_work_reports" ("subjectAssociateUserId");
CREATE INDEX IF NOT EXISTS "jr_work_reports_status_idx" ON "legal"."jr_work_reports" ("status");

-- ── 3. jr_work_report_notes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "legal"."jr_work_report_notes" (
    "id"           TEXT NOT NULL,
    "reportId"     TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "content"      TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"    TIMESTAMP(3),
    CONSTRAINT "jr_work_report_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "jr_work_report_notes_reportId_idx" ON "legal"."jr_work_report_notes" ("reportId");

-- ── 4. jr_work_report_attachments (created now, written by 10B) ───────────────
CREATE TABLE IF NOT EXISTS "legal"."jr_work_report_attachments" (
    "id"                      TEXT NOT NULL,
    "reportId"                TEXT NOT NULL,
    "kind"                    "legal"."JrWorkReportAttachmentKind" NOT NULL,
    "storageKey"              VARCHAR(500) NOT NULL,
    "mimeType"                VARCHAR(120),
    "durationMs"              INTEGER,
    "audioCodecExt"           VARCHAR(20),
    "transcript"              TEXT,
    "transcriptStatus"        "legal"."JrTranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "sourceWhatsAppMessageId" VARCHAR(120),
    "createdByUserId"         TEXT NOT NULL,
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"               TIMESTAMP(3),
    CONSTRAINT "jr_work_report_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "jr_work_report_attachments_reportId_idx" ON "legal"."jr_work_report_attachments" ("reportId");

-- ── 5. foreign keys ──────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "legal"."jr_work_report_notes"
    ADD CONSTRAINT "jr_work_report_notes_reportId_fkey" FOREIGN KEY ("reportId")
    REFERENCES "legal"."jr_work_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "legal"."jr_work_report_attachments"
    ADD CONSTRAINT "jr_work_report_attachments_reportId_fkey" FOREIGN KEY ("reportId")
    REFERENCES "legal"."jr_work_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
