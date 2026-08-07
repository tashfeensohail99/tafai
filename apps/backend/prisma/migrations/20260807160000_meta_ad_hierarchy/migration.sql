-- Phase 1C — Meta ad structure mirror (campaign → ad set → ad).
-- Additive + idempotent: new tables only, no writes to existing data.

-- Campaigns -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "crm"."meta_campaigns" (
    "id"              TEXT NOT NULL,
    "adAccountId"     TEXT NOT NULL,
    "campaignId"      TEXT NOT NULL,
    "name"            TEXT,
    "status"          TEXT,
    "effectiveStatus" TEXT,
    "objective"       TEXT,
    "dailyBudget"     DECIMAL(14,2),
    "lifetimeBudget"  DECIMAL(14,2),
    "budgetCurrency"  TEXT,
    "startTime"       TIMESTAMP(3),
    "stopTime"        TIMESTAMP(3),
    "syncedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meta_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "meta_campaigns_campaignId_key" ON "crm"."meta_campaigns"("campaignId");
CREATE INDEX IF NOT EXISTS "meta_campaigns_adAccountId_idx" ON "crm"."meta_campaigns"("adAccountId");
CREATE INDEX IF NOT EXISTS "meta_campaigns_effectiveStatus_idx" ON "crm"."meta_campaigns"("effectiveStatus");

-- Ad sets -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "crm"."meta_ad_sets" (
    "id"               TEXT NOT NULL,
    "adAccountId"      TEXT NOT NULL,
    "adsetId"          TEXT NOT NULL,
    "campaignId"       TEXT NOT NULL,
    "name"             TEXT,
    "status"           TEXT,
    "effectiveStatus"  TEXT,
    "optimizationGoal" TEXT,
    "billingEvent"     TEXT,
    "dailyBudget"      DECIMAL(14,2),
    "lifetimeBudget"   DECIMAL(14,2),
    "budgetCurrency"   TEXT,
    "startTime"        TIMESTAMP(3),
    "endTime"          TIMESTAMP(3),
    "syncedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meta_ad_sets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "meta_ad_sets_adsetId_key" ON "crm"."meta_ad_sets"("adsetId");
CREATE INDEX IF NOT EXISTS "meta_ad_sets_adAccountId_idx" ON "crm"."meta_ad_sets"("adAccountId");
CREATE INDEX IF NOT EXISTS "meta_ad_sets_campaignId_idx" ON "crm"."meta_ad_sets"("campaignId");
CREATE INDEX IF NOT EXISTS "meta_ad_sets_effectiveStatus_idx" ON "crm"."meta_ad_sets"("effectiveStatus");

-- Ads -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "crm"."meta_ads" (
    "id"              TEXT NOT NULL,
    "adAccountId"     TEXT NOT NULL,
    "adId"            TEXT NOT NULL,
    "adsetId"         TEXT NOT NULL,
    "campaignId"      TEXT NOT NULL,
    "name"            TEXT,
    "status"          TEXT,
    "effectiveStatus" TEXT,
    "creativeId"      TEXT,
    "syncedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meta_ads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "meta_ads_adId_key" ON "crm"."meta_ads"("adId");
CREATE INDEX IF NOT EXISTS "meta_ads_adAccountId_idx" ON "crm"."meta_ads"("adAccountId");
CREATE INDEX IF NOT EXISTS "meta_ads_adsetId_idx" ON "crm"."meta_ads"("adsetId");
CREATE INDEX IF NOT EXISTS "meta_ads_campaignId_idx" ON "crm"."meta_ads"("campaignId");
