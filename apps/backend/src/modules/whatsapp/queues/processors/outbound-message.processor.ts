import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  LeadStatus,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { ActivityTimelineService } from '../../../activity-timeline/activity-timeline.service';
import { StorageService } from '../../../storage/storage.service';
import { WhatsAppMetaClientFactory } from '../../meta/client.factory';
import { MetaApiError, type MetaSendResponse } from '../../meta/cloud-client';
import { WhatsAppRealtimePublisher } from '../../realtime/publisher.service';
import {
  WHATSAPP_QUEUE,
  WHATSAPP_WS_EVENTS,
  type OutboundMessageJob,
} from '../queue-contracts';

/**
 * Send a queued outbound message to Meta. Idempotent on Message: if the
 * status is already SENT/DELIVERED/READ/FAILED we no-op.
 *
 * Retry policy: BullMQ retries on thrown errors. We let it retry transient
 * failures (5xx, 130429 rate-limit). Permanent failures (4xx other) flip
 * the message to FAILED and don't retry.
 *
 * Side effects after a successful send:
 *   - Update Message to SENT with sentAt + waMessageId from Meta's response
 *   - If this is the agent's first reply, record the SLA breach decision
 *     and bump Lead.status NEW → CONTACTED
 *   - Push realtime status update to the org's connected agents
 */
