import { Injectable, Logger } from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { OpenAiService } from '../ai/openai.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * A single advisory insight the model produced. Always ADVISORY — nothing
 * here mutates budgets, ads, or routing rules; the model may recommend an
 * action, the human decides.
 */
export interface MarketingInsight {
  key: string;
  category: 'performance' | 'attribution' | 'routing' | 'creative' | 'budget' | 'other';
  severity: 'high' | 'medium' | 'low';
  title: string;
  rationale: string;
  action: string;
  confidence: number; // 0..1
  targetAdId?: string | null;
  targetAdName?: string | null;
  targetCampaignId?: string | null;
  targetCampaignName?: string | null;
}

export interface MarketingInsightsResult {
  insights: MarketingInsight[];
  generatedAt: string;
  windowDays: number;
  model: string;
  cached: boolean;
  tokens?: { input: number; output: number };
  /** Present when the model is not configured or the LLM call failed. */
  error?: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — LLM calls cost money

/**
 * Advisory insights for the Marketing portal (Phase 1G).
 *
 * Grounds an LLM on live aggregates (overview KPIs + top campaigns + top ads
 * + routing gaps) and asks it to surface 3–7 things a marketing manager
 * would want to notice — CPL drift, ad rejection, disproportionate spend on
 * a low-converter, missing routing rules, etc.
 *
 * IMPORTANT — advisory only. Per the module spec §15, this NEVER changes ad
 * status, budget, or routing on its own. Every recommendation includes an
 * `action` line the human executes.
 *
 * Caching: results are memoised for 1h keyed by (windowDays). A manual
 * refresh call clears the cache. LLM calls cost money and the underlying
 * aggregates only shift meaningfully at hour-scale; anything finer would be
 * noise the model would over-interpret.
 */
@Injectable()
export class MarketingAiInsightsService {
  private readonly log = new Logger(MarketingAiInsightsService.name);
  private cache = new Map<number, { at: number; result: MarketingInsightsResult }>();
  private inflight = new Map<number, Promise<MarketingInsightsResult>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregates: MarketingService,
    private readonly openai: OpenAiService,
  ) {}

  async get(windowDays = 30, force = false): Promise<MarketingInsightsResult> {
    if (!force) {
      const hit = this.cache.get(windowDays);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return { ...hit.result, cached: true };
      }
      const inflight = this.inflight.get(windowDays);
      if (inflight) return inflight;
    } else {
      this.cache.delete(windowDays);
    }

