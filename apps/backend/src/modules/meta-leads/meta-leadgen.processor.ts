import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { META_LEADGEN_QUEUE, type MetaLeadgenJob } from './queue-contracts';
import { MetaLeadsService } from './meta-leads.service';

/**
 * Consumes leadgen jobs forked off the shared Meta webhook. Concurrency 1:
 * leadgen volume is low and serial processing keeps the dedupe + round-robin
 * cursor race-free without extra locking. Idempotency is guaranteed by the
 * unique leadgenId regardless.
 */
@Processor(META_LEADGEN_QUEUE, { concurrency: 1 })
export class MetaLeadgenProcessor extends WorkerHost {
  private readonly log = new Logger(MetaLeadgenProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaLeads: MetaLeadsService,
  ) {
    super();
  }

  override async process(job: Job<MetaLeadgenJob>): Promise<void> {
    const { webhookEventId } = job.data;
    const event = await this.prisma.whatsAppWebhookEvent.findUnique({
      where: { id: webhookEventId },
      select: { rawPayload: true },
    });
    if (!event) {
      this.log.warn(`webhook event ${webhookEventId} not found`);
      return;
    }

    const entries = this.metaLeads.parseWebhookPayload(event.rawPayload);
    if (entries.length === 0) {
      this.log.warn(`no leadgen entries in webhook event ${webhookEventId}`);
      return;
    }

    for (const entry of entries) {
      const res = await this.metaLeads.processLeadgen(entry);
      this.log.log(`leadgen ${entry.leadgenId}: ${res.status}${res.leadId ? ` (lead ${res.leadId})` : ''}`);
    }
  }
}
