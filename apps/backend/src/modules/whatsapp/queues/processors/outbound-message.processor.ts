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
          select: { id: true, waContactId: true, firstAgentReplyAt: true, slaDeadlineAt: true },
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

    const client = this.metaFactory.forChannel(message.channel);
    const to = message.thread.waContactId;

    try {
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

      // 2) SLA + leadStage transitions (only on the conversation's FIRST agent reply).
      if (!message.thread.firstAgentReplyAt && message.leadId) {
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
        // mediaUrl prefixed with "meta:" means we already have a Meta media_id
        const isMetaId = message.mediaUrl?.startsWith('meta:');
        const mediaRef = isMetaId
          ? { mediaId: message.mediaUrl!.slice(5) }
          : message.mediaUrl
            ? { link: message.mediaUrl }
            : {};
        return client.sendMedia({
          to,
          type: message.type.toLowerCase() as 'image' | 'video' | 'audio' | 'document' | 'sticker',
          ...mediaRef,
          ...(message.body ? { caption: message.body } : {}),
        });
      }
      default:
        throw new Error(`Unsupported outbound type: ${message.type}`);
    }
  }
}
