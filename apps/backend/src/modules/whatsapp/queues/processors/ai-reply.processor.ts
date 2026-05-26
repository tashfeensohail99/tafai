import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { OrchestratorService } from '../../../ai/orchestrator.service';
import { OpenAiService } from '../../../ai/openai.service';
import { StorageService } from '../../../storage/storage.service';
import {
  WHATSAPP_QUEUE,
  type AiReplyJob,
  type OutboundMessageJob,
} from '../queue-contracts';

/**
 * Fires 60s after each inbound TEXT message (see webhook-ingest.processor —
 * it enqueues with `delay: 60_000`). The processor:
 *
 *   1. Runs the orchestrator's `decide()` which itself rechecks every guard
 *      at fire-time (paid client, human-lockout window, newer inbound, etc.)
 *      so a human jumping in during those 60s correctly aborts the send.
 *   2. On AUTO: creates a QUEUED OUTBOUND WhatsAppMessage row + enqueues it
 *      via the existing outbound pipeline. sentByEmployeeId stays NULL so
 *      the bot's own messages don't re-trigger the human-lockout stamp.
 *   3. On SKIPPED: just logs to ai.runs for the cost dashboard / forensics.
 *   4. Persists ai.runs and bumps `thread.aiState` to the orchestrator's
 *      `nextAiState` so the funnel progresses turn-by-turn.
 *
 * Idempotency: `jobId` is the inboundMessageId, and ai.runs has a UNIQUE on
 * inboundMessageId. Duplicate enqueues / retries no-op safely.
 */
@Processor(WHATSAPP_QUEUE.AI_REPLY, { concurrency: 4 })
export class AiReplyProcessor extends WorkerHost {
  private readonly log = new Logger(AiReplyProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: OrchestratorService,
    private readonly openai: OpenAiService,
    private readonly storage: StorageService,
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
  ) {
    super();
  }

