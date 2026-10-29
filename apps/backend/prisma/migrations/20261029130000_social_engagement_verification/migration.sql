-- Team social-engagement verification. Additive only: new enums, two new
-- tables, and three nullable columns on employees. No data is modified.

-- CreateEnum
CREATE TYPE "core"."SocialPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK');

-- CreateEnum
CREATE TYPE "core"."SocialEngagementStatus" AS ENUM ('VERIFIED', 'TEXT_VERIFIED_AUTHOR_UNCONFIRMED', 'NOT_FOUND', 'PENDING');

-- CreateEnum
CREATE TYPE "core"."SocialEngagementSource" AS ENUM ('AUTO_SWEEP', 'REP_CLAIM');

-- AlterTable: social-handle registry on employees (nullable, no backfill).
ALTER TABLE "core"."employees" ADD COLUMN "instagramHandle" TEXT;
ALTER TABLE "core"."employees" ADD COLUMN "facebookProfileUrl" TEXT;
ALTER TABLE "core"."employees" ADD COLUMN "facebookDisplayName" TEXT;

-- CreateTable
CREATE TABLE "core"."social_posts" (
  "id"          TEXT NOT NULL,
  "platform"    "core"."SocialPlatform" NOT NULL,
  "pageId"      TEXT NOT NULL,
  "externalId"  TEXT NOT NULL,
  "permalink"   TEXT,
  "caption"     TEXT,
  "postedAt"    TIMESTAMP(3),
  "lastSweptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."social_engagements" (
  "id"                TEXT NOT NULL,
  "employeeId"        TEXT NOT NULL,
  "platform"          "core"."SocialPlatform" NOT NULL,
  "status"            "core"."SocialEngagementStatus" NOT NULL,
  "source"            "core"."SocialEngagementSource" NOT NULL,
  "postExternalId"    TEXT NOT NULL,
  "postUrl"           TEXT,
  "commentExternalId" TEXT,
  "commentText"       TEXT,
  "commentedAt"       TIMESTAMP(3),
  "screenshotKey"     TEXT,
  "claimedByUserId"   TEXT,
  "note"              TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_posts_platform_externalId_key" ON "core"."social_posts"("platform", "externalId");

-- CreateIndex
CREATE INDEX "social_posts_platform_postedAt_idx" ON "core"."social_posts"("platform", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_engagements_platform_commentExternalId_key" ON "core"."social_engagements"("platform", "commentExternalId");

-- CreateIndex
CREATE INDEX "social_engagements_employeeId_createdAt_idx" ON "core"."social_engagements"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "social_engagements_platform_status_idx" ON "core"."social_engagements"("platform", "status");

-- CreateIndex
CREATE INDEX "social_engagements_postExternalId_idx" ON "core"."social_engagements"("postExternalId");

-- AddForeignKey
ALTER TABLE "core"."social_engagements" ADD CONSTRAINT "social_engagements_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "core"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
