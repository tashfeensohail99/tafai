/**
 * BullMQ queue for Meta Lead Ads processing. The WhatsApp webhook receiver and
 * its ingest worker share one public callback URL with WhatsApp (Meta allows
 * only one per app); when a `page`/`leadgen` event arrives it's forked onto
 * THIS queue, processed by MetaLeadgenProcessor in the meta-leads module.
 */
export const META_LEADGEN_QUEUE = 'meta-leadgen';

export interface MetaLeadgenJob {
  /** The persisted WhatsAppWebhookEvent row (object='page') to process. */
  webhookEventId: string;
}
