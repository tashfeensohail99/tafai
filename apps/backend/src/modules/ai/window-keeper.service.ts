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
  AppointmentStatus,
  Prisma,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WHATSAPP_QUEUE, type OutboundMessageJob } from '../whatsapp/queues/queue-contracts';
import { WhatsAppCallsService } from '../whatsapp/calls/calls.service';

/**
 * Window-keeper: a gentle re-engagement nudge fired a few hours before the
 * WhatsApp 24-hour customer-service window closes, so an unresolved lead who
 * has gone quiet gets one chance to reply — and their reply reopens the window
 * (a business message does NOT reset it; only the customer's does), keeping
 * the conversation reachable for free instead of falling back to templates.
 *
 * This is distinct from the backlog sweeper, which RE-ANSWERS an unanswered
 * inbound. The window-keeper targets the opposite case: WE spoke last, the
 * lead went silent, and the window is about to lapse.
 *
 * Targeting (deliberately conservative — protects the number's Meta quality
 * rating). A thread is nudged only when ALL hold:
 *   • org botMode === 'AUTO' and the bot is enabled (never in SHADOW_ONLY /
 *     DISABLED — a shadow bot must never auto-send);
 *   • current time is within sending hours (no 3am pings);
 *   • thread OPEN, aiEnabled, NOT handed off (so booked / opted-out / media
 *     threads are skipped);
 *   • lead is still a lead — not converted, not a client, not deleted;
 *   • NO appointment booked for the lead (SCHEDULED / CONFIRMED);
 *   • the window closes within {@link CLOSE_WITHIN_MS} but is still open;
 *   • the latest message on the thread is OUTBOUND ("we spoke last / lead's
 *     gone quiet" — an unanswered inbound is the backlog sweeper's job);
 *   • we have not already sent a window-keeper nudge since the lead's most
 *     recent inbound (fire at most once per window).
 *
 * Idempotent + capped per sweep. Sends via the normal outbound queue (a plain
 * free-form message inside the still-open window).
 */
