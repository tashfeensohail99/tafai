-- Call recording + transcription (internal QA / AI-training corpus). The audio
-- is captured in the rep's browser and stored in object storage; the transcript
-- is produced by Whisper. Additive + idempotent.

ALTER TABLE "whatsapp"."calls"
  ADD COLUMN IF NOT EXISTS "recordingKey"      TEXT,
  ADD COLUMN IF NOT EXISTS "recordingMimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "transcript"        TEXT,
  ADD COLUMN IF NOT EXISTS "transcriptStatus"  TEXT;
