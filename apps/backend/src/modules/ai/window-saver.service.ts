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
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WHATSAPP_QUEUE, type OutboundMessageJob } from '../whatsapp/queues/queue-contracts';
import { OrchestratorService } from './orchestrator.service';

/**
 * Window-saver: the deliberate, once-per-window exception to the bot's
 * human-reply lockout.
 *
 * The lockout (see {@link OrchestratorService.decide}) keeps the bot silent on
 * ANY thread a rep has replied to — sales owns those conversations and the bot
 * must never talk over them. That is correct almost always, but it has one
 * failure mode: a rep replies, the customer sends a follow-up question, the rep
 * gets pulled away, and nobody answers. Left alone, the 24h WhatsApp service
 * window quietly closes on that question — after which the customer can only be
 * reached with a paid template.
 *
 * The window-saver targets exactly that thread. A few hours before the window
 * closes, for a customer question still sitting unanswered, it asks the
 * orchestrator to compose ONE context-aware reply (full history + RAG over the
 * knowledge base — the same brain the bot uses everywhere, so it stays ON
 * topic instead of emitting a canned nudge) and sends it, keeping the
 * conversation — and the free window — alive. The customer's reply reopens the
 * window; a business message alone does not reset it.
 *
 * Distinct from the window-keeper, which handles the OPPOSITE case (WE spoke
 * last, the lead went quiet) with canned re-engagement text. The saver only
 * fires when the LATEST message is an unanswered INBOUND.
 *
 * Targeting (conservative — protects the number's Meta quality rating). Fires
 * only when ALL hold:
 *   • WINDOW_SAVER_ENABLED is not 'false' (kill-switch);
 *   • org botMode === 'AUTO' and the bot is enabled (never SHADOW_ONLY /
 *     DISABLED — a shadow bot must never auto-send);
 *   • current time is within sending hours (no 3am sends);
 *   • thread OPEN, aiEnabled, NOT handed off (booked / opted-out / media-parked
 *     are left alone), lead still a lead (not converted / deleted);
 *   • the window closes within {@link CLOSE_WITHIN_MS} but is still open
 *     (≈20h elapsed of the 24h window);
 *   • the LATEST message on the thread is INBOUND (a genuinely unanswered
 *     customer message — if the bot or a rep had answered it, the latest would
 *     be OUTBOUND);
 *   • we have not already saved this window (fire at most once per inbound);
 *   • decide(windowSave) returns an AUTO reply (its own guards — opt-out,
 *     blocked, paid client, empty/guarded reply — can still veto).
 *
 * Idempotent + capped per sweep. Sends bot-attributed (sentByEmployeeId null,
 * payload.source='window_save') so it never masquerades as a human reply and
 * the fire-once guard can find it.
 */
