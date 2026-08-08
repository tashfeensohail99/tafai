import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * A single Marketing alert. Derived on-the-fly from live data (no persistence
 * in 1F — the source data IS the source of truth; once the underlying
 * condition clears, the alert disappears).
 *
 * `key` is stable across polls (adId+type or similar) so the frontend can
 * de-dupe and animate transitions.
 */
export interface MarketingAlert {
  key: string;
  severity: 'critical' | 'warning' | 'info';
  type: 'AD_DISAPPROVED' | 'AD_SPEND_NO_LEADS' | 'CPL_SPIKE' | 'NEW_UNROUTED_AD';
  title: string;
  description: string;
  adId?: string | null;
  adName?: string | null;
  campaignName?: string | null;
  metric?: { label: string; value: string } | null;
  since?: string | null; // ISO
}

const SEVERITY_ORDER: Record<MarketingAlert['severity'], number> = { critical: 0, warning: 1, info: 2 };

/**
 * Marketing alerts (Phase 1F). Four conditions, all read directly from the
 * tables Phase 1B–1E populated — no new schema, no cron. The Marketing page
 * fetches this endpoint on load and re-queries on demand; the alerts vanish
 * the moment the underlying data recovers.
 *
 * Conditions:
 *   1. AD_DISAPPROVED   — meta_ads.effectiveStatus = 'DISAPPROVED' (Meta
 *      rejected it; no delivery until fixed). Critical.
 *   2. AD_SPEND_NO_LEADS — ad has any spend in the last 7 days but 0 leads
 *      attributed. Broken landing or wrong audience. Warning.
 *   3. CPL_SPIKE        — ad's trailing-7d CPL is ≥ 2× its trailing-30d CPL
 *      (baseline ≥ 5 leads to avoid noise). Warning.
 *   4. NEW_UNROUTED_AD  — ad with spend in the last 14 days and NO routing
 *      rule (direct or via its campaign). Someone launched without wiring
 *      lead routing. Info.
 */
@Injectable()
export class MarketingAlertsService {
  private readonly log = new Logger(MarketingAlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<MarketingAlert[]> {
    const [disapproved, noLeads, cplSpikes, unrouted] = await Promise.all([
      this.disapprovedAds(),
      this.spendingWithoutLeads(),
      this.cplSpikes(),
      this.unroutedActiveAds(),
    ]);
    return [...disapproved, ...noLeads, ...cplSpikes, ...unrouted].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
  }

  /** Ads Meta has explicitly rejected — they're spending nothing and reaching nobody. */
  private async disapprovedAds(): Promise<MarketingAlert[]> {
    const rows = await this.prisma.metaAd.findMany({
      where: { effectiveStatus: 'DISAPPROVED' },
      select: { adId: true, name: true, campaignId: true, syncedAt: true },
    });
    if (rows.length === 0) return [];
    const campaignNames = await this.campaignNamesFor(rows.map((r) => r.campaignId));
    return rows.map((r) => ({
      key: `AD_DISAPPROVED:${r.adId}`,
      severity: 'critical' as const,
      type: 'AD_DISAPPROVED' as const,
      title: r.name ?? '(unnamed ad)',
      description: 'Meta disapproved this ad — it is not delivering. Fix and resubmit in Ads Manager.',
      adId: r.adId,
      adName: r.name,
      campaignName: campaignNames.get(r.campaignId) ?? null,
      metric: null,
      since: r.syncedAt.toISOString(),
    }));
  }

  /** Ads burning budget in the last 7 days with zero leads to show for it. */
  private async spendingWithoutLeads(): Promise<MarketingAlert[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ adId: string; adName: string | null; campaignName: string | null; spend: string; leads: bigint }>
    >(
      `WITH ad_spend AS (
         SELECT "adId", SUM("baseSpend") AS spend
         FROM crm.ad_spend_daily WHERE date >= $1::date
         GROUP BY "adId" HAVING SUM("baseSpend") > 0
       ),
       ad_leads AS (
         SELECT "metaAdId" AS "adId", COUNT(*) AS leads
         FROM crm.leads
         WHERE "deletedAt" IS NULL AND "metaAdId" IS NOT NULL
           AND "createdAt" >= $2
         GROUP BY "metaAdId"
       )
       SELECT s."adId",
              a.name AS "adName",
              c.name AS "campaignName",
              s.spend::text AS spend,
              COALESCE(l.leads, 0)::bigint AS leads
       FROM ad_spend s
       LEFT JOIN ad_leads l ON l."adId" = s."adId"
       LEFT JOIN crm.meta_ads a ON a."adId" = s."adId"
       LEFT JOIN crm.meta_campaigns c ON c."campaignId" = a."campaignId"
       WHERE COALESCE(l.leads, 0) = 0
       ORDER BY s.spend DESC
       LIMIT 20`,
      sevenDaysAgo.toISOString().slice(0, 10),
      sevenDaysAgo,
    );
    return rows.map((r) => ({
      key: `AD_SPEND_NO_LEADS:${r.adId}`,
      severity: 'warning' as const,
      type: 'AD_SPEND_NO_LEADS' as const,
      title: r.adName ?? '(unnamed ad)',
      description: 'Spending money over the last 7 days with 0 leads to show for it — check landing / audience.',
      adId: r.adId,
      adName: r.adName,
      campaignName: r.campaignName,
      metric: { label: '7-day spend', value: fmtCad(Number(r.spend)) },
      since: null,
    }));
  }

