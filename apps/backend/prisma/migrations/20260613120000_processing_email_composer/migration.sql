-- Email composer (processing feedback #7-11).
-- Per-user email signature, plus the actual recipients + attachment metadata
-- recorded on each case email so the case keeps a faithful sent-email record.
-- All columns are nullable or defaulted -> additive, safe to apply online.

ALTER TABLE "core"."user_accounts" ADD COLUMN "emailSignature" TEXT;

ALTER TABLE "processing"."case_communications" ADD COLUMN "toEmail" TEXT;
ALTER TABLE "processing"."case_communications" ADD COLUMN "ccEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "processing"."case_communications" ADD COLUMN "bccEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "processing"."case_communications" ADD COLUMN "attachmentsMeta" JSONB;
