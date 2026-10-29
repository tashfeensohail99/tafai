-- Public self-submit social-handle intake. Additive only: three nullable
-- columns on employees (LinkedIn + TikTok handles + a submission timestamp).

ALTER TABLE "core"."employees" ADD COLUMN "linkedinUrl" TEXT;
ALTER TABLE "core"."employees" ADD COLUMN "tiktokHandle" TEXT;
ALTER TABLE "core"."employees" ADD COLUMN "socialHandlesSubmittedAt" TIMESTAMP(3);
