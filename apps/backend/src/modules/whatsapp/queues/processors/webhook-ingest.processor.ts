import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  LeadStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { ActivityTimelineService } from '../../../activity-timeline/activity-timeline.service';
import { WhatsAppAssignmentService } from '../../routing/assignment.service';
import { WhatsAppRealtimePublisher } from '../../realtime/publisher.service';
import {
  WHATSAPP_QUEUE,
  WHATSAPP_WS_EVENTS,
  type WebhookIngestJob,
} from '../queue-contracts';

// ---- Meta webhook payload types (subset; full spec at developers.facebook.com)
interface MetaContact {
  wa_id: string;
  profile?: { name?: string };
}
interface MetaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  video?: { id: string; mime_type: string; sha256: string; caption?: string };
  audio?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  sticker?: { id: string; mime_type: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: unknown;
  interactive?: unknown;
  context?: { id: string; from?: string };
  reaction?: { message_id: string; emoji: string };
}
interface MetaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  conversation?: { id: string; expiration_timestamp?: string; origin?: { type: string } };
  pricing?: { category?: string };
  errors?: Array<{ code: number; title?: string; message?: string; error_data?: unknown }>;
}
interface MetaValue {
  messaging_product: 'whatsapp';
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: MetaContact[];
  messages?: MetaMessage[];
  statuses?: MetaStatus[];
}
interface MetaChange {
  field: string;
  value: MetaValue;
}
interface MetaEntry {
  id: string;
  changes: MetaChange[];
}
interface MetaWebhookPayload {
  object: 'whatsapp_business_account';
  entry: MetaEntry[];
}

const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * The system's hottest code path: every inbound WhatsApp event lands here.
 *
 * For each `message` entry we:
 *   1. Find the channel by phone_number_id.
 *   2. Resolve the customer:
 *        a. Existing Client by phone? (already converted — chat continues)
 *        b. Existing Lead by phone?  (active sales prospect — continue)
 *        c. Neither?                 → create a new Lead (sourceChannel=whatsapp)
 *   3. Upsert the WhatsAppThread (24h window timestamp, lastMessage*, unread++).
 *   4. Dedupe-write the WhatsAppMessage (waMessageId is uniq).
 *   5. Record ActivityTimeline event WHATSAPP_MESSAGE_RECEIVED on the Lead/Client.
 *   6. Trigger assignment (sticky → round-robin → after-hours queue).
 *   7. Publish realtime fanout to the org's agents.
 *
 * For each `status` we:
 *   1. Find the Message by waMessageId.
 *   2. Update lifecycle timestamps + status field.
 *   3. Capture error detail if FAILED.
 *   4. Publish realtime fanout.
 */
@Processor(WHATSAPP_QUEUE.WEBHOOK_INGEST, { concurrency: 8 })
export class WebhookIngestProcessor extends WorkerHost {
  private readonly log = new Logger(WebhookIngestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: ActivityTimelineService,
    private readonly assignment: WhatsAppAssignmentService,
    private readonly publisher: WhatsAppRealtimePublisher,
  ) {
    super();
  }

