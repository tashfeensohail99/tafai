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
  // CSV auto-drip — two-touch template outreach for CSV-imported leads.
  // touch 1 fires ~on import (small stagger), touch 2 ~40h later ONLY if the
  // lead hasn't replied. The processor re-checks every guard at fire-time
  // (opted-out, blocked, recently-active, per-channel daily cap, replied).
  CSV_DRIP: 'whatsapp-csv-drip',
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

export interface CsvDripJob {
  leadId: string;
  // Which of the two touches this job is. touch 1 also schedules touch 2.
  touch: 1 | 2;
  // touch1 send time (ms epoch), carried on the touch-2 job so its "has the
  // lead replied since touch 1?" guard needs no extra lookup.
  touch1At?: number;
  // Incremented each time the per-channel daily cap defers this touch, so the
  // processor can give up after a bounded number of re-checks.
  deferrals?: number;
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
  // Outbound (business-initiated): the user accepted; carries their SDP answer
  // for the initiating rep's browser to apply as the remote description.
  CALL_ANSWERED: 'whatsapp.call.answered',
  // A DIFFERENT device of the same rep answered this inbound call — their other
  // still-ringing clients (e.g. the web CallDock while they picked up on the
  // phone) use this to stop ringing. Payload: { callId }.
  CALL_ANSWERED_ELSEWHERE: 'whatsapp.call.answered_elsewhere',
  // A call-permission request was answered (granted/rejected) — UI hint refresh.
  CALL_PERMISSION: 'whatsapp.call.permission',
} as const;

export type WhatsAppWsEvent = (typeof WHATSAPP_WS_EVENTS)[keyof typeof WHATSAPP_WS_EVENTS];

// Redis pub/sub channel naming — one channel per organization for fanout to
// every connected agent in that org.
export const redisOrgChannel = (organizationId: string): string =>
  `whatsapp:org:${organizationId}`;

// Per-employee channel — used to ring ONE rep (e.g. an inbound call routed to
// the assigned salesperson) without broadcasting signaling to the whole org.
export const redisEmpChannel = (employeeId: string): string =>
  `whatsapp:emp:${employeeId}`;