@Injectable()
export class WhatsAppWindowSaverService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhatsAppWindowSaverService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Re-entrancy guard: a sweep composes (LLM+RAG) per thread, the heaviest of
   *  the three crons, so guard against an overlapping sweep on a slow run. */
  private running = false;

  /** Sweep cadence. */
  private static readonly INTERVAL_MS = 30 * 60 * 1000;
  /** Save when the window will close within this much time (and is still open).
   *  ~4h before the 24h close ≈ the "20h elapsed" mark — late enough that the
   *  rep has clearly not returned, early enough to still land inside the
   *  window. Override with WINDOW_SAVER_CLOSE_WITHIN_HOURS. */
  private static readonly CLOSE_WITHIN_MS =
    (Number(process.env.WINDOW_SAVER_CLOSE_WITHIN_HOURS) || 4) * 60 * 60 * 1000;
  /** Sending hours in org-local time (PKT). No sends outside [START, END). */
  private static readonly SEND_HOUR_START = 8; // 8am
  private static readonly SEND_HOUR_END = 22; // 10pm
  /** Per-sweep cap so a backlog can't burst outbound sends. */
  private static readonly MAX_PER_SWEEP = 50;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
    private readonly orchestrator: OrchestratorService,
  ) {}

  onModuleInit(): void {
    if (process.env.WINDOW_SAVER_ENABLED === 'false') {
      this.log.log('WhatsApp window-saver disabled (WINDOW_SAVER_ENABLED=false)');
      return;
    }
    setTimeout(() => {
      void this.sweep().catch((e) =>
        this.log.warn(`first window-saver sweep failed: ${(e as Error).message}`),
      );
    }, 60_000);
    this.timer = setInterval(() => {
      void this.sweep().catch((e) =>
        this.log.warn(`window-saver sweep failed: ${(e as Error).message}`),
      );
    }, WhatsAppWindowSaverService.INTERVAL_MS);
    this.log.log(
      `WhatsApp window-saver started (every ${WhatsAppWindowSaverService.INTERVAL_MS / 60000} min, save ≤${WhatsAppWindowSaverService.CLOSE_WITHIN_MS / 3600000}h before close)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sweep(): Promise<void> {
    if (this.running) return; // don't let a slow sweep overlap the next tick
    this.running = true;
    try {
      await this.runSweep();
    } finally {
      this.running = false;
    }
  }

  private async runSweep(): Promise<void> {
    // ── Org gate: only when the bot is fully AUTO + enabled. SHADOW_ONLY and
    // DISABLED must never auto-send. (decide() enforces this too, but gating
    // here avoids composing a reply we'd only throw away.) ───────────────────
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { botMode: true, botEnabledAt: true },
    });
    if (!org || org.botMode !== 'AUTO') return;
    if (!org.botEnabledAt || org.botEnabledAt.getTime() > Date.now()) return;

    // ── Sending-hours gate (org-local PKT) — never send in the middle of the
    // night. A window that lapses off-hours is better lost than answered at 3am.
    const hour = this.pktHour();
    if (
      hour < WhatsAppWindowSaverService.SEND_HOUR_START ||
      hour >= WhatsAppWindowSaverService.SEND_HOUR_END
    ) {
      return;
    }

    const now = new Date();
    const closeBy = new Date(now.getTime() + WhatsAppWindowSaverService.CLOSE_WITHIN_MS);

    const threads = await this.prisma.whatsAppThread.findMany({
      where: {
        status: 'OPEN',
        aiEnabled: true,
        // Skip booked / opted-out / media-parked (HANDED_OFF) and the bot-driven
        // email-capture state (ASK_EMAIL) — a cron must never hijack the
        // sequential email→verification→call-permission flow that state drives.
        aiState: { notIn: ['HANDED_OFF', 'ASK_EMAIL'] },
        windowExpiresAt: { gt: now, lte: closeBy },
        clientId: null,
        leadId: { not: null },
        lead: { is: { convertedClientId: null, deletedAt: null } },
      },
      select: { id: true, channelId: true, leadId: true },
      take: 500,
    });

    let sent = 0;
    for (const t of threads) {
      if (sent >= WhatsAppWindowSaverService.MAX_PER_SWEEP) break;
      if (!t.leadId) continue;

      // The latest message must be an unanswered INBOUND. If it's OUTBOUND, the
      // bot or a rep already answered (or it's the window-keeper's "we spoke
      // last" lane) — nothing to save here.
      const latest = await this.prisma.whatsAppMessage.findFirst({
        where: { threadId: t.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, direction: true, body: true, createdAt: true },
      });
      if (!latest || latest.direction !== WhatsAppMessageDirection.INBOUND) continue;

      // Need real text to understand + answer. A media-only inbound gives the
      // orchestrator nothing to ground on — leave those for a human.
      const inboundText = (latest.body ?? '').trim();
      if (!inboundText) continue;

      // Fire once per window: skip if we already saved since this inbound
      // (this inbound IS the latest message, so anything OUTBOUND after it
      // would have flipped the `latest` check — but guard explicitly in case a
      // prior save is still QUEUED and hasn't been counted as OUTBOUND yet).
      const alreadySaved = await this.prisma.whatsAppMessage.findFirst({
        where: {
          threadId: t.id,
          direction: WhatsAppMessageDirection.OUTBOUND,
          createdAt: { gt: latest.createdAt },
          payload: { path: ['source'], equals: 'window_save' },
        },
        select: { id: true },
      });
      if (alreadySaved) continue;

      // Ask the orchestrator to compose a context-aware reply, bypassing the
      // human-reply lockout for this one save. decide() applies its remaining
      // guards (opt-out / blocked / paid client / empty reply) and returns
      // SKIPPED if any veto — in which case we send nothing.
      let decision;
      try {
        decision = await this.orchestrator.decide({
          threadId: t.id,
          inboundMessageId: latest.id,
          inboundText,
          windowSave: true,
        });
      } catch (e) {
        this.log.warn(`window-saver decide failed (thread ${t.id}): ${(e as Error).message}`);
        continue;
      }
      // Send only a plain AUTO text reply. Skip brochure-expecting decisions:
      // the real-time processor overrides the text and sends the file as a
      // follow-up DOCUMENT — which we do NOT replicate here — so sending
      // decision.reply alone risks promising a brochure that never arrives.
      // Let a human field those. (mode !== 'AUTO' also skips OPT_OUT/SKIPPED,
      // so an opt-out inbound is correctly left untouched.)
      if (decision.mode !== 'AUTO' || !decision.reply?.trim() || decision.attachBrochure) {
        continue;
      }

      await this.sendSaveText(t, decision.reply.trim());
      sent++;
    }

    if (sent > 0) {
      this.log.log(`window-saver re-engaged ${sent} unanswered lead(s) before their window closes`);
    }
  }

  /** Self-create + enqueue a bot-attributed reply, stamped with the
   *  'window_save' marker so the fire-once-per-window guard catches it. */
  private async sendSaveText(
    t: { id: string; channelId: string; leadId: string | null },
    body: string,
  ): Promise<void> {
    const msg = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: t.id,
        channelId: t.channelId,
        leadId: t.leadId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEXT,
        status: WhatsAppMessageStatus.QUEUED,
        body,
        idempotencyKey: randomUUID(),
        payload: { source: 'window_save' } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await this.outboundQueue.add('send', { messageId: msg.id }, { jobId: msg.id });
  }

  /** Current hour (0–23) in the org's PKT timezone. */
  private pktHour(): number {
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      hour: '2-digit',
      hour12: false,
    }).format(new Date());
    const h = parseInt(s, 10);
    return Number.isFinite(h) ? h % 24 : 12; // default to midday if parse fails
  }
}
