import { Global, Module } from '@nestjs/common';
import { WhatsAppMetaClientFactory } from './client.factory';
import { WhatsAppWebhookSignatureService } from './webhook-signature.service';
import { CallingBootstrapService } from './calling-bootstrap.service';

@Global()
@Module({
  providers: [WhatsAppMetaClientFactory, WhatsAppWebhookSignatureService, CallingBootstrapService],
  exports: [WhatsAppMetaClientFactory, WhatsAppWebhookSignatureService],
})
export class WhatsAppMetaModule {}
