import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  WhatsAppThreadStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WHATSAPP_QUEUE, type OutboundMessageJob } from '../queues/queue-contracts';

export type AppointmentConfirmationResult =
  | { sent: true; messageId: string; threadId: string }
  | { sent: false; reason: 'no_thread' | 'window_expired' | 'no_phone' | 'no_channel' };

/**
 * Sends a free-form WhatsApp confirmation when a sales agent books an
 * appointment from the inbox. Best-effort: never throws, never blocks
 * appointment creation. If the 24-hour customer-service window has expired,
 * or the lead has no active thread, we silently skip and surface the reason
 * to the UI so the agent can decide to send a template manually.
 *
 * Hooks into the same outbound queue + WhatsAppMessage row used by manual
 * agent sends, so delivery status, retries, and realtime fanout all work
 * identically.
 */
@Injectable()
export class WhatsAppAppointmentNotifierService {
  private readonly log = new Logger(WhatsAppAppointmentNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
  ) {}

  async sendConfirmationFor(
    appointmentId: string,
    actorUserId: string,
  ): Promise<AppointmentConfirmationResult> {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        leadId: true,
        clientId: true,
        title: true,
        appointmentType: true,
        scheduledAt: true,
        durationMinutes: true,
        location: true,
        meetingLink: true,
        notes: true,
        lead: { select: { id: true, firstName: true, phone: true } },
        client: { select: { id: true, firstName: true, phone: true } },
      },
    });
    if (!appt) {
      this.log.warn({ appointmentId }, 'confirmation: appointment not found');
      return { sent: false, reason: 'no_thread' };
    }

    const phone = appt.lead?.phone ?? appt.client?.phone ?? null;
    if (!phone) return { sent: false, reason: 'no_phone' };

    const thread = await this.prisma.whatsAppThread.findFirst({
      where: {
        ...(appt.leadId ? { leadId: appt.leadId } : {}),
        ...(!appt.leadId && appt.clientId ? { clientId: appt.clientId } : {}),
        status: { in: [WhatsAppThreadStatus.OPEN, WhatsAppThreadStatus.PENDING] },
      },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        channelId: true,
        leadId: true,
        clientId: true,
        windowExpiresAt: true,
      },
    });
    if (!thread) return { sent: false, reason: 'no_thread' };

    const now = new Date();
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime()) {
      return { sent: false, reason: 'window_expired' };
    }

    const sentByEmployeeId = await this.findEmployeeIdByUserId(actorUserId);
    const firstName = appt.lead?.firstName ?? appt.client?.firstName ?? null;
    const body = this.composeBody({
      firstName,
      appointmentType: appt.appointmentType,
      scheduledAt: appt.scheduledAt,
      durationMinutes: appt.durationMinutes,
      location: appt.location,
      meetingLink: appt.meetingLink,
      notes: appt.notes,
    });

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
        sentByEmployeeId,
        idempotencyKey: randomUUID(),
        payload: {
          source: 'appointment_confirmation',
          appointmentId: appt.id,
        } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });

    return { sent: true, messageId: message.id, threadId: thread.id };
  }

  private composeBody(input: {
    firstName: string | null;
    appointmentType: string;
    scheduledAt: Date;
    durationMinutes: number | null;
    location: string | null;
    meetingLink: string | null;
    notes: string | null;
  }): string {
    const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
    const typeLabel = formatAppointmentType(input.appointmentType);
    const { dateLine, timeLine } = formatScheduledAt(input.scheduledAt);
    const durationLine = input.durationMinutes
      ? `Duration: ${input.durationMinutes} min`
      : null;
    const lines: string[] = [
      `${greeting} your ${typeLabel} is confirmed.`,
      '',
      dateLine,
      timeLine,
    ];
    if (durationLine) lines.push(durationLine);
    if (input.location) lines.push(`Location: ${input.location}`);
    if (input.meetingLink) lines.push(`Meeting link: ${input.meetingLink}`);
    if (input.notes) lines.push('', input.notes);
    lines.push('', 'Reply here if anything changes. — Tashfeen Immigration');
    return lines.join('\n');
  }

  private async findEmployeeIdByUserId(userId: string): Promise<string | null> {
    const emp = await this.prisma.employee.findFirst({
      where: { userId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return emp?.id ?? null;
  }
}

function formatAppointmentType(raw: string): string {
  switch (raw) {
    case 'CONSULTATION':
      return 'consultation';
    case 'DOCUMENT_REVIEW':
      return 'document review';
    case 'FOLLOW_UP':
      return 'follow-up';
    case 'VISA_FILING':
      return 'visa filing appointment';
    case 'IN_PERSON':
      return 'in-person meeting';
    default:
      return raw.toLowerCase().replace(/_/g, ' ');
  }
}

function formatScheduledAt(scheduledAt: Date): { dateLine: string; timeLine: string } {
  const fmtDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const fmtTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return {
    dateLine: `Date: ${fmtDate.format(scheduledAt)}`,
    timeLine: `Time: ${fmtTime.format(scheduledAt)} PKT`,
  };
}
