import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  WhatsAppCampaignStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  WhatsAppThreadStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WHATSAPP_QUEUE, type OutboundMessageJob } from '../whatsapp/queues/queue-contracts';

/**
 * Self-paced re-engagement BLAST for the dormant-lead backlog. Clears the
 * "uncontacted + 24h-window-closed" backlog one salesperson at a time, a few
 * messages at a time, so it never bursts Meta and protects the quality rating.
 *
 * Driven by a control row: an ACTIVE `WhatsAppCampaign`. No active campaign →
 * the cron does nothing (safe by default — deploying it never sends anything
 * until an admin explicitly starts a campaign). Pause = set the campaign to any
 * non-ACTIVE status; it auto-flips to COMPLETED when the backlog is empty.
 * Control via scripts/reengage-blast-control.ts (start|pause|resume|stop|status|preview).
 *
 * Per sweep (every 20 min, 8am–10pm PKT): pick the agent to work (the configured
 * priority agent first — e.g. Iffat Hanif — then the agent with the largest
 * remaining backlog), and queue up to `perTick` template sends for that agent,
 * respecting a per-PKT-day cap. Idempotent: a thread already sent this template
 * is never messaged again. Sends are bot/campaign-attributed (sentByEmployeeId
 * null) so they don't clear the "uncontacted" flag — a rep still replies when
 * the customer responds.
 */
interface BlastConfig {
  templateName: string;
  language: string;
  perTick: number;
  dailyCap: number;
  priorityEmployeeId: string | null;
  staggerMs: number;
}