@Injectable()
export class WhatsAppWindowKeeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhatsAppWindowKeeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Sweep cadence. */
  private static readonly INTERVAL_MS = 30 * 60 * 1000;
  /** Nudge when the window will close within this much time (and is still open).
   *  ~7h before the 24h close ≈ the "17h elapsed" mark — early enough to read as
   *  a genuine follow-up, late enough that the lead has clearly gone quiet. */
  private static readonly CLOSE_WITHIN_MS = 7 * 60 * 60 * 1000;
  /** Sending hours in org-local time (PKT). No nudges outside [START, END). */
  private static readonly SEND_HOUR_START = 8; // 8am
  private static readonly SEND_HOUR_END = 22; // 10pm
  /** Per-sweep cap so a backlog can't burst outbound sends. */
  private static readonly MAX_PER_SWEEP = 50;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
    private readonly calls: WhatsAppCallsService,
  ) {}

  onModuleInit(): void {
    setTimeout(() => {
      void this.sweep().catch((e) =>
        this.log.warn(`first window-keeper sweep failed: ${(e as Error).message}`),
      );
    }, 45_000);
    this.timer = setInterval(() => {
      void this.sweep().catch((e) =>
        this.log.warn(`window-keeper sweep failed: ${(e as Error).message}`),
      );
    }, WhatsAppWindowKeeperService.INTERVAL_MS);
    this.log.log(
      `WhatsApp window-keeper started (every ${WhatsAppWindowKeeperService.INTERVAL_MS / 60000} min, nudge ≤${WhatsAppWindowKeeperService.CLOSE_WITHIN_MS / 3600000}h before close)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sweep(): Promise<void> {
    // ── Org gate: only when the bot is fully AUTO + enabled. SHADOW_ONLY and
    // DISABLED must never auto-send. ─────────────────────────────────────────
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { botMode: true, botEnabledAt: true },
    });
    if (!org || org.botMode !== 'AUTO') return;
    if (!org.botEnabledAt || org.botEnabledAt.getTime() > Date.now()) return;

    // ── Sending-hours gate (org-local PKT) — never nudge in the middle of the
    // night. A window that lapses off-hours is better lost than spammed at 3am.
    const hour = this.pktHour();
    if (
      hour < WhatsAppWindowKeeperService.SEND_HOUR_START ||
      hour >= WhatsAppWindowKeeperService.SEND_HOUR_END
    ) {
      return;
    }

    const now = new Date();
    const closeBy = new Date(now.getTime() + WhatsAppWindowKeeperService.CLOSE_WITHIN_MS);

    const threads = await this.prisma.whatsAppThread.findMany({
      where: {
        status: 'OPEN',
        aiEnabled: true,
        aiState: { not: 'HANDED_OFF' }, // skip booked / opted-out / media-parked
        windowExpiresAt: { gt: now, lte: closeBy },
        clientId: null,
        leadId: { not: null },
        lead: { is: { convertedClientId: null, deletedAt: null } },
      },
      select: {
        id: true,
        channelId: true,
        leadId: true,
        callPermissionStatus: true,
        lead: {
          select: {
            firstName: true,
            email: true,
            assignedEmployee: { select: { user: { select: { id: true } } } },
          },
        },
      },
      take: 500,
    });

    let sent = 0;
    for (const t of threads) {
      if (sent >= WhatsAppWindowKeeperService.MAX_PER_SWEEP) break;
      if (!t.leadId) continue;

      // Window anchor = lead's most recent inbound. Also our fire-once boundary.
      const latestInbound = await this.prisma.whatsAppMessage.findFirst({
        where: { threadId: t.id, direction: WhatsAppMessageDirection.INBOUND },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (!latestInbound) continue;

      // "We spoke last": the latest message must be OUTBOUND. If it's INBOUND,
      // the lead has an unanswered message — that's the backlog sweeper's lane.
      const latest = await this.prisma.whatsAppMessage.findFirst({
        where: { threadId: t.id },
        orderBy: { createdAt: 'desc' },
        select: { direction: true },
      });
      if (!latest || latest.direction !== WhatsAppMessageDirection.OUTBOUND) continue;

      // No appointment booked for this lead.
      const appt = await this.prisma.appointment.findFirst({
        where: {
          leadId: t.leadId,
          status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
        },
        select: { id: true },
      });
      if (appt) continue;

      // Fire once per window: skip if we already nudged since the last inbound.
      const alreadyNudged = await this.prisma.whatsAppMessage.findFirst({
        where: {
          threadId: t.id,
          direction: WhatsAppMessageDirection.OUTBOUND,
          createdAt: { gt: latestInbound.createdAt },
          payload: { path: ['source'], equals: 'window_keeper' },
        },
        select: { id: true },
      });
      if (alreadyNudged) continue;

      // ── Decide what this lead still needs, and ask for ONE thing — never
      // both in the same touch, and never repeat what we already have:
      //   1. no email        → ask for email (reply captured by the orchestrator
      //                         ASK_EMAIL handler, which saves it + verification
      //                         link, THEN sends the call-permission request — so
      //                         email and permission stay separate & sequential);
      //   2. email, no perm   → send the interactive call-permission request
      //                         (idempotent: status flips to PENDING, never null
      //                         again, so it can't re-fire);
      //   3. perm PENDING     → already asked this window — stay quiet;
      //   4. email + settled  → light re-engagement, no repeated asks.
      const firstName = cleanFirstName(t.lead?.firstName);
      const emailMissing = !t.lead?.email;
      const permStatus = t.callPermissionStatus;
      const repUserId = t.lead?.assignedEmployee?.user?.id ?? null;

      if (emailMissing) {
        await this.sendKeeperText(t, askEmailBody(firstName));
        await this.prisma.whatsAppThread.update({
          where: { id: t.id },
          data: { aiState: 'ASK_EMAIL' },
        });
        sent++;
      } else if (permStatus == null && repUserId) {
        try {
          await this.calls.requestCallPermission(t.id, repUserId);
          sent++;
        } catch (e) {
          this.log.warn(
            `window-keeper permission request failed (thread ${t.id}): ${(e as Error).message}`,
          );
        }
      } else if (permStatus === 'PENDING') {
        continue; // already requested this window — don't nag
      } else {
        await this.sendKeeperText(t, composeNudge(firstName));
        sent++;
      }
    }

    if (sent > 0) {
      this.log.log(`window-keeper nudged ${sent} lead(s) before their window closes`);
    }
  }

  /** Self-create + enqueue a bot-attributed free-form nudge, stamped with the
   *  'window_keeper' marker so the fire-once-per-window guard catches it. */
  private async sendKeeperText(
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
        payload: { source: 'window_keeper' } as unknown as Prisma.InputJsonValue,
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

/**
 * Drop placeholder / non-name values so the nudge never greets "Hi +9234…"
 * or "Hi Customer 1234". Returns a usable first name or null.
 */
function cleanFirstName(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (v.length < 2) return null;
  if (/^[+\d]/.test(v)) return null; // starts with a digit or +
  if (/^customer\b/i.test(v)) return null;
  return v;
}

function composeNudge(firstName: string | null): string {
  const greet = firstName ? `Hi ${firstName},` : 'Hi,';
  return `${greet} just checking in — are you still considering your immigration options? I'm here whenever you'd like to pick things up. — Tashfeen Immigration`;
}

/** Email-collection ask — sent inside the still-open window. The lead's reply
 *  is captured by the orchestrator's ASK_EMAIL handler. */
function askEmailBody(firstName: string | null): string {
  const greet = firstName ? `Hi ${firstName},` : 'Hi,';
  return `${greet} so we can send your consultation details and important updates by email, could you share your best email address? Just reply here. — Tashfeen Immigration`;
}