    const promise = this.build(windowDays)
      .then((r) => {
        this.cache.set(windowDays, { at: Date.now(), result: r });
        return r;
      })
      .finally(() => {
        this.inflight.delete(windowDays);
      });
    this.inflight.set(windowDays, promise);
    return promise;
  }

  private async build(windowDays: number): Promise<MarketingInsightsResult> {
    const [overview, adsResp, campsResp, unroutedAdCount] = await Promise.all([
      this.aggregates.getOverview(windowDays),
      this.aggregates.getAds(windowDays, false),
      this.aggregates.getCampaigns(windowDays, false),
      this.countUnroutedActiveAds(),
    ]);

    // Compact the ads/campaigns to top-10 each so the model isn't drowning
    // in 200 rows. It should still see the shape of the tail via counts.
    const topAds = adsResp.ads.slice(0, 10);
    const topCampaigns = campsResp.campaigns.slice(0, 10);

    const context = {
      window: overview.window,
      kpis: overview.kpis,
      totals: {
        adsWithActivity: adsResp.ads.length,
        campaignsWithActivity: campsResp.campaigns.length,
        unroutedActiveAds: unroutedAdCount,
      },
      topAds: topAds.map((a) => ({
        adId: a.adId,
        adName: a.adName,
        campaignName: a.campaignName,
        status: a.effectiveStatus,
        spendCad: round(a.spendBaseCad),
        impressions: a.impressions,
        clicks: a.clicks,
        leads: a.leads,
        cpl: round(a.cpl),
        ctr: a.ctr != null ? round(a.ctr * 100) : null,
      })),
      topCampaigns: topCampaigns.map((c) => ({
        campaignId: c.campaignId,
        name: c.name,
        status: c.effectiveStatus,
        objective: c.objective,
        spendCad: round(c.spendBaseCad),
        leads: c.leads,
        clientsConverted: c.clientsConverted,
        // Absolute revenue is intentionally NOT fed to the LLM — otherwise a
        // recommendation could quote it back and leak the amount to the
        // marketing role. ROAS (a ratio) is enough signal for "worth scaling
        // or worth cutting" advice.
        cpl: round(c.cpl),
        cpa: round(c.cpa),
        roas: round(c.roas),
      })),
    };

    let result: MarketingInsightsResult;
    try {
      result = await this.callLlm(context, windowDays);
    } catch (e) {
      this.log.error(`Insights generation failed: ${(e as Error).message}`);
      result = {
        insights: [],
        generatedAt: new Date().toISOString(),
        windowDays,
        model: 'gpt-4o-mini',
        cached: false,
        error: (e as Error).message,
      };
    }
    return result;
  }

  private async callLlm(context: unknown, windowDays: number): Promise<MarketingInsightsResult> {
    const system = [
      'You are a senior paid-media analyst reviewing this immigration-consulting firm\'s Meta ad account.',
      'You get compact JSON aggregates for the trailing window; write 3–7 short, specific, actionable insights.',
      'RULES:',
      '- ADVISORY only. Never say "I paused" or "I raised" anything. Recommend, never act.',
      '- Reference REAL rows from the aggregates by ad_id or campaign name when relevant. Do not invent metrics.',
      '- Prefer specific numbers over vague adjectives. "CPL 12 vs 3 baseline" beats "CPL is elevated".',
      '- Skip filler like "keep monitoring" — only surface things that need a human decision.',
      '- If a metric is null or 0 and it matters (e.g. ROAS 0 with real spend), flag it, don\'t guess a number.',
      '- Rank by decision impact, not novelty.',
      'Return STRICT JSON with the exact schema below — no prose outside the JSON block.',
      '',
      'SCHEMA:',
      '{',
      '  "insights": [',
      '    {',
      '      "key": "kebab-case-slug-unique-per-insight",',
      '      "category": "performance" | "attribution" | "routing" | "creative" | "budget" | "other",',
      '      "severity": "high" | "medium" | "low",',
      '      "title": "short imperative headline (≤80 chars)",',
      '      "rationale": "1–2 sentences citing the numbers",',
      '      "action": "one concrete next step the human should take",',
      '      "confidence": 0.0-1.0,',
      '      "targetAdId": "string or null",',
      '      "targetAdName": "string or null",',
      '      "targetCampaignId": "string or null",',
      '      "targetCampaignName": "string or null"',
      '    }',
      '  ]',
      '}',
    ].join('\n');

    const user = `Window: last ${windowDays} days.\n\nAGGREGATES:\n${JSON.stringify(context, null, 2)}`;

    const res = await this.openai.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { jsonMode: true, maxTokens: 1800, temperature: 0.2 },
    );

    let parsed: { insights?: unknown } = {};
    try {
      parsed = JSON.parse(res.reply) as { insights?: unknown };
    } catch (e) {
      throw new Error(`Model returned non-JSON: ${(e as Error).message}`);
    }
    const rawInsights = Array.isArray(parsed.insights) ? parsed.insights : [];
    const insights = rawInsights.map((r) => this.coerceInsight(r)).filter((r): r is MarketingInsight => r !== null);

    return {
      insights,
      generatedAt: new Date().toISOString(),
      windowDays,
      model: res.model,
      cached: false,
      tokens: { input: res.inputTokens, output: res.outputTokens },
    };
  }

  private coerceInsight(raw: unknown): MarketingInsight | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const title = str(r.title);
    const rationale = str(r.rationale);
    const action = str(r.action);
    if (!title || !rationale || !action) return null;
    return {
      key: str(r.key) ?? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60),
      category: (['performance', 'attribution', 'routing', 'creative', 'budget', 'other'].includes(
        (r.category ?? '') as string,
      )
        ? r.category
        : 'other') as MarketingInsight['category'],
      severity: (['high', 'medium', 'low'].includes((r.severity ?? '') as string)
        ? r.severity
        : 'medium') as MarketingInsight['severity'],
      title,
      rationale,
      action,
      confidence: clamp01(typeof r.confidence === 'number' ? r.confidence : 0.5),
      targetAdId: str(r.targetAdId),
      targetAdName: str(r.targetAdName),
      targetCampaignId: str(r.targetCampaignId),
      targetCampaignName: str(r.targetCampaignName),
    };
  }

  private async countUnroutedActiveAds(): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n
       FROM crm.meta_ads a
       WHERE a."effectiveStatus" = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM crm.ad_routing_rules r
           WHERE (r."targetType" = 'AD' AND r."targetId" = a."adId")
              OR (r."targetType" = 'CAMPAIGN' AND r."targetId" = a."campaignId")
         )`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  cacheInfo(): { keys: number; oldestAgeMs: number | null } {
    if (this.cache.size === 0) return { keys: 0, oldestAgeMs: null };
    const now = Date.now();
    const oldest = Math.min(...[...this.cache.values()].map((v) => v.at));
    return { keys: this.cache.size, oldestAgeMs: now - oldest };
  }
}

function round(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}
