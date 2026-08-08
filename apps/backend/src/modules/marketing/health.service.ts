import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MetaAdsService } from '../meta-ads/meta-ads.service';
import { AdRoutingRulesService } from './routing.service';

/** Per-pipe status snapshot for the /marketing/health page. */
export interface HealthPipe {
  key: string;
  label: string;
  status: 'healthy' | 'warning' | 'stale' | 'error' | 'never';
  detail: string; // human line ("2 min ago" / "not configured" etc.)
  lastAt: string | null;
  ageSeconds: number | null;
  /** Extra facts to render underneath the status line. */
  facts?: Array<{ label: string; value: string }>;
}

/**
 * Integration Health (Phase 1F). One page summarising whether the pipes that
 * feed the Marketing module are still connected — Meta ad-spend sync, Meta
 * hierarchy sync, WhatsApp inbound webhook, CTWA lead flow, ads credentials,
 * routing snapshot. Every number is derived live from the tables at read
 * time; nothing stored.
 *
 * Status logic is deliberately simple: `healthy` inside the expected cadence,
 * `warning` at 2× cadence, `stale` at 4×, `error` for hard misconfig, `never`
 * if the data has never arrived.
 */
@Injectable()
export class MarketingHealthService {
  private readonly log = new Logger(MarketingHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ads: MetaAdsService,
    private readonly routing: AdRoutingRulesService,
  ) {}

  async getStatus() {
    const [adSpend, hierarchy, lastInbound, lastCtwaLead, adsCreds] = await Promise.all([
      this.adSpendPipe(),
      this.hierarchyPipe(),
      this.whatsappInboundPipe(),
      this.ctwaLeadPipe(),
      this.ads.getStatus(),
    ]);
    const routingSnap = this.routingPipe();

    return {
      generatedAt: new Date().toISOString(),
      pipes: [adSpend, hierarchy, lastInbound, lastCtwaLead, routingSnap],
      metaAccount: {
        configured: adsCreds.configured,
        source: adsCreds.source,
        accountId: adsCreds.accountId,
      },
    };
  }

  private ageSeconds(d: Date | null | undefined): number | null {
    return d ? Math.round((Date.now() - d.getTime()) / 1000) : null;
  }

  /** Classify by cadence. `expectedSec` is the normal beat; `hardSec` is what
   *  we call "stale". Anything beyond hardSec × 2 is treated as `error`. */
  private classify(ageSec: number | null, expectedSec: number, hardSec: number): HealthPipe['status'] {
    if (ageSec == null) return 'never';
    if (ageSec <= expectedSec) return 'healthy';
    if (ageSec <= hardSec) return 'warning';
    if (ageSec <= hardSec * 2) return 'stale';
    return 'error';
  }

  private describeAge(ageSec: number | null): string {
    if (ageSec == null) return 'no data yet';
    if (ageSec < 60) return `${ageSec}s ago`;
    if (ageSec < 3600) return `${Math.round(ageSec / 60)} min ago`;
    if (ageSec < 86_400) return `${Math.round(ageSec / 3600)}h ago`;
    return `${Math.round(ageSec / 86_400)}d ago`;
  }

  /** Ad-spend sync runs every 6h; call "warning" at 8h and "stale" at 24h. */
  private async adSpendPipe(): Promise<HealthPipe> {
    const agg = await this.prisma.adSpendDaily.aggregate({
      _max: { syncedAt: true, date: true },
      _count: { _all: true },
    });
    const last = agg._max.syncedAt;
    const age = this.ageSeconds(last);
    const status = this.classify(age, 8 * 3600, 24 * 3600);
    return {
      key: 'ad_spend_sync',
      label: 'Meta ad-spend sync',
      status,
      detail: `Last sync ${this.describeAge(age)}`,
      lastAt: last?.toISOString() ?? null,
      ageSeconds: age,
      facts: [
        { label: 'Rows cached', value: (agg._count._all ?? 0).toLocaleString() },
        { label: 'Latest day', value: agg._max.date?.toISOString().slice(0, 10) ?? '—' },
      ],
    };
  }

  /** Hierarchy sync also 6-hourly; same thresholds as ad-spend. */
  private async hierarchyPipe(): Promise<HealthPipe> {
    const [{ _max, _count }, activeAds] = await Promise.all([
      this.prisma.metaAd.aggregate({ _max: { syncedAt: true }, _count: { _all: true } }),
      this.prisma.metaAd.count({ where: { effectiveStatus: 'ACTIVE' } }),
    ]);
    const last = _max.syncedAt;
    const age = this.ageSeconds(last);
    const status = this.classify(age, 8 * 3600, 24 * 3600);
    return {
      key: 'hierarchy_sync',
      label: 'Meta hierarchy sync',
      status,
      detail: `Last sync ${this.describeAge(age)}`,
      lastAt: last?.toISOString() ?? null,
      ageSeconds: age,
      facts: [
        { label: 'Ads', value: _count._all.toLocaleString() },
        { label: 'Active', value: activeAds.toLocaleString() },
      ],
    };
  }

  /** Any inbound WhatsApp in the last N min — a proxy for "webhook alive". */
  private async whatsappInboundPipe(): Promise<HealthPipe> {
    const row = await this.prisma.whatsAppMessage.findFirst({
      where: { direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const age = this.ageSeconds(row?.createdAt);
    // WhatsApp is chatty — anything > 30 min is a warning, > 2h stale, > 4h error.
    const status = this.classify(age, 30 * 60, 2 * 3600);
    return {
      key: 'whatsapp_inbound',
      label: 'WhatsApp inbound webhook',
      status,
      detail: `Last inbound ${this.describeAge(age)}`,
      lastAt: row?.createdAt.toISOString() ?? null,
      ageSeconds: age,
    };
  }

  /** Last Click-to-WhatsApp lead — the ad→CRM pipe as seen from our side. */
  private async ctwaLeadPipe(): Promise<HealthPipe> {
    const row = await this.prisma.lead.findFirst({
      where: { deletedAt: null, metaAdId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const age = this.ageSeconds(row?.createdAt);
    // Business-hours only, but roughly: > 4h without a lead during the day is
    // worth surfacing. Overnight the "warning" is expected — the health page
    // shows why in `detail`.
    const status = this.classify(age, 4 * 3600, 12 * 3600);
    return {
      key: 'ctwa_lead_flow',
      label: 'CTWA lead flow',
      status,
      detail: `Last ad lead ${this.describeAge(age)}`,
      lastAt: row?.createdAt.toISOString() ?? null,
      ageSeconds: age,
    };
  }

  /** Routing snapshot freshness — anything > 5 min unbuilt during activity
   *  is a red flag (the cache should rebuild once per minute on any traffic). */
  private routingPipe(): HealthPipe {
    const info = this.routing.snapshotInfo();
    const age = info.ageMs != null ? Math.round(info.ageMs / 1000) : null;
    const status = this.classify(age, 5 * 60, 30 * 60);
    return {
      key: 'routing_snapshot',
      label: 'Ad-routing snapshot',
      status,
      detail: info.builtAt ? `Rebuilt ${this.describeAge(age)}` : 'Not built yet (first request will build)',
      lastAt: info.builtAt,
      ageSeconds: age,
      facts: [
        { label: 'Rules', value: info.rules.toLocaleString() },
        { label: 'Ads mapped', value: info.ads.toLocaleString() },
      ],
    };
  }
}
