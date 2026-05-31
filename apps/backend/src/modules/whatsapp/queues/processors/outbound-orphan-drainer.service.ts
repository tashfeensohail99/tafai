import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { WHATSAPP_QUEUE, type OutboundMessageJob } from '../queue-contracts';

/**
 * Boot-time sweep that picks up OUTBOUND WhatsApp messages stuck in QUEUED
 * status without a matching Redis job. This happens when a row gets written
 * to the DB but the BullMQ enqueue never landed — typically because a
 * maintenance script ran from outside the Railway VPC (Redis is on the
 * internal network only), or because the backend crashed between the DB
 * commit and `queue.add()`.
 *
 * Runs once per backend boot. Idempotent — re-using the messageId as the
 * jobId means BullMQ silently dedupes if the job is already there.
 *
 * Bounds:
 *   - direction = OUTBOUND, status = QUEUED, sentByEmployeeId IS NULL.
 *     Manual agent sends enqueue inline in the same request handler, so an
 *     orphan would only happen on a hard crash — and we'd rather not surprise-
 *     resend a 2-week-old draft on a deploy. System-originated messages
 *     (bot, scripts, notifiers) are the realistic case.
 *   - createdAt within the last 7 days. Long-stale rows aren't safe to
 *     suddenly fire off.
 *   - hard cap 500. If there are more, the next boot picks up the rest;
 *     stops a runaway from choking the queue right at startup.
 *
 * Same logic backs the manual POST /whatsapp/threads/requeue-orphans
 * endpoint — this service just calls the same shape on boot so you don't
 * have to remember to hit it.
 */
@Injectable()
export class OutboundOrphanDrainerService implements OnApplicationBootstrap {
  private readonly log = new Logger(OutboundOrphanDrainerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundQueue: Queue<OutboundMessageJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const orphans = await this.prisma.whatsAppMessage.findMany({
        where: {
          direction: 'OUTBOUND',
          status: 'QUEUED',
          sentByEmployeeId: null,
          createdAt: { gte: cutoff },
        },
        orderBy: { createdAt: 'asc' },
        take: 500,
        select: { id: true },
      });
      if (orphans.length === 0) {
        this.log.log('boot drain: no orphaned QUEUED outbound messages');
        return;
      }
      let added = 0;
      for (const m of orphans) {
        try {
          await this.outboundQueue.add('send', { messageId: m.id }, { jobId: m.id });
          added++;
        } catch {
          // Job already exists for this id — exactly the dedupe we want.
        }
      }
      this.log.log(
        `boot drain: enqueued ${added} orphaned outbound message(s) (of ${orphans.length} found)`,
      );
    } catch (e) {
      // Boot must not block on this. Worst case the next manual call to the
      // requeue endpoint picks up what we missed.
      this.log.warn(`boot drain failed: ${(e as Error).message}`);
    }
  }
}
