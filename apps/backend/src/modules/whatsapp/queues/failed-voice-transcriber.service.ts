import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WhatsAppMessageType } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { OpenAiService } from '../../ai/openai.service';
import { WhatsAppRealtimePublisher } from '../realtime/publisher.service';
import { WHATSAPP_WS_EVENTS } from './queue-contracts';

/**
 * When an outbound VOICE NOTE permanently fails, transcribe the audio we still
 * host and attach the text to the message (payload.failedTranscript) so the rep
 * can send it as TEXT instead of re-recording ("Send as text" in both inboxes).
 *
 * Extracted from OutboundMessageProcessor (2026-09-01) because the common
 * failure class — Meta 131053 "Media upload error" — does NOT surface in the
 * worker's catch at all: the Send API ACCEPTS the message (wamid returned, row
 * stamped SENT) and the failure arrives 1-2s later as a STATUS WEBHOOK. The
 * transcript hook therefore has to live where BOTH paths can call it:
 *   • OutboundMessageProcessor's catch (send-API rejections), and
 *   • WebhookIngestProcessor.ingestStatus's failed branch (webhook rejections —
 *     verified 14/14 of the observed 131053s took this path, so before this
 *     service existed the transcript was NEVER attached for them).
 *
 * Every bail-out is logged: a silent no-op here is exactly how the gap above
 * stayed invisible — a rep's dead red bubble should always be explainable from
 * the logs.
 */
@Injectable()
export class FailedVoiceTranscriberService {
  private readonly log = new Logger(FailedVoiceTranscriberService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly openai: OpenAiService,
    private readonly publisher: WhatsAppRealtimePublisher,
  ) {}

  /** Fire-and-forget safe: never throws. */
  async transcribe(message: {
    id: string;
    threadId: string;
    type: WhatsAppMessageType;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    payload: Prisma.JsonValue | null;
  }): Promise<void> {
    try {
      await this.run(message);
    } catch (e) {
      this.log.warn(`failed-voice ${message.id}: transcript error — ${(e as Error).message}`);
    }
  }

  private async run(message: {
    id: string;
    threadId: string;
    type: WhatsAppMessageType;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    payload: Prisma.JsonValue | null;
  }): Promise<void> {
    if (message.type !== WhatsAppMessageType.AUDIO) return; // not a voice note — nothing to do
    const basePayload =
      message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)
        ? (message.payload as Record<string, unknown>)
        : {};
    if (basePayload.isVoiceNote !== true) {
      this.log.debug(`failed-voice ${message.id}: skip — AUDIO but not a voice note`);
      return;
    }
    if (basePayload.failedTranscript) return; // already attached (both paths may fire)
    if (!message.mediaUrl || message.mediaUrl.startsWith('meta:')) {
      this.log.warn(
        `failed-voice ${message.id}: skip — no hosted bytes (ref=${message.mediaUrl?.slice(0, 16) ?? 'null'})`,
      );
      return;
    }

    let bytes: Buffer;
    try {
      if (message.mediaUrl.startsWith('http')) {
        const r = await fetch(message.mediaUrl);
        if (!r.ok) {
          this.log.warn(`failed-voice ${message.id}: skip — fetch ${r.status}`);
          return;
        }
        bytes = Buffer.from(await r.arrayBuffer());
      } else {
        bytes = (await this.storage.download(message.mediaUrl)).bytes;
      }
    } catch (e) {
      this.log.warn(`failed-voice ${message.id}: skip — download failed: ${(e as Error).message}`);
      return;
    }
    if (!bytes || bytes.length === 0) {
      this.log.warn(`failed-voice ${message.id}: skip — empty bytes`);
      return;
    }

    const res = await this.openai.transcribe(bytes, `voice-${message.id}.ogg`);
    const text = res?.text?.trim();
    if (!text) {
      this.log.warn(`failed-voice ${message.id}: skip — Whisper returned no text`);
      return;
    }

    await this.prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        payload: {
          ...basePayload,
          failedTranscript: text,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    // Nudge open chats so the transcript appears without a manual reload. Carry
    // the text on the event so the client can render it immediately; a cold
    // load reads it straight from the message payload.
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (org) {
      await this.publisher
        .publishToOrg(org.id, WHATSAPP_WS_EVENTS.MESSAGE_STATUS, {
          threadId: message.threadId,
          messageId: message.id,
          status: 'FAILED',
          failedTranscript: text,
        })
        .catch(() => undefined);
    }
    this.log.log(`failed-voice ${message.id}: transcript attached (${text.length} chars)`);
  }
}