  override async process(job: Job<AiReplyJob>): Promise<void> {
    const { inboundMessageId, threadId, body } = job.data;

    // Skip if we've already recorded a run for this inbound (idempotency).
    const existingRun = await this.prisma.aiRun.findUnique({
      where: { inboundMessageId },
      select: { id: true },
    });
    if (existingRun) {
      this.log.debug(`ai.runs row already exists for ${inboundMessageId}, skipping`);
      return;
    }

    // Resolve the text to feed the orchestrator. For TEXT messages this is
    // just the body. For AUDIO voice notes we transcribe via Whisper here,
    // persist the transcript into message.body (so sales can read it later
    // on the chat panel), then pass the transcript downstream. Whisper
    // failure / no-rehost-yet → skip with a clear reason; BullMQ retries
    // pick it up automatically.
    let inboundText = body;
    const message = await this.prisma.whatsAppMessage.findUnique({
      where: { id: inboundMessageId },
      select: { id: true, type: true, body: true, mediaUrl: true, mediaMimeType: true },
    });
    if (!message) {
      await this.prisma.aiRun.create({
        data: { threadId, inboundMessageId, mode: 'SKIPPED', skipReason: 'message-not-found' },
      });
      return;
    }
    if (message.type === 'AUDIO' && (!inboundText || !inboundText.trim())) {
      // Existing body wins if we already transcribed in a previous attempt.
      if (message.body?.trim()) {
        inboundText = message.body;
      } else {
        const transcript = await this.transcribeVoiceMessage(message);
        if (!transcript) {
          await this.prisma.aiRun.create({
            data: { threadId, inboundMessageId, mode: 'SKIPPED', skipReason: 'voice-transcription-failed' },
          });
          return;
        }
        inboundText = transcript;
        // Persist so sales sees the transcript on the chat panel + so a
        // retry doesn't pay for another Whisper call.
        await this.prisma.whatsAppMessage.update({
          where: { id: inboundMessageId },
          data: { body: transcript },
        });
      }
    }
    if (!inboundText || inboundText.trim().length < 2) {
      await this.prisma.aiRun.create({
        data: { threadId, inboundMessageId, mode: 'SKIPPED', skipReason: 'empty-after-transcription' },
      });
      return;
    }

    const decision = await this.orchestrator.decide({
      threadId,
      inboundMessageId,
      inboundText,
    });

    if (decision.mode === 'SKIPPED') {
      await this.prisma.aiRun.create({
        data: {
          threadId,
          inboundMessageId,
          mode: 'SKIPPED',
          skipReason: decision.skipReason ?? 'unknown',
        },
      });
      return;
    }

    // AUTO — enqueue an outbound message via the existing send pipeline.
    const thread = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: { id: true, channelId: true, leadId: true, clientId: true, windowExpiresAt: true },
    });
    if (!thread) {
      await this.prisma.aiRun.create({
        data: {
          threadId,
          inboundMessageId,
          mode: 'SKIPPED',
          skipReason: 'thread-vanished',
        },
      });
      return;
    }

    // 24-hour window check — free-form bot replies need the window open.
    // If closed, log + skip (a template would have to be sent by a human).
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= Date.now()) {
      await this.prisma.aiRun.create({
        data: {
          threadId,
          inboundMessageId,
          mode: 'SKIPPED',
          skipReason: 'window-closed',
        },
      });
      return;
    }

    const outbound = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'QUEUED',
        body: decision.reply ?? '',
        // Bot messages: NULL sentByEmployeeId. The "human-active" guard
        // keys off sentByEmployeeId NOT NULL so this never self-locks.
        sentByEmployeeId: null,
        payload: { aiBot: true } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.outboundQueue.add(
      'send',
      { messageId: outbound.id },
      { jobId: outbound.id },
    );

    await this.prisma.aiRun.create({
      data: {
        threadId,
        inboundMessageId,
        mode: 'AUTO',
        model: decision.model ?? null,
        inputTokens: decision.inputTokens ?? null,
        outputTokens: decision.outputTokens ?? null,
        totalLatencyMs: decision.latencyMs ?? null,
        topMatchSimilarity: decision.topMatch?.similarity ?? null,
        outboundMessageId: outbound.id,
      },
    });

    // Advance the funnel phase on the thread for next turn's prompt.
    if (decision.nextAiState) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiState: decision.nextAiState },
      });
    }
  }

  /**
   * Pull the audio bytes for an inbound voice note + transcribe via Whisper.
   *
   * mediaUrl resolution (mirrors threads.controller.streamMedia):
   *   • starts with "meta:" → media-download hasn't run yet. Return null;
   *     the SKIP reason will be "voice-transcription-failed". BullMQ retries
   *     the job will pick up after rehost completes.
   *   • starts with "http"  → public CDN URL form, fetch with HTTP.
   *   • else                → raw S3/Supabase storage key, use StorageService.
   *
   * Returns null on any failure — the caller logs SKIPPED and we move on.
   */
  private async transcribeVoiceMessage(message: {
    id: string;
    mediaUrl: string | null;
    mediaMimeType: string | null;
  }): Promise<string | null> {
    if (!message.mediaUrl || message.mediaUrl.startsWith('meta:')) {
      this.log.debug(`voice ${message.id}: media not rehosted yet`);
      return null;
    }
    let bytes: Buffer | null = null;
    try {
      if (message.mediaUrl.startsWith('http')) {
        const r = await fetch(message.mediaUrl);
        if (!r.ok) {
          this.log.warn(`voice ${message.id}: http fetch returned ${r.status}`);
          return null;
        }
        bytes = Buffer.from(await r.arrayBuffer());
      } else {
        const d = await this.storage.download(message.mediaUrl);
        bytes = d.bytes;
      }
    } catch (e) {
      this.log.warn(`voice ${message.id}: bytes fetch failed: ${(e as Error).message}`);
      return null;
    }
    if (!bytes || bytes.length === 0) return null;

    // Pick a filename whose extension matches the codec so Whisper picks the
    // right decoder. WhatsApp voice notes are Ogg/Opus; other audio is
    // commonly mp3/m4a. When uncertain default to .ogg.
    const ext = (message.mediaMimeType ?? '').includes('mp3')
      ? 'mp3'
      : (message.mediaMimeType ?? '').includes('m4a')
        ? 'm4a'
        : 'ogg';
    const res = await this.openai.transcribe(bytes, `voice-${message.id}.${ext}`);
    return res?.text?.trim() || null;
  }
}
