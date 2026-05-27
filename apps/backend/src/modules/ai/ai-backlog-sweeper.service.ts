import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WHATSAPP_QUEUE, type AiReplyJob } from '../whatsapp/queues/queue-contracts';

/**
 * Periodic safety-net sweep that picks up unanswered customer messages
 * approaching the WhatsApp 24-hour customer-service window deadline.
 *
 * Normal flow: every new inbound enqueues an AI reply job with a 60-second
 * delay. When that job fires, the orchestrator checks whether a human
 * agent has replied to (or after) this specific inbound — if yes, sales
 * has it; if no, the bot replies. That handles ~all messages within
 * the first minute.
 *
 * This sweeper catches the edge cases where the 60s flow didn't fire:
 *   - Backend was crashing / queue was paused at the inbound time
 *   - AI was disabled on the thread when the inbound landed, then
 *     re-enabled later
 *   - The job got dropped for any other operational reason
 *
 * Strategy:
 *   1. Look for OPEN threads with `windowExpiresAt > now` (still in WA
 *      customer window) and `aiEnabled = true`.
 *   2. Latest INBOUND on the thread must be older than {@link STALE_AFTER_MS}
 *      so we only catch genuinely-stale messages (not freshly-arrived ones
 *      that are already in the 60s debounce flow).
 *   3. No human OUTBOUND since that inbound — if sales already replied,
 *      we leave it.
 *   4. No existing AI run for that message id — the `inboundMessageId`
 *      unique constraint would block a duplicate anyway, but the check
 *      avoids enqueueing wasted work.
 *
 * Idempotent: every guard above is re-checked by the orchestrator at job
 * fire-time, so a sweep firing simultaneously with the original 60s job
 * can't double-send.
 */
@Injectable()
export class AiBacklogSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AiBacklogSweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** How often the sweep runs. 30 min is enough — Case 1 is a safety net. */
  private static readonly INTERVAL_MS = 30 * 60 * 1000;
  /**
   * Inbound must be older than this to be picked up. Anything fresher is
   * already in the 60s debounce flow — we don't want to double-enqueue.
   * We deliberately use a value just past the debounce (5 min) so the
   * sweep catches operational misses quickly, not just at hour 20.
   */
  private static readonly STALE_AFTER_MS = 5 * 60 * 1000;
  /** Per-sweep cap so a backlog spike can't burst the OpenAI rate limiter. */
  private static readonly MAX_ENQUEUE_PER_SWEEP = 50;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.AI_REPLY)
    private readonly aiReplyQueue: Queue<AiReplyJob>,
  ) {}

  onModuleInit(): void {
    // First sweep deferred a bit so it doesn't fight startup work.
    setTimeout(() => {
      void this.sweep().catch((e) =>
        this.log.warn(`first AI backlog sweep failed: ${(e as Error).message}`),
      );
    }, 30_000);
    this.timer = setInterval(() => {
      void this.sweep().catch((e) =>
        this.log.warn(`AI backlog sweep failed: ${(e as Error).message}`),
      );
    }, AiBacklogSweeperService.INTERVAL_MS);
    this.log.log(
      `AI backlog sweeper started (every ${AiBacklogSweeperService.INTERVAL_MS / 60000} min, stale-after=${AiBacklogSweeperService.STALE_AFTER_MS / 60000} min)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sweep(): Promise<void> {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - AiBacklogSweeperService.STALE_AFTER_MS);

    const threads = await this.prisma.whatsAppThread.findMany({
      where: {
        status: 'OPEN',
        aiEnabled: true,
        windowExpiresAt: { gt: now },
        responseDeadlineAt: { not: null },
        clientId: null,
        lead: { is: { convertedClientId: null, deletedAt: null } },
      },
      select: { id: true },
      take: 500, // hard cap on candidates per pass
    });

    let enqueued = 0;
    for (const thread of threads) {
      if (enqueued >= AiBacklogSweeperService.MAX_ENQUEUE_PER_SWEEP) break;

      const latestInbound = await this.prisma.whatsAppMessage.findFirst({
        where: { threadId: thread.id, direction: 'INBOUND', type: 'TEXT' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, body: true },
      });
      if (!latestInbound || !(latestInbound.body ?? '').trim()) continue;
      // Too fresh: the standard 60s flow is still in progress for this one.
      if (latestInbound.createdAt > staleCutoff) continue;

      // Sales already replied since this inbound? Leave it alone.
      const humanReplyAfter = await this.prisma.whatsAppMessage.findFirst({
        where: {
          threadId: thread.id,
          direction: 'OUTBOUND',
          sentByEmployeeId: { not: null },
          createdAt: { gt: latestInbound.createdAt },
        },
        select: { id: true },
      });
      if (humanReplyAfter) continue;

      // Already processed by AI (any mode)? Skip — the unique constraint on
      // ai.runs.inboundMessageId would reject the duplicate anyway, but the
      // check avoids enqueueing pointless work.
      const existingRun = await this.prisma.aiRun.findUnique({
        where: { inboundMessageId: latestInbound.id },
        select: { id: true },
      });
      if (existingRun) continue;

      await this.aiReplyQueue.add(
        'reply',
        {
          inboundMessageId: latestInbound.id,
          threadId: thread.id,
          body: latestInbound.body!,
        },
        {
          jobId: `ai-${latestInbound.id}`,
          // Stagger so a 50-thread sweep doesn't burst OpenAI calls.
          delay: 2_000 + enqueued * 1_500,
          attempts: 2,
          removeOnComplete: { age: 3600, count: 500 },
          removeOnFail: { age: 24 * 3600, count: 500 },
        },
      );
      enqueued++;
    }

    if (enqueued > 0) {
      this.log.log(`backlog sweep enqueued ${enqueued} bot replies`);
    }
  }
}