@Injectable()
export class WhatsAppReengageBlastService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhatsAppReengageBlastService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private static readonly INTERVAL_MS = 20 * 60 * 1000; // ~3 ticks/hr → 15/hr at perTick 5
  private static readonly SEND_HOUR_START = 8; // 8am PKT
  private static readonly SEND_HOUR_END = 22; // 10pm PKT

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
  ) {}

  onModuleInit(): void {
    setTimeout(() => {
      void this.sweep().catch((e) =>
        this.log.warn(`first reengage-blast sweep failed: ${(e as Error).message}`),
      );
    }, 90_000);
    this.timer = setInterval(() => {
      void this.sweep().catch((e) =>
        this.log.warn(`reengage-blast sweep failed: ${(e as Error).message}`),
      );
    }, WhatsAppReengageBlastService.INTERVAL_MS);
    this.log.log(
      `reengage-blast cron started (every ${WhatsAppReengageBlastService.INTERVAL_MS / 60000} min; idle until an ACTIVE campaign exists)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sweep(): Promise<void> {
    if (this.running) return; // never overlap sweeps
    this.running = true;
    try {
      const campaign = await this.prisma.whatsAppCampaign.findFirst({
        where: { status: WhatsAppCampaignStatus.SENDING },
        orderBy: { createdAt: 'desc' },
      });
      if (!campaign) return;
      const cfg = this.parseConfig(campaign.variableMap);
      if (!cfg) return;

      const hour = this.pktHour();
      if (
        hour < WhatsAppReengageBlastService.SEND_HOUR_START ||
        hour >= WhatsAppReengageBlastService.SEND_HOUR_END
      ) {
        return;
      }

      const dayStart = this.pktDayStartUtc();
      const sentToday = await this.prisma.whatsAppMessage.count({
        where: {
          templateName: cfg.templateName,
          createdAt: { gte: dayStart },
          payload: { path: ['source'], equals: 'reengage_blast' },
        },
      });
      const budget = Math.min(cfg.perTick, cfg.dailyCap - sentToday);
      if (budget <= 0) return;

      const targets = await this.nextAgentBatch(cfg, budget);
      if (targets === 'empty') {
        await this.prisma.whatsAppCampaign.update({
          where: { id: campaign.id },
          data: { status: WhatsAppCampaignStatus.COMPLETED, completedAt: new Date() },
        });
        this.log.log('reengage-blast: backlog cleared → campaign COMPLETED');
        return;
      }
      if (targets.rows.length === 0) return;

      const bodyText = await this.templateBody(targets.channelId, cfg.templateName);
      let queued = 0;
      for (let i = 0; i < targets.rows.length; i++) {
        const t = targets.rows[i];
        const name = cleanGreetingName(t.firstName);
        const rep = (t.repFirstName ?? '').trim() || 'our team';
        const components: Array<Record<string, unknown>> = [
          { type: 'body', parameters: [{ type: 'text', text: name }, { type: 'text', text: rep }] },
        ];
        const rendered = bodyText
          ? bodyText.replace(/\{\{(\d+)\}\}/g, (_, n: string) =>
              n === '1' ? name : n === '2' ? rep : `{{${n}}}`,
            )
          : null;
        try {
          const msg = await this.prisma.whatsAppMessage.create({
            data: {
              threadId: t.threadId,
              channelId: t.channelId,
              leadId: t.leadId,
              direction: WhatsAppMessageDirection.OUTBOUND,
              type: WhatsAppMessageType.TEMPLATE,
              status: WhatsAppMessageStatus.QUEUED,
              templateName: cfg.templateName,
              templateLanguage: cfg.language,
              body: rendered,
              payload: {
                components,
                source: 'reengage_blast',
                campaignId: campaign.id,
              } as unknown as Prisma.InputJsonValue,
              sentByEmployeeId: null,
              idempotencyKey: randomUUID(),
            },
            select: { id: true },
          });
          await this.outboundQueue.add(
            'send',
            { messageId: msg.id },
            { jobId: msg.id, delay: i * cfg.staggerMs },
          );
          queued += 1;
        } catch (e) {
          this.log.warn(`reengage-blast queue failed (thread ${t.threadId}): ${(e as Error).message}`);
        }
      }
      if (queued > 0) {
        await this.prisma.whatsAppCampaign.update({
          where: { id: campaign.id },
          data: {
            totalQueued: { increment: queued },
            totalSent: { increment: queued },
            ...(campaign.startedAt ? {} : { startedAt: new Date() }),
          },
        });
        this.log.log(
          `reengage-blast: queued ${queued} for agent ${targets.agentId} (today ${sentToday + queued}/${cfg.dailyCap})`,
        );
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Resolve the next batch to send: pick the working agent (priority agent
   * first, else the largest remaining backlog) and return up to `budget` of
   * their eligible threads. Returns 'empty' when no agent has any eligible
   * thread left (→ campaign complete).
   */
  private async nextAgentBatch(
    cfg: BlastConfig,
    budget: number,
  ): Promise<
    | 'empty'
    | {
        agentId: string;
        channelId: string;
        rows: Array<{ threadId: string; channelId: string; leadId: string | null; firstName: string | null; repFirstName: string | null }>;
      }
  > {
    const now = new Date();
    const sent = await this.prisma.whatsAppMessage.findMany({
      where: { templateName: cfg.templateName },
      select: { threadId: true },
      distinct: ['threadId'],
    });
    const sentIds = new Set(sent.map((s) => s.threadId).filter((x): x is string => !!x));

    const candidates = await this.prisma.whatsAppThread.findMany({
      where: {
        lastHumanReplyAt: null,
        status: { in: [WhatsAppThreadStatus.OPEN, WhatsAppThreadStatus.PENDING] },
        windowExpiresAt: { lt: now },
        leadId: { not: null },
        lead: {
          is: {
            blockedAt: null,
            convertedClientId: null,
            deletedAt: null,
            assignedEmployeeId: { not: null },
          },
        },
        ...(sentIds.size ? { id: { notIn: [...sentIds] } } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        channelId: true,
        leadId: true,
        lead: {
          select: {
            firstName: true,
            assignedEmployeeId: true,
            assignedEmployee: { select: { firstName: true } },
          },
        },
      },
    });
    if (candidates.length === 0) return 'empty';

    const byAgent = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const aid = c.lead?.assignedEmployeeId;
      if (!aid) continue;
      const list = byAgent.get(aid) ?? [];
      list.push(c);
      byAgent.set(aid, list);
    }
    if (byAgent.size === 0) return 'empty';

    let agentId: string | null = null;
    if (cfg.priorityEmployeeId && byAgent.has(cfg.priorityEmployeeId)) {
      agentId = cfg.priorityEmployeeId;
    } else {
      let max = 0;
      for (const [aid, list] of byAgent) {
        if (list.length > max) {
          max = list.length;
          agentId = aid;
        }
      }
    }
    if (!agentId) return 'empty';

    const rows = byAgent
      .get(agentId)!
      .slice(0, budget)
      .map((c) => ({
        threadId: c.id,
        channelId: c.channelId,
        leadId: c.leadId,
        firstName: c.lead?.firstName ?? null,
        repFirstName: c.lead?.assignedEmployee?.firstName ?? null,
      }));
    return { agentId, channelId: candidates[0].channelId, rows };
  }

  private async templateBody(channelId: string, name: string): Promise<string | null> {
    const tpl = await this.prisma.whatsAppTemplate.findFirst({
      where: { channelId, name },
      select: { components: true },
    });
    const comps = (tpl?.components ?? []) as Array<{ type?: string; text?: string }>;
    return comps.find((c) => (c.type ?? '').toUpperCase() === 'BODY')?.text ?? null;
  }

  private parseConfig(v: Prisma.JsonValue | null): BlastConfig | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const templateName = typeof o.templateName === 'string' ? o.templateName : null;
    if (!templateName) return null;
    return {
      templateName,
      language: typeof o.language === 'string' ? o.language : 'en',
      perTick: typeof o.perTick === 'number' ? o.perTick : 5,
      dailyCap: typeof o.dailyCap === 'number' ? o.dailyCap : 200,
      priorityEmployeeId: typeof o.priorityEmployeeId === 'string' ? o.priorityEmployeeId : null,
      staggerMs: typeof o.staggerMs === 'number' ? o.staggerMs : 1500,
    };
  }

  private pktHour(): number {
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      hour: '2-digit',
      hour12: false,
    }).format(new Date());
    const h = parseInt(s, 10);
    return Number.isFinite(h) ? h % 24 : 12;
  }

  /** Start of the current PKT day, expressed in UTC (for createdAt >= filters). */
  private pktDayStartUtc(): Date {
    const PKT = 5 * 60 * 60 * 1000;
    const nowPkt = new Date(Date.now() + PKT);
    const dayPktMidnight = Date.UTC(
      nowPkt.getUTCFullYear(),
      nowPkt.getUTCMonth(),
      nowPkt.getUTCDate(),
      0,
      0,
      0,
    );
    return new Date(dayPktMidnight - PKT);
  }
}

/**
 * Sanitize a lead's first name for the "Hi {{1}}," greeting. Many dormant leads
 * carry a WhatsApp profile name (emoji, non-Latin script, junk) as their first
 * name — "Hi 🥰اللہ," reads as spam and hurts the brand. Keep only a plausible
 * Latin given name; otherwise fall back to a neutral "there" ({{1}} can't be
 * empty — Meta rejects empty params).
 */
function cleanGreetingName(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (/^[A-Za-z][A-Za-z .'’-]{1,38}$/.test(v)) return v;
  return 'there';
}
