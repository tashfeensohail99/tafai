import type { ServiceTypeCode } from './service-types';

/**
 * Website → WhatsApp attribution.
 *
 * Every WhatsApp button on the public marketing site
 * (tashfeenimmigrationsolutions.com) opens WhatsApp with a pre-filled message
 * that ends in a ref token, e.g.
 *
 *   "Hi, I'd like to ask about immigrating to Canada. [Ref: WP-7K2M]"
 *
 * The prefix is the service the button sits on; the 4-character code is a
 * stable hash of the page slug (see the site's `lib/wa.ts`). The token in the
 * message TEXT is the only thing that survives browser → Meta → our webhook —
 * the webhook sees nothing but the sender's number and what they sent. Without
 * reading it, a website chat lands as a plain `whatsapp` lead, indistinguishable
 * from cold WhatsApp traffic.
 */

/**
 * sourceChannel for a lead whose FIRST WhatsApp message carried a website ref.
 *
 * Deliberately NOT the form's 'WEBSITE': these leads are still live WhatsApp
 * round-robin leads, so they must keep counting toward the daily lead cap
 * (ONLINE_ROUND_ROBIN_SOURCE_CHANNELS) and keep classifying as Auto-CRM —
 * 'whatsapp-website' contains both the 'whatsapp' and 'web' keywords. The
 * Sales UI maps it into its WEBSITE source bucket.
 */
export const WEBSITE_WHATSAPP_SOURCE = 'whatsapp-website';

/** Ref prefix → canonical service code (mirrors the site's REF_PREFIX map). */
const PREFIX_TO_SERVICE: Readonly<Record<string, ServiceTypeCode>> = {
  WP: 'WORK_PERMIT',
  VV: 'VISIT_VISA',
  JR: 'JR_RESUBMISSION',
  SV: 'STUDY_VISA',
};

const WEBSITE_REF_RE = /\[Ref:\s*(WP|VV|JR|SV)-([0-9A-Z]{4})\]/i;

export interface WebsiteRef {
  /** Normalised token, e.g. 'WP-7K2M'. */
  ref: string;
  serviceInterest: ServiceTypeCode;
}

/** Pull a website ref token out of a message, or null if there isn't one. */
export function parseWebsiteRef(text: string | null | undefined): WebsiteRef | null {
  if (!text) return null;
  const m = WEBSITE_REF_RE.exec(text);
  if (!m) return null;
  const prefix = m[1]!.toUpperCase();
  return { ref: `${prefix}-${m[2]!.toUpperCase()}`, serviceInterest: PREFIX_TO_SERVICE[prefix]! };
}

/**
 * The attribution fields for a lead auto-created from an inbound WhatsApp
 * message. With a website ref: the website source, the service the button was
 * for, and a note with the ref so the page can be traced. Without one: exactly
 * what the webhook always wrote.
 */
export function inboundWhatsAppLeadAttribution(firstMessageText: string | null | undefined): {
  sourceChannel: string;
  serviceInterest?: ServiceTypeCode;
  notes?: string;
} {
  const website = parseWebsiteRef(firstMessageText);
  if (!website) return { sourceChannel: 'whatsapp' };
  return {
    sourceChannel: WEBSITE_WHATSAPP_SOURCE,
    serviceInterest: website.serviceInterest,
    notes: `Came from the website's WhatsApp button (ref ${website.ref}).`,
  };
}
