-- New-post → staff engagement alert. Additive: two new tables, reusing the
-- existing core."SocialPlatform" enum. No data modified.

-- CreateTable: singleton config (one row; starts disabled).
CREATE TABLE "core"."social_alert_config" (
  "id"             TEXT NOT NULL,
  "enabled"        BOOLEAN NOT NULL DEFAULT false,
  "enabledAt"      TIMESTAMP(3),
  "departments"    TEXT[] DEFAULT ARRAY[]::TEXT[],
  "platforms"      "core"."SocialPlatform"[] DEFAULT ARRAY[]::"core"."SocialPlatform"[],
  "channels"       TEXT[] DEFAULT ARRAY[]::TEXT[],
  "quietStartHour" INTEGER,
  "quietEndHour"   INTEGER,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_alert_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable: dedupe ledger (one row per post the poller acted on).
CREATE TABLE "core"."social_post_alerts" (
  "id"             TEXT NOT NULL,
  "platform"       "core"."SocialPlatform" NOT NULL,
  "externalId"     TEXT NOT NULL,
  "permalink"      TEXT,
  "caption"        TEXT,
  "postedAt"       TIMESTAMP(3),
  "alerted"        BOOLEAN NOT NULL DEFAULT false,
  "alertedAt"      TIMESTAMP(3),
  "recipients"     INTEGER NOT NULL DEFAULT 0,
  "bannerAlertKey" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_post_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_post_alerts_platform_externalId_key" ON "core"."social_post_alerts"("platform", "externalId");

-- CreateIndex
CREATE INDEX "social_post_alerts_alerted_createdAt_idx" ON "core"."social_post_alerts"("alerted", "createdAt");
