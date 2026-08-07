import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MetaAdsService } from './meta-ads.service';

/** Shapes returned by the Marketing API structure edges (only fields we read). */
interface GraphCampaign {
  id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
}
interface GraphAdSet {
  id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  campaign_id?: string;
  optimization_goal?: string;
  billing_event?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  end_time?: string;
}
interface GraphAd {
  id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  adset_id?: string;
  campaign_id?: string;
  creative?: { id?: string };
}
interface Paged<T> {
  data?: T[];
  paging?: { next?: string };
}

/**
 * Meta Marketing API → local mirror of the campaign → ad-set → ad hierarchy
 * (MetaCampaign / MetaAdSet / MetaAd).
 *
 * Enumerates top-down at the ACCOUNT level (`/{act}/campaigns`, `/{act}/adsets`,
 * `/{act}/ads`) — three paged sweeps, not a per-campaign fan-out — and upserts
 * each entity by its Meta id. Current-state snapshot only (delivery status +
 * names + budgets); spend history stays in AdSpendDaily.
 *
 * Reuses MetaAdsService for credential resolution and the shared Graph fetch, so
 * there is no second token/plumbing to configure. No-ops quietly when `meta_ads`
 * credentials are absent.
 *
 * Finally, back-fills the ad-set + campaign onto leads that only had an ad id
 * (the CTWA path: the referral carries `source_id` = ad id and nothing else),
 * closing the gap Phase 1B left open.
 */
@Injectable()
export class MetaHierarchyService {
  private readonly log = new Logger(MetaHierarchyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ads: MetaAdsService,
  ) {}

  /** Meta budgets are minor units (paisa/cents) as strings; store major units. */
  private toMajor(minor: string | undefined | null): Prisma.Decimal | null {
    if (minor == null || minor === '') return null;
    try {
      const d = new Prisma.Decimal(minor).div(100);
      // Meta returns "0" for "no budget at this level" — don't store a misleading 0.
      return d.gt(0) ? d : null;
    } catch {
      return null;
    }
  }

