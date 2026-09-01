import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
// Voice-note transcoding uses the system ffmpeg installed in the runtime image
// via apk (see apps/backend/Dockerfile, runner stage). We deliberately do NOT
// use the `ffmpeg-static` npm package: its post-install downloads the binary
// from a GitHub release at `npm ci` time, which intermittently returns 504 and
// fails the entire deploy. The apk package is deterministic and baked into the
// image layer, so builds no longer depend on an external download.
const FFMPEG_BIN = 'ffmpeg';
// ffprobe ships in the same alpine `ffmpeg` apk package — used to read a
// video's duration so we can target a bitrate that lands under WhatsApp's cap.
const FFPROBE_BIN = 'ffprobe';

// A rep's phone occasionally records a voice note that runs the full duration
// but captures NO audio — another app is holding the mic, an OEM mic-privacy
// toggle is on, or the mic hardware is failing. The .ogg is a normal length
// but ~1-3 KB and measures ~-91 dB (pure digital silence); the client then
// receives a voice note with no voice. We measure the transcoded note's peak
// level and refuse to send a silent one so the rep re-records. Real speech
// peaks far above this (a normal note maxes around -12 dB); -70 dB only ever
// trips on effectively-silent capture, so a genuinely quiet note still sends.
const VOICE_SILENCE_MAX_DB = -70;

