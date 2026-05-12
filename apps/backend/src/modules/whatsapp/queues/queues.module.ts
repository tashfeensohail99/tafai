import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WHATSAPP_QUEUE } from './queue-contracts';

const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
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
          redis: {
            host: url.hostname,
            port: parseInt(url.port || '6379', 10),
            password: url.password || undefined,
            username: url.username || undefined,
            // BullMQ requires this for blocking commands.
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
    ),
  ],
  exports: [BullModule],
})
export class WhatsAppQueuesModule {}
