import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** A calendar day of activity, used by the Overview time-series. */
export interface DailyPoint {
  date: string; // YYYY-MM-DD
  spendBaseCad: number;
  leads: number;
}

/** Per-currency spend line for the multi-currency KPI card. */
export interface SpendByCurrency {
  currency: string;
  amount: number;
}

/** Common window shape returned with every response. */
export interface MarketingWindow {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  days: number;
}

/**
 * Marketing dashboard aggregations for the Phase 1D UI.
 *
 * Reads from three sources that Phases 1A–1C put in place:
 *   - `crm.ad_spend_daily` (per-ad daily spend, FX'd to CAD at sync time)
 *   - `crm.leads.metaAdId / metaCampaignId` (durable ad attribution, denormalized on Lead)
 *   - `crm.meta_campaigns / meta_ad_sets / meta_ads` (hierarchy mirror)
 *
 * Revenue joins forward: Lead → Client (via Client.sourceLeadId) →
 * Invoice → Payment (PAID + not soft-deleted) → sum baseAmount in CAD.
 *
 * All monetary values in the response are base CAD so the frontend never has
 * to reconcile currencies. Spend is also returned per-currency for the
 * "PKR X.XM (≈ CAD Y.YK)" tooltip on the spend card.
 *
 * Every aggregation is raw SQL, joining directly at the DB — the alternative
 * (per-row Prisma queries) fans out badly across ~22k leads × 200 ads.
 */