// WhatsApp Cloud API media ceilings (Meta-enforced, per message type):
//   • inline video   → 16 MB  (a video over this can't be sent as a video)
//   • document       → 100 MB (our fallback: send an oversized clip as a file)
// We compress videos to a target below the video cap; if a clip is so long it
// still won't fit after compression, it goes out as a document up to 100 MB.
const WA_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const WA_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;
// Compression target — a few MB under the 16 MB video cap so single-pass x264
// bitrate variance can't push the result back over the line.
const VIDEO_TARGET_BYTES = 14 * 1024 * 1024;
import {
  ChannelPlatform,
  Prisma,
  WhatsAppChannelStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  WhatsAppTemplateCategory,
  WhatsAppThreadStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { normalisePhone } from '../../../common/phone/phone.util';
import { StorageService } from '../../storage/storage.service';
import { WHATSAPP_QUEUE, type OutboundMessageJob } from '../queues/queue-contracts';
import { WhatsAppMetaClientFactory } from '../meta/client.factory';
import { MetaApiError } from '../meta/cloud-client';

interface CallerContext {
  userId: string;
  employeeId: string | null;
  canViewAll: boolean;
  /**
   * Finance closed-loop scope: caller may see/send on threads only for
   * leads where Sales has sent an agreement (status != DRAFT).
   */
  canViewFinanceScope?: boolean;
  /**
   * Processing closed-loop scope: caller may see/send on threads only for
   * leads/clients that have a ProcessingCase.
   */
  canViewProcessingScope?: boolean;
}

interface SendTextInput {
  threadId: string;
  body: string;
  /** Optional Meta wa_message_id of a message being replied-to (in-chat quote). */
  contextWaMessageId?: string;
  /** Client-supplied idempotency key to dedupe accidental double-send. */
  idempotencyKey?: string;
}

interface SendTemplateInput {
  threadId: string;
  templateName: string;
  language: string;
  components?: Array<Record<string, unknown>>;
  idempotencyKey?: string;
}

interface SendMediaInput {
  threadId: string;
  /** Raw file buffer from the multipart upload. */
  file: Buffer;
  /** MIME type from Content-Type, e.g. audio/ogg or image/jpeg. */
  mimeType: string;
  /** Original filename, used for Meta upload and as document display name. */
  filename: string;
  /** Optional text caption shown below the media. */
  caption?: string;
  idempotencyKey?: string;
}

interface SendReactionInput {
  threadId: string;
  /** wa_message_id of the (inbound) message being reacted to. */
  targetWaMessageId: string;
  /** Emoji to react with. */
  emoji: string;
  idempotencyKey?: string;
}

interface SendLocationInput {
  threadId: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  idempotencyKey?: string;
}

interface SendContactInput {
  threadId: string;
  /** Simple {name, phone} pairs; the service assembles the Meta contact shape. */
  contacts: Array<{ name: string; phone: string }>;
  idempotencyKey?: string;
}

/**
 * Compose + enqueue outbound WhatsApp messages. The Meta send happens in the
 * outbound-message worker; this service only persists the Message row and
 * publishes the job.
 *
 * Enforced rules (UI cannot bypass):
 *   - 24-hour customer-service window: free-form text is allowed only when
 *     `WhatsAppThread.windowExpiresAt` is in the future. Outside the window
 *     callers must use a template message.
 *   - Agent scope: an agent can only send on threads whose Lead is assigned
 *     to them, unless they hold `whatsapp.view_all_inboxes`.
 */
@Injectable()
export class WhatsAppMessagesService {
  private readonly logger = new Logger(WhatsAppMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
    private readonly metaFactory: WhatsAppMetaClientFactory,
    private readonly storage: StorageService,
  ) {}

  async listForThread(
    caller: CallerContext,
    threadId: string,
    opts: { limit?: number; before?: Date; after?: Date } = {},
  ) {
    const thread = await this.thread(caller, threadId);
    const limit = Math.min(opts.limit ?? 50, 200);

    // `after` → tail fetch: ONLY messages newer than the cursor, ascending.
    // The open chat uses this to append just-arrived messages on a realtime
    // event instead of refetching the whole window every time. Uses the
    // [threadId, createdAt] index just like the default load.
    if (opts.after) {
      return this.prisma.whatsAppMessage.findMany({
        where: { threadId: thread.id, createdAt: { gt: opts.after } },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: this.publicSelect(),
      });
    }

    const rows = await this.prisma.whatsAppMessage.findMany({
      where: {
        threadId: thread.id,
        ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: this.publicSelect(),
    });
    // Return chronological asc for the chat thread render.
    return rows.reverse();
  }

  async sendText(caller: CallerContext, input: SendTextInput) {
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Message body must not be empty');

    const thread = await this.thread(caller, input.threadId);
    const now = new Date();
    // WhatsApp requires a template outside the 24h window. Messenger/Instagram
    // have no templates — a human rep replies via the HUMAN_AGENT tag (≤7 days),
    // applied by the outbound processor — so they are not blocked here.
    const isSocial = thread.platform !== ChannelPlatform.WHATSAPP;
    if (!isSocial && (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime())) {
      throw new BadRequestException(
        '24-hour customer-service window has expired. Use a template message instead.',
      );
    }

    const senderEmployeeId = this.resolveSenderEmployeeId(caller, thread);

    let message;
    try {
      message = await this.prisma.whatsAppMessage.create({
        data: {
          threadId: thread.id,
          channelId: thread.channelId,
          leadId: thread.leadId,
          clientId: thread.clientId,
          direction: WhatsAppMessageDirection.OUTBOUND,
          type: WhatsAppMessageType.TEXT,
          status: WhatsAppMessageStatus.QUEUED,
          body,
          sentByEmployeeId: senderEmployeeId,
          repliedToWaMessageId: input.contextWaMessageId ?? null,
          idempotencyKey: input.idempotencyKey ?? randomUUID(),
        },
        select: this.publicSelect(),
      });
    } catch (err) {
      // Client retry of a send whose FIRST attempt already landed (the mobile
      // optimistic composer re-posts with the SAME idempotencyKey after a
      // timeout). Collapse to the existing row instead of 500ing — the
      // customer must never receive the message twice. The queue add below is
      // jobId-keyed, so re-running it for the existing row is a no-op when the
      // first attempt already enqueued (and a repair when it died beforehand).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        input.idempotencyKey
      ) {
        const existing = await this.prisma.whatsAppMessage.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: this.publicSelect(),
        });
        if (existing && existing.threadId === thread.id) {
          await this.outboundQueue.add(
            'send',
            { messageId: existing.id },
            { jobId: existing.id },
          );
          return existing;
        }
      }
      throw err;
    }

    await this.outboundQueue.add(
      'send',
      { messageId: message.id },
      { jobId: message.id },
    );
    // Stamp the thread so the AI bot stays silent for 4h after any human
    // reply. This rolls forward on every subsequent human send. Bot-sent
    // messages have senderEmployeeId=null and don't touch this stamp.
    if (senderEmployeeId) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiDisabledAt: new Date() },
      });
    }
    return message;
  }

  async sendTemplate(caller: CallerContext, input: SendTemplateInput) {
    const thread = await this.thread(caller, input.threadId);
    // Opt-out gate — MARKETING templates only. A customer who replied STOP has
    // their waId recorded in whatsapp.opt_outs (see ai-reply.processor OPT_OUT).
    // Meta's opt-out is about PROMOTIONAL (MARKETING) messaging, so we refuse
    // MARKETING templates to them — bulk re-engage, per-lead CRM outreach, and
    // any other promotional template all funnel through here, so this one check
    // honors the opt-out everywhere. Transactional templates (UTILITY receipts /
    // appointment confirmations, AUTHENTICATION OTPs) are deliberately NOT gated:
    // a lead who opted out and later became a paying client must still receive
    // their receipts — those are consented-to and, with the 24h window closed,
    // a template is the only channel. In-window replies (sendText/media) aren't
    // gated either. Unknown/unsynced templates fail OPEN (send) — the only
    // promotional template we send, reengage_personal, is synced as MARKETING,
    // and blocking a transactional message is the worse failure. To resume
    // promotional messages to an opted-out contact, an admin clears the
    // whatsapp.opt_outs row (no self-serve UI yet — see backlog).
    if (thread.waContactId) {
      const tpl = await this.prisma.whatsAppTemplate.findFirst({
        where: { channelId: thread.channelId, name: input.templateName },
        select: { category: true },
      });
      if (tpl?.category === WhatsAppTemplateCategory.MARKETING) {
        const optedOut = await this.prisma.whatsAppOptOut.findUnique({
          where: { waId: thread.waContactId },
          select: { waId: true },
        });
        if (optedOut) {
          throw new ForbiddenException(
            'This contact opted out of promotional WhatsApp messages (they replied STOP). Transactional messages are unaffected.',
          );
        }
      }
    }
    const senderEmployeeId = this.resolveSenderEmployeeId(caller, thread);
    // Normalise the template BODY parameters before the message reaches Meta:
    // {{1}} is FORCED to the contact's real first name (reps were treating the
    // open {{1}} field as a message box — typing whole sentences into it — which
    // produced "Hi <paragraph>, …" sends and Meta rejections when the text
    // carried newlines), and every parameter is stripped of the newlines / tabs
    // / space-runs Meta rejects. Fixes web AND mobile with no app update needed.
    const components = await this.normalizeTemplateParams(thread, input.components);

    // Render the template's body with the supplied parameters so the chat
    // bubble + inbox preview show what the customer actually receives, instead
    // of a bare "Template: <name>" placeholder. Does NOT affect what's sent to
    // Meta (the processor still sends templateName + components).
    const renderedBody = await this.renderTemplateBody(
      thread.channelId,
      input.templateName,
      components,
    );
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEMPLATE,
        status: WhatsAppMessageStatus.QUEUED,
        templateName: input.templateName,
        templateLanguage: input.language,
        body: renderedBody,
        payload: { components } as unknown as Prisma.InputJsonValue,
        sentByEmployeeId: senderEmployeeId,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      },
      select: this.publicSelect(),
    });
    await this.outboundQueue.add(
      'send',
      { messageId: message.id },
      { jobId: message.id },
    );
    // Stamp the thread so the AI bot stays silent for 4h after any human
    // reply. This rolls forward on every subsequent human send. Bot-sent
    // messages have senderEmployeeId=null and don't touch this stamp.
    if (senderEmployeeId) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiDisabledAt: new Date() },
      });
    }
    return message;
  }

  /**
   * Send an approved WhatsApp TEMPLATE to a LEAD from the CRM business number,
   * creating the conversation thread on the fly when the lead has never
   * messaged. This is how a rep makes FIRST contact on the CRM number instead
   * of their personal WhatsApp: Meta only permits business-initiated messages
   * via an approved template, so this always sends a template (never free
   * text) and is exempt from the 24h window. Returns the thread id so the UI
   * can open the in-CRM chat.
   *
   * Guards: the lead must be assigned to the caller (admins may message any),
   * and blocked leads are refused. The thread is keyed on the same
   * (channelId, waContactId) as the inbound webhook, so a later inbound reply
   * updates THIS row instead of creating a duplicate.
   */
  async sendTemplateToLead(
    caller: CallerContext,
    input: {
      leadId: string;
      templateName?: string;
      language?: string;
      /** Meta components for the chosen template. When omitted we fall back to
       *  the legacy 2-param `reengage_personal` shape (mobile one-tap path). */
      components?: Array<Record<string, unknown>>;
      idempotencyKey?: string;
    },
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: input.leadId },
      select: {
        id: true,
        phone: true,
        firstName: true,
        assignedEmployeeId: true,
        convertedClientId: true,
        blockedAt: true,
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // Ownership: a rep may only message their OWN lead; admins (view_all) any.
    if (!caller.canViewAll && lead.assignedEmployeeId !== caller.employeeId) {
      throw new ForbiddenException('This lead is not assigned to you');
    }
    // Refuse BLOCKED contacts. Block state lives on the lead AND, after
    // conversion, on the client — and the inbound webhook roots a converted
    // contact's thread on the CLIENT (leadId null), so a client-only block must
    // count too. Mirrors the reengage batch, which filters lead+client blockedAt.
    let contactBlocked = !!lead.blockedAt;
    if (!contactBlocked && lead.convertedClientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: lead.convertedClientId },
        select: { blockedAt: true },
      });
      contactBlocked = !!client?.blockedAt;
    }
    if (contactBlocked) {
      throw new BadRequestException('This contact is blocked — unblock them before messaging.');
    }

    // Reuse the lead's existing thread if it already has one (from any prior
    // inbound message/call). Lead↔Thread is 1:1 (WhatsAppThread.leadId is
    // @unique), so we must NEVER create a second thread for the same lead — and
    // reusing it also reconciles any phone-format drift between the lead's
    // stored number and the thread's waContactId. Only when there's no thread
    // yet do we open one outbound-first on the active channel.
    const existingThread = await this.prisma.whatsAppThread.findUnique({
      where: { leadId: lead.id },
      select: { id: true },
    });

    let threadId: string;
    if (existingThread) {
      threadId = existingThread.id;
    } else {
      // Normalise to E.164 digits WITHOUT the '+', exactly how the inbound
      // webhook stores waContactId, so this thread reconciles with any thread a
      // future inbound message would upsert on the same (channelId, waContactId).
      const norm = normalisePhone(lead.phone);
      if (!norm.ok || !norm.e164) {
        throw new BadRequestException(
          `This lead has no valid phone number to message (${norm.reason ?? 'invalid number'}).`,
        );
      }
      const waContactId = norm.e164.replace(/\D/g, '');

      // Persist the canonical E.164 back to the lead so a future inbound REPLY
      // (the webhook resolves the sender by EXACT phone) reconciles to THIS lead
      // instead of spawning a duplicate. Skip if another lead already holds the
      // canonical number, to avoid creating a same-number duplicate — the
      // outbound thread still links to this lead either way.
      if (lead.phone !== norm.e164) {
        const clash = await this.prisma.lead.findFirst({
          where: { phone: norm.e164, deletedAt: null, id: { not: lead.id } },
          select: { id: true },
        });
        if (!clash) {
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: { phone: norm.e164 },
          });
        }
      }

      // Send from the org's ACTIVE WhatsApp channel (the CRM business number).
      const channel = await this.prisma.whatsAppChannel.findFirst({
        where: { status: WhatsAppChannelStatus.ACTIVE },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!channel) {
        throw new BadRequestException('No active WhatsApp channel is configured to send from.');
      }

      const clientId = lead.convertedClientId ?? null;
      const now = new Date();
      // upsert on (channelId, waContactId): if the inbound webhook races us with
      // a message from the same number, whichever runs second just updates the
      // existing row instead of creating a duplicate.
      const created = await this.prisma.whatsAppThread.upsert({
        where: { channelId_waContactId: { channelId: channel.id, waContactId } },
        create: {
          channelId: channel.id,
          waContactId,
          leadId: lead.id,
          clientId,
          status: WhatsAppThreadStatus.OPEN,
          lastMessageAt: now,
          lastHumanActivityAt: now,
        },
        update: {
          leadId: lead.id,
          ...(clientId ? { clientId } : {}),
        },
        select: { id: true },
      });
      threadId = created.id;
    }

    // Template body params. When the caller picked a template in the UI it
    // supplies its own components (param count follows THAT template), and we
    // must not second-guess them — a mismatched count is a Meta #132000 reject.
    // With none supplied we keep the legacy default for reengage_personal:
    // "Hi {{1}}, this is {{2}} from Tashfeen …" — {{1}} the lead's first name,
    // {{2}} the rep's name.
    let components = input.components;
    if (!components?.length) {
      const rep = caller.employeeId
        ? await this.prisma.employee.findUnique({
            where: { id: caller.employeeId },
            select: { firstName: true },
          })
        : null;
      const repName = rep?.firstName?.trim() || 'Tashfeen Immigration Solutions';
      const leadFirstName = lead.firstName?.trim() || 'there';
      components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: leadFirstName },
            { type: 'text', text: repName },
          ],
        },
      ];
    }

    const templateName = input.templateName?.trim() || 'reengage_personal';
    const language = input.language?.trim() || 'en';

    // Coarse time-bucketed idempotency key: a double-click / two-tab / retry
    // burst collapses to ONE send (WhatsAppMessage.idempotencyKey is @unique),
    // while genuinely re-contacting the lead a couple of minutes later stays
    // allowed. A collision throws P2002, which we treat as an idempotent no-op.
    // The template name is part of the key: a rep who sends template A and then
    // deliberately picks template B seconds later must get BOTH, not a silent
    // no-op that looks like a successful second send.
    const bucket = Math.floor(Date.now() / 120_000); // 2-minute window
    const idempotencyKey =
      input.idempotencyKey ?? `wa-tpl-lead-${threadId}-${templateName}-b${bucket}`;
    try {
      const message = await this.sendTemplate(caller, {
        threadId,
        templateName,
        language,
        components,
        idempotencyKey,
      });
      return { threadId, message };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Same lead + same 2-minute window: the template already went out.
        return { threadId, message: null };
      }
      throw err;
    }
  }

  /**
   * React to a customer message with an emoji (WhatsApp reaction). A reaction is
   * a free-form session message, so the 24h window must be open — same rule as
   * text/media. Deliberately lightweight: it does NOT count as a reply, so the
   * outbound worker skips all thread denormalization (no awaiting-reply clear,
   * no lead graduation, no SLA resolution) and we do NOT stamp aiDisabledAt.
   */
  async sendReaction(caller: CallerContext, input: SendReactionInput) {
    const emoji = (input.emoji ?? '').trim();
    if (!emoji) throw new BadRequestException('An emoji is required');
    if (!input.targetWaMessageId) {
      throw new BadRequestException('A message to react to is required');
    }
    const thread = await this.thread(caller, input.threadId);
    const now = new Date();
    // WhatsApp requires a template outside the 24h window. Messenger/Instagram
    // have no templates — a human rep replies via the HUMAN_AGENT tag (≤7 days),
    // applied by the outbound processor — so they are not blocked here.
    const isSocial = thread.platform !== ChannelPlatform.WHATSAPP;
    if (!isSocial && (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime())) {
      throw new BadRequestException(
        '24-hour customer-service window has expired. Use a template message instead.',
      );
    }
    const senderEmployeeId = this.resolveSenderEmployeeId(caller, thread);
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.REACTION,
        status: WhatsAppMessageStatus.QUEUED,
        body: emoji,
        // Same shape the webhook stores for INBOUND reactions, so the chat panel
        // renders an outbound reaction identically (reads payload.reaction.emoji).
        payload: {
          reaction: { message_id: input.targetWaMessageId, emoji },
        } as unknown as Prisma.InputJsonValue,
        repliedToWaMessageId: input.targetWaMessageId,
        sentByEmployeeId: senderEmployeeId,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      },
      select: this.publicSelect(),
    });
    await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });
    return message;
  }

  /**
   * Send a pin-drop location. A real reply → the normal human-send path (clears
   * awaiting-reply, graduates the lead, stamps aiDisabledAt). Needs an open 24h
   * window like text/media.
   */
  async sendLocation(caller: CallerContext, input: SendLocationInput) {
    if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
      throw new BadRequestException('A valid latitude and longitude are required');
    }
    const thread = await this.thread(caller, input.threadId);
    const now = new Date();
    // WhatsApp requires a template outside the 24h window. Messenger/Instagram
    // have no templates — a human rep replies via the HUMAN_AGENT tag (≤7 days),
    // applied by the outbound processor — so they are not blocked here.
    const isSocial = thread.platform !== ChannelPlatform.WHATSAPP;
    if (!isSocial && (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime())) {
      throw new BadRequestException(
        '24-hour customer-service window has expired. Use a template message instead.',
      );
    }
    const senderEmployeeId = this.resolveSenderEmployeeId(caller, thread);
    const name = input.name?.trim() || undefined;
    const address = input.address?.trim() || undefined;
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.LOCATION,
        status: WhatsAppMessageStatus.QUEUED,
        body: null,
        // Matches the inbound location payload the chat panel reads.
        payload: {
          location: {
            latitude: input.latitude,
            longitude: input.longitude,
            ...(name ? { name } : {}),
            ...(address ? { address } : {}),
          },
        } as unknown as Prisma.InputJsonValue,
        sentByEmployeeId: senderEmployeeId,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      },
      select: this.publicSelect(),
    });
    await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });
    if (senderEmployeeId) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiDisabledAt: new Date() },
      });
    }
    return message;
  }

  /**
   * Send one or more contact cards. A real reply → the normal human-send path.
   * Needs an open 24h window like text/media.
   */
  async sendContact(caller: CallerContext, input: SendContactInput) {
    const cards = (input.contacts ?? [])
      .map((c) => ({ name: c.name?.trim() ?? '', phone: c.phone?.trim() ?? '' }))
      .filter((c) => c.name && c.phone);
    if (!cards.length) {
      throw new BadRequestException('At least one contact with a name and phone is required');
    }
    const thread = await this.thread(caller, input.threadId);
    const now = new Date();
    // WhatsApp requires a template outside the 24h window. Messenger/Instagram
    // have no templates — a human rep replies via the HUMAN_AGENT tag (≤7 days),
    // applied by the outbound processor — so they are not blocked here.
    const isSocial = thread.platform !== ChannelPlatform.WHATSAPP;
    if (!isSocial && (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime())) {
      throw new BadRequestException(
        '24-hour customer-service window has expired. Use a template message instead.',
      );
    }
    const senderEmployeeId = this.resolveSenderEmployeeId(caller, thread);
    // Assemble the Meta contact shape ONCE. The stored payload is byte-identical
    // to what the wire send uses AND to what the webhook stores for inbound
    // contacts, so the chat panel renders it (reads name.formatted_name +
    // phones[0].phone) with no special-casing.
    const metaContacts = cards.map((c) => ({
      name: { formatted_name: c.name, first_name: c.name },
      phones: [{ phone: c.phone, type: 'CELL' }],
    }));
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.CONTACTS,
        status: WhatsAppMessageStatus.QUEUED,
        body: null,
        payload: { contacts: metaContacts } as unknown as Prisma.InputJsonValue,
        sentByEmployeeId: senderEmployeeId,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      },
      select: this.publicSelect(),
    });
    await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });
    if (senderEmployeeId) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiDisabledAt: new Date() },
      });
    }
    return message;
  }

  /**
   * Report the re-engagement backlog for a given template: how many dormant
   * threads are still eligible (never replied-to by a human, 24h window closed,
   * contact not blocked, and NOT already sent this template), and how many have
   * already received it. Used by the admin batch sender to show progress.
   */
  async reengageStats(templateName: string): Promise<{
    templateName: string;
    alreadySent: number;
    eligibleRemaining: number;
  }> {
    const now = new Date();
    const sentThreadIds = await this.reengageSentThreadIds(templateName);
    const eligibleRemaining = await this.prisma.whatsAppThread.count({
      where: this.reengageEligibleWhere(now, sentThreadIds),
    });
    return { templateName, alreadySent: sentThreadIds.size, eligibleRemaining };
  }

  /**
   * Send the approved re-engagement TEMPLATE to the next batch of dormant leads.
   *
   * Audience: threads with NO human reply ever (lastHumanReplyAt null), status
   * OPEN/PENDING, 24h window CLOSED, contact not blocked, and that have NOT
   * already received this template (idempotent — safe to re-run; a thread is
   * never messaged twice). Ordered most-recent-first (higher reply rate).
   *
   * Each message is a system/campaign send (sentByEmployeeId = null) so it does
   * NOT clear the "uncontacted" flag or disable the AI — a rep still has to reply
   * when the customer responds. {{1}} is auto-filled with the contact's first
   * name. Goes through the normal outbound queue + WhatsAppMessage row, so every
   * send is logged, retried, and delivery-tracked exactly like a manual send.
   *
   * Jobs are staggered (small per-job delay) so a batch trickles out over a few
   * minutes instead of bursting — protects the sender quality rating.
   */
  async reengageDormantBatch(input: {
    templateName: string;
    language: string;
    limit: number;
    dryRun?: boolean;
    staggerMs?: number;
  }): Promise<{
    dryRun: boolean;
    templateName: string;
    eligibleRemainingBefore: number;
    selected: number;
    queued: number;
    sampleNames: string[];
    eligibleRemainingAfter: number;
  }> {
    const now = new Date();
    const dryRun = input.dryRun ?? false;
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 0), 0), 500); // hard cap 500/run
    const staggerMs = Math.min(Math.max(Math.trunc(input.staggerMs ?? 1500), 0), 10_000);

    const sentThreadIds = await this.reengageSentThreadIds(input.templateName);
    const where = this.reengageEligibleWhere(now, sentThreadIds);
    const eligibleRemainingBefore = await this.prisma.whatsAppThread.count({ where });

    // Pull a small buffer beyond `limit` so dropping blocked contacts in memory
    // still leaves a full batch.
    const candidates = await this.prisma.whatsAppThread.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: limit + 50,
      select: {
        id: true,
        channelId: true,
        leadId: true,
        clientId: true,
        lead: { select: { firstName: true, blockedAt: true } },
        client: { select: { firstName: true, blockedAt: true } },
      },
    });
    const selectable = candidates
      .filter((t) => !t.lead?.blockedAt && !t.client?.blockedAt)
      .slice(0, limit);

    const sampleNames = selectable
      .slice(0, 8)
      .map((t) => (t.lead?.firstName ?? t.client?.firstName ?? 'there').trim() || 'there');

    if (dryRun) {
      return {
        dryRun: true,
        templateName: input.templateName,
        eligibleRemainingBefore,
        selected: selectable.length,
        queued: 0,
        sampleNames,
        eligibleRemainingAfter: eligibleRemainingBefore,
      };
    }

    // Resolve the template BODY once per channel for the stored (display) text.
    const bodyByChannel = new Map<string, string | null>();
    let queued = 0;
    let i = 0;
    for (const t of selectable) {
      const firstName = (t.lead?.firstName ?? t.client?.firstName ?? '').trim() || 'there';
      const components: Array<Record<string, unknown>> = [
        { type: 'body', parameters: [{ type: 'text', text: firstName }] },
      ];
      if (!bodyByChannel.has(t.channelId)) {
        bodyByChannel.set(
          t.channelId,
          await this.renderTemplateBody(t.channelId, input.templateName, components),
        );
      }
      const tpl = bodyByChannel.get(t.channelId) ?? null;
      const renderedBody = tpl
        ? tpl.replace(/\{\{(\d+)\}\}/g, (_, n: string) => (n === '1' ? firstName : `{{${n}}}`))
        : null;

      try {
        const message = await this.prisma.whatsAppMessage.create({
          data: {
            threadId: t.id,
            channelId: t.channelId,
            leadId: t.leadId,
            clientId: t.clientId,
            direction: WhatsAppMessageDirection.OUTBOUND,
            type: WhatsAppMessageType.TEMPLATE,
            status: WhatsAppMessageStatus.QUEUED,
            templateName: input.templateName,
            templateLanguage: input.language,
            body: renderedBody,
            payload: {
              components,
              source: 'reengagement_backlog',
            } as unknown as Prisma.InputJsonValue,
            sentByEmployeeId: null, // campaign send — must NOT count as a human reply
            idempotencyKey: randomUUID(),
          },
          select: { id: true },
        });
        await this.outboundQueue.add(
          'send',
          { messageId: message.id },
          { jobId: message.id, delay: i * staggerMs },
        );
        queued += 1;
        i += 1;
      } catch (e) {
        this.logger.warn(
          `reengage: failed to queue thread ${t.id}: ${(e as Error).message}`,
        );
      }
    }

    return {
      dryRun: false,
      templateName: input.templateName,
      eligibleRemainingBefore,
      selected: selectable.length,
      queued,
      sampleNames,
      eligibleRemainingAfter: Math.max(eligibleRemainingBefore - queued, 0),
    };
  }

  /** Distinct thread IDs that have already received the given template (any
   *  status) — the idempotency guard so we never double-message a thread. */
  private async reengageSentThreadIds(templateName: string): Promise<Set<string>> {
    const rows = await this.prisma.whatsAppMessage.findMany({
      where: { templateName },
      select: { threadId: true },
      distinct: ['threadId'],
    });
    return new Set(rows.map((r) => r.threadId).filter((id): id is string => !!id));
  }

  /** Prisma `where` for re-engagement-eligible threads: uncontacted (no human
   *  reply ever), live, 24h window closed, excluding ones already sent. Blocked
   *  contacts are dropped in memory (relation-OR is awkward in a single where). */
  private reengageEligibleWhere(
    now: Date,
    sentThreadIds: Set<string>,
  ): Prisma.WhatsAppThreadWhereInput {
    return {
      lastHumanReplyAt: null,
      status: { in: [WhatsAppThreadStatus.OPEN, WhatsAppThreadStatus.PENDING] },
      windowExpiresAt: { lt: now },
      ...(sentThreadIds.size ? { id: { notIn: [...sentThreadIds] } } : {}),
    };
  }

  /**
   * Normalise template BODY parameters before the message reaches Meta.
   *
   * {{1}} is the greeting name in every one of our templates and it must ALWAYS
   * be the contact's real first name — never rep-typed text. Reps were treating
   * the open {{1}} field as a message box (typing whole sentences into it),
   * which produced "Hi <paragraph>, …" sends and Meta rejections when the text
   * carried newlines. So we OVERRIDE {{1}} with the contact's first name here
   * (falling back to a neutral "there" when no name is on file), discarding
   * whatever was submitted for it — fixing web AND mobile with no app update.
   *
   * Every other parameter ({{2}}, {{3}}, …) is a genuine caller value (a date,
   * an amount): we keep it but SANITISE it, because WhatsApp rejects a parameter
   * that contains a newline, a tab, or a long run of spaces. An empty non-first
   * parameter is a real caller mistake we can't guess, so we reject it loudly
   * rather than let Meta silently drop the send.
   *
   * NOTE: relies on the "{{1}} = recipient name" convention every current
   * template follows. If a future template needs {{1}} to be something else,
   * revisit this override.
   */
  private async normalizeTemplateParams(
    thread: { leadId: string | null; clientId: string | null },
    components: Array<Record<string, unknown>> | undefined,
  ): Promise<Array<Record<string, unknown>>> {
    const list = components ?? [];
    const isBody = (c: Record<string, unknown>) =>
      String((c as { type?: string }).type ?? '').toLowerCase() === 'body';
    const paramText = (p: Record<string, unknown>) =>
      String((p as { text?: string }).text ?? '');
    // Meta rejects a template parameter containing newlines, tabs, or long
    // space-runs, and caps parameter length — flatten all whitespace to single
    // spaces and cap so a send can never fail on parameter formatting.
    const sanitize = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 1024);

    const hasBodyParams = list.some(
      (c) => isBody(c) && ((c as { parameters?: unknown[] }).parameters ?? []).length > 0,
    );
    if (!hasBodyParams) return list;

    const name = sanitize((await this.resolveContactFirstName(thread)) ?? '') || 'there';
    return list.map((c) => {
      if (!isBody(c)) return c;
      const params = (
        (c as { parameters?: Array<Record<string, unknown>> }).parameters ?? []
      ).map((p, i) => {
        // {{1}} is ALWAYS the recipient's name — reps cannot set it.
        if (i === 0) return { ...p, type: 'text', text: name };
        const text = sanitize(paramText(p));
        if (text.length === 0) {
          throw new BadRequestException(
            `Template parameter {{${i + 1}}} is required — please fill it in before sending.`,
          );
        }
        return { ...p, type: 'text', text };
      });
      return { ...c, parameters: params };
    });
  }

  /** First name of the thread's contact (lead, else client); null if none. */
  private async resolveContactFirstName(thread: {
    leadId: string | null;
    clientId: string | null;
  }): Promise<string | null> {
    if (thread.leadId) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: thread.leadId },
        select: { firstName: true },
      });
      return lead?.firstName ?? null;
    }
    if (thread.clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: thread.clientId },
        select: { firstName: true },
      });
      return client?.firstName ?? null;
    }
    return null;
  }

  /**
   * Resolve a template's BODY text and fill its {{1}}, {{2}}… placeholders with
   * the parameters the agent supplied, so we can store the real message text on
   * the WhatsAppMessage row (used purely for our chat/inbox display — Meta gets
   * the structured template + components separately). Returns null when the
   * template or its body can't be resolved, so the UI falls back to a label.
   */
  private async renderTemplateBody(
    channelId: string,
    templateName: string,
    components: Array<Record<string, unknown>> | undefined,
  ): Promise<string | null> {
    try {
      const tpl = await this.prisma.whatsAppTemplate.findFirst({
        where: { channelId, name: templateName },
        select: { components: true },
      });
      const tplComps = (tpl?.components ?? []) as Array<{ type?: string; text?: string }>;
      const bodyText = tplComps.find((c) => (c.type ?? '').toUpperCase() === 'BODY')?.text;
      if (!bodyText) return null;
      const sent = (components ?? []) as Array<{ type?: string; parameters?: Array<{ text?: string }> }>;
      const values =
        sent.find((c) => (c.type ?? '').toLowerCase() === 'body')?.parameters?.map((p) => p?.text ?? '') ?? [];
      return bodyText.replace(/\{\{(\d+)\}\}/g, (_, n: string) => values[Number(n) - 1] ?? `{{${n}}}`);
    } catch {
      return null;
    }
  }

  /**
   * Upload a media file to Meta, then enqueue the outbound media message.
   * Supports audio, image, video, and document types.
   */
  async sendMediaMessage(caller: CallerContext, input: SendMediaInput) {
    const thread = await this.thread(caller, input.threadId);
    const senderEmployeeId = this.resolveSenderEmployeeId(caller, thread);

    // Free-form media messages are subject to the same 24-hour window rule
    // as text messages. Templates are exempt but they don't use this method.
    const now = new Date();
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(
        '24-hour customer-service window has expired. Use a template message instead.',
      );
    }

    // Voice notes (filename convention voice-note.*) skip strict MIME
    // validation — they're ALWAYS transcoded to Ogg/Opus below, and the
    // mobile app's multipart parts arrive as application/octet-stream.
    const isVoiceNote = input.filename.toLowerCase().startsWith('voice-note.');

    // Resolve Meta message type from the MIME type; clients that upload a
    // generic octet-stream (mobile multipart) fall back to the filename
    // extension so gallery attachments survive too.
    const effectiveMime = normalizeMediaMime(input.mimeType, input.filename);
    const mediaType = isVoiceNote ? 'audio' : resolveMediaType(effectiveMime);
    if (!mediaType) {
      throw new BadRequestException(`Unsupported media MIME type: ${input.mimeType}`);
    }

    // Get the WhatsApp channel settings to build the Meta client
    const channel = await this.prisma.whatsAppChannel.findUnique({
      where: { id: thread.channelId },
      select: { id: true, phoneNumberId: true, accessTokenEnc: true },
    });
    if (!channel) throw new NotFoundException('WhatsApp channel not found');

    const metaClient = this.metaFactory.forChannel(channel);

    // Upload to Meta — returns reusable media_id. Wrap any Meta-side
    // failure in a BadGateway with the actual error code/title/message
    // so the frontend can show "(#131009) Parameter value is not valid"
    // instead of the bare "Internal server error" that NestJS produces
    // for an unhandled non-HttpException.
    // Voice notes require OGG/OPUS format — transcode if the client recorded
    // in a different format (e.g. audio/mp4 on Chrome, audio/webm elsewhere).
    let uploadBuffer = input.file;
    let uploadMimeType = effectiveMime;
    let uploadFilename = input.filename;
    // Set when an oversized video can't fit the 16 MB inline-video cap even
    // after compression → delivered as a document (up to 100 MB) instead.
    let sendAsDocument = false;

    if (isVoiceNote) {
      // ALWAYS transcode voice notes to clean Ogg/Opus — never trust the
      // browser's declared MIME. Raw MediaRecorder output is wrapped in
      // containers Meta's media pipeline rejects:
      //   • Chrome / Edge record WebM/Opus       → sniffs as video/webm
      //   • Safari / iOS record MP4/AAC          → sniffs as video/mp4
      //   • Chrome even mislabels its WebM blob as "audio/ogg;codecs=opus"
      // In every case Meta ACCEPTS the upload (we declare a valid audio
      // type) but then fails DELIVERY with error 131053 "Media upload
      // error … on processing it is of type application/octet-stream".
      // Re-muxing through ffmpeg yields a single-stream Ogg/Opus file that
      // libmagic — and therefore Meta — identifies as audio/ogg. Verified
      // empirically: ffmpeg output → audio/ogg (accepted); every raw
      // browser blob → video/webm | video/mp4 (rejected).
      try {
        uploadBuffer = await this.transcodeVoiceToOgg(input.file);
        if (uploadBuffer.length < 64) {
          throw new Error(`transcode produced only ${uploadBuffer.length} bytes`);
        }
        uploadMimeType = 'audio/ogg';
        uploadFilename = 'voice-note.ogg';
        this.logger.debug(
          `Transcoded voice note from ${input.mimeType} → audio/ogg (${input.file.length} → ${uploadBuffer.length} bytes)`,
        );
        // Reject a note whose mic captured nothing (see VOICE_SILENCE_MAX_DB).
        // Thrown as BadRequest so the sender gets an immediate, actionable
        // message and re-records — instead of the client receiving silence.
        const peakDb = await this.measureVoicePeakDb(uploadBuffer);
        if (peakDb !== null && peakDb <= VOICE_SILENCE_MAX_DB) {
          this.logger.warn(
            `Silent voice note blocked: thread=${thread.id} sender=${senderEmployeeId} peak=${peakDb}dB bytes=${uploadBuffer.length}`,
          );
          throw new BadRequestException(
            'This voice note has no sound — your microphone did not pick up any audio. Please check your mic and record again.',
          );
        }
      } catch (err) {
        // A deliberate HTTP error (e.g. the silent-note BadRequest above) is
        // already the message we want the sender to see — pass it through
        // rather than masking it as a generic transcode failure.
        if (err instanceof HttpException) throw err;
        // A voice note that can't be transcoded cannot be delivered — the
        // raw blob is guaranteed to 131053 on Meta's side. Fail loudly now
        // so the agent gets an immediate, actionable error instead of a
        // message that silently rots to FAILED minutes later via webhook.
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Voice note transcode failed for thread=${thread.id} (${reason})`,
        );
        throw new BadGatewayException(
          'Voice note could not be processed for sending. Please try again.',
        );
      }
    }

    // Videos: compress/transcode to an MP4 that fits WhatsApp's 16 MB inline
    // cap. A raw phone clip is usually too big and often in a container Meta
    // rejects (.mov / .mkv / .webm), so without this "send video" silently
    // failed. If it still won't fit after compression, send it as a document
    // (WhatsApp allows any file up to 100 MB); past that, ask the rep to trim.
    // Already a WhatsApp-ready mp4 under the cap → send as-is, no re-encode
    // (re-encoding a small clean clip only loses quality and wastes time).
    const videoAlreadyOk =
      effectiveMime === 'video/mp4' && uploadBuffer.length <= WA_VIDEO_MAX_BYTES;
    if (mediaType === 'video' && !isVoiceNote && !videoAlreadyOk) {
      const originalBytes = uploadBuffer.length;
      try {
        uploadBuffer = await this.transcodeVideoToMp4(input.file);
        uploadMimeType = 'video/mp4';
        uploadFilename = `${input.filename.replace(/\.[^./\\]+$/, '') || 'video'}.mp4`;
        this.logger.debug(
          `Compressed video for thread=${thread.id}: ${originalBytes} → ${uploadBuffer.length} bytes`,
        );
      } catch (err) {
        // Compression failed — keep the original bytes and let the size checks
        // below (and Meta) decide. Better to try the raw file than hard-fail.
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Video compression failed for thread=${thread.id} (${reason}); sending original`,
        );
      }
      if (uploadBuffer.length > WA_VIDEO_MAX_BYTES) {
        if (uploadBuffer.length <= WA_DOCUMENT_MAX_BYTES) {
          // Too big to play inline, small enough to send as a file.
          sendAsDocument = true;
        } else {
          throw new BadRequestException(
            'This video is too large to send on WhatsApp even after compression ' +
              '(limit ~100 MB). Please trim or shorten it and try again.',
          );
        }
      }
    }

    // How the outbound worker will reference the media:
    //   • `meta:<id>`        — we uploaded the bytes to Meta (default path).
    //   • a durable storage key — the worker signs a fresh link and Meta
    //     FETCHES it. Used for oversized-video documents (see below).
    let mediaRef: string;
    // Voice-note media id: when set, the worker sends by media_id and skips
    // link delivery entirely (see below for why this is the permanent fix).
    let voiceMetaMediaId: string | null = null;
    // Voice notes AND oversized-video documents keep a durable copy in our
    // storage — the inbox streams it forever (rep/admin playback) and the
    // re-send action reuses it. Documents are ALSO delivered by link (Meta
    // fetches at send time): that deliberately skips Meta's /media upload,
    // which would apply the 16 MB VIDEO cap instead of the 100 MB document one.
    if (isVoiceNote || sendAsDocument) {
      const up = await this.storage.upload(
        uploadBuffer,
        uploadMimeType,
        'whatsapp/outbound',
        uploadFilename,
      );
      mediaRef = up.key;
      this.logger.debug(
        `Media hosted in storage: thread=${thread.id} key=${up.key} bytes=${uploadBuffer.length} asDocument=${sendAsDocument}`,
      );
      // PERMANENT FIX for voice notes (2026-08-12): also upload the bytes to
      // Meta and send by media_id. Link delivery routes through Meta's
      // fwdproxy, which rate-limits by our STORAGE PROVIDER'S ASN — not per
      // account — so aggregate traffic to that network intermittently returns
      // HTTP 429 ("Request ratelimit by fwdproxy"). Meta then has no audio to
      // serve and the recipient sees "audio no longer available", even though
      // our stored copy is perfect (verified: rep can play it, client can't).
      // Uploading bytes bypasses fwdproxy entirely — Meta's own documented
      // recommendation ("for better performance, use id … instead"). The
      // earlier 131053/octet-stream upload bug that forced link delivery has
      // since been fixed in uploadMedia (bare mime + explicit Content-Length +
      // no chunked encoding), and a live upload of a real voice note now
      // returns a valid audio/ogg media_id.
      //   Only for voice notes — documents keep the link path for the 100 MB
      //   limit above. Best-effort: on any upload error we keep the storage key
      //   and the worker falls back to link delivery, so a hiccup never blocks
      //   a voice note from sending.
      if (isVoiceNote) {
        try {
          voiceMetaMediaId = await metaClient.uploadMedia(
            uploadBuffer,
            uploadMimeType,
            uploadFilename,
          );
          this.logger.debug(
            `Voice note uploaded to Meta: thread=${thread.id} mediaId=${voiceMetaMediaId} (storage key=${up.key} kept for playback + link fallback)`,
          );
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'unknown upload error';
          this.logger.warn(
            `Voice note Meta upload failed — falling back to link delivery for thread=${thread.id}: ${reason}`,
          );
        }
      }
    } else {
      try {
        const metaMediaId = await metaClient.uploadMedia(
          uploadBuffer,
          uploadMimeType,
          uploadFilename,
        );
        mediaRef = `meta:${metaMediaId}`;
      } catch (err) {
        if (err instanceof MetaApiError) {
          const detail = err.detail;
          const message = detail.title
            ? `Meta rejected media upload: ${detail.title} — ${detail.message}`
            : `Meta rejected media upload: ${detail.message}`;
          this.logger.error(
            `uploadMedia failed for thread=${thread.id} mime=${input.mimeType} bytes=${input.file.length}: code=${detail.code} message=${detail.message}`,
          );
          throw new BadGatewayException({
            message,
            metaCode: detail.code,
            metaTitle: detail.title,
            metaMessage: detail.message,
            fbtraceId: detail.fbtrace_id,
          });
        }
        const reason = err instanceof Error ? err.message : 'Unknown upload error';
        this.logger.error(
          `uploadMedia threw non-Meta error for thread=${thread.id} mime=${input.mimeType}: ${reason}`,
        );
        throw new BadGatewayException(`Media upload failed: ${reason}`);
      }
    }

    // Map MIME type → WhatsApp message type enum. An oversized video that fell
    // back to file delivery is a DOCUMENT regardless of its video/* MIME.
    const messageType = sendAsDocument
      ? WhatsAppMessageType.DOCUMENT
      : mediaType === 'image'
        ? WhatsAppMessageType.IMAGE
        : mediaType === 'video'
          ? WhatsAppMessageType.VIDEO
          : mediaType === 'document'
            ? WhatsAppMessageType.DOCUMENT
            : WhatsAppMessageType.AUDIO;

    let message;
    try {
      message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: messageType,
        status: WhatsAppMessageStatus.QUEUED,
        mediaUrl: mediaRef,
        // Store the normalised mime type so streamMedia serves the correct
        // Content-Type and the processor knows the actual uploaded format.
        mediaMimeType: uploadMimeType,
        // Actual delivered byte size (post-transcode for voice). Was never
        // recorded before, which hid a fleet of silent 1-3 KB voice notes;
        // storing it makes size-based monitoring possible without re-reading
        // the object from storage.
        mediaSizeBytes: uploadBuffer.length,
        body: input.caption ?? null,
        // Mark as a voice note so the outbound worker sends voice:true (Meta
        // renders waveform + auto-play). By this point a voice note is
        // guaranteed to be Ogg/Opus — the transcode above either succeeded
        // or threw, so we never flag a non-Ogg file as a voice note.
        // Voice notes carry isVoiceNote (worker sends voice:true); a video that
        // fell back to a document carries its filename so WhatsApp shows it as
        // a named file the recipient can download and play.
        ...(isVoiceNote
          ? {
              payload: {
                isVoiceNote: true,
                // Present when the Meta upload succeeded → worker sends by
                // media_id (bypasses fwdproxy). Absent → worker link-falls-back.
                ...(voiceMetaMediaId ? { metaMediaId: voiceMetaMediaId } : {}),
              } as unknown as Prisma.InputJsonValue,
            }
          : sendAsDocument
            ? { payload: { filename: uploadFilename } as unknown as Prisma.InputJsonValue }
            : {}),
        sentByEmployeeId: senderEmployeeId,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      },
      select: this.publicSelect(),
      });
    } catch (err) {
      // Client retry of a media send whose FIRST attempt already landed (the
      // mobile optimistic composer re-posts with the SAME idempotencyKey after
      // a timeout). Same collapse as sendText: return the existing row — the
      // customer must never receive the media twice. The duplicate transcode/
      // upload above is wasted work, but correctness comes first.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        input.idempotencyKey
      ) {
        const existing = await this.prisma.whatsAppMessage.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: this.publicSelect(),
        });
        if (existing && existing.threadId === thread.id) {
          await this.outboundQueue.add(
            'send',
            { messageId: existing.id },
            { jobId: existing.id },
          );
          return existing;
        }
      }
      throw err;
    }

    await this.outboundQueue.add(
      'send',
      { messageId: message.id },
      { jobId: message.id },
    );
    // Stamp the thread so the AI bot stays silent for 4h after any human
    // reply. This rolls forward on every subsequent human send. Bot-sent
    // messages have senderEmployeeId=null and don't touch this stamp.
    if (senderEmployeeId) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiDisabledAt: new Date() },
      });
    }
    return message;
  }

  /**
   * Re-send a media message we already hold. WhatsApp deletes its server copy
   * of media shortly after delivery, so once the recipient's device drops the
   * local file they see "This media is no longer available — ask the sender to
   * re-send it." We still have the original (mediaUrl = durable storage key),
   * so this clones it into a fresh outbound message and dispatches it. The
   * outbound worker signs a new link from the same key at send time — no
   * re-upload, no re-record. Copies payload verbatim so a voice note stays a
   * voice note (isVoiceNote) and a document keeps its filename.
   */
  async resendMedia(caller: CallerContext, input: { threadId: string; messageId: string }) {
    const thread = await this.thread(caller, input.threadId);
    const senderEmployeeId = this.resolveSenderEmployeeId(caller, thread);

    // Free-form media is subject to the same 24-hour window as any non-template
    // send — fail with a clear message rather than a raw Meta rejection.
    const now = new Date();
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(
        '24-hour customer-service window has expired. Use a template message instead.',
      );
    }

    const original = await this.prisma.whatsAppMessage.findUnique({
      where: { id: input.messageId },
      select: {
        threadId: true,
        type: true,
        mediaUrl: true,
        mediaMimeType: true,
        body: true,
        payload: true,
      },
    });
    if (!original || original.threadId !== thread.id) {
      throw new NotFoundException('Message not found on this thread');
    }
    const MEDIA_TYPES: WhatsAppMessageType[] = [
      WhatsAppMessageType.IMAGE,
      WhatsAppMessageType.VIDEO,
      WhatsAppMessageType.AUDIO,
      WhatsAppMessageType.DOCUMENT,
      WhatsAppMessageType.STICKER,
    ];
    if (!MEDIA_TYPES.includes(original.type)) {
      throw new BadRequestException('Only media messages can be re-sent.');
    }
    if (!original.mediaUrl) {
      throw new BadRequestException(
        'This media was never stored, so it cannot be re-sent — please upload it again.',
      );
    }

    // Resolve a SENDABLE reference (durable key as-is; rehost a "meta:<id>" ref
    // off Meta's expiring store before it's purged). Shared with forwardMessage.
    let { mediaRef, mediaMime } = await this.resolveSendableMediaRef({
      sourceChannelId: thread.channelId,
      mediaUrl: original.mediaUrl,
      mediaMimeType: original.mediaMimeType,
      payload: original.payload,
      repointMessageId: input.messageId,
    });

    // VOICE RE-NORMALIZATION (2026-09-01): a FAILED voice note's stored bytes
    // can carry the exact shape Meta rejects (the 131053 class: WebM-inherited
    // language tag + start offset) — replaying the SAME bytes would re-fail no
    // matter the transport. Re-run the hardened transcode on the stored audio,
    // store the clean copy, and upload it to Meta so the retry delivers by a
    // FRESH media_id (the reliable path). Best-effort: any hiccup falls back
    // to link delivery of the existing bytes (the pre-existing behavior).
    let freshVoiceMediaId: string | null = null;
    const isVoiceResend =
      original.type === WhatsAppMessageType.AUDIO &&
      (original.payload as { isVoiceNote?: boolean } | null)?.isVoiceNote === true;
    if (isVoiceResend && !mediaRef.startsWith('meta:')) {
      try {
        const { bytes } = await this.storage.download(mediaRef);
        const clean = await this.transcodeVoiceToOgg(bytes);
        const up = await this.storage.upload(clean, 'audio/ogg', 'whatsapp/outbound', 'voice-note.ogg');
        mediaRef = up.key;
        mediaMime = 'audio/ogg';
        const channel = await this.prisma.whatsAppChannel.findUnique({
          where: { id: thread.channelId },
          select: { id: true, phoneNumberId: true, accessTokenEnc: true },
        });
        if (channel) {
          freshVoiceMediaId = await this.metaFactory
            .forChannel(channel)
            .uploadMedia(clean, 'audio/ogg', 'voice-note.ogg');
        }
        this.logger.log(
          `resendMedia: voice note re-normalized (${bytes.length} → ${clean.length} bytes, mediaId=${freshVoiceMediaId ?? 'link-fallback'})`,
        );
      } catch (e) {
        this.logger.warn(
          `resendMedia: voice re-normalization failed — falling back to stored bytes: ${(e as Error).message}`,
        );
      }
    }

    // Strip a stale voice-note metaMediaId before cloning: the id is bound to
    // its original ~30-day/channel window, so a re-send must NOT reuse it (the
    // worker would try an expired media_id and fail). When re-normalization
    // above produced a FRESH id, carry that instead. isVoiceNote/filename
    // are preserved so the message still renders correctly.
    const resendPayload = ((): Prisma.InputJsonValue | undefined => {
      const base = (original.payload as Record<string, unknown> | null) ?? {};
      const { metaMediaId: _drop, ...rest } = base;
      const merged = {
        ...rest,
        ...(freshVoiceMediaId ? { metaMediaId: freshVoiceMediaId } : {}),
      };
      return Object.keys(merged).length > 0 ? (merged as Prisma.InputJsonValue) : undefined;
    })();

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: original.type,
        status: WhatsAppMessageStatus.QUEUED,
        // Durable key — the worker signs a fresh link at dispatch.
        mediaUrl: mediaRef,
        mediaMimeType: mediaMime,
        body: original.body,
        ...(resendPayload ? { payload: resendPayload } : {}),
        sentByEmployeeId: senderEmployeeId,
        idempotencyKey: randomUUID(),
      },
      select: this.publicSelect(),
    });

    await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });
    // Mirror sendMediaMessage: a human send silences the AI bot for 4h.
    if (senderEmployeeId) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiDisabledAt: new Date() },
      });
    }
    return message;
  }

  /**
   * Resolve a media message's stored ref into one that can be dispatched
   * (again), possibly to a DIFFERENT thread than the one it came from. Durable
   * storage keys are returned as-is (the worker signs a fresh link at
   * dispatch). A "meta:<id>" ref is Meta's uploaded-media id, which (a) expires
   * on the same ~30-day clock as the recipient's copy and (b) is only valid
   * within its OWN channel/WABA — so it's rehosted to our storage NOW: download
   * the bytes from the SOURCE channel while they still exist, upload to durable
   * storage, and (best-effort) repoint the source row so it's preserved and any
   * future re-send/forward is instant. Throws if Meta already purged the bytes.
   */
  private async resolveSendableMediaRef(args: {
    sourceChannelId: string;
    mediaUrl: string;
    mediaMimeType: string | null;
    payload: unknown;
    repointMessageId: string;
  }): Promise<{ mediaRef: string; mediaMime: string | null }> {
    let mediaRef = args.mediaUrl;
    let mediaMime = args.mediaMimeType;
    if (mediaRef.startsWith('meta:')) {
      const channel = await this.prisma.whatsAppChannel.findUnique({
        where: { id: args.sourceChannelId },
        select: { id: true, phoneNumberId: true, accessTokenEnc: true },
      });
      if (!channel) throw new NotFoundException('WhatsApp channel not found');
      const metaClient = this.metaFactory.forChannel(channel);
      const metaMediaId = mediaRef.slice(5);
      let bytes: Buffer;
      let mime: string;
      try {
        const info = await metaClient.getMediaUrl(metaMediaId);
        mime = info.mime_type;
        bytes = await metaClient.downloadMedia(info.url);
      } catch {
        throw new BadRequestException(
          'The original file is no longer available — WhatsApp deleted its copy. Please upload it again.',
        );
      }
      const ext = (mime.split(';')[0].split('/')[1] ?? 'bin').trim();
      const filename =
        (args.payload as { filename?: string } | null)?.filename ?? `media.${ext}`;
      const up = await this.storage.upload(bytes, mime, 'whatsapp/outbound', filename);
      mediaRef = up.key;
      mediaMime = mime;
      // Preserve permanently: repoint the SOURCE row at the durable key too, so
      // the inbox can re-stream it forever. Best-effort — never block the send.
      await this.prisma.whatsAppMessage
        .update({
          where: { id: args.repointMessageId },
          data: { mediaUrl: up.key, mediaMimeType: mime },
        })
        .catch(() => undefined);
    }
    return { mediaRef, mediaMime };
  }

  /**
   * Forward an existing message (text OR media) to ANOTHER thread — WhatsApp-
   * style. The content is re-sent to the target contact on WhatsApp, so it
   * obeys the target thread's 24-hour window (closed → clear "send a template"
   * error). Media is rehosted the same way {@link resendMedia} does, so a
   * "meta:<id>" ref works even across channels. Tags payload.forwarded so the
   * inbox can show a "Forwarded" marker. Access is enforced on BOTH threads:
   * the caller must be able to send on the target AND view the source.
   */
  async forwardMessage(
    caller: CallerContext,
    input: { messageId: string; targetThreadId: string },
  ) {
    const target = await this.thread(caller, input.targetThreadId);
    const senderEmployeeId = this.resolveSenderEmployeeId(caller, target);

    const now = new Date();
    if (!target.windowExpiresAt || target.windowExpiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(
        '24-hour customer-service window has expired. Use a template message instead.',
      );
    }

    const original = await this.prisma.whatsAppMessage.findUnique({
      where: { id: input.messageId },
      select: {
        threadId: true,
        channelId: true,
        type: true,
        mediaUrl: true,
        mediaMimeType: true,
        body: true,
        payload: true,
      },
    });
    if (!original) throw new NotFoundException('Message not found');
    // Enforce that the caller may see the SOURCE thread too — prevents
    // forwarding content out of a conversation they don't have access to.
    await this.thread(caller, original.threadId);

    const MEDIA_TYPES: WhatsAppMessageType[] = [
      WhatsAppMessageType.IMAGE,
      WhatsAppMessageType.VIDEO,
      WhatsAppMessageType.AUDIO,
      WhatsAppMessageType.DOCUMENT,
      WhatsAppMessageType.STICKER,
    ];
    const isMedia = MEDIA_TYPES.includes(original.type);
    const isText = original.type === WhatsAppMessageType.TEXT;
    if (!isMedia && !isText) {
      throw new BadRequestException('Only text and media messages can be forwarded.');
    }

    // Build a CLEAN payload for the forwarded copy — never spread the source
    // payload wholesale: it can carry system flags (autoAck, window_save,
    // callPermissionRequest, processing source…) that would corrupt SLA / lead
    // state on the TARGET thread. Whitelist only what the outbound worker needs
    // to render the media, reading BOTH shapes:
    //   • outbound-origin: payload.filename / payload.isVoiceNote (top-level)
    //   • inbound-origin:  payload.document.filename / payload.audio.voice
    const src = (original.payload as Record<string, unknown> | null) ?? {};
    const filename =
      (src.filename as string | undefined) ??
      (src.document as { filename?: string } | undefined)?.filename;
    const isVoiceNote =
      src.isVoiceNote === true ||
      (src.audio as { voice?: boolean } | undefined)?.voice === true;
    const forwardPayload = {
      forwarded: true,
      ...(filename ? { filename } : {}),
      ...(isVoiceNote ? { isVoiceNote: true } : {}),
    } as unknown as Prisma.InputJsonValue;

    let mediaRef: string | null = null;
    let mediaMime: string | null = null;
    if (isMedia) {
      if (!original.mediaUrl) {
        throw new BadRequestException(
          'This media was never stored, so it cannot be forwarded — please re-upload it.',
        );
      }
      const resolved = await this.resolveSendableMediaRef({
        sourceChannelId: original.channelId,
        mediaUrl: original.mediaUrl,
        mediaMimeType: original.mediaMimeType,
        payload: original.payload,
        repointMessageId: input.messageId,
      });
      mediaRef = resolved.mediaRef;
      mediaMime = resolved.mediaMime;
    } else if (!original.body?.trim()) {
      throw new BadRequestException('There is no text to forward.');
    }

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: target.id,
        channelId: target.channelId,
        leadId: target.leadId,
        clientId: target.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: original.type,
        status: WhatsAppMessageStatus.QUEUED,
        body: original.body,
        ...(isMedia ? { mediaUrl: mediaRef, mediaMimeType: mediaMime } : {}),
        payload: forwardPayload,
        sentByEmployeeId: senderEmployeeId,
        idempotencyKey: randomUUID(),
      },
      select: this.publicSelect(),
    });

    await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });
    // A human forward silences the AI bot for 4h on the TARGET thread.
    if (senderEmployeeId) {
      await this.prisma.whatsAppThread.update({
        where: { id: target.id },
        data: { aiDisabledAt: new Date() },
      });
    }
    return message;
  }

  /**
   * Transcode any audio buffer to OGG/OPUS mono 16 kHz using ffmpeg.
   * Meta requires this exact format for voice notes (voice: true messages).
   * Falls back gracefully — callers should catch and upload the original.
   */
  /**
   * Peak loudness of an audio buffer in dBFS, via ffmpeg's `volumedetect`.
   * Used to catch a voice note whose mic captured only silence (see
   * VOICE_SILENCE_MAX_DB). Returns null if the measurement can't be taken —
   * the caller then fails OPEN (sends the note) rather than blocking a
   * legitimate message on a diagnostic hiccup.
   */
  private async measureVoicePeakDb(ogg: Buffer): Promise<number | null> {
    const tmpIn = join(tmpdir(), `vn-vol-${randomUUID()}.ogg`);
    try {
      await writeFile(tmpIn, ogg);
      // volumedetect prints to stderr; -f null discards the decoded output.
      const { stderr } = await execFileAsync(FFMPEG_BIN, [
        '-hide_banner',
        '-i', tmpIn,
        '-af', 'volumedetect',
        '-f', 'null',
        '-',
      ]);
      // e.g. "[Parsed_volumedetect_0 @ ..] max_volume: -12.4 dB"
      const m = /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(String(stderr));
      return m ? parseFloat(m[1]) : null;
    } catch (e) {
      // execFile rejects with stderr on the object; parse it if present so a
      // real (non-error) volumedetect run still yields a reading.
      const stderr = (e as { stderr?: unknown }).stderr;
      const m = stderr ? /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(String(stderr)) : null;
      if (m) return parseFloat(m[1]);
      this.logger.warn(`measureVoicePeakDb failed — sending note unchecked: ${(e as Error).message}`);
      return null;
    } finally {
      await unlink(tmpIn).catch(() => {});
    }
  }

  private async transcodeVoiceToOgg(input: Buffer): Promise<Buffer> {
    const tmpIn = join(tmpdir(), `vn-in-${randomUUID()}`);
    const tmpOut = join(tmpdir(), `vn-out-${randomUUID()}.ogg`);
    try {
      await writeFile(tmpIn, input);
      // No input format hint — ffmpeg sniffs the container from the bytes,
      // so this handles WebM, MP4, Ogg, etc. transparently. Output is
      // mono Opus-in-Ogg, the format WhatsApp voice notes require.
      //
      // Recipe notes (hard-won): the mobile app records AAC/m4a. Re-encoding
      // AAC → Opus at a FORCED 16 kHz in VoIP mode produced a stream Meta's
      // media processor refused to decode — it stored the upload as
      // application/octet-stream and failed delivery with 131053, while
      // web-recorded Opus (a near-passthrough re-encode) delivered fine.
      // Encoding at Opus's native 48 kHz in general "audio" mode, taking
      // only the first audio stream (-map 0:a:0, -vn drops any cover art),
      // produces a clean Ogg/Opus that Meta accepts from every source.
      try {
        await execFileAsync(FFMPEG_BIN, [
          '-hide_banner',
          '-y',           // overwrite output
          '-i', tmpIn,
          '-vn',          // never carry a video/cover-art stream into Ogg
          '-map', '0:a:0', // first audio stream only
          // ── 131053 hardening (2026-09-01, PROVEN root cause) ───────────
          // Meta's send-time processor (since ≈2026-08-27) rejects Opus
          // streams with TIMELINE DISCONTINUITIES: the web recorder
          // (MediaRecorder) drops audio chunks when the browser stutters,
          // leaving ~50ms mid-stream timestamp gaps that a plain re-encode
          // faithfully PRESERVES — which is why replaying/re-encoding the
          // same bytes kept failing. Proven end-to-end on a real rejected
          // recording (2 gaps at 19.2s/33.4s → failed 6×; gap-filled version
          // of the SAME audio → DELIVERED). aresample=async=1 stretches/
          // squeezes-in silence so the output is gapless by construction;
          // first_pts=0 also zeroes the start offset. Metadata strips kill
          // the WebM-inherited stream language tag ('eng') for good measure.
          // All flags are no-ops on clean continuous (mobile Ogg) input.
          '-map_metadata', '-1',      // drop global metadata
          '-map_metadata:s', '-1',    // drop per-stream metadata
          '-metadata:s:a:0', 'language=', // clear track language tag
          '-af', 'aresample=async=1:first_pts=0', // fill gaps → gapless timeline from t=0
          // ───────────────────────────────────────────────────────────────
          '-c:a', 'libopus',
          '-ac', '1',     // mono (Meta voice-note requirement)
          '-ar', '48000', // Opus-native rate — forced 16k broke Meta decoding
          '-b:a', '32k',
          '-application', 'audio',
          '-f', 'ogg',    // explicit container
          tmpOut,
        ]);
      } catch (e) {
        // execFile rejects with the captured stderr — surface its tail so
        // a broken/missing binary or undecodable input is diagnosable.
        const stderr = (e as { stderr?: unknown }).stderr;
        const tail = stderr
          ? ` — ${String(stderr).trim().split('\n').slice(-2).join(' ')}`
          : ` — ${(e as Error).message}`;
        throw new Error(`ffmpeg transcode failed${tail}`);
      }
      const out = await readFile(tmpOut);
      // Sanity-check the container: a real Ogg stream starts with the "OggS"
      // capture pattern. If it doesn't, Meta will store the upload as
      // application/octet-stream and fail delivery with 131053 — so reject
      // here with a clear reason instead of shipping bad bytes.
      const magic = out.subarray(0, 4).toString('latin1');
      if (magic !== 'OggS') {
        throw new Error(`ffmpeg output is not Ogg (magic="${magic}", ${out.length} bytes)`);
      }
      // TRIPWIRE (fail-open): assert the output has the Meta-accepted shape —
      // start_time ≈ 0 and NO stream language tag. If a future ffmpeg/browser
      // change re-introduces the 131053 byte-shape, this makes it a loud log
      // marker the day it happens instead of a rep's dead red bubble a week
      // later. Never blocks the send.
      try {
        const { stdout } = await execFileAsync(FFPROBE_BIN, [
          '-v', 'error',
          '-show_entries', 'stream=start_time:stream_tags=language:format=start_time',
          '-of', 'default=noprint_wrappers=1',
          tmpOut,
        ]);
        const probe = String(stdout);
        const langHit = /TAG:language=(?!\s*$)(\S+)/.exec(probe);
        const starts = [...probe.matchAll(/start_time=([-\d.]+)/g)].map((m) => Math.abs(parseFloat(m[1])));
        const badStart = starts.some((s) => Number.isFinite(s) && s > 0.001);
        if (langHit || badStart) {
          this.logger.error(
            `[VOICE-SHAPE-TRIPWIRE] transcode output carries a 131053-risk shape ` +
              `(language=${langHit?.[1] ?? 'none'}, starts=${starts.join(',')}) — ` +
              `Meta may reject this voice note; the normalization flags need updating.`,
          );
        }
      } catch {
        // Probe hiccup — never block a legitimate send on the diagnostic.
      }
      return out;
    } finally {
      await unlink(tmpIn).catch(() => {});
      await unlink(tmpOut).catch(() => {});
    }
  }

  /** Probe a media file's duration in seconds via ffprobe; null if unknown. */
  private async probeDurationSec(path: string): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync(FFPROBE_BIN, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        path,
      ]);
      const d = parseFloat(String(stdout).trim());
      return Number.isFinite(d) && d > 0 ? d : null;
    } catch {
      return null;
    }
  }

  /**
   * Compress/transcode any video buffer to a WhatsApp-friendly H.264/AAC MP4,
   * aiming to land under the 16 MB inline-video cap. Phone clips are routinely
   * 30–150 MB and in containers Meta rejects (.mov, .mkv, .webm), so a raw
   * "send video" almost always failed before this existed.
   *
   * Strategy: read the duration, compute a video bitrate that hits ~14 MB, and
   * encode at 720p. If that still overshoots 16 MB (a long clip), re-encode at
   * 480p with a lower bitrate. Returns the SMALLEST result — the caller checks
   * the final size and, if it's still over 16 MB, sends it as a document
   * instead of an inline video. Best-effort: on ffmpeg failure the caller
   * catches and falls back to the original bytes.
   */
  private async transcodeVideoToMp4(input: Buffer): Promise<Buffer> {
    const tmpIn = join(tmpdir(), `vid-in-${randomUUID()}`);

    const encode = async (
      boxW: number,
      boxH: number,
      videoKbps: number,
      audioKbps: number,
    ): Promise<Buffer> => {
      const tmpOut = join(tmpdir(), `vid-out-${randomUUID()}.mp4`);
      try {
        await execFileAsync(
          FFMPEG_BIN,
          [
            '-hide_banner',
            '-y',
            '-i', tmpIn,
            // Fit within the box preserving aspect (works for portrait too),
            // then force even dimensions (yuv420p/H.264 requires them).
            '-vf', `scale=w=${boxW}:h=${boxH}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-profile:v', 'main',
            '-pix_fmt', 'yuv420p',
            '-b:v', `${videoKbps}k`,
            '-maxrate', `${Math.round(videoKbps * 1.5)}k`,
            '-bufsize', `${videoKbps * 2}k`,
            '-c:a', 'aac',
            '-b:a', `${audioKbps}k`,
            '-ac', '2',
            '-movflags', '+faststart', // moov atom up front → streams/plays sooner
            '-map', '0:v:0',
            '-map', '0:a:0?', // include first audio track if present (optional)
            tmpOut,
          ],
          { maxBuffer: 16 * 1024 * 1024 },
        );
        return await readFile(tmpOut);
      } catch (e) {
        const stderr = (e as { stderr?: unknown }).stderr;
        const tail = stderr
          ? ` — ${String(stderr).trim().split('\n').slice(-2).join(' ')}`
          : ` — ${(e as Error).message}`;
        throw new Error(`ffmpeg video transcode failed${tail}`);
      } finally {
        await unlink(tmpOut).catch(() => {});
      }
    };

    try {
      await writeFile(tmpIn, input);
      const durationSec = await this.probeDurationSec(tmpIn);

      // Video bitrate (kbps) that fills VIDEO_TARGET_BYTES over the clip's
      // length, minus the audio track. Floor keeps quality watchable; cap
      // avoids wasting bits on a short clip.
      const bitrateFor = (audioKbps: number, floor: number, cap: number): number => {
        if (!durationSec) return Math.min(cap, 1200); // no duration → modest default
        const totalKbps = (VIDEO_TARGET_BYTES * 8) / 1000 / durationSec;
        return Math.max(floor, Math.min(cap, Math.floor(totalKbps) - audioKbps));
      };

      // Pass 1 — 720p.
      const out720 = await encode(1280, 720, bitrateFor(96, 300, 2500), 96);
      if (out720.length <= WA_VIDEO_MAX_BYTES) return out720;

      // Pass 2 — 480p, lower audio, for long clips that overshot at 720p.
      const out480 = await encode(854, 480, bitrateFor(64, 250, 1200), 64);
      return out480.length < out720.length ? out480 : out720;
    } finally {
      await unlink(tmpIn).catch(() => {});
    }
  }

  /**
   * Decide which employee gets stamped on the outgoing message's
   * `sentByEmployeeId`. Two cases:
   *
   *   1. Caller IS an employee (sales agent, manager-in-pool, admin who's also
   *      in the WhatsApp pool) — stamp them. The thread reads naturally as
   *      that person speaking.
   *
   *   2. Caller is NOT an employee (super-admin / founder account with no
   *      Employee row) intervening in a sales agent's thread — stamp the
   *      thread's assigned agent so the conversation reads as one consistent
   *      voice from the customer's side. The customer never sees the
   *      attribution anyway (Meta only shows the business number) — this is
   *      purely about how the internal CRM thread renders. Falls back to null
   *      if neither caller nor thread has an employee (e.g. unassigned thread
   *      hit by a super-admin), which the schema allows.
   *
   * Audit of who *actually* clicked send is preserved via the JWT auth log
   * and ActivityTimeline, not via sentByEmployeeId.
   */
  private resolveSenderEmployeeId(
    caller: CallerContext,
    thread: { lead: { assignedEmployeeId: string | null } | null },
  ): string | null {
    if (caller.employeeId) return caller.employeeId;
    return thread.lead?.assignedEmployeeId ?? null;
  }

  /** Look up the thread, enforcing the agent-scope rule. */
  private async thread(caller: CallerContext, threadId: string) {
    const t = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        channelId: true,
        platform: true,
        leadId: true,
        clientId: true,
        windowExpiresAt: true,
        waContactId: true,
        lead: { select: { id: true, assignedEmployeeId: true } },
      },
    });
    if (!t) throw new NotFoundException('Thread not found');
    // Admin (canViewAll) and Finance (canViewFinanceScope) may operate on any
    // thread they open: Finance's per-lead WhatsApp works from any lead/client
    // profile they open (view history + send message/template/media). The
    // closed-loop agreement gate only scopes the finance INBOX LIST elsewhere,
    // not per-thread access. Processing and plain agents stay scoped below.
    if (!caller.canViewAll && !caller.canViewFinanceScope) {
      if (caller.canViewProcessingScope) {
        // Processing may send only on a thread for one of their own clients
        // (lead/client has a ProcessingCase).
        const inProcessing = await this.prisma.processingCase.findFirst({
          where: {
            OR: [
              ...(t.leadId ? [{ leadId: t.leadId }] : []),
              ...(t.clientId ? [{ clientId: t.clientId }] : []),
            ],
          },
          select: { id: true },
        });
        if (!inProcessing) throw new ForbiddenException('Thread not in your processing scope');
      } else if (!caller.employeeId || t.lead?.assignedEmployeeId !== caller.employeeId) {
        throw new ForbiddenException('Thread not assigned to you');
      }
    }
    return t;
  }

  private publicSelect() {
    return {
      id: true,
      threadId: true,
      leadId: true,
      clientId: true,
      direction: true,
      type: true,
      status: true,
      body: true,
      payload: true,
      mediaUrl: true,
      mediaMimeType: true,
      templateName: true,
      templateLanguage: true,
      sentByEmployeeId: true,
      waMessageId: true,
      repliedToWaMessageId: true,
      // Echoed so the mobile optimistic sender can match a poll-delivered row
      // to its own temp bubble (client sets the key to the temp bubble's id).
      idempotencyKey: true,
      errorCode: true,
      errorTitle: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      failedAt: true,
      adReferral: true,
      createdAt: true,
    } as const;
  }
}

/** Map inbound MIME type to one of Meta's media categories. */
function resolveMediaType(
  mimeType: string,
): 'audio' | 'image' | 'video' | 'document' | null {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base.startsWith('audio/')) return 'audio';
  if (base.startsWith('image/') && base !== 'image/webp') return 'image';
  if (base === 'image/webp') return 'image'; // sticker-like, treat as image
  if (base.startsWith('video/')) return 'video';
  const documentMimes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
  ];
  if (documentMimes.includes(base)) return 'document';
  return null;
}

/**
 * Best-effort MIME for clients that upload without declaring one (the
 * mobile app's multipart parts arrive as application/octet-stream): fall
 * back to the filename extension. Unknown extensions keep the original
 * MIME so the strict check above still rejects them.
 */
function normalizeMediaMime(mimeType: string, filename: string): string {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (base && base !== 'application/octet-stream') return base;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const byExt: Record<string, string> = {
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    amr: 'audio/amr',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
    '3gp': 'video/3gp',
    // Non-mp4 videos map to a video/* MIME so resolveMediaType classifies them
    // as video and the send path transcodes them to a WhatsApp-ready mp4
    // (Meta itself only accepts mp4/3gp). Covers octet-stream uploads whose
    // only clue is the extension (.mov is iPhone's default).
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
  };
  return byExt[ext] ?? base;
}