  override async process(job: Job<WebhookIngestJob>): Promise<void> {
    const { webhookEventId } = job.data;
    const event = await this.prisma.whatsAppWebhookEvent.findUnique({
      where: { id: webhookEventId },
    });
    if (!event) {
      this.log.warn(`webhook event ${webhookEventId} not found`);
      return;
    }
    if (event.processedAt) return; // idempotent
    if (!event.signatureValid) {
      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date(), processingError: 'invalid signature' },
      });
      return;
    }

    const payload = event.rawPayload as unknown as MetaWebhookPayload;
    if (payload?.object !== 'whatsapp_business_account') {
      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date(), processingError: 'unsupported object' },
      });
      return;
    }

    try {
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field !== 'messages') continue;
          await this.handleValue(change.value);
        }
      }
      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
    } catch (err) {
      this.log.error(`webhook ${webhookEventId} failed: ${(err as Error).message}`);
      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date(), processingError: (err as Error).message },
      });
      throw err; // let BullMQ retry
    }
  }

  private async handleValue(value: MetaValue): Promise<void> {
    const channel = await this.prisma.whatsAppChannel.findUnique({
      where: { phoneNumberId: value.metadata.phone_number_id },
    });
    if (!channel) {
      this.log.warn(`no channel for phone_number_id ${value.metadata.phone_number_id}`);
      return;
    }

    for (const msg of value.messages ?? []) {
      const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
      await this.ingestInboundMessage(channel.id, msg, profileName ?? null);
    }
    for (const st of value.statuses ?? []) {
      await this.ingestStatus(st);
    }
  }

  private async ingestInboundMessage(
    channelId: string,
    msg: MetaMessage,
    profileName: string | null,
  ): Promise<void> {
    const waContactId = msg.from;
    const phone = waContactId.startsWith('+') ? waContactId : `+${waContactId}`;
    const now = new Date();
    const windowExpiresAt = new Date(now.getTime() + WINDOW_DURATION_MS);

    // Resolve customer: client > lead > new lead. We treat phone match as
    // identity. Phone has a UNIQUE constraint on Client and an index on Lead.
    const existingClient = await this.prisma.client.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true },
    });
    let leadId: string | null = null;
    let clientId: string | null = existingClient?.id ?? null;
    let createdLead = false;

    if (!clientId) {
      const existingLead = await this.prisma.lead.findFirst({
        where: { phone, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (existingLead) {
        leadId = existingLead.id;
      } else {
        // Create a new Lead from the WhatsApp profile. Required fields:
        // firstName, lastName, phone. branchId optional but we pick the
        // first branch of the (single) Organization for proper bucketing.
        const branch = await this.prisma.branch.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        const { firstName, lastName } = splitProfileName(profileName, phone);
        const newLead = await this.prisma.lead.create({
          data: {
            firstName,
            lastName,
            phone,
            sourceChannel: 'whatsapp',
            status: LeadStatus.NEW,
            ...(branch ? { branchId: branch.id } : {}),
          },
          select: { id: true },
        });
        leadId = newLead.id;
        createdLead = true;
      }
    }

    // Upsert thread by (channelId, waContactId). Both indexes exist.
    const thread = await this.prisma.whatsAppThread.upsert({
      where: { channelId_waContactId: { channelId, waContactId } },
      create: {
        channelId,
        leadId,
        clientId,
        waContactId,
        windowExpiresAt,
        firstInboundAt: now,
        lastMessageAt: now,
        lastMessagePreview: previewOf(msg),
        unreadCount: 1,
      },
      update: {
        // Keep linkage in sync (covers lead-to-client conversion).
        ...(leadId && { leadId }),
        ...(clientId && { clientId }),
        windowExpiresAt,
        lastMessageAt: now,
        lastMessagePreview: previewOf(msg),
        unreadCount: { increment: 1 },
        status: 'OPEN',
        // Stamp firstInboundAt only if missing.
        firstInboundAt: undefined,
      },
    });

    // If this is the conversation's first inbound and firstInboundAt is still
    // null (existing thread that we previously created for outbound), stamp it.
    if (!thread.firstInboundAt) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { firstInboundAt: now },
      });
    }

    // Dedupe: Meta retries every webhook with the same wa_message_id.
    const dupe = await this.prisma.whatsAppMessage.findUnique({
      where: { waMessageId: msg.id },
      select: { id: true },
    });
    if (dupe) {
      this.log.debug(`dedup inbound ${msg.id}`);
      return;
    }

    const decoded = decodeIncoming(msg);
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId,
        leadId,
        clientId,
        waMessageId: msg.id,
        direction: WhatsAppMessageDirection.INBOUND,
        type: decoded.type,
        status: WhatsAppMessageStatus.RECEIVED,
        body: decoded.body,
        payload: decoded.payload as Prisma.InputJsonValue,
        mediaMimeType: decoded.mediaMeta?.mime_type ?? null,
        repliedToWaMessageId: msg.context?.id ?? null,
        createdAt: new Date(Number(msg.timestamp) * 1000),
      },
    });

    // Activity timeline — Lead-rooted or Client-rooted depending on linkage.
    await this.timeline.record({
      entityType: clientId ? 'Client' : 'Lead',
      entityId: (clientId ?? leadId)!,
      leadId: leadId ?? undefined,
      clientId: clientId ?? undefined,
      eventType: createdLead ? 'WHATSAPP_LEAD_CREATED' : 'WHATSAPP_MESSAGE_RECEIVED',
      description: createdLead
        ? `New WhatsApp lead from ${phone}`
        : `WhatsApp message received: ${(decoded.body ?? '[' + decoded.type.toLowerCase() + ']').slice(0, 80)}`,
      metadata: {
        channelId,
        threadId: thread.id,
        messageId: message.id,
        type: decoded.type,
      },
    });

    // Run assignment engine: sticky → round-robin → after-hours queue.
    try {
      await this.assignment.ensureAssigned(thread.id);
    } catch (err) {
      this.log.error(`assignment failed for thread ${thread.id}: ${(err as Error).message}`);
    }

    // Realtime fanout to all agents in the org.
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (org) {
      await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.MESSAGE_NEW, {
        threadId: thread.id,
        leadId,
        clientId,
        messageId: message.id,
        direction: 'INBOUND',
      });
    }
  }

  private async ingestStatus(st: MetaStatus): Promise<void> {
    const message = await this.prisma.whatsAppMessage.findUnique({
      where: { waMessageId: st.id },
      select: { id: true, threadId: true, leadId: true, clientId: true },
    });
    if (!message) {
      this.log.debug(`status for unknown wamid ${st.id} — likely race`);
      return;
    }
    const ts = new Date(Number(st.timestamp) * 1000);
    const STATUS_MAP: Record<
      MetaStatus['status'],
      { status: WhatsAppMessageStatus; field: 'sentAt' | 'deliveredAt' | 'readAt' | 'failedAt' }
    > = {
      sent: { status: WhatsAppMessageStatus.SENT, field: 'sentAt' },
      delivered: { status: WhatsAppMessageStatus.DELIVERED, field: 'deliveredAt' },
      read: { status: WhatsAppMessageStatus.READ, field: 'readAt' },
      failed: { status: WhatsAppMessageStatus.FAILED, field: 'failedAt' },
    };
    const m = STATUS_MAP[st.status];
    if (!m) return;

    const data: Prisma.WhatsAppMessageUpdateInput = { status: m.status, [m.field]: ts };
    if (st.status === 'failed' && st.errors?.[0]) {
      data.errorCode = String(st.errors[0].code);
      data.errorTitle = st.errors[0].title ?? null;
      data.errorDetails = st.errors[0] as Prisma.InputJsonValue;
    }
    if (st.pricing?.category) {
      data.pricingCategory = st.pricing.category;
    }
    await this.prisma.whatsAppMessage.update({ where: { id: message.id }, data });

    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (org) {
      await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.MESSAGE_STATUS, {
        threadId: message.threadId,
        messageId: message.id,
        status: m.status,
      });
    }
  }
}