  private toDate(s: string | undefined | null): Date | null {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** Follow `paging.next` to pull every page of a structure edge (hard-capped). */
  private async fetchAllPages<T>(firstUrl: string, token: string): Promise<T[]> {
    const out: T[] = [];
    let url = firstUrl;
    for (let page = 0; page < 100 && url; page += 1) {
      const body = await this.ads.graphGet<Paged<T>>(url, token);
      if (!body) break;
      if (Array.isArray(body.data)) out.push(...body.data);
      url = body.paging?.next ?? '';
    }
    return out;
  }

  /**
   * Full structure sync + lead back-fill. Idempotent (upsert by Meta id). One
   * bad row never aborts the sweep. No-ops when unconfigured.
   */
  async syncHierarchy(): Promise<{
    skipped: boolean;
    reason?: string;
    campaigns?: number;
    adsets?: number;
    ads?: number;
    leadsEnriched?: number;
    accountId?: string;
  }> {
    const creds = await this.ads.resolveCredentials();
    if (!creds) return { skipped: true, reason: 'no meta_ads account id configured' };

    const base = `${this.ads.graphBase()}/${creds.accountId}`;
    const token = creds.token;

    // Account currency, resolved once — budget fields are in this currency.
    const acct = await this.ads.graphGet<{ currency?: string }>(`${base}?fields=currency`, token);
    const currency = acct?.currency ?? null;

    // 1. Campaigns.
    const campaigns = await this.fetchAllPages<GraphCampaign>(
      `${base}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time&limit=200`,
      token,
    );
    let campaignN = 0;
    for (const c of campaigns) {
      if (!c.id) continue;
      try {
        const hasBudget = !!(c.daily_budget || c.lifetime_budget);
        const data = {
          adAccountId: creds.accountId,
          name: c.name ?? null,
          status: c.status ?? null,
          effectiveStatus: c.effective_status ?? null,
          objective: c.objective ?? null,
          dailyBudget: this.toMajor(c.daily_budget),
          lifetimeBudget: this.toMajor(c.lifetime_budget),
          budgetCurrency: hasBudget ? currency : null,
          startTime: this.toDate(c.start_time),
          stopTime: this.toDate(c.stop_time),
          syncedAt: new Date(),
        };
        await this.prisma.metaCampaign.upsert({
          where: { campaignId: c.id },
          create: { campaignId: c.id, ...data },
          update: data,
        });
        campaignN += 1;
      } catch (e) {
        this.log.warn(`campaign upsert failed (${c.id}): ${(e as Error).message}`);
      }
    }

    // 2. Ad sets.
    const adsets = await this.fetchAllPages<GraphAdSet>(
      `${base}/adsets?fields=id,name,status,effective_status,campaign_id,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,end_time&limit=200`,
      token,
    );
    let adsetN = 0;
    for (const s of adsets) {
      if (!s.id || !s.campaign_id) continue;
      try {
        const hasBudget = !!(s.daily_budget || s.lifetime_budget);
        const data = {
          adAccountId: creds.accountId,
          campaignId: s.campaign_id,
          name: s.name ?? null,
          status: s.status ?? null,
          effectiveStatus: s.effective_status ?? null,
          optimizationGoal: s.optimization_goal ?? null,
          billingEvent: s.billing_event ?? null,
          dailyBudget: this.toMajor(s.daily_budget),
          lifetimeBudget: this.toMajor(s.lifetime_budget),
          budgetCurrency: hasBudget ? currency : null,
          startTime: this.toDate(s.start_time),
          endTime: this.toDate(s.end_time),
          syncedAt: new Date(),
        };
        await this.prisma.metaAdSet.upsert({
          where: { adsetId: s.id },
          create: { adsetId: s.id, ...data },
          update: data,
        });
        adsetN += 1;
      } catch (e) {
        this.log.warn(`adset upsert failed (${s.id}): ${(e as Error).message}`);
      }
    }

    // 3. Ads.
    const ads = await this.fetchAllPages<GraphAd>(
      `${base}/ads?fields=id,name,status,effective_status,adset_id,campaign_id,creative{id}&limit=200`,
      token,
    );
    let adN = 0;
    for (const a of ads) {
      if (!a.id || !a.adset_id || !a.campaign_id) continue;
      try {
        const data = {
          adAccountId: creds.accountId,
          adsetId: a.adset_id,
          campaignId: a.campaign_id,
          name: a.name ?? null,
          status: a.status ?? null,
          effectiveStatus: a.effective_status ?? null,
          creativeId: a.creative?.id ?? null,
          syncedAt: new Date(),
        };
        await this.prisma.metaAd.upsert({
          where: { adId: a.id },
          create: { adId: a.id, ...data },
          update: data,
        });
        adN += 1;
      } catch (e) {
        this.log.warn(`ad upsert failed (${a.id}): ${(e as Error).message}`);
      }
    }

    const leadsEnriched = await this.enrichLeads();

    this.log.log(
      `Meta hierarchy sync: ${campaignN}/${campaigns.length} campaigns, ${adsetN}/${adsets.length} ad sets, ` +
        `${adN}/${ads.length} ads for ${creds.accountId} (${creds.source}); ${leadsEnriched} leads enriched`,
    );
    return {
      skipped: false,
      campaigns: campaignN,
      adsets: adsetN,
      ads: adN,
      leadsEnriched,
      accountId: creds.accountId,
    };
  }

  /**
   * Resolve ad-set + campaign onto leads that only carry an ad id. The CTWA
   * referral gives us `source_id` (ad id) and nothing above it; now that the ad
   * table maps ad → ad-set → campaign, one UPDATE fills the gap. Idempotent —
   * only touches leads whose metaAdsetId is still NULL — so it stays cheap on
   * every sync after the first, and also fills metaCampaign/metaAdName where
   * those were still blank (e.g. an ad with no spend row).
   */
  private async enrichLeads(): Promise<number> {
    try {
      return await this.prisma.$executeRawUnsafe(`
        UPDATE crm.leads l
        SET "metaAdsetId"      = a."adsetId",
            "metaAdsetName"    = aset.name,
            "metaCampaignId"   = COALESCE(l."metaCampaignId", a."campaignId"),
            "metaCampaignName" = COALESCE(l."metaCampaignName", camp.name),
            "metaAdName"       = COALESCE(l."metaAdName", a.name)
        FROM crm.meta_ads a
        LEFT JOIN crm.meta_ad_sets aset ON aset."adsetId" = a."adsetId"
        LEFT JOIN crm.meta_campaigns camp ON camp."campaignId" = a."campaignId"
        WHERE l."metaAdId" = a."adId"
          AND l."metaAdId" IS NOT NULL
          AND l."metaAdsetId" IS NULL
      `);
    } catch (e) {
      this.log.warn(`lead enrichment skipped: ${(e as Error).message}`);
      return 0;
    }
  }

  /** Admin/marketing status: counts + freshness. Safe before the tables exist. */
  async getStatus() {
    try {
      const [campaigns, adsets, ads, agg, activeAds] = await Promise.all([
        this.prisma.metaCampaign.count(),
        this.prisma.metaAdSet.count(),
        this.prisma.metaAd.count(),
        this.prisma.metaAd.aggregate({ _max: { syncedAt: true } }),
        this.prisma.metaAd.count({ where: { effectiveStatus: 'ACTIVE' } }),
      ]);
      return {
        campaigns,
        adsets,
        ads,
        activeAds,
        lastSyncedAt: agg._max.syncedAt,
      };
    } catch {
      // Tables not migrated yet.
      return { campaigns: 0, adsets: 0, ads: 0, activeAds: 0, lastSyncedAt: null };
    }
  }
}
