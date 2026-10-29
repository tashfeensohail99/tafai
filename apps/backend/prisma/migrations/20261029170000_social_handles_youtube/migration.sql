-- YouTube channel in the social-handle registry. Additive: one nullable column.
-- (Collection only for now; YouTube engagement verification is a future phase —
-- YT Data API + Google OAuth — and will be verifiable like IG.)

ALTER TABLE "core"."employees" ADD COLUMN "youtubeChannelUrl" TEXT;
