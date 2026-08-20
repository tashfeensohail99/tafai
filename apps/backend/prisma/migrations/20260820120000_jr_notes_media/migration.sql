-- Judicial Review notes media: attachments on jr_notes (text/voice/image).
-- Additive + idempotent: 1 enum + 1 table + 1 index + 1 FK, all in "legal".
-- The migration is APPLIED BY THE USER (prisma migrate deploy at boot). Keep re-runnable.

-- ── 1. enum ──────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "legal"."JrNoteAttachmentKind" AS ENUM ('AUDIO','IMAGE'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 2. table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "legal"."jr_note_attachments" (
    "id"             TEXT NOT NULL,
    "noteId"         TEXT NOT NULL,
    "kind"           "legal"."JrNoteAttachmentKind" NOT NULL,
    "storageKey"     TEXT NOT NULL,
    "fileName"       TEXT NOT NULL,
    "mimeType"       VARCHAR(120) NOT NULL,
    "fileSizeBytes"  INTEGER NOT NULL,
    "durationMs"     INTEGER,
    "transcript"     TEXT,
    "transcriptLang" VARCHAR(20),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jr_note_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "jr_note_attachments_noteId_idx" ON "legal"."jr_note_attachments" ("noteId");

-- ── 3. foreign key ───────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "legal"."jr_note_attachments"
    ADD CONSTRAINT "jr_note_attachments_noteId_fkey" FOREIGN KEY ("noteId")
    REFERENCES "legal"."jr_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
