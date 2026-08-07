import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FxService } from '../../common/fx/fx.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { WhatsAppCryptoService } from '../whatsapp/crypto/crypto.service';

/** Resolved Marketing-API credentials. */
interface AdsCreds {
  accountId: string; // normalized "act_<digits>"
  token: string; // a token carrying `ads_read`
  source: 'env' | 'api_key' | 'shared'; // shared = reused WhatsApp/leads token
}

/** One ad's daily spend row as returned by the Insights endpoint. */
interface InsightRow {
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  account_currency?: string;
  date_start?: string;
  date_stop?: string;
}

interface InsightsResponse {
  data?: InsightRow[];
  paging?: { next?: string };
  error?: unknown;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A real Meta access token is long and starts with "EAA"; an ad-account id is "act_…". */
function looksLikeToken(s: string | undefined | null): boolean {
  return !!s && s.length > 40 && !s.startsWith('act_');
}

/**
 * Meta Marketing API → daily ad spend cache (`AdSpendDaily`).
 *
 * Pulls per-ad daily spend from `/{act_id}/insights` and upserts one row per
 * (date, ad), FX-converting spend to CAD at sync time (mirrors Payment.baseAmount)
 * so the leads dashboard can compute a single-currency ROAS.
 *
 * Credentials: the AD-ACCOUNT ID comes from the `meta_ads` API key's label (or
 * a META_ADS_ACCOUNT_ID env override). The TOKEN, in priority order:
 *   1. META_ADS_ACCESS_TOKEN env, 2. a real token pasted into the meta_ads key,
 *   3. the live WhatsApp/leads System-User token (same Meta Business — it already
 *      carries ads_read), reused so the admin only has to enter the account id.
 * If no account id is configured, every method no-ops quietly.
 */
@Injectable()
export class MetaAdsService {
  private readonly log = new Logger(MetaAdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fx: FxService,
    private readonly apiKeys: ApiKeysService,
    private readonly crypto: WhatsAppCryptoService,
  ) {}

  graphBase(): string {
    const ver = this.config.get<string>('app.whatsapp.metaGraphApiVersion') ?? 'v21.0';
    return `https://graph.facebook.com/${ver}`;
  }

  private normalizeAccount(raw: string): string {
    const t = raw.trim();
    return t.startsWith('act_') ? t : `act_${t}`;
  }

