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
  // AI bot reply — fired 60s after an inbound TEXT message so a human can
  // jump in first. The processor double-checks at fire-time and skips if
  // a human has since replied, a newer inbound landed, or the thread's AI
  // got disabled.
  AI_REPLY: 'whatsapp-ai-reply',
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

export interface AiReplyJob {
  inboundMessageId: string;
  threadId: string;
  body: string;
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
  // Response-SLA sweeper: a thread is approaching its reply deadline, or has
  // breached it. Frontends listening on the org channel surface a warning to
  // the assigned agent + admins.
  SLA_WARNING: 'whatsapp.sla.warning',
  SLA_BREACH: 'whatsapp.sla.breach',
  // Presence accountability: agent has been Away > 10 min, or Offline > 2h in
  // working hours (the latter also docks SLA points). Payload carries the
  // employeeId so the agent's own shell shows the warning popup.
  PRESENCE_AWAY_WARNING: 'whatsapp.presence.away_warning',
  PRESENCE_OFFLINE_PENALTY: 'whatsapp.presence.offline_penalty',
  // Inbound WhatsApp voice call routed to the assigned rep. Payload carries
  // callId, from, leadId/clientId, threadId so the agent's shell can ring/toast
  // (Phase 1 softphone). CALL_ENDED fires on terminate with the final duration.
  CALL_INCOMING: 'whatsapp.call.incoming',
  CALL_ENDED: 'whatsapp.call.ended',
} as const;

export type WhatsAppWsEvent = (typeof WHATSAPP_WS_EVENTS)[keyof typeof WHATSAPP_WS_EVENTS];

// Redis pub/sub channel naming — one channel per organization for fanout to
// every connected agent in that org.
export const redisOrgChannel = (organizationId: string): string =>
  `whatsapp:org:${organizationId}`;