  /**
   * Ads whose trailing 7-day CPL is ≥ 2× the trailing 30-day baseline. Only
   * fires when the baseline has ≥ 5 leads (otherwise the ratio is too noisy
   * to trust — one flake leads can look like a spike).
   */
  private async cplSpikes(): Promise<MarketingAlert[]> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        adId: string;
        adName: string | null;
        campaignName: string | null;
        cpl7: string;
        cpl30: string;
      }>
    >(
      `WITH spend7 AS (
         SELECT "adId", SUM("baseSpend") AS s FROM crm.ad_spend_daily
         WHERE date >= $1::date GROUP BY "adId"
       ),
       leads7 AS (
         SELECT "metaAdId" AS "adId", COUNT(*) AS n FROM crm.leads
         WHERE "deletedAt" IS NULL AND "metaAdId" IS NOT NULL AND "createdAt" >= $2
         GROUP BY "metaAdId"
       ),
       spend30 AS (
         SELECT "adId", SUM("baseSpend") AS s FROM crm.ad_spend_daily
         WHERE date >= $3::date GROUP BY "adId"
       ),
       leads30 AS (
         SELECT "metaAdId" AS "adId", COUNT(*) AS n FROM crm.leads
         WHERE "deletedAt" IS NULL AND "metaAdId" IS NOT NULL AND "createdAt" >= $4
         GROUP BY "metaAdId"
       )
       SELECT s7."adId",
              a.name AS "adName",
              c.name AS "campaignName",
              (s7.s / NULLIF(l7.n, 0))::text  AS cpl7,
              (s30.s / NULLIF(l30.n, 0))::text AS cpl30
       FROM spend7 s7
       JOIN leads7  l7 ON l7."adId" = s7."adId"
       JOIN spend30 s30 ON s30."adId" = s7."adId"
       JOIN leads30 l30 ON l30."adId" = s7."adId"
       LEFT JOIN crm.meta_ads a       ON a."adId"       = s7."adId"
       LEFT JOIN crm.meta_campaigns c ON c."campaignId" = a."campaignId"
       WHERE l30.n >= 5
         AND l7.n  >= 1
         AND (s7.s  / NULLIF(l7.n, 0))  >= 2 * (s30.s / NULLIF(l30.n, 0))
       ORDER BY (s7.s / NULLIF(l7.n, 0)) DESC
       LIMIT 20`,
      sevenDaysAgo.toISOString().slice(0, 10),
      sevenDaysAgo,
      thirtyDaysAgo.toISOString().slice(0, 10),
      thirtyDaysAgo,
    );

    return rows.map((r) => {
      const cpl7 = Number(r.cpl7);
      const cpl30 = Number(r.cpl30);
      const ratio = cpl30 > 0 ? cpl7 / cpl30 : 0;
      return {
        key: `CPL_SPIKE:${r.adId}`,
        severity: 'warning' as const,
        type: 'CPL_SPIKE' as const,
        title: r.adName ?? '(unnamed ad)',
        description: `Cost per lead has jumped ${ratio.toFixed(1)}× versus the 30-day baseline. Investigate creative fatigue or a sudden CPM change.`,
        adId: r.adId,
        adName: r.adName,
        campaignName: r.campaignName,
        metric: { label: '7d CPL vs 30d', value: `${fmtCad(cpl7)} vs ${fmtCad(cpl30)}` },
        since: null,
      };
    });
  }

  /**
   * Ads that had spend in the last 14 days and have NO routing rule (direct
   * or via campaign) — a lead from this ad will fall into the whole-pool
   * default, which might not be what Marketing intended.
   */
  private async unroutedActiveAds(): Promise<MarketingAlert[]> {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000);
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ adId: string; adName: string | null; campaignName: string | null; spend: string }>
    >(
      `WITH ad_spend AS (
         SELECT "adId", SUM("baseSpend") AS spend
         FROM crm.ad_spend_daily WHERE date >= $1::date
         GROUP BY "adId" HAVING SUM("baseSpend") > 0
       )
       SELECT s."adId",
              a.name AS "adName",
              c.name AS "campaignName",
              s.spend::text AS spend
       FROM ad_spend s
       JOIN crm.meta_ads a       ON a."adId"       = s."adId"
       LEFT JOIN crm.meta_campaigns c ON c."campaignId" = a."campaignId"
       WHERE NOT EXISTS (
         SELECT 1 FROM crm.ad_routing_rules r
         WHERE (r."targetType" = 'AD' AND r."targetId" = s."adId")
            OR (r."targetType" = 'CAMPAIGN' AND r."targetId" = a."campaignId")
       )
       ORDER BY s.spend DESC
       LIMIT 20`,
      fourteenDaysAgo.toISOString().slice(0, 10),
    );

    return rows.map((r) => ({
      key: `NEW_UNROUTED_AD:${r.adId}`,
      severity: 'info' as const,
      type: 'NEW_UNROUTED_AD' as const,
      title: r.adName ?? '(unnamed ad)',
      description: 'This ad is spending but has no routing rule — leads fall into the whole pool. Add a rule in Lead Routing to pin it to a branch.',
      adId: r.adId,
      adName: r.adName,
      campaignName: r.campaignName,
      metric: { label: '14-day spend', value: fmtCad(Number(r.spend)) },
      since: null,
    }));
  }

  private async campaignNamesFor(campaignIds: string[]): Promise<Map<string, string | null>> {
    if (campaignIds.length === 0) return new Map();
    const rows = await this.prisma.metaCampaign.findMany({
      where: { campaignId: { in: campaignIds } },
      select: { campaignId: true, name: true },
    });
    return new Map(rows.map((r) => [r.campaignId, r.name]));
  }
}

function fmtCad(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `CAD ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
