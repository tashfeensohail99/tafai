import { Module } from '@nestjs/common';
import { WhatsAppCryptoModule } from './crypto/crypto.module';
import { WhatsAppMetaModule } from './meta/meta.module';
import { WhatsAppQueuesModule } from './queues/queues.module';
import { WhatsAppProcessorsModule } from './queues/processors/processors.module';
import { WhatsAppRoutingModule } from './routing/routing.module';
import { WhatsAppRealtimeModule } from './realtime/realtime.module';
import { WhatsAppChannelsModule } from './channels/channels.module';
import { WhatsAppWebhooksModule } from './webhooks/webhooks.module';
import { WhatsAppPresenceModule } from './presence/presence.module';
import { WhatsAppThreadsModule } from './threads/threads.module';
import { WhatsAppMessagesModule } from './messages/messages.module';
import { WhatsAppNotificationsModule } from './notifications/notifications.module';
import { WhatsAppTemplatesModule } from './templates/templates.module';

/**
 * Root WhatsApp module. Composes the entire integration.
 *
 *   crypto      AES-256-GCM for stored Meta access tokens
 *   meta        Cloud API client + HMAC signature verifier
 *   queues      BullMQ wiring (6 queues registered)
 *   processors  Worker implementations bound to the queues
 *   routing     Sticky + round-robin assignment, business-hours math
 *   realtime    Socket.IO gateway + Redis publisher (org-scoped pub/sub)
 *   channels    Admin endpoints for WABA channels
 *   webhooks    Public Meta webhook receiver
 *   presence    Agent online/away/offline + heartbeat + manager view
 *   threads     Agent inbox API (list / detail / mark-read)
 *   messages    Agent send API (text within 24h window, templates always)
 */
@Module({
  imports: [
    WhatsAppCryptoModule,
    WhatsAppMetaModule,
    WhatsAppQueuesModule,
    WhatsAppRoutingModule,
    WhatsAppRealtimeModule,
    WhatsAppProcessorsModule,
    WhatsAppChannelsModule,
    WhatsAppWebhooksModule,
    WhatsAppPresenceModule,
    WhatsAppThreadsModule,
    WhatsAppMessagesModule,
    WhatsAppNotificationsModule,
    WhatsAppTemplatesModule,
  ],
})
export class WhatsAppModule {}
