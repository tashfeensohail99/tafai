-- Meta ad-spend cache for the leads-dashboard ROI metrics (CPL / CPA / ROAS).
-- One row per (date, ad), pulled from the Marketing API Insights endpoint and
-- FX-converted to CAD at sync time so ROAS can be computed in a single base
-- currency. `adId` joins to WhatsAppThread.adReferral->>'source_id'.
-- Additive only: a brand-new table. No changes to existing rows.

CREATE TABLE "crm"."ad_spend_daily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "adName" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "spend" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "baseSpend" DECIMAL(14,2) NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'CAD',
    "fxRate" DECIMAL(18,8),
    "impressions" INTEGER,
    "clicks" INTEGER,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ad_spend_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ad_spend_daily_date_adId_key" ON "crm"."ad_spend_daily"("date", "adId");
CREATE INDEX "ad_spend_daily_adId_idx" ON "crm"."ad_spend_daily"("adId");
CREATE INDEX "ad_spend_daily_date_idx" ON "crm"."ad_spend_daily"("date");
