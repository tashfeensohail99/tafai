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
  WhatsAppThreadStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OpenAiService } from '../../ai/openai.service';
import { normalisePhone } from '../../../common/phone/phone.util';
import { WHATSAPP_QUEUE, type OutboundMessageJob } from '../queues/queue-contracts';

/** The reception paid-consultation UTILITY templates (approved at Meta). */
export type ConsultTemplateName =
  | 'consultation_confirmed'
  | 'consultation_payment_received'
  | 'consultation_no_show'
  | 'consultation_payment_reminder'
  | 'consultation_reminder'
  | 'consultation_slot_released';

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
    opts?: { kind?: 'booked' | 'rescheduled' },
  ): Promise<AppointmentConfirmationResult> {
    const kind = opts?.kind ?? 'booked';
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
    // consultation is about. Skipped for reschedules — the customer already
    // knows the topic; that message should be short and only carry the new
    // time. Falls back to the manually-typed notes (or nothing) on failure.
    const summary = kind === 'booked' ? await this.generateChatSummary(thread.id) : null;
    const body = this.composeBody({
      firstName,
      appointmentType: appt.appointmentType,
      scheduledAt: appt.scheduledAt,
      durationMinutes: appt.durationMinutes,
      location: appt.location,
      meetingLink: appt.meetingLink,
      notes: appt.notes,
      summary,
      kind,
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
          kind,
        } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });

    return { sent: true, messageId: message.id, threadId: thread.id };
  }

  /**
   * Send a plain bot text message on a thread (bot-attributed —
   * sentByEmployeeId null, so it never trips the human-takeover guard). Used by
   * the orchestrator for proactive follow-ups like the post-booking email
   * request. Best-effort: respects the 24h window, never throws.
   */
  async sendBotText(threadId: string, body: string): Promise<{ sent: boolean }> {
    const thread = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        channelId: true,
        leadId: true,
        clientId: true,
        windowExpiresAt: true,
      },
    });
    if (!thread) return { sent: false };
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= Date.now()) {
      return { sent: false };
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
        sentByEmployeeId: null,
        idempotencyKey: randomUUID(),
      },
      select: { id: true },
    });
    await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });
    return { sent: true };
  }

  /**
   * Send an approved reception UTILITY template to a lead/client — system
   * attributed (sentByEmployeeId null, so it never trips the human-takeover
   * guard) and business-INITIATED, so it works OUTSIDE the 24h window (that is
   * the whole point of a template). Best-effort: never throws, so a WhatsApp
   * failure can never roll back the money/booking that triggered it.
   *
   * Resolves the lead's existing thread (Lead↔Thread is 1:1) or opens one
   * outbound-first on the active channel, keyed on the same (channelId,
   * waContactId) the inbound webhook uses so a later reply reconciles here.
   * Refuses a hard-blocked contact. These are all UTILITY (transactional), so —
   * like receipts — they are deliberately NOT gated on the promotional opt-out.
   */
  async sendConsultTemplate(input: {
    leadId?: string | null;
    clientId?: string | null;
    phone: string | null;
    templateName: ConsultTemplateName;
    bodyParams: string[];
    /** Fills the {{1}} of the URL button (consultation_payment_reminder only). */
    buttonUrlToken?: string;
    idempotencyKey?: string;
    /** Whether the customer opted in to WhatsApp updates. false → skip (Meta
     *  requires opt-in for business-initiated, out-of-window messages). */
    consent?: boolean;
  }): Promise<{ sent: boolean; reason?: string }> {
    try {
      // Opt-in gate — never business-initiate to a customer who didn't agree.
      if (input.consent === false) return { sent: false, reason: 'no_consent' };

      // Resolve the contact's STORED (previously-validated) phone + block state.
      // PREFER the stored number over an ad-hoc desk-typed one: a mistyped digit
      // must not leak this customer's name/fee/appointment to a stranger or bind
      // their thread to an unverified number.
      let storedPhone: string | null = null;
      if (input.leadId) {
        const lead = await this.prisma.lead.findUnique({ where: { id: input.leadId }, select: { blockedAt: true, phone: true } });
        if (lead?.blockedAt) return { sent: false, reason: 'blocked' };
        storedPhone = lead?.phone ?? null;
      }
      if (input.clientId) {
        const client = await this.prisma.client.findUnique({ where: { id: input.clientId }, select: { blockedAt: true, phone: true } });
        if (client?.blockedAt) return { sent: false, reason: 'blocked' };
        if (!storedPhone) storedPhone = client?.phone ?? null;
      }

      const rawPhone = storedPhone ?? input.phone;
      if (!rawPhone) return { sent: false, reason: 'no_phone' };
      const norm = normalisePhone(rawPhone);
      if (!norm.ok || !norm.e164) return { sent: false, reason: 'no_phone' };
      const waContactId = norm.e164.replace(/\D/g, '');

      const channel = await this.prisma.whatsAppChannel.findFirst({
        where: { status: WhatsAppChannelStatus.ACTIVE },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!channel) return { sent: false, reason: 'no_channel' };

      // Reuse the lead's 1:1 thread if any (avoids the leadId-unique violation an
      // upsert-create would hit); else open/reconcile on (channelId, waContactId).
      let thread: { id: string; channelId: string; leadId: string | null; clientId: string | null } | null = null;
      if (input.leadId) {
        thread = await this.prisma.whatsAppThread.findUnique({
          where: { leadId: input.leadId },
          select: { id: true, channelId: true, leadId: true, clientId: true },
        });
      }
      if (!thread) {
        const now = new Date();
        thread = await this.prisma.whatsAppThread.upsert({
          where: { channelId_waContactId: { channelId: channel.id, waContactId } },
          create: {
            channelId: channel.id,
            waContactId,
            leadId: input.leadId ?? null,
            clientId: input.clientId ?? null,
            status: WhatsAppThreadStatus.OPEN,
            lastMessageAt: now,
            lastHumanActivityAt: now,
          },
          update: {
            ...(input.leadId ? { leadId: input.leadId } : {}),
            ...(input.clientId ? { clientId: input.clientId } : {}),
          },
          select: { id: true, channelId: true, leadId: true, clientId: true },
        });
      }

      const components: Array<Record<string, unknown>> = [
        { type: 'body', parameters: input.bodyParams.map((t) => ({ type: 'text', text: t })) },
      ];
      if (input.buttonUrlToken) {
        // Meta send-time URL-button param shape (NOT the template-definition shape).
        components.push({
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: input.buttonUrlToken }],
        });
      }

      const renderedBody = await this.renderConsultBody(channel.id, input.templateName, input.bodyParams);

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
          templateLanguage: 'en',
          body: renderedBody,
          payload: { components, source: 'reception_consult' } as unknown as Prisma.InputJsonValue,
          sentByEmployeeId: null,
          idempotencyKey: input.idempotencyKey ?? randomUUID(),
        },
        select: { id: true },
      });
      await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });
      return { sent: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Same idempotencyKey already queued this exact send — treat as sent.
        return { sent: true };
      }
      this.log.warn(`consult template ${input.templateName} send failed: ${(e as Error).message}`);
      return { sent: false, reason: 'error' };
    }
  }

  /** Render an approved template's BODY with the supplied params, for the chat
   *  bubble / inbox preview. Best-effort — null (bare "Template: name") on any
   *  miss; never affects what is actually sent to Meta. */
  private async renderConsultBody(
    channelId: string,
    templateName: string,
    bodyParams: string[],
  ): Promise<string | null> {
    try {
      const tpl = await this.prisma.whatsAppTemplate.findFirst({
        where: { channelId, name: templateName },
        select: { components: true },
      });
      const comps = (tpl?.components ?? []) as Array<{ type?: string; text?: string }>;
      const body = comps.find((c) => (c.type ?? '').toUpperCase() === 'BODY')?.text;
      if (!body) return null;
      return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
        const idx = Number(n) - 1;
        return bodyParams[idx] ?? `{{${n}}}`;
      });
    } catch {
      return null;
    }
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
    kind?: 'booked' | 'rescheduled';
  }): string {
    const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
    const typeLabel = formatAppointmentType(input.appointmentType);
    const { dateLine, timeLine } = formatScheduledAt(input.scheduledAt);
    const headline =
      input.kind === 'rescheduled'
        ? `${greeting} your ${typeLabel} has been rescheduled — here is the new time:`
        : `${greeting} your ${typeLabel} is confirmed.`;
    const lines: string[] = [
      headline,
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
