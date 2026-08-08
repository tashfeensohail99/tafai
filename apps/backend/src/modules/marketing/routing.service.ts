import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AdRoutingTargetType, type AdRoutingRule } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Editable ad-routing rules — the DB replacement for the hardcoded AD_ROUTING
 * map that used to live in assignment.service.ts.
 *
 * Two responsibilities:
 *   1. CRUD for the /marketing/routing admin page (list / upsert / delete).
 *   2. `teamForReferral(adId)` — the hot-path helper the WhatsApp assignment
 *      loop calls to decide whether a Click-to-WhatsApp lead is pinned to a
 *      sub-team. This is called on every inbound webhook, so it reads out of
 *      an in-memory snapshot refreshed every 60s (rules + hierarchy + branch
 *      rosters all cached together — a rule change re-invalidates the
 *      snapshot immediately on write).
 *
 * Resolution order:
 *   ad rule → campaign rule (via meta_ads → campaignId) → no rule (null).
 * `null` at any step means "no restriction — use the whole eligible pool".
 */
@Injectable()
export class AdRoutingRulesService {
  private readonly log = new Logger(AdRoutingRulesService.name);

  /** In-memory snapshot rebuilt every 60s or when a rule mutates. */
  private snap: {
    /** Ad id → set of eligible employee ids. */
    adToEmployees: Map<string, ReadonlySet<string>>;
    /** Campaign id → set of eligible employee ids. */
    campaignToEmployees: Map<string, ReadonlySet<string>>;
    /** Ad id → its campaign id (from meta_ads), so an AD lookup can fall
     *  through to a CAMPAIGN rule without a second DB round-trip. */
    adToCampaign: Map<string, string>;
    builtAt: number;
  } | null = null;

  private static readonly TTL_MS = 60_000;
  private building: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ─────────────────────────────────────────────────────────────────

  list(): Promise<AdRoutingRule[]> {
    return this.prisma.adRoutingRule.findMany({ orderBy: [{ targetType: 'asc' }, { createdAt: 'desc' }] });
  }

  /** Upsert (by targetType+targetId). Returns the row and invalidates the cache. */
  async upsert(input: {
    targetType: AdRoutingTargetType;
    targetId: string;
    branchIds: string[];
    notes?: string | null;
    createdByUserId?: string | null;
  }): Promise<AdRoutingRule> {
    if (input.branchIds.length === 0) {
      throw new Error('branchIds cannot be empty — delete the rule instead');
    }
    const row = await this.prisma.adRoutingRule.upsert({
      where: { targetType_targetId: { targetType: input.targetType, targetId: input.targetId } },
      create: {
        targetType: input.targetType,
        targetId: input.targetId,
        branchIds: input.branchIds,
        notes: input.notes ?? null,
        createdByUserId: input.createdByUserId ?? null,
      },
      update: {
        branchIds: input.branchIds,
        notes: input.notes ?? null,
      },
    });
    this.snap = null;
    return row;
  }

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.adRoutingRule.delete({ where: { id } });
    } catch (e) {
      throw new NotFoundException(`Routing rule ${id} not found`);
    }
    this.snap = null;
  }

  // ── Hot-path lookup ──────────────────────────────────────────────────────

  /**
   * Return the fixed sub-team a Click-to-WhatsApp `adReferral` must route to,
   * or `null` if the ad has no override. Called from the WhatsApp assignment
   * loop; must be cheap. Reads from the in-memory snapshot (refreshed at most
   * once per minute + on write).
   */
  async teamForReferral(adReferral: unknown): Promise<ReadonlySet<string> | null> {
    if (!adReferral || typeof adReferral !== 'object' || Array.isArray(adReferral)) return null;
    const sid = (adReferral as Record<string, unknown>)['source_id'];
    if (typeof sid !== 'string') return null;

    const snap = await this.getSnap();
    // Ad-level rule wins.
    const adTeam = snap.adToEmployees.get(sid);
    if (adTeam) return adTeam.size > 0 ? adTeam : null;
    // Fall through to the campaign rule if this ad is in a campaign that has one.
    const campaignId = snap.adToCampaign.get(sid);
    if (campaignId) {
      const campTeam = snap.campaignToEmployees.get(campaignId);
      if (campTeam) return campTeam.size > 0 ? campTeam : null;
    }
    return null;
  }

  /** Cache snapshot — returned if fresh, otherwise rebuilt (single-flight). */
  private async getSnap() {
    const now = Date.now();
    if (this.snap && now - this.snap.builtAt < AdRoutingRulesService.TTL_MS) return this.snap;
    if (this.building) {
      await this.building;
      return this.snap!;
    }
    this.building = this.rebuild().finally(() => {
      this.building = null;
    });
    await this.building;
    return this.snap!;
  }

  /** Introspection for the Integration Health page. Doesn't force a rebuild —
   *  a `null` snapshot means "not built yet"; the caller should render that as
   *  "warming up" rather than "broken". */
  snapshotInfo(): { rules: number; ads: number; builtAt: string | null; ageMs: number | null } {
    if (!this.snap) return { rules: 0, ads: 0, builtAt: null, ageMs: null };
    return {
      rules: this.snap.adToEmployees.size + this.snap.campaignToEmployees.size,
      ads: this.snap.adToCampaign.size,
      builtAt: new Date(this.snap.builtAt).toISOString(),
      ageMs: Date.now() - this.snap.builtAt,
    };
  }

  private async rebuild(): Promise<void> {
    const [rules, ads] = await Promise.all([
      this.prisma.adRoutingRule.findMany({ select: { targetType: true, targetId: true, branchIds: true } }),
      this.prisma.metaAd.findMany({ select: { adId: true, campaignId: true } }),
    ]);

    // Resolve every distinct branch id referenced by a rule into its active
    // employee roster (one query, batched across rules).
    const allBranchIds = new Set<string>();
    for (const r of rules) r.branchIds.forEach((b) => allBranchIds.add(b));
    const employeesByBranch = new Map<string, string[]>();
    if (allBranchIds.size > 0) {
      const emps = await this.prisma.employee.findMany({
        where: { branchId: { in: [...allBranchIds] }, deletedAt: null, isActive: true },
        select: { id: true, branchId: true },
      });
      for (const e of emps) {
        if (!e.branchId) continue;
        const bucket = employeesByBranch.get(e.branchId) ?? [];
        bucket.push(e.id);
        employeesByBranch.set(e.branchId, bucket);
      }
    }

    const adToEmployees = new Map<string, ReadonlySet<string>>();
    const campaignToEmployees = new Map<string, ReadonlySet<string>>();
    for (const r of rules) {
      const team = new Set<string>();
      for (const b of r.branchIds) for (const id of employeesByBranch.get(b) ?? []) team.add(id);
      if (r.targetType === 'AD') adToEmployees.set(r.targetId, team);
      else campaignToEmployees.set(r.targetId, team);
    }

    const adToCampaign = new Map<string, string>();
    for (const a of ads) adToCampaign.set(a.adId, a.campaignId);

    this.snap = { adToEmployees, campaignToEmployees, adToCampaign, builtAt: Date.now() };
    this.log.debug?.(
      `Ad-routing snapshot: ${adToEmployees.size} ad rules · ${campaignToEmployees.size} campaign rules · ${adToCampaign.size} ads`,
    );
  }
}
