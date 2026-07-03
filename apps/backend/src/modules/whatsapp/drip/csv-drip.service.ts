import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  WhatsAppChannelStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  WhatsAppTemplateStatus,
  WhatsAppThreadStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { normalisePhone } from '../../../common/phone/phone.util';
import {
  WHATSAPP_QUEUE,
  type CsvDripJob,
  type OutboundMessageJob,
} from '../queues/queue-contracts';

// --- Tunables (env-overridable, no UI needed) -------------------------------
// The MARKETING template used for both touches (your only marketing template).
const DRIP_TEMPLATE = process.env.CSV_DRIP_TEMPLATE?.trim() || 'reengage_personal';
const DRIP_LANGUAGE = process.env.CSV_DRIP_LANGUAGE?.trim() || 'en';
// Second touch fires this many hours after touch-1 (default 40h → both within 48h).
const TOUCH2_DELAY_MS = Number(process.env.CSV_DRIP_TOUCH2_HOURS ?? 40) * 3_600_000;
// Per-channel guardrail: max drip template sends in any rolling 24h. Protects
// the business number's Meta quality rating from an import spike.
const DAILY_CAP = Number(process.env.CSV_DRIP_DAILY_CAP ?? 250);
// When the cap is hit, re-check after this long, up to MAX_DEFERRALS times, so
// leads beyond today's cap still get contacted rather than silently dropped.
const CAP_DEFER_MS = Number(process.env.CSV_DRIP_CAP_DEFER_HOURS ?? 4) * 3_600_000;
const MAX_DEFERRALS = Number(process.env.CSV_DRIP_MAX_DEFERRALS ?? 12);
// A lead whose thread shows a real conversation (ever replied, or a rep messaged
// them) within this window is "recently active" → we DON'T drop a canned
// template into it (decision: skip auto-template for active leads).
const RECENT_ACTIVE_MS = Number(process.env.CSV_DRIP_RECENT_DAYS ?? 30) * 86_400_000;

type ThreadState = {
  id: string;
  clientId: string | null;
  firstInboundAt: Date | null;
  lastCustomerMessageAt: Date | null;
  lastHumanReplyAt: Date | null;
} | null;

/**
 * CSV auto-drip: a two-touch WhatsApp TEMPLATE outreach fired when a lead enters
 * via CSV import. Touch-1 lands ~on import (staggered), touch-2 ~40h later — but
 * ONLY if the lead hasn't replied. Every send is BOT-STYLE (sentByEmployeeId
 * null, payload.source='csv_drip') so it never masquerades as a human reply /
 * disturbs the inbox's awaiting-reply accounting. All guards are re-checked at
 * fire-time (a delayed job can be hours/days stale): blocked, opted-out,
 * recently-active, per-channel daily cap, already-replied.
 */
@Injectable()
export class CsvDripService {
  private readonly log = new Logger(CsvDripService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
    @InjectQueue(WHATSAPP_QUEUE.CSV_DRIP)
    private readonly dripQueue: Queue<CsvDripJob>,
  ) {}