  /** Decrypt the live WhatsApp/leads System-User token (already has ads_read). */
  private async sharedWhatsAppToken(): Promise<string | null> {
    const channels = await this.prisma.whatsAppChannel.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { accessTokenEnc: true },
    });
    for (const c of channels) {
      try {
        return this.crypto.decrypt(c.accessTokenEnc);
      } catch {
        /* key rotated for this channel — try the next */
      }
    }
    return null;
  }

  /** Resolve creds. Null when no ad-account id is configured. */
  async resolveCredentials(): Promise<AdsCreds | null> {
    const envAcct = process.env.META_ADS_ACCOUNT_ID?.trim();
    const keyRow = await this.apiKeys.getActiveWithMeta('meta_ads').catch(() => null);
    const rawAcct = envAcct || keyRow?.label;
    if (!rawAcct) return null;
    const accountId = this.normalizeAccount(rawAcct);
    if (!/^act_\d+$/.test(accountId)) {
      this.log.warn(`meta_ads account id "${rawAcct}" is invalid (need act_<digits>) — skipping`);
      return null;
    }

    const envToken = process.env.META_ADS_ACCESS_TOKEN?.trim();
    if (envToken) return { accountId, token: envToken, source: 'env' };
    if (looksLikeToken(keyRow?.key)) return { accountId, token: keyRow!.key, source: 'api_key' };
    const shared = await this.sharedWhatsAppToken();
    if (shared) return { accountId, token: shared, source: 'shared' };
    return null;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.resolveCredentials()) !== null;
  }

  /** YYYY-MM-DD in UTC. */
  private ymd(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /**
   * Generic authenticated GET against the Graph API. The token rides in the
   * Authorization header (never the query string) so it never lands in a
   * constructed URL or upstream access log. Returns the parsed body, or null on
   * any HTTP / parse / network / timeout error (logged). Shared by the spend and
   * hierarchy syncs so there is one Graph fetch path.
   */
  async graphGet<T = unknown>(url: string, token: string): Promise<T | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Authorization: `Bearer ${token}` } });
      const body = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
      if (!res.ok) {
        this.log.error(`Graph ${res.status}: ${JSON.stringify(body?.error ?? body)}`);
        return null;
      }
      return body;
    } catch (e) {
      this.log.error(`Graph fetch failed: ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private getJson(url: string, token: string): Promise<InsightsResponse | null> {
    return this.graphGet<InsightsResponse>(url, token);
  }

  /** Fetch per-ad daily spend rows for [since, until] (inclusive), following paging. */
  private async fetchInsights(creds: AdsCreds, since: string, until: string): Promise<InsightRow[]> {
    const fields = 'ad_id,ad_name,campaign_id,campaign_name,spend,impressions,clicks,account_currency';
    const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
    let url =
      `${this.graphBase()}/${creds.accountId}/insights` +
      `?level=ad&time_increment=1&fields=${fields}&time_range=${timeRange}&limit=200`;

    const rows: InsightRow[] = [];
    // Hard page cap so a runaway cursor can never loop forever.
    for (let page = 0; page < 50 && url; page += 1) {
      const body = await this.getJson(url, creds.token);
      if (!body) break;
      if (Array.isArray(body.data)) rows.push(...body.data);
      url = body.paging?.next ?? '';
    }
    return rows;
  }

  /**
   * Pull the last `days` of per-ad daily spend and upsert into AdSpendDaily.
   * Idempotent (unique on date+adId). No-ops when unconfigured. One bad row
   * never aborts the batch (per-row try/catch); a row whose currency can't be
   * FX-converted to CAD is skipped (retried next sync) rather than stored with
   * a bogus CAD base.
   */
  async syncSpend(days = 35): Promise<{
    skipped: boolean;
    reason?: string;
    synced?: number;
    since?: string;
    until?: string;
    accountId?: string;
  }> {
    const creds = await this.resolveCredentials();
    if (!creds) return { skipped: true, reason: 'no meta_ads account id configured' };

    // Widen the window a day on each side: Meta interprets time_range in the
    // ad-account's timezone, so a UTC "today/until" can drop the newest/oldest
    // account-tz day. Future days simply return nothing.
    const now = Date.now();
    const sinceStr = this.ymd(new Date(now - Math.max(1, days) * DAY_MS));
    const untilStr = this.ymd(new Date(now + DAY_MS));

    const rows = await this.fetchInsights(creds, sinceStr, untilStr);
    let synced = 0;
    for (const r of rows) {
      try {
        if (!r.ad_id || !r.date_start) continue;
        const spendNum = Number(r.spend ?? 0);
        if (!Number.isFinite(spendNum)) continue;
        const currency = (r.account_currency || 'USD').toUpperCase();
        let baseSpend: number;
        let fxRate: number | null;
        try {
          const conv = await this.fx.convertToBase(spendNum, currency);
          baseSpend = conv.baseAmount;
          fxRate = conv.rate;
        } catch (e) {
          // Unknown currency → skip; don't poison the CAD rollup with a fake rate.
          this.log.warn(`skip ${r.ad_id}/${r.date_start}: FX ${currency}→CAD failed (${(e as Error).message})`);
          continue;
        }
        const imp = Number(r.impressions);
        const clk = Number(r.clicks);
        const date = new Date(`${r.date_start}T00:00:00.000Z`); // stored day = account-tz date
        const data = {
          adAccountId: creds.accountId,
          adId: r.ad_id,
          adName: r.ad_name ?? null,
          campaignId: r.campaign_id ?? null,
          campaignName: r.campaign_name ?? null,
          spend: r.spend ?? '0', // pass the string straight to the Decimal column
          currency,
          baseSpend,
          baseCurrency: 'CAD',
          fxRate,
          impressions: Number.isFinite(imp) ? Math.round(imp) : null,
          clicks: Number.isFinite(clk) ? Math.round(clk) : null,
          syncedAt: new Date(),
        };
        await this.prisma.adSpendDaily.upsert({
          where: { date_adId: { date, adId: r.ad_id } },
          create: { date, ...data },
          update: data,
        });
        synced += 1;
      } catch (e) {
        this.log.warn(`ad-spend row upsert failed (${r.ad_id}/${r.date_start}): ${(e as Error).message}`);
      }
    }
    this.log.log(
      `Ad-spend sync: ${synced}/${rows.length} ad-day rows for ${creds.accountId} (${sinceStr}…${untilStr}, ${creds.source})`,
    );
    return { skipped: false, synced, since: sinceStr, until: untilStr, accountId: creds.accountId };
  }

  /** Admin status: is it wired, and what's cached. Never returns the token. */
  async getStatus() {
    const creds = await this.resolveCredentials();
    try {
      const agg = await this.prisma.adSpendDaily.aggregate({
        _count: { _all: true },
        _max: { syncedAt: true, date: true },
        _min: { date: true },
        _sum: { baseSpend: true },
      });
      const distinctAds = await this.prisma.adSpendDaily
        .findMany({ select: { adId: true }, distinct: ['adId'] })
        .then((r) => r.length);
      return {
        configured: !!creds,
        source: creds?.source ?? null,
        accountId: creds?.accountId ?? null,
        rows: agg._count._all,
        distinctAds,
        lastSyncedAt: agg._max.syncedAt,
        coverageFrom: agg._min.date,
        coverageTo: agg._max.date,
        totalBaseSpendCad: agg._sum.baseSpend ? Number(agg._sum.baseSpend) : 0,
      };
    } catch {
      // Table not migrated yet — report config state without the cache stats.
      return {
        configured: !!creds,
        source: creds?.source ?? null,
        accountId: creds?.accountId ?? null,
        rows: 0,
        distinctAds: 0,
        lastSyncedAt: null,
        coverageFrom: null,
        coverageTo: null,
        totalBaseSpendCad: 0,
      };
    }
  }
}
