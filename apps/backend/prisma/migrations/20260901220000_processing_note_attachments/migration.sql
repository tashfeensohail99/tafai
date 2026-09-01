-- Voice notes / images / screenshots / files attached to a processing case note.
CREATE TYPE "processing"."ProcessingNoteAttachmentKind" AS ENUM ('IMAGE', 'VOICE', 'FILE');

CREATE TABLE "processing"."processing_note_attachments" (
  "id"           TEXT NOT NULL,
  "noteId"       TEXT NOT NULL,
  "kind"         "processing"."ProcessingNoteAttachmentKind" NOT NULL,
  "storageKey"   TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "sizeBytes"    INTEGER NOT NULL,
  "originalName" TEXT,
  "durationMs"   INTEGER,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "processing_note_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "processing_note_attachments_noteId_idx"
  ON "processing"."processing_note_attachments" ("noteId");

ALTER TABLE "processing"."processing_note_attachments"
  ADD CONSTRAINT "processing_note_attachments_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "processing"."processing_notes" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
