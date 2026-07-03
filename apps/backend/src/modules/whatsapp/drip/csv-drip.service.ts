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
import { findLeadByNormalizedPhone } from '../../../common/phone/lead-dedupe';
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
      // Idempotency: this exact touch already went out. On a re-run of touch-1
      // (e.g. last time the touch-2 enqueue failed after dripTouch1At committed)
      // (re)ensure the touch-2 job exists — add with the fixed jobId is a no-op
      // if it's already queued, so this can't double-schedule.
      if (touch === 1 && lead.dripTouch1At) {
        if (!lead.dripTouch2At) {
          await this.dripQueue
            .add(
              'touch2',
              { leadId, touch: 2, touch1At: lead.dripTouch1At.getTime() },
              { jobId: `drip-${leadId}-t2`, delay: TOUCH2_DELAY_MS },
            )
            .catch(() => undefined);
        }
        return;
      }
      if (touch === 2 && lead.dripTouch2At) return;

      const thread = lead.whatsappThread as ThreadState;

      // --- guards (each either sends, skips-with-reason, or defers) ----------
      if (lead.blockedAt) return this.skip(leadId, touch, 'blocked');
      // A converted lead is an existing (often paying) client — the drip is a
      // lead-acquisition tool and must NEVER fire on them, blocked or not.
      if (lead.convertedClientId) return this.skip(leadId, touch, 'converted_client');

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

      // Phone-scoped block: Lead.phone isn't unique, so a sibling lead row stored
      // in a different format — or the converted client for this number — may
      // carry the block even when THIS lead row doesn't. Honor it (mirrors how
      // the inbound webhook resolves + drops blocked contacts).
      const dupLead = await findLeadByNormalizedPhone(this.prisma, norm.e164);
      if (dupLead?.blockedAt) return this.skip(leadId, touch, 'blocked');
      const blockedClient = await this.prisma.client.findFirst({
        where: { phone: norm.e164, deletedAt: null, blockedAt: { not: null } },
        select: { id: true },
      });
      if (blockedClient) return this.skip(leadId, touch, 'blocked');

      // Opt-out gate — reengage_personal is MARKETING, so honor STOP. The
      // opt_outs rows are written by the wa-optout-gate branch's OPT_OUT handler
      // (MUST be merged before this feature — see the drip PR notes).
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
      // no_channel / no_template are TRANSIENT (channel briefly inactive, template
      // still syncing/approving) — defer + retry, don't kill the whole drip.
      if (!channel) return this.deferTouch(data, 'no_channel');

      // Per-channel daily cap. When hit, defer (bounded) rather than drop.
      const sentToday = await this.countRecentDripSends(channel.id);
      if (sentToday >= DAILY_CAP) return this.deferTouch(data, 'daily_cap');

      const tpl = await this.prisma.whatsAppTemplate.findFirst({
        where: { channelId: channel.id, name: DRIP_TEMPLATE },
        select: { status: true, language: true, components: true },
      });
      if (!tpl || tpl.status !== WhatsAppTemplateStatus.APPROVED) {
        return this.deferTouch(data, 'no_template');
      }

      const threadId = await this.ensureThread(lead.id, thread, channel.id, waId, norm.e164, lead.phone);
      // null = the number's thread already belongs to a DIFFERENT lead/client —
      // this is a duplicate lead; never steal that conversation (terminal skip).
      if (!threadId) return this.skip(leadId, touch, 'thread_conflict');

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
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        // Row already exists — a duplicate job, OR a prior attempt committed the
        // row but failed to enqueue the send. Re-enqueue idempotently (jobId =
        // message.id) so it isn't left stuck in QUEUED waiting on the boot
        // drainer. Only when still QUEUED, so a genuinely-sent duplicate isn't
        // re-dispatched.
        const existingMsg = await this.prisma.whatsAppMessage.findUnique({
          where: { idempotencyKey: `drip-${lead.id}-t${touch}` },
          select: { id: true, status: true },
        });
        if (existingMsg && existingMsg.status === WhatsAppMessageStatus.QUEUED) {
          await this.outboundQueue.add('send', { messageId: existingMsg.id }, { jobId: existingMsg.id });
        }
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

    // A thread for this (channel, waId) may ALREADY exist under a DIFFERENT lead
    // (a same-number duplicate stored in another format) or a converted client.
    // NEVER steal it — that would orphan the real owner and mis-route replies.
    // Resolve first; claim only when unowned; otherwise return null (the caller
    // skips as 'thread_conflict').
    const found = await this.prisma.whatsAppThread.findUnique({
      where: { channelId_waContactId: { channelId, waContactId } },
      select: { id: true, leadId: true, clientId: true },
    });
    if (found) {
      if (found.clientId || (found.leadId && found.leadId !== leadId)) return null;
      if (found.leadId !== leadId) {
        await this.prisma.whatsAppThread.update({ where: { id: found.id }, data: { leadId } });
      }
      return found.id;
    }
    try {
      // Bot-created thread: deliberately do NOT stamp lastHumanActivityAt /
      // lastCustomerMessageAt / lastHumanReplyAt — a drip send is not human/
      // customer activity, and those drive inbox sort ordering.
      const created = await this.prisma.whatsAppThread.create({
        data: { channelId, waContactId, leadId, status: WhatsAppThreadStatus.OPEN, lastMessageAt: new Date() },
        select: { id: true },
      });
      return created.id;
    } catch (e) {
      // Lost a race to create the same (channel, waId) — re-read and apply the
      // same no-steal rule.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const r = await this.prisma.whatsAppThread.findUnique({
        where: { channelId_waContactId: { channelId, waContactId } },
        select: { id: true, leadId: true, clientId: true },
      });
      if (!r || r.clientId || (r.leadId && r.leadId !== leadId)) return null;
      return r.id;
    }
  }

  /**
   * Record why a touch didn't send AND re-enqueue it (bounded) — for TRANSIENT
   * conditions (daily cap hit, channel briefly inactive, template still syncing)
   * that should retry rather than silently kill the drip.
   */
  private async deferTouch(data: CsvDripJob, reason: string): Promise<void> {
    await this.skip(data.leadId, data.touch, reason);
    const deferrals = (data.deferrals ?? 0) + 1;
    if (deferrals <= MAX_DEFERRALS) {
      await this.dripQueue.add(
        data.touch === 1 ? 'touch1' : 'touch2',
        { ...data, deferrals },
        { jobId: `drip-${data.leadId}-t${data.touch}-d${deferrals}`, delay: CAP_DEFER_MS },
      );
    } else {
      this.log.warn(`drip lead ${data.leadId} touch ${data.touch}: gave up after ${MAX_DEFERRALS} deferrals (${reason})`);
    }
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
