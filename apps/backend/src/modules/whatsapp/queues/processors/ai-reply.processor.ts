import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { OrchestratorService } from '../../../ai/orchestrator.service';
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

    const decision = await this.orchestrator.decide({
      threadId,
      inboundMessageId,
      inboundText: body,
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
}