  /** Fire-time entry point for a drip job (touch 1 or 2). Never throws. */
  async runTouch(data: CsvDripJob): Promise<void> {
    const { leadId, touch } = data;
    try {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          firstName: true,
          phone: true,
          convertedClientId: true,
          blockedAt: true,
          deletedAt: true,
          dripTouch1At: true,
          dripTouch2At: true,
          assignedEmployee: { select: { firstName: true } },
          whatsappThread: {
            select: {
              id: true,
              clientId: true,
              firstInboundAt: true,
              lastCustomerMessageAt: true,
              lastHumanReplyAt: true,
            },
          },
        },
      });
      if (!lead || lead.deletedAt) return; // lead vanished / soft-deleted
      // Idempotency: this exact touch already went out.
      if (touch === 1 && lead.dripTouch1At) return;
      if (touch === 2 && lead.dripTouch2At) return;

      const thread = lead.whatsappThread as ThreadState;

      // --- guards (each either sends, skips-with-reason, or defers) ----------
      if (lead.blockedAt) return this.skip(leadId, touch, 'blocked');
      if (lead.convertedClientId) {
        const c = await this.prisma.client.findUnique({
          where: { id: lead.convertedClientId },
          select: { blockedAt: true },
        });
        if (c?.blockedAt) return this.skip(leadId, touch, 'blocked');
      }

      // Touch-2: if the customer replied since touch-1, STOP — the drip did its
      // job and the lead now drops off the CSV list (reply filter) into the
      // live inbox. Not a "skip reason" — it's the happy path.
      if (touch === 2) {
        const touch1At = data.touch1At ? new Date(data.touch1At) : lead.dripTouch1At;
        if (this.repliedSince(thread, touch1At)) return;
      }

      // Never drop a canned template into an already-live conversation.
      if (this.recentlyActive(thread)) return this.skip(leadId, touch, 'recently_active');

      const norm = normalisePhone(lead.phone);
      if (!norm.ok || !norm.e164) return this.skip(leadId, touch, 'invalid_phone');
      const waId = norm.e164.replace(/\D/g, '');

      // Opt-out gate — reengage_personal is MARKETING, so honor STOP.
      const optedOut = await this.prisma.whatsAppOptOut.findUnique({
        where: { waId },
        select: { waId: true },
      });
      if (optedOut) return this.skip(leadId, touch, 'opted_out');

      const channel = await this.prisma.whatsAppChannel.findFirst({
        where: { status: WhatsAppChannelStatus.ACTIVE },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!channel) return this.skip(leadId, touch, 'no_channel');

      // Per-channel daily cap. When hit, defer (bounded) rather than drop.
      const sentToday = await this.countRecentDripSends(channel.id);
      if (sentToday >= DAILY_CAP) {
        await this.skip(leadId, touch, 'daily_cap');
        const deferrals = (data.deferrals ?? 0) + 1;
        if (deferrals <= MAX_DEFERRALS) {
          await this.dripQueue.add(
            touch === 1 ? 'touch1' : 'touch2',
            { ...data, deferrals },
            { jobId: `drip-${leadId}-t${touch}-d${deferrals}`, delay: CAP_DEFER_MS },
          );
        } else {
          this.log.warn(`drip lead ${leadId} touch ${touch}: gave up after ${MAX_DEFERRALS} cap deferrals`);
        }
        return;
      }

      const tpl = await this.prisma.whatsAppTemplate.findFirst({
        where: { channelId: channel.id, name: DRIP_TEMPLATE },
        select: { status: true, language: true, components: true },
      });
      if (!tpl || tpl.status !== WhatsAppTemplateStatus.APPROVED) {
        return this.skip(leadId, touch, 'no_template');
      }

      const threadId = await this.ensureThread(lead.id, thread, channel.id, waId, norm.e164, lead.phone);
      if (!threadId) return this.skip(leadId, touch, 'no_channel');

      // --- send (bot-style TEMPLATE) ----------------------------------------
      const repName = (lead.assignedEmployee?.firstName ?? '').trim() || 'Tashfeen Immigration Solutions';
      const firstName = (lead.firstName ?? '').trim() || 'there';
      const components: Array<Record<string, unknown>> = [
        { type: 'body', parameters: [{ type: 'text', text: firstName }, { type: 'text', text: repName }] },
      ];
      const body = this.renderBody(tpl.components, [firstName, repName]);

      try {
        const message = await this.prisma.whatsAppMessage.create({
          data: {
            threadId,
            channelId: channel.id,
            leadId: lead.id,
            clientId: thread?.clientId ?? lead.convertedClientId ?? null,
            direction: WhatsAppMessageDirection.OUTBOUND,
            type: WhatsAppMessageType.TEMPLATE,
            status: WhatsAppMessageStatus.QUEUED,
            templateName: DRIP_TEMPLATE,
            templateLanguage: tpl.language,
            body,
            payload: { components, source: 'csv_drip', touch } as unknown as Prisma.InputJsonValue,
            sentByEmployeeId: null, // bot send — must NOT count as a human reply
            idempotencyKey: `drip-${lead.id}-t${touch}`,
          },
          select: { id: true },
        });
        await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });
      } catch (e) {
        // @unique idempotencyKey collision = this touch already went out (a
        // duplicate job). Treat as sent: fall through to stamp + schedule.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }

      await this.prisma.lead.update({
        where: { id: lead.id },
        data:
          touch === 1
            ? { dripTouch1At: new Date(), dripSkippedReason: null }
            : { dripTouch2At: new Date(), dripSkippedReason: null },
      });

      if (touch === 1) {
        await this.dripQueue.add(
          'touch2',
          { leadId, touch: 2, touch1At: Date.now() },
          { jobId: `drip-${leadId}-t2`, delay: TOUCH2_DELAY_MS },
        );
      }
      this.log.log(`drip lead ${leadId}: touch ${touch} queued`);
    } catch (e) {
      // Never let a drip failure crash the worker; BullMQ will retry per opts.
      this.log.warn(`drip lead ${leadId} touch ${touch} failed: ${(e as Error).message}`);
      throw e; // allow BullMQ retry/backoff
    }
  }

  private repliedSince(thread: ThreadState, since: Date | null | undefined): boolean {
    if (!thread || !since) return false;
    return !!thread.lastCustomerMessageAt && thread.lastCustomerMessageAt.getTime() > since.getTime();
  }

  private recentlyActive(thread: ThreadState): boolean {
    if (!thread) return false; // brand-new CSV lead — no conversation to disturb
    const cutoff = Date.now() - RECENT_ACTIVE_MS;
    // A live conversation in the last N days (customer messaged us, or a rep
    // messaged them) — don't drop a canned template into it. A genuinely
    // DORMANT lead (last activity older than the window) is still re-engaged.
    if (thread.lastCustomerMessageAt && thread.lastCustomerMessageAt.getTime() > cutoff) return true;
    if (thread.lastHumanReplyAt && thread.lastHumanReplyAt.getTime() > cutoff) return true;
    return false;
  }

  /** Rolling-24h count of csv_drip sends on a channel (the daily-cap window). */
  private async countRecentDripSends(channelId: string): Promise<number> {
    const since = new Date(Date.now() - 86_400_000);
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM whatsapp.messages
      WHERE "channelId" = ${channelId}
        AND "createdAt" >= ${since}
        AND payload->>'source' = 'csv_drip'`;
    return Number(rows[0]?.count ?? 0n);
  }

  /** Reuse the lead's thread, else open one outbound-first (like sendTemplateToLead). */
  private async ensureThread(
    leadId: string,
    existing: ThreadState,
    channelId: string,
    waContactId: string,
    e164: string,
    storedPhone: string,
  ): Promise<string | null> {
    if (existing) return existing.id;

    // Persist the canonical E.164 back to the lead so a future inbound REPLY
    // (webhook resolves by exact phone) reconciles to THIS lead, unless another
    // lead already holds the canonical number.
    if (storedPhone !== e164) {
      const clash = await this.prisma.lead.findFirst({
        where: { phone: e164, deletedAt: null, id: { not: leadId } },
        select: { id: true },
      });
      if (!clash) {
        await this.prisma.lead.update({ where: { id: leadId }, data: { phone: e164 } }).catch(() => undefined);
      }
    }

    const now = new Date();
    const created = await this.prisma.whatsAppThread.upsert({
      where: { channelId_waContactId: { channelId, waContactId } },
      create: {
        channelId,
        waContactId,
        leadId,
        status: WhatsAppThreadStatus.OPEN,
        lastMessageAt: now,
        lastHumanActivityAt: now,
      },
      update: { leadId },
      select: { id: true },
    });
    return created.id;
  }

  /** Substitute {{1}},{{2}}… in the template's BODY text for the stored display body. */
  private renderBody(components: unknown, params: string[]): string | null {
    const list = Array.isArray(components) ? (components as Array<{ type?: string; text?: string }>) : [];
    const bodyText = list.find((c) => String(c?.type ?? '').toUpperCase() === 'BODY')?.text;
    if (!bodyText) return null;
    return bodyText.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
  }

  /** Best-effort record of why a touch did NOT send (shown on the CSV page). */
  private async skip(leadId: string, touch: 1 | 2, reason: string): Promise<void> {
    this.log.log(`drip lead ${leadId}: touch ${touch} skipped (${reason})`);
    await this.prisma.lead
      .update({ where: { id: leadId }, data: { dripSkippedReason: reason } })
      .catch(() => undefined);
  }
}
