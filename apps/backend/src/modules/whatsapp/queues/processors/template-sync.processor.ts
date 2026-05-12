import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  WhatsAppTemplateCategory,
  WhatsAppTemplateStatus,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { WhatsAppMetaClientFactory } from '../../meta/client.factory';
import { WHATSAPP_QUEUE, type TemplateSyncJob } from '../queue-contracts';

interface MetaTemplate {
  name: string;
  language: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: unknown;
  quality_score?: { score?: string };
  rejected_reason?: string;
}

/**
 * Pulls the full template list from Meta for a given WABA channel and mirrors
 * it into `whatsapp.templates`. Idempotent (upsert by channel+name+language).
 *
 * Trigger this when an admin clicks "Sync templates" or on a daily schedule.
 */
@Processor(WHATSAPP_QUEUE.TEMPLATE_SYNC, { concurrency: 2 })
export class TemplateSyncProcessor extends WorkerHost {
  private readonly log = new Logger(TemplateSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaFactory: WhatsAppMetaClientFactory,
  ) {
    super();
  }

  override async process(job: Job<TemplateSyncJob>): Promise<void> {
    const { channelId } = job.data;
    const channel = await this.prisma.whatsAppChannel.findUnique({ where: { id: channelId } });
    if (!channel) {
      this.log.warn(`template-sync: channel ${channelId} not found`);
      return;
    }
    const client = this.metaFactory.forChannel(channel);
    const templates = (await client.listTemplates(channel.wabaId)) as MetaTemplate[];

    const now = new Date();
    for (const t of templates) {
      await this.prisma.whatsAppTemplate.upsert({
        where: {
          channelId_name_language: {
            channelId: channel.id,
            name: t.name,
            language: t.language,
          },
        },
        create: {
          channelId: channel.id,
          name: t.name,
          language: t.language,
          category: t.category as WhatsAppTemplateCategory,
          status: t.status as WhatsAppTemplateStatus,
          components: t.components as Prisma.InputJsonValue,
          qualityRating: t.quality_score?.score ?? null,
          rejectedReason: t.rejected_reason ?? null,
          lastSyncAt: now,
        },
        update: {
          category: t.category as WhatsAppTemplateCategory,
          status: t.status as WhatsAppTemplateStatus,
          components: t.components as Prisma.InputJsonValue,
          qualityRating: t.quality_score?.score ?? null,
          rejectedReason: t.rejected_reason ?? null,
          lastSyncAt: now,
        },
      });
    }
    await this.prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: { lastSyncAt: now },
    });
    this.log.log(`template-sync complete: ${templates.length} templates for channel ${channel.id}`);
  }
}
