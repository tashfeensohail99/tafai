-- Add lead email verification fields
ALTER TABLE "crm"."leads"
  ADD COLUMN IF NOT EXISTS "emailVerified"           BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "emailVerificationToken"  TEXT        UNIQUE,
  ADD COLUMN IF NOT EXISTS "emailVerificationSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt"         TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "leads_emailVerificationToken_idx"
  ON "crm"."leads" ("emailVerificationToken");

-- Add new timeline event types
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFICATION_SENT';
ALTER TYPE "crm"."TimelineEventType" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFIED';
