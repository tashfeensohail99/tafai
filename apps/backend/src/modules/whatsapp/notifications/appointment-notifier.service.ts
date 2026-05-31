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
import { OpenAiService } from '../../ai/openai.service';
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
    private readonly openai: OpenAiService,
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
    // Best-effort AI summary of the recent chat so the client sees what the
    // consultation is about. Falls back to the manually-typed notes (or
    // nothing) on any failure.
    const summary = await this.generateChatSummary(thread.id);
    const body = this.composeBody({
      firstName,
      appointmentType: appt.appointmentType,
      scheduledAt: appt.scheduledAt,
      durationMinutes: appt.durationMinutes,
      location: appt.location,
      meetingLink: appt.meetingLink,
      notes: appt.notes,
      summary,
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
    summary: string | null;
  }): string {
    const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
    const typeLabel = formatAppointmentType(input.appointmentType);
    const { dateLine, timeLine } = formatScheduledAt(input.scheduledAt);
    const lines: string[] = [
      `${greeting} your ${typeLabel} is confirmed.`,
      '',
      dateLine,
      timeLine,
      `Duration: ${input.durationMinutes ?? 30} min`,
    ];
    if (input.location) lines.push(`Location: ${input.location}`);
    lines.push(`Meeting: ${formatMeetingModality(input)}`);
    const notesLine = input.summary?.trim() || input.notes?.trim() || null;
    if (notesLine) lines.push(`Notes: ${notesLine}`);
    lines.push('', 'Reply here if anything changes. — Tashfeen Immigration');
    return lines.join('\n');
  }

  /**
   * Pull the last ~30 messages from this thread and ask the LLM for a 1–2
   * sentence summary describing what the upcoming consultation is about.
   * Best-effort: returns null on any failure (no key, network, empty thread)
   * so the confirmation send is never blocked by it.
   */
  private async generateChatSummary(threadId: string): Promise<string | null> {
    try {
      const msgs = await this.prisma.whatsAppMessage.findMany({
        where: { threadId, body: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          direction: true,
          body: true,
          sentByEmployeeId: true,
        },
      });
      if (msgs.length === 0) return null;
      const transcript = msgs
        .reverse()
        .map((m) => {
          const text = (m.body ?? '').trim();
          if (!text) return null;
          if (m.direction === WhatsAppMessageDirection.INBOUND) return `Client: ${text}`;
          return `${m.sentByEmployeeId ? 'Agent' : 'Bot'}: ${text}`;
        })
        .filter(Boolean)
        .join('\n');
      if (!transcript) return null;
      const { reply } = await this.openai.chat([
        {
          role: 'system',
          content:
            'You write a one-line summary (max 25 words) describing what the upcoming consultation is about, based on a WhatsApp chat. Plain English. Start with the topic, no greeting. Do not invent details that are not in the chat.',
        },
        {
          role: 'user',
          content: `Chat transcript:\n${transcript}\n\nWrite the summary line for the appointment confirmation.`,
        },
      ]);
      const cleaned = reply.trim().replace(/^["'`]+|["'`]+$/g, '');
      return cleaned || null;
    } catch (e) {
      this.log.warn(
        { err: (e as Error).message, threadId },
        'confirmation: chat summary failed; falling back to manual notes',
      );
      return null;
    }
  }

  private async findEmployeeIdByUserId(userId: string): Promise<string | null> {
    const emp = await this.prisma.employee.findFirst({
      where: { userId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return emp?.id ?? null;
  }
}

/**
 * Pick the right "how are we meeting" line for the confirmation:
 *   - Has a meeting link → Video call (with link)
 *   - In-person / has a physical location → Office visit
 *   - Otherwise → Phone call (the default consultation flow)
 */
function formatMeetingModality(input: {
  appointmentType: string;
  location: string | null;
  meetingLink: string | null;
}): string {
  if (input.meetingLink) return `Video call — ${input.meetingLink}`;
  const type = input.appointmentType.toUpperCase();
  if (type === 'IN_PERSON' || type === 'VISA_FILING' || input.location) {
    return 'Office visit';
  }
  return 'Phone call';
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