@Processor(WHATSAPP_QUEUE.OUTBOUND_MESSAGE, { concurrency: 16 })
export class OutboundMessageProcessor extends WorkerHost {
  private readonly log = new Logger(OutboundMessageProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaFactory: WhatsAppMetaClientFactory,
    private readonly publisher: WhatsAppRealtimePublisher,
    private readonly timeline: ActivityTimelineService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  override async process(job: Job<OutboundMessageJob>): Promise<void> {
    const { messageId } = job.data;
    const message = await this.prisma.whatsAppMessage.findUnique({
      where: { id: messageId },
      include: {
        channel: true,
        thread: {
          select: {
            id: true,
            waContactId: true,
            firstAgentReplyAt: true,
            slaDeadlineAt: true,
            responseDeadlineAt: true,
            responseBreached: true,
          },
        },
      },
    });
    if (!message) {
      this.log.warn(`outbound: message ${messageId} not found`);
      return;
    }
    if (
      message.status !== WhatsAppMessageStatus.QUEUED &&
      message.status !== WhatsAppMessageStatus.SENDING
    ) {
      this.log.debug(`outbound ${messageId} already ${message.status}`);
      return;
    }

    await this.prisma.whatsAppMessage.update({
      where: { id: messageId },
      data: { status: WhatsAppMessageStatus.SENDING },
    });

    try {
      // forChannel() decrypts the stored access token. If the
      // WHATSAPP_ENCRYPTION_KEY env var was rotated AFTER the channel was
      // saved, decrypt throws InvalidTag and — when this lived outside the
      // try block — the message rotted in SENDING with no errorCode, BullMQ
      // retried 5× silently and gave up. Keep it inside so the FAIL branch
      // below stamps a real diagnosis on the message.
      const client = this.metaFactory.forChannel(message.channel);
      const to = message.thread.waContactId;
      const res = await this.dispatchSend(client, message, to);
      const waMessageId = res.messages?.[0]?.id ?? null;
      const now = new Date();

      // 1) Stamp the Message as SENT.
      await this.prisma.whatsAppMessage.update({
        where: { id: messageId },
        data: {
          status: WhatsAppMessageStatus.SENT,
          sentAt: now,
          ...(waMessageId ? { waMessageId } : {}),
        },
      });

      // 1a) Bump the thread's denormalized lastMessage* fields so the inbox
      //     sidebar re-sorts and the chat preview updates. Without this the
      //     left-side list keeps showing the customer's last inbound as the
      //     thread preview even after we replied (visible bug observed both
      //     with bot replies and human sends). Mirrors the inbound update
      //     in webhook-ingest. We DO NOT touch unreadCount here — outbound
      //     messages don't make the conversation "unread for the agent".
      const preview = previewOfOutbound(message);
      await this.prisma.whatsAppThread.update({
        where: { id: message.threadId },
        data: {
          lastMessageAt: now,
          lastMessagePreview: preview,
        },
      });

      // 1b) Rolling Response-SLA resolution. A genuine agent reply closes the
      //     current pending window: stamp Met or Breached, move the assigned
      //     agent's tally, and clear the clock so the next customer message
      //     starts a fresh one. The auto-acknowledgement is flagged in its
      //     payload and MUST NOT resolve the SLA — the customer still needs a
      //     human reply for the window to count as met.
      const isAutoAck =
        (message.payload as { autoAck?: boolean } | null)?.autoAck === true;
      if (!isAutoAck && message.thread.responseDeadlineAt) {
        const creditEmployeeId = message.sentByEmployeeId; // resolved sender (assignee for super-admin sends)
        // If the sweeper already counted this window as a breach, don't
        // double-count — just clear the clock. Otherwise score it now.
        if (!message.thread.responseBreached) {
          const metOnTime = now <= message.thread.responseDeadlineAt;
          if (creditEmployeeId) {
            await this.prisma.employee.update({
              where: { id: creditEmployeeId },
              data: metOnTime
                ? { slaResponsesMet: { increment: 1 } }
                : { slaResponsesBreached: { increment: 1 } },
            });
          }
        }
        await this.prisma.whatsAppThread.update({
          where: { id: message.threadId },
          data: {
            responseDeadlineAt: null,
            responseDueSince: null,
            responseWarned: false,
            responseBreached: false,
          },
        });
      }

      // 2) SLA + leadStage transitions (only on the conversation's FIRST agent reply).
      //    Skip for the auto-ack so it doesn't masquerade as the first human reply.
      if (!isAutoAck && !message.thread.firstAgentReplyAt && message.leadId) {
        const breached = message.thread.slaDeadlineAt
          ? now > message.thread.slaDeadlineAt
          : false;
        await this.prisma.whatsAppThread.update({
          where: { id: message.threadId },
          data: { firstAgentReplyAt: now, slaBreached: breached },
        });
        // Lead.status NEW → CONTACTED. Use updateMany so we don't error if
        // the lead was already moved past NEW.
        await this.prisma.lead.updateMany({
          where: { id: message.leadId, status: LeadStatus.NEW },
          data: { status: LeadStatus.CONTACTED },
        });
      }

      // 3) Timeline.
      await this.timeline.record({
        entityType: message.clientId ? 'Client' : 'Lead',
        entityId: (message.clientId ?? message.leadId)!,
        leadId: message.leadId ?? undefined,
        clientId: message.clientId ?? undefined,
        eventType: 'WHATSAPP_MESSAGE_SENT',
        description: `WhatsApp message sent: ${(message.body ?? '[' + message.type.toLowerCase() + ']').slice(0, 80)}`,
        actorUserId: undefined,
        metadata: {
          messageId: message.id,
          threadId: message.threadId,
          type: message.type,
          sentByEmployeeId: message.sentByEmployeeId,
        },
      });

      // 4) Realtime fanout.
      const org = await this.prisma.organization.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (org) {
        await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.MESSAGE_STATUS, {
          threadId: message.threadId,
          messageId: message.id,
          status: 'SENT',
        });
      }
    } catch (err) {
      if (err instanceof MetaApiError) {
        const isRetryable = err.status >= 500 || err.detail.code === 130429;
        await this.prisma.whatsAppMessage.update({
          where: { id: messageId },
          data: {
            status: isRetryable ? WhatsAppMessageStatus.QUEUED : WhatsAppMessageStatus.FAILED,
            failedAt: isRetryable ? null : new Date(),
            errorCode: String(err.detail.code),
            errorTitle: err.detail.title ?? null,
            errorDetails: { message: err.detail.message, raw: err.raw } as Prisma.InputJsonValue,
          },
        });
        if (!isRetryable) {
          const org = await this.prisma.organization.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          if (org) {
            await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.MESSAGE_STATUS, {
              threadId: message.threadId,
              messageId: message.id,
              status: 'FAILED',
            });
          }
        }
        // Re-throw so BullMQ counts the attempt and applies retry policy.
        throw err;
      }

      // Non-Meta throws — decrypt InvalidTag (encryption key rotated), bad
      // channel config, code bugs. Stamp the message FAILED with a clear
      // errorTitle so admin sees what happened instead of a forever-pending
      // clock icon. Code "internal" tells the UI this isn't a Meta error.
      const errMsg = (err as Error)?.message ?? 'unknown';
      const isCryptoErr = /InvalidTag|Unsupported state|bad decrypt|auth tag/i.test(errMsg);
      await this.prisma.whatsAppMessage.update({
        where: { id: messageId },
        data: {
          status: WhatsAppMessageStatus.FAILED,
          failedAt: new Date(),
          errorCode: 'internal',
          errorTitle: isCryptoErr
            ? 'Channel credentials cannot be decrypted — re-save Meta access token'
            : 'Internal worker error',
          errorDetails: { message: errMsg } as Prisma.InputJsonValue,
        },
      });
      const org = await this.prisma.organization.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (org) {
        await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.MESSAGE_STATUS, {
          threadId: message.threadId,
          messageId: message.id,
          status: 'FAILED',
        });
      }
      this.log.error(`outbound ${messageId} failed (non-Meta): ${errMsg}`);
      throw err;
    }
  }

  private async dispatchSend(
    client: ReturnType<WhatsAppMetaClientFactory['forChannel']>,
    message: {
      type: WhatsAppMessageType;
      body: string | null;
      templateName: string | null;
      templateLanguage: string | null;
      payload: Prisma.JsonValue | null;
      mediaUrl: string | null;
      mediaMimeType: string | null;
      repliedToWaMessageId: string | null;
    },
    to: string,
  ): Promise<MetaSendResponse> {
    switch (message.type) {
      case WhatsAppMessageType.TEXT:
        return client.sendText({
          to,
          body: message.body ?? '',
          ...(message.repliedToWaMessageId
            ? { contextWaMessageId: message.repliedToWaMessageId }
            : {}),
        });
      case WhatsAppMessageType.TEMPLATE:
        return client.sendTemplate({
          to,
          templateName: message.templateName ?? '',
          language: message.templateLanguage ?? 'en',
          components:
            ((message.payload as { components?: unknown[] } | null)?.components as
              | Array<Record<string, unknown>>
              | undefined) ?? [],
        });
      case WhatsAppMessageType.IMAGE:
      case WhatsAppMessageType.VIDEO:
      case WhatsAppMessageType.AUDIO:
      case WhatsAppMessageType.DOCUMENT:
      case WhatsAppMessageType.STICKER: {
        // Resolve mediaUrl into a Meta media reference:
        //   • "meta:<id>"  → we already uploaded to Meta; send by media_id.
        //   • "http(s)://" → an externally-hosted public URL; send as-is.
        //   • anything else → a DURABLE storage key (e.g. brochures/C11.pdf).
        //     Sign a FRESH link right now so Meta fetches a live URL — never a
        //     5-min-old one that expired while the job sat in the queue, and
        //     the key stays on the row so the inbox can re-stream it forever.
        let mediaRef: { mediaId: string } | { link: string } | Record<string, never>;
        if (message.mediaUrl?.startsWith('meta:')) {
          mediaRef = { mediaId: message.mediaUrl.slice(5) };
        } else if (message.mediaUrl?.startsWith('http')) {
          mediaRef = { link: message.mediaUrl };
        } else if (message.mediaUrl) {
          mediaRef = { link: await this.storage.getSignedUrl(message.mediaUrl) };
        } else {
          mediaRef = {};
        }
        // For voice notes the service sets payload.isVoiceNote = true and
        // transcodes the file to OGG/OPUS before upload. We must pass
        // voice: true so Meta renders it as a voice note (waveform + auto-play)
        // rather than a basic audio attachment.
        const isVoiceNote =
          message.type === WhatsAppMessageType.AUDIO &&
          ((message.payload as { isVoiceNote?: boolean } | null)?.isVoiceNote ?? false);
        // Documents render with a proper filename in WhatsApp when we pass one
        // (e.g. the brochure's display title). Stored in payload.filename.
        const filename =
          message.type === WhatsAppMessageType.DOCUMENT
            ? ((message.payload as { filename?: string } | null)?.filename ?? undefined)
            : undefined;
        return client.sendMedia({
          to,
          type: message.type.toLowerCase() as 'image' | 'video' | 'audio' | 'document' | 'sticker',
          ...mediaRef,
          ...(message.body ? { caption: message.body } : {}),
          ...(filename ? { filename } : {}),
          ...(isVoiceNote ? { voice: true } : {}),
        });
      }
      default:
        throw new Error(`Unsupported outbound type: ${message.type}`);
    }
  }
}

/**
 * Inbox-sidebar preview for an outbound message. Matches the shape used by
 * the inbound preview in webhook-ingest.processor — body text trimmed to ~140
 * chars, or a "[media]" placeholder when there's no body (e.g. a voice note
 * sent without a caption). Returns null for genuinely empty messages so the
 * sidebar keeps whatever was there before instead of going blank.
 */
function previewOfOutbound(message: { body: string | null; type: string }): string | null {
  const body = (message.body ?? '').trim();
  if (body) return body.slice(0, 140);
  switch (message.type) {
    case 'IMAGE': return '[image]';
    case 'VIDEO': return '[video]';
    case 'AUDIO': return '[voice]';
    case 'DOCUMENT': return '[document]';
    case 'STICKER': return '[sticker]';
    case 'TEMPLATE': return '[template]';
    default: return null;
  }
}
