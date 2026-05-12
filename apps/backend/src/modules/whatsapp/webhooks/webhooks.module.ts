import { Module } from '@nestjs/common';
import { WhatsAppWebhooksController } from './webhooks.controller';

@Module({
  controllers: [WhatsAppWebhooksController],
})
export class WhatsAppWebhooksModule {}
