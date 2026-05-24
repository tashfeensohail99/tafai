import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WHATSAPP_QUEUE } from './queue-contracts';
import { META_LEADGEN_QUEUE } from '../../meta-leads/queue-contracts';

/**
 * BullMQ wiring for the WhatsApp module.
 *
 * Defaults applied to every job:
 *   attempts: 5 with exponential backoff (1s, 2s, 4s, 8s, 16s)
 *   completed jobs reaped after 1h or 1000 records
 *   failed jobs kept 24h or 5000 records for diagnostics
 *
 * Queues registered:
 *   webhook-ingest       Meta webhook payloads → create/find Lead, assign, fan out
 *   outbound-message     Outbound sends to Meta Cloud API
 *   media-download       Re-host inbound Meta media to R2/S3
 *   template-sync        Pull approved templates from Meta WABA
 *   campaign-dispatch    Phase 4 — expand a campaign into recipient jobs
 *   campaign-recipient   Phase 4 — send one recipient's template message
 */
const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 1_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 24 * 3_600, count: 5_000 },
};

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const url = new URL(cfg.get<string>('app.redis.url') ?? 'redis://localhost:6379');
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port || '6379', 10),
            ...(url.password ? { password: url.password } : {}),
            ...(url.username && url.username !== 'default' ? { username: url.username } : {}),
            // BullMQ workers need this for blocking commands (BRPOP).
            maxRetriesPerRequest: null,
          },
          defaultJobOptions: DEFAULT_JOB_OPTS,
        };
      },
    }),
    BullModule.registerQueue(
      { name: WHATSAPP_QUEUE.WEBHOOK_INGEST },
      { name: WHATSAPP_QUEUE.OUTBOUND_MESSAGE },
      { name: WHATSAPP_QUEUE.MEDIA_DOWNLOAD },
      { name: WHATSAPP_QUEUE.TEMPLATE_SYNC },
      { name: WHATSAPP_QUEUE.CAMPAIGN_DISPATCH },
      { name: WHATSAPP_QUEUE.CAMPAIGN_RECIPIENT },
      // Meta Lead Ads (forked off the shared webhook → meta-leads module).
      { name: META_LEADGEN_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class WhatsAppQueuesModule {}
