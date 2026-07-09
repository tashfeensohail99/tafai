import { Module } from '@nestjs/common';
import { WhatsAppWebhooksController } from './webhooks.controller';
import { WebhookEventRetentionService } from './webhook-retention.service';

@Module({
  controllers: [WhatsAppWebhooksController],
  // Daily prune of the raw-payload webhook_events table (was unbounded).
  providers: [WebhookEventRetentionService],
})
export class WhatsAppWebhooksModule {}
