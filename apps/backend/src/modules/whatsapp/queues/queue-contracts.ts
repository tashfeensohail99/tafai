/**
 * BullMQ queue names + job payloads for the WhatsApp module. Single source of
 * truth — producers (services) and consumers (processors) both import here.
 */

// BullMQ disallows `:` in queue names (uses it as a Redis key separator).
export const WHATSAPP_QUEUE = {
  WEBHOOK_INGEST: 'whatsapp-webhook-ingest',
  OUTBOUND_MESSAGE: 'whatsapp-outbound-message',
  MEDIA_DOWNLOAD: 'whatsapp-media-download',
  TEMPLATE_SYNC: 'whatsapp-template-sync',
  CAMPAIGN_DISPATCH: 'whatsapp-campaign-dispatch',
  CAMPAIGN_RECIPIENT: 'whatsapp-campaign-recipient',
} as const;

export type WhatsAppQueueName = (typeof WHATSAPP_QUEUE)[keyof typeof WHATSAPP_QUEUE];

// ---- Job payloads --------------------------------------------------------

export interface WebhookIngestJob {
  webhookEventId: string;
}

export interface OutboundMessageJob {
  messageId: string;
  attempt?: number;
}

export interface MediaDownloadJob {
  messageId: string;
  metaMediaId: string;
}

export interface TemplateSyncJob {
  channelId: string;
}

export interface CampaignDispatchJob {
  campaignId: string;
}

export interface CampaignRecipientJob {
  campaignId: string;
  // For "every conversation IS a lead" model — recipients are Leads or Clients
  // by phone. We resolve at dispatch time.
  leadId?: string;
  clientId?: string;
  phone: string;
}

// ---- Realtime WebSocket events -------------------------------------------

export const WHATSAPP_WS_EVENTS = {
  MESSAGE_NEW: 'whatsapp.message.new',
  MESSAGE_STATUS: 'whatsapp.message.status',
  THREAD_UPDATED: 'whatsapp.thread.updated',
  THREAD_ASSIGNED: 'whatsapp.thread.assigned',
  PRESENCE_CHANGED: 'whatsapp.presence.changed',
} as const;

export type WhatsAppWsEvent = (typeof WHATSAPP_WS_EVENTS)[keyof typeof WHATSAPP_WS_EVENTS];

// Redis pub/sub channel naming — one channel per organization for fanout to
// every connected agent in that org.
export const redisOrgChannel = (organizationId: string): string =>
  `whatsapp:org:${organizationId}`;
