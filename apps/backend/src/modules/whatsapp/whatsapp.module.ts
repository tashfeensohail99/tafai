import { Module } from '@nestjs/common';
import { WhatsAppCryptoModule } from './crypto/crypto.module';
import { WhatsAppMetaModule } from './meta/meta.module';
import { WhatsAppQueuesModule } from './queues/queues.module';
import { WhatsAppRoutingModule } from './routing/routing.module';
import { WhatsAppChannelsModule } from './channels/channels.module';
import { WhatsAppWebhooksModule } from './webhooks/webhooks.module';

/**
 * Root WhatsApp module — composes every sub-module of the WhatsApp Business
 * Cloud API integration. Imported once in `app.module.ts`.
 *
 * Sub-modules:
 *   crypto    — AES-256-GCM for stored access tokens
 *   meta      — Cloud API client + webhook HMAC verification
 *   queues    — BullMQ wiring for inbound ingest, outbound, media, templates
 *   routing   — sticky + round-robin assignment, business-hours math
 *   channels  — admin endpoints to connect / pause WABA numbers
 *   webhooks  — public webhook receiver
 *
 * Still TODO (Phase 3 follow-up):
 *   - queue processors (ingest / outbound) — they live in workers
 *   - threads.service / messages.service for sales-agent endpoints
 *   - presence module (heartbeat + auto-derive)
 *   - realtime gateway (Socket.IO) for inbox push
 *   - templates + campaigns admin
 */
@Module({
  imports: [
    WhatsAppCryptoModule,
    WhatsAppMetaModule,
    WhatsAppQueuesModule,
    WhatsAppRoutingModule,
    WhatsAppChannelsModule,
    WhatsAppWebhooksModule,
  ],
})
export class WhatsAppModule {}
