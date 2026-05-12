import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WHATSAPP_QUEUE, type OutboundMessageJob } from '../queues/queue-contracts';

interface CallerContext {
  userId: string;
  employeeId: string | null;
  canViewAll: boolean;
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
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
  ) {}

  async listForThread(
    caller: CallerContext,
    threadId: string,
    opts: { limit?: number; before?: Date } = {},
  ) {
    const thread = await this.thread(caller, threadId);
    const limit = Math.min(opts.limit ?? 50, 200);
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
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(
        '24-hour customer-service window has expired. Use a template message instead.',
      );
    }

    if (!caller.employeeId) {
      throw new ForbiddenException('Only employees may send WhatsApp messages');
    }

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEXT,
        status: WhatsAppMessageStatus.QUEUED,
        body,
        sentByEmployeeId: caller.employeeId,
        repliedToWaMessageId: input.contextWaMessageId ?? null,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      },
      select: this.publicSelect(),
    });

    await this.outboundQueue.add(
      'send',
      { messageId: message.id },
      { jobId: message.id },
    );
    return message;
  }

  async sendTemplate(caller: CallerContext, input: SendTemplateInput) {
    const thread = await this.thread(caller, input.threadId);
    if (!caller.employeeId) {
      throw new ForbiddenException('Only employees may send WhatsApp messages');
    }
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
        payload: { components: input.components ?? [] } as unknown as Prisma.InputJsonValue,
        sentByEmployeeId: caller.employeeId,
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
      },
      select: this.publicSelect(),
    });
    await this.outboundQueue.add(
      'send',
      { messageId: message.id },
      { jobId: message.id },
    );
    return message;
  }

  /** Look up the thread, enforcing the agent-scope rule. */
  private async thread(caller: CallerContext, threadId: string) {
    const t = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        channelId: true,
        leadId: true,
        clientId: true,
        windowExpiresAt: true,
        lead: { select: { assignedEmployeeId: true } },
      },
    });
    if (!t) throw new NotFoundException('Thread not found');
    if (!caller.canViewAll) {
      if (!caller.employeeId || t.lead?.assignedEmployeeId !== caller.employeeId) {
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
      errorCode: true,
      errorTitle: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      failedAt: true,
      createdAt: true,
    } as const;
  }
}
