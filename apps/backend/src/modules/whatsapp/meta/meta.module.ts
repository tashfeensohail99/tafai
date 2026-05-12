import { Global, Module } from '@nestjs/common';
import { WhatsAppMetaClientFactory } from './client.factory';
import { WhatsAppWebhookSignatureService } from './webhook-signature.service';

@Global()
@Module({
  providers: [WhatsAppMetaClientFactory, WhatsAppWebhookSignatureService],
  exports: [WhatsAppMetaClientFactory, WhatsAppWebhookSignatureService],
})
export class WhatsAppMetaModule {}
