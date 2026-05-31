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

    // IMAGE / DOCUMENT inbound — bot doesn't try to read the file. It just
    // sends one canned acknowledgement so the customer knows we got it,
    // parks the thread in HANDED_OFF, and gets out of the way so sales can
    // review the actual content. Falls through the rest of the guards
    // (window open, paid client, etc.) — same safety net as TEXT.
    if (message.type === 'IMAGE' || message.type === 'DOCUMENT') {
      await this.sendMediaAcknowledgement(threadId, inboundMessageId, message.type);
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

    // AUTO or OPT_OUT — both want to send an outbound message. OPT_OUT
    // additionally flips thread.aiEnabled to false so the bot stays out
    // for good (it's the customer asking us to stop).
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

    // If a brochure is going out, override the LLM's text with a clean,
    // concise "here it is" instead of whatever the model improvised — this
    // way the text + the document tell a consistent story regardless of
    // what the model originally wrote.
    const textBody = decision.attachBrochure
      ? brochureHandoffText(decision.language ?? 'en')
      : (decision.reply ?? '');

    const outbound = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'QUEUED',
        body: textBody,
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

    // Follow-up brochure send: signed URL from storage → outbound DOCUMENT
    // message. The existing outbound processor will dispatch this via the
    // Meta Cloud API using the `link` form (no need to upload to Meta).
    // Marker in payload (`brochureProgramKey`) lets the orchestrator's
    // dedup query skip re-sending the same brochure on this thread.
    if (decision.attachBrochure) {
      try {
        const signedUrl = await this.storage.getSignedUrl(decision.attachBrochure.s3Key);
        const brochureMsg = await this.prisma.whatsAppMessage.create({
          data: {
            threadId: thread.id,
            channelId: thread.channelId,
            leadId: thread.leadId,
            clientId: thread.clientId,
            direction: 'OUTBOUND',
            type: 'DOCUMENT',
            status: 'QUEUED',
            mediaUrl: signedUrl,
            mediaMimeType: decision.attachBrochure.mimeType,
            sentByEmployeeId: null,
            payload: {
              aiBot: true,
              brochureProgramKey: decision.attachBrochure.programKey,
              filename: decision.attachBrochure.displayTitle,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        await this.outboundQueue.add(
          'send',
          { messageId: brochureMsg.id },
          { jobId: brochureMsg.id },
        );
      } catch (err) {
        // Brochure attach is best-effort. The text reply already went out —
        // if the document fails the customer still gets the prose, which
        // says we're sending it. The dedup query won't skip next time so a
        // retry on the next message could succeed.
        this.log.warn(`brochure attach failed: ${(err as Error).message}`);
      }
    }

    await this.prisma.aiRun.create({
      data: {
        threadId,
        inboundMessageId,
        // OPT_OUT is logged distinctly from AUTO so the admin panel can show
        // when a customer told us to stop.
        mode: decision.mode === 'OPT_OUT' ? 'OPT_OUT' : 'AUTO',
        model: decision.model ?? null,
        inputTokens: decision.inputTokens ?? null,
        outputTokens: decision.outputTokens ?? null,
        totalLatencyMs: decision.latencyMs ?? null,
        topMatchSimilarity: decision.topMatch?.similarity ?? null,
        outboundMessageId: outbound.id,
      },
    });

    // OPT_OUT: silence the bot on this thread permanently. The customer
    // asked us to stop — honoring that is a regulatory + trust requirement.
    // Sales can manually flip aiEnabled back on if needed.
    if (decision.mode === 'OPT_OUT') {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: {
          aiEnabled: false,
          aiState: 'HANDED_OFF',
        },
      });
      return;
    }

    // Advance the funnel phase on the thread for next turn's prompt.
    if (decision.nextAiState) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiState: decision.nextAiState },
      });
    }
  }

  /**
   * Send one canned acknowledgement when the customer drops an IMAGE or
   * DOCUMENT on us. The bot doesn't try to read the file — that's the
   * manager's job. We park the thread in HANDED_OFF afterwards so the bot
   * doesn't keep replying turn after turn.
   *
   * Respects every per-thread guard via a focused mini-decide call: bot
   * enabled, window open, not paid client, no recent human reply, AI not
   * disabled on this thread. If any of those fail, we log SKIPPED with the
   * orchestrator's reason and don't send anything.
   */
  private async sendMediaAcknowledgement(
    threadId: string,
    inboundMessageId: string,
    messageType: 'IMAGE' | 'DOCUMENT',
  ): Promise<void> {
    // Run the orchestrator with a fake text payload purely to reuse its
    // pre-flight guards. If it would skip, we skip the same way.
    const fakeText = messageType === 'IMAGE' ? '[image]' : '[document]';
    const decision = await this.orchestrator.decide({
      threadId,
      inboundMessageId,
      inboundText: fakeText,
    });
    if (decision.mode === 'SKIPPED') {
      await this.prisma.aiRun.create({
        data: {
          threadId,
          inboundMessageId,
          mode: 'SKIPPED',
          skipReason: decision.skipReason ?? `media-ack-skipped`,
        },
      });
      return;
    }

    // The orchestrator's compose may already produce a reasonable reply,
    // but for media we override with a canned acknowledgement so the bot
    // doesn't accidentally answer based on a hallucinated read of the
    // (unread) media. Pick language from the orchestrator's detection.
    const ack = mediaAckText(decision.language ?? 'en', messageType);

    const thread = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: { id: true, channelId: true, leadId: true, clientId: true, windowExpiresAt: true },
    });
    if (!thread) return;
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= Date.now()) {
      await this.prisma.aiRun.create({
        data: { threadId, inboundMessageId, mode: 'SKIPPED', skipReason: 'window-closed' },
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
        body: ack,
        sentByEmployeeId: null,
        payload: { aiBot: true, mediaAck: true } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.outboundQueue.add('send', { messageId: outbound.id }, { jobId: outbound.id });

    await this.prisma.aiRun.create({
      data: {
        threadId,
        inboundMessageId,
        mode: 'AUTO',
        model: 'canned-media-ack',
        outboundMessageId: outbound.id,
      },
    });

    // Park the thread so subsequent inbounds don't keep getting bot replies
    // until a human takes over. Sales picks up from here.
    await this.prisma.whatsAppThread.update({
      where: { id: thread.id },
      data: { aiState: 'HANDED_OFF' },
    });
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

/**
 * Canned acknowledgement text for an inbound IMAGE or DOCUMENT. Short and
 * friendly — explicitly says a human will look at it so the customer
 * doesn't think the bot has read their passport / salary slip.
 */
function mediaAckText(
  language: string,
  messageType: 'IMAGE' | 'DOCUMENT',
): string {
  const what = messageType === 'IMAGE' ? 'image' : 'document';
  if (language === 'ur_roman' || language === 'ur') {
    const noun = messageType === 'IMAGE' ? 'tasveer' : 'document';
    return `Shukriya — aapki ${noun} mil gayi. Main review kar k jaldi reply karunga.`;
  }
  return `Thanks — got your ${what}. I'll review it and get back to you shortly.`;
}

/**
 * Override text we send right BEFORE the brochure attachment, so the message
 * + document tell a coherent story. The LLM's original reply may have said
 * "the manager will share it" — that conflicts with us attaching the file
 * ourselves, so we replace.
 */
function brochureHandoffText(language: string): string {
  if (language === 'ur_roman' || language === 'ur') {
    return 'Yeh raha brochure. Detail mein parh lijiyega, koi bhi sawal ho to btaiye!';
  }
  return "Here you go — the brochure is attached. Have a read and let me know if you have any questions!";
}