@Injectable()
export class MarketingService {
  private readonly log = new Logger(MarketingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Normalize a `days` argument into an inclusive [from, to] date window. */
  private resolveWindow(daysArg: number | undefined): { from: Date; to: Date; toEnd: Date; days: number } {
    const days = Math.max(1, Math.min(365, daysArg ?? 30));
    const now = new Date();
    // Anchor "to" at end-of-today (UTC) so today's activity is included.
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const toEnd = new Date(to.getTime() + 24 * 60 * 60 * 1000);
    return { from, to, toEnd, days };
  }

  private ymd(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    const n = typeof v === 'string' || typeof v === 'bigint' ? Number(v) : (v as number);
    return Number.isFinite(n) ? n : 0;
  }

  private ratio(num: number, den: number): number | null {
    if (!den || !Number.isFinite(den)) return null;
    const r = num / den;
    return Number.isFinite(r) ? r : null;
  }

  /**
   * Overview KPIs + daily time-series + top-5 campaigns for the given window.
   * The five headline numbers (spend, leads, conversions, CPL, ROAS) map 1:1
   * to the Marketing Overview card.
   */
  async getOverview(daysArg?: number) {
    const { from, to, toEnd, days } = this.resolveWindow(daysArg);
    const fromStr = this.ymd(from);
    const toStr = this.ymd(to);

    // Kick off every read in parallel — none of them depend on each other.
    const [spendRows, leadCountRow, convRow, seriesRows, topRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ currency: string; base: string; native: string }>>(
        `SELECT currency, COALESCE(SUM("baseSpend"), 0)::text AS base, COALESCE(SUM(spend), 0)::text AS native
         FROM crm.ad_spend_daily
         WHERE date >= $1::date AND date <= $2::date
         GROUP BY currency`,
        fromStr,
        toStr,
      ),
      this.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n
         FROM crm.leads
         WHERE "deletedAt" IS NULL
           AND "metaAdId" IS NOT NULL
           AND "createdAt" >= $1 AND "createdAt" < $2`,
        from,
        toEnd,
      ),
      // Clients from the cohort + revenue collected from those clients.
      // Revenue is all-time from cohort clients (matches getAdPerformance's
      // convention): the window bounds who entered the cohort, not when they
      // paid, so late payments still count toward the ad that produced them.
      this.prisma.$queryRawUnsafe<Array<{ converted: bigint; revenue: string }>>(
        `WITH cohort_leads AS (
           SELECT id FROM crm.leads
           WHERE "deletedAt" IS NULL AND "metaAdId" IS NOT NULL
             AND "createdAt" >= $1 AND "createdAt" < $2
         ),
         cohort_clients AS (
           SELECT id FROM crm.clients WHERE "sourceLeadId" IN (SELECT id FROM cohort_leads)
         )
         SELECT
           (SELECT COUNT(*)::bigint FROM cohort_clients) AS converted,
           COALESCE((
             SELECT SUM(p."baseAmount")
             FROM finance.payments p
             JOIN finance.invoices i ON i.id = p."invoiceId"
             WHERE p.status = 'PAID' AND p."deletedAt" IS NULL
               AND i."clientId" IN (SELECT id FROM cohort_clients)
           ), 0)::text AS revenue`,
        from,
        toEnd,
      ),
      // Time series — LEFT JOIN a full date_series so gaps show as zero, not missing.
      this.prisma.$queryRawUnsafe<Array<{ date: Date; spend: string; leads: bigint }>>(
        `WITH date_series AS (
           SELECT generate_series($1::date, $2::date, '1 day')::date AS d
         ),
         spend_daily AS (
           SELECT date::date AS d, SUM("baseSpend") AS spend
           FROM crm.ad_spend_daily WHERE date >= $1::date AND date <= $2::date
           GROUP BY date::date
         ),
         leads_daily AS (
           SELECT "createdAt"::date AS d, COUNT(*) AS leads
           FROM crm.leads
           WHERE "deletedAt" IS NULL AND "metaAdId" IS NOT NULL
             AND "createdAt" >= $3 AND "createdAt" < $4
           GROUP BY "createdAt"::date
         )
         SELECT ds.d AS date,
                COALESCE(sp.spend, 0)::text AS spend,
                COALESCE(ld.leads, 0)::bigint AS leads
         FROM date_series ds
         LEFT JOIN spend_daily sp ON sp.d = ds.d
         LEFT JOIN leads_daily ld ON ld.d = ds.d
         ORDER BY ds.d`,
        fromStr,
        toStr,
        from,
        toEnd,
      ),
      // Top-5 campaigns by base spend in window, joined once at the campaign
      // level (per-ad joins would fan out badly). Includes a "spend or leads
      // > 0" filter so campaigns idle in the window don't clutter the top.
      this.prisma.$queryRawUnsafe<
        Array<{
          campaignId: string;
          name: string | null;
          effectiveStatus: string | null;
          spend: string;
          leads: bigint;
        }>
      >(
        `WITH campaign_spend AS (
           SELECT a."campaignId", SUM(s."baseSpend") AS spend
           FROM crm.meta_ads a
           JOIN crm.ad_spend_daily s ON s."adId" = a."adId"
           WHERE s.date >= $1::date AND s.date <= $2::date
           GROUP BY a."campaignId"
         ),
         campaign_leads AS (
           SELECT "metaCampaignId" AS "campaignId", COUNT(*) AS leads
           FROM crm.leads
           WHERE "deletedAt" IS NULL AND "metaCampaignId" IS NOT NULL
             AND "createdAt" >= $3 AND "createdAt" < $4
           GROUP BY "metaCampaignId"
         )
         SELECT c."campaignId",
                c.name,
                c."effectiveStatus",
                COALESCE(sp.spend, 0)::text AS spend,
                COALESCE(ld.leads, 0)::bigint AS leads
         FROM crm.meta_campaigns c
         LEFT JOIN campaign_spend sp ON sp."campaignId" = c."campaignId"
         LEFT JOIN campaign_leads ld ON ld."campaignId" = c."campaignId"
         WHERE COALESCE(sp.spend, 0) > 0 OR COALESCE(ld.leads, 0) > 0
         ORDER BY spend DESC NULLS LAST, leads DESC
         LIMIT 5`,
        fromStr,
        toStr,
        from,
        toEnd,
      ),
    ]);

    const spendByCurrency: SpendByCurrency[] = spendRows.map((r) => ({
      currency: r.currency,
      amount: this.num(r.native),
    }));
    const spendBaseCad = spendRows.reduce((acc, r) => acc + this.num(r.base), 0);
    const leads = this.num(leadCountRow[0]?.n);
    const clientsConverted = this.num(convRow[0]?.converted);
    const revenueBaseCad = this.num(convRow[0]?.revenue);

    const timeSeries: DailyPoint[] = seriesRows.map((r) => ({
      date: this.ymd(r.date),
      spendBaseCad: this.num(r.spend),
      leads: this.num(r.leads),
    }));

    const topCampaigns = topRows.map((r) => {
      const spend = this.num(r.spend);
      const cLeads = this.num(r.leads);
      return {
        campaignId: r.campaignId,
        name: r.name,
        effectiveStatus: r.effectiveStatus,
        spendBaseCad: spend,
        leads: cLeads,
        cpl: this.ratio(spend, cLeads),
      };
    });

    return {
      window: { from: fromStr, to: toStr, days } satisfies MarketingWindow,
      kpis: {
        spendBaseCad,
        spendByCurrency,
        leads,
        clientsConverted,
        revenueBaseCad,
        cpl: this.ratio(spendBaseCad, leads),
        cpa: this.ratio(spendBaseCad, clientsConverted),
        roas: this.ratio(revenueBaseCad, spendBaseCad),
        conversionRate: this.ratio(clientsConverted, leads),
      },
      timeSeries,
      topCampaigns,
    };
  }

  /**
   * Per-ad row for the Ads page. One row per known Meta ad; joins in the
   * window's spend (base CAD + impressions/clicks) and the window's lead count.
   * Rows without any activity in the window are dropped by default, but the
   * `includeIdle` flag keeps them (with zeros) — useful when the marketing
   * user wants to see PAUSED ads that still exist in Meta.
   */
  async getAds(daysArg?: number, includeIdle = false) {
    const { from, to, toEnd, days } = this.resolveWindow(daysArg);
    const fromStr = this.ymd(from);
    const toStr = this.ymd(to);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        adId: string;
        adName: string | null;
        adsetId: string;
        adsetName: string | null;
        campaignId: string;
        campaignName: string | null;
        effectiveStatus: string | null;
        spend: string;
        impressions: string | null;
        clicks: string | null;
        leads: bigint;
      }>
    >(
      `WITH ad_spend AS (
         SELECT "adId",
                SUM("baseSpend") AS spend,
                SUM(impressions) AS imp,
                SUM(clicks) AS clk
         FROM crm.ad_spend_daily
         WHERE date >= $1::date AND date <= $2::date
         GROUP BY "adId"
       ),
       ad_leads AS (
         SELECT "metaAdId" AS "adId", COUNT(*) AS leads
         FROM crm.leads
         WHERE "deletedAt" IS NULL AND "metaAdId" IS NOT NULL
           AND "createdAt" >= $3 AND "createdAt" < $4
         GROUP BY "metaAdId"
       )
       SELECT a."adId",
              a.name  AS "adName",
              a."adsetId",
              aset.name AS "adsetName",
              a."campaignId",
              camp.name AS "campaignName",
              a."effectiveStatus",
              COALESCE(sp.spend, 0)::text AS spend,
              sp.imp::text  AS impressions,
              sp.clk::text  AS clicks,
              COALESCE(ld.leads, 0)::bigint AS leads
       FROM crm.meta_ads a
       LEFT JOIN crm.meta_ad_sets   aset ON aset."adsetId"    = a."adsetId"
       LEFT JOIN crm.meta_campaigns camp ON camp."campaignId" = a."campaignId"
       LEFT JOIN ad_spend sp ON sp."adId" = a."adId"
       LEFT JOIN ad_leads ld ON ld."adId" = a."adId"
       ${includeIdle ? '' : "WHERE COALESCE(sp.spend, 0) > 0 OR COALESCE(ld.leads, 0) > 0"}
       ORDER BY COALESCE(sp.spend, 0) DESC NULLS LAST, COALESCE(ld.leads, 0) DESC`,
      fromStr,
      toStr,
      from,
      toEnd,
    );

    const ads = rows.map((r) => {
      const spend = this.num(r.spend);
      const leads = this.num(r.leads);
      const impressions = this.num(r.impressions);
      const clicks = this.num(r.clicks);
      return {
        adId: r.adId,
        adName: r.adName,
        adsetId: r.adsetId,
        adsetName: r.adsetName,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        effectiveStatus: r.effectiveStatus,
        spendBaseCad: spend,
        impressions,
        clicks,
        leads,
        cpl: this.ratio(spend, leads),
        ctr: this.ratio(clicks, impressions),
      };
    });

    return {
      window: { from: fromStr, to: toStr, days } satisfies MarketingWindow,
      ads,
    };
  }

  /**
   * Per-campaign roll-up with nested ad-set breakdown. One row per Meta
   * campaign; each carries its ad-sets already aggregated (spend + leads +
   * per-adset delivery status). Empty campaigns are hidden unless `includeIdle`.
   */
  async getCampaigns(daysArg?: number, includeIdle = false) {
    const { from, to, toEnd, days } = this.resolveWindow(daysArg);
    const fromStr = this.ymd(from);
    const toStr = this.ymd(to);

    // Two queries: campaign roll-up + adset roll-up. Assemble in JS — one JOIN
    // between them at DB level would either explode the row count or need a
    // json_agg that hurts readability.
    const [campaignRows, adsetRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<
        Array<{
          campaignId: string;
          name: string | null;
          effectiveStatus: string | null;
          objective: string | null;
          spend: string;
          leads: bigint;
          converted: bigint;
          revenue: string;
        }>
      >(
        `WITH campaign_spend AS (
           SELECT a."campaignId", SUM(s."baseSpend") AS spend
           FROM crm.meta_ads a
           JOIN crm.ad_spend_daily s ON s."adId" = a."adId"
           WHERE s.date >= $1::date AND s.date <= $2::date
           GROUP BY a."campaignId"
         ),
         campaign_cohort AS (
           SELECT l.id, l."metaCampaignId"
           FROM crm.leads l
           WHERE l."deletedAt" IS NULL AND l."metaCampaignId" IS NOT NULL
             AND l."createdAt" >= $3 AND l."createdAt" < $4
         ),
         campaign_leads AS (
           SELECT "metaCampaignId" AS "campaignId", COUNT(*) AS leads
           FROM campaign_cohort GROUP BY "metaCampaignId"
         ),
         campaign_clients AS (
           SELECT cc."metaCampaignId" AS "campaignId", c.id AS "clientId"
           FROM campaign_cohort cc
           JOIN crm.clients c ON c."sourceLeadId" = cc.id
         ),
         campaign_conv AS (
           SELECT "campaignId", COUNT(*) AS converted
           FROM campaign_clients GROUP BY "campaignId"
         ),
         campaign_revenue AS (
           SELECT cc."campaignId", SUM(p."baseAmount") AS revenue
           FROM campaign_clients cc
           JOIN finance.invoices i ON i."clientId" = cc."clientId"
           JOIN finance.payments p ON p."invoiceId" = i.id
           WHERE p.status = 'PAID' AND p."deletedAt" IS NULL
           GROUP BY cc."campaignId"
         )
         SELECT c."campaignId",
                c.name,
                c."effectiveStatus",
                c.objective,
                COALESCE(sp.spend, 0)::text  AS spend,
                COALESCE(ld.leads, 0)::bigint AS leads,
                COALESCE(cv.converted, 0)::bigint AS converted,
                COALESCE(rv.revenue, 0)::text AS revenue
         FROM crm.meta_campaigns c
         LEFT JOIN campaign_spend    sp ON sp."campaignId" = c."campaignId"
         LEFT JOIN campaign_leads    ld ON ld."campaignId" = c."campaignId"
         LEFT JOIN campaign_conv     cv ON cv."campaignId" = c."campaignId"
         LEFT JOIN campaign_revenue  rv ON rv."campaignId" = c."campaignId"
         ${includeIdle ? '' : "WHERE COALESCE(sp.spend, 0) > 0 OR COALESCE(ld.leads, 0) > 0"}
         ORDER BY COALESCE(sp.spend, 0) DESC NULLS LAST, COALESCE(ld.leads, 0) DESC`,
        fromStr,
        toStr,
        from,
        toEnd,
      ),
      this.prisma.$queryRawUnsafe<
        Array<{
          adsetId: string;
          name: string | null;
          effectiveStatus: string | null;
          campaignId: string;
          spend: string;
          leads: bigint;
        }>
      >(
        `WITH adset_spend AS (
           SELECT a."adsetId", SUM(s."baseSpend") AS spend
           FROM crm.meta_ads a
           JOIN crm.ad_spend_daily s ON s."adId" = a."adId"
           WHERE s.date >= $1::date AND s.date <= $2::date
           GROUP BY a."adsetId"
         ),
         adset_leads AS (
           SELECT "metaAdsetId" AS "adsetId", COUNT(*) AS leads
           FROM crm.leads
           WHERE "deletedAt" IS NULL AND "metaAdsetId" IS NOT NULL
             AND "createdAt" >= $3 AND "createdAt" < $4
           GROUP BY "metaAdsetId"
         )
         SELECT s."adsetId",
                s.name,
                s."effectiveStatus",
                s."campaignId",
                COALESCE(sp.spend, 0)::text AS spend,
                COALESCE(ld.leads, 0)::bigint AS leads
         FROM crm.meta_ad_sets s
         LEFT JOIN adset_spend sp ON sp."adsetId" = s."adsetId"
         LEFT JOIN adset_leads ld ON ld."adsetId" = s."adsetId"
         WHERE COALESCE(sp.spend, 0) > 0 OR COALESCE(ld.leads, 0) > 0
         ORDER BY COALESCE(sp.spend, 0) DESC NULLS LAST`,
        fromStr,
        toStr,
        from,
        toEnd,
      ),
    ]);

    // Bucket ad-sets under their campaign.
    const adsetsByCampaign = new Map<
      string,
      Array<{ adsetId: string; name: string | null; effectiveStatus: string | null; spendBaseCad: number; leads: number; cpl: number | null }>
    >();
    for (const r of adsetRows) {
      const spend = this.num(r.spend);
      const leads = this.num(r.leads);
      const bucket = adsetsByCampaign.get(r.campaignId) ?? [];
      bucket.push({
        adsetId: r.adsetId,
        name: r.name,
        effectiveStatus: r.effectiveStatus,
        spendBaseCad: spend,
        leads,
        cpl: this.ratio(spend, leads),
      });
      adsetsByCampaign.set(r.campaignId, bucket);
    }

    const campaigns = campaignRows.map((r) => {
      const spend = this.num(r.spend);
      const leads = this.num(r.leads);
      const converted = this.num(r.converted);
      const revenue = this.num(r.revenue);
      return {
        campaignId: r.campaignId,
        name: r.name,
        effectiveStatus: r.effectiveStatus,
        objective: r.objective,
        spendBaseCad: spend,
        leads,
        clientsConverted: converted,
        revenueBaseCad: revenue,
        cpl: this.ratio(spend, leads),
        cpa: this.ratio(spend, converted),
        roas: this.ratio(revenue, spend),
        adsets: adsetsByCampaign.get(r.campaignId) ?? [],
      };
    });

    return {
      window: { from: fromStr, to: toStr, days } satisfies MarketingWindow,
      campaigns,
    };
  }

  /**
   * Per-ad OUTCOMES for the Marketing team's Leads page. Aggregated only —
   * NO lead-level PII (no names, phones, or emails leave the aggregation).
   * Each row is one Meta ad with:
   *   - conversations (lead count from that ad within the window)
   *   - clientsConverted (of those leads, how many became paying clients)
   *   - revenueCad (all-time revenue from those clients, in base CAD)
   *   - CPL, CPA, ROAS
   * Rows with zero activity in the window are hidden unless includeIdle.
   * Ordered by revenue desc (best ROI first), then leads desc.
   */
  async getLeadsByAd(daysArg?: number, includeIdle = false) {
    const { from, to, toEnd, days } = this.resolveWindow(daysArg);
    const fromStr = this.ymd(from);
    const toStr = this.ymd(to);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        adId: string;
        adName: string | null;
        campaignId: string;
        campaignName: string | null;
        effectiveStatus: string | null;
        spend: string;
        leads: bigint;
        converted: bigint;
        revenue: string;
      }>
    >(
      `WITH ad_spend AS (
         SELECT "adId", SUM("baseSpend") AS spend
         FROM crm.ad_spend_daily
         WHERE date >= $1::date AND date <= $2::date
         GROUP BY "adId"
       ),
       ad_cohort AS (
         SELECT l.id, l."metaAdId"
         FROM crm.leads l
         WHERE l."deletedAt" IS NULL AND l."metaAdId" IS NOT NULL
           AND l."createdAt" >= $3 AND l."createdAt" < $4
       ),
       ad_leads AS (
         SELECT "metaAdId" AS "adId", COUNT(*) AS leads
         FROM ad_cohort GROUP BY "metaAdId"
       ),
       ad_clients AS (
         SELECT ac."metaAdId" AS "adId", c.id AS "clientId"
         FROM ad_cohort ac
         JOIN crm.clients c ON c."sourceLeadId" = ac.id
       ),
       ad_conv AS (
         SELECT "adId", COUNT(*) AS converted
         FROM ad_clients GROUP BY "adId"
       ),
       ad_revenue AS (
         SELECT ac."adId", SUM(p."baseAmount") AS revenue
         FROM ad_clients ac
         JOIN finance.invoices i ON i."clientId" = ac."clientId"
         JOIN finance.payments p ON p."invoiceId" = i.id
         WHERE p.status = 'PAID' AND p."deletedAt" IS NULL
         GROUP BY ac."adId"
       )
       SELECT a."adId",
              a.name AS "adName",
              a."campaignId",
              c.name AS "campaignName",
              a."effectiveStatus",
              COALESCE(sp.spend, 0)::text AS spend,
              COALESCE(ld.leads, 0)::bigint AS leads,
              COALESCE(cv.converted, 0)::bigint AS converted,
              COALESCE(rv.revenue, 0)::text AS revenue
       FROM crm.meta_ads a
       LEFT JOIN crm.meta_campaigns c  ON c."campaignId" = a."campaignId"
       LEFT JOIN ad_spend    sp ON sp."adId" = a."adId"
       LEFT JOIN ad_leads    ld ON ld."adId" = a."adId"
       LEFT JOIN ad_conv     cv ON cv."adId" = a."adId"
       LEFT JOIN ad_revenue  rv ON rv."adId" = a."adId"
       ${includeIdle ? '' : "WHERE COALESCE(sp.spend, 0) > 0 OR COALESCE(ld.leads, 0) > 0"}
       ORDER BY COALESCE(rv.revenue, 0) DESC NULLS LAST,
                COALESCE(ld.leads, 0) DESC,
                COALESCE(sp.spend, 0) DESC`,
      fromStr,
      toStr,
      from,
      toEnd,
    );

    // Marketing team does NOT see absolute money on this page — the response
    // deliberately omits spend, revenue, CPL and CPA (they'd leak the account's
    // financials). ROAS ships as a ratio only; the frontend renders it as a %.
    // Rows are still ordered by revenue desc server-side (best return first)
    // so the client doesn't need the raw number to sort correctly.
    const ads = rows.map((r) => {
      const spend = this.num(r.spend);
      const leads = this.num(r.leads);
      const converted = this.num(r.converted);
      const revenue = this.num(r.revenue);
      return {
        adId: r.adId,
        adName: r.adName,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        effectiveStatus: r.effectiveStatus,
        conversations: leads,
        clientsConverted: converted,
        conversionRate: this.ratio(converted, leads),
        roas: this.ratio(revenue, spend),
      };
    });

    return {
      window: { from: fromStr, to: toStr, days } satisfies MarketingWindow,
      ads,
    };
  }
}