// ---- helpers --------------------------------------------------------------

function splitProfileName(name: string | null, phone: string): { firstName: string; lastName: string } {
  if (!name || !name.trim()) {
    // No profile name — use the phone number as the first name placeholder.
    return { firstName: 'WhatsApp', lastName: phone.replace(/[^0-9]/g, '').slice(-4) };
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

function previewOf(msg: MetaMessage): string {
  if (msg.text?.body) return msg.text.body.slice(0, 140);
  if (msg.image) return '[image]';
  if (msg.video) return '[video]';
  if (msg.audio) return '[audio]';
  if (msg.document) return `[document${msg.document.filename ? `: ${msg.document.filename}` : ''}]`;
  if (msg.sticker) return '[sticker]';
  if (msg.location) return '[location]';
  if (msg.interactive) return '[interactive]';
  if (msg.reaction) return `[reaction ${msg.reaction.emoji}]`;
  return `[${msg.type}]`;
}

function decodeIncoming(msg: MetaMessage): {
  type: WhatsAppMessageType;
  body: string | null;
  payload: Record<string, unknown> | null;
  mediaMeta: { id: string; mime_type: string } | null;
} {
  switch (msg.type) {
    case 'text':
      return { type: WhatsAppMessageType.TEXT, body: msg.text?.body ?? null, payload: null, mediaMeta: null };
    case 'image':
      return {
        type: WhatsAppMessageType.IMAGE,
        body: msg.image?.caption ?? null,
        payload: { image: msg.image },
        mediaMeta: msg.image ? { id: msg.image.id, mime_type: msg.image.mime_type } : null,
      };
    case 'video':
      return {
        type: WhatsAppMessageType.VIDEO,
        body: msg.video?.caption ?? null,
        payload: { video: msg.video },
        mediaMeta: msg.video ? { id: msg.video.id, mime_type: msg.video.mime_type } : null,
      };
    case 'audio':
      return {
        type: WhatsAppMessageType.AUDIO,
        body: null,
        payload: { audio: msg.audio },
        mediaMeta: msg.audio ? { id: msg.audio.id, mime_type: msg.audio.mime_type } : null,
      };
    case 'document':
      return {
        type: WhatsAppMessageType.DOCUMENT,
        body: msg.document?.caption ?? null,
        payload: { document: msg.document },
        mediaMeta: msg.document ? { id: msg.document.id, mime_type: msg.document.mime_type } : null,
      };
    case 'sticker':
      return {
        type: WhatsAppMessageType.STICKER,
        body: null,
        payload: { sticker: msg.sticker },
        mediaMeta: msg.sticker ? { id: msg.sticker.id, mime_type: msg.sticker.mime_type } : null,
      };
    case 'location':
      return { type: WhatsAppMessageType.LOCATION, body: null, payload: { location: msg.location }, mediaMeta: null };
    case 'interactive':
      return { type: WhatsAppMessageType.INTERACTIVE, body: null, payload: { interactive: msg.interactive }, mediaMeta: null };
    case 'reaction':
      return {
        type: WhatsAppMessageType.REACTION,
        body: msg.reaction?.emoji ?? null,
        payload: { reaction: msg.reaction },
        mediaMeta: null,
      };
    case 'contacts':
      return { type: WhatsAppMessageType.CONTACTS, body: null, payload: { contacts: msg.contacts }, mediaMeta: null };
    default:
      return {
        type: WhatsAppMessageType.UNSUPPORTED,
        body: null,
        payload: msg as unknown as Record<string, unknown>,
        mediaMeta: null,
      };
  }
}
