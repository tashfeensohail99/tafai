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

/**
 * The site's free tools send a fixed token instead of a page hash — the CRS and
 * FSW calculators are permanent-residence questions, the refusal decoder a
 * re-application one.
 */
const TOOL_TO_SERVICE: Readonly<Record<string, ServiceTypeCode>> = {
  CRS: 'PR_CASE',
  FSW: 'PR_CASE',
  RF: 'JR_RESUBMISSION',
};

const WEBSITE_REF_RE = /\[Ref:\s*(?:(WP|VV|JR|SV)-([0-9A-Z]{4})|(CRS|FSW|RF)-TOOL)\]/i;

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
  if (m[3]) {
    const tool = m[3].toUpperCase();
    return { ref: `${tool}-TOOL`, serviceInterest: TOOL_TO_SERVICE[tool]! };
  }
  const prefix = m[1]!.toUpperCase();
  return { ref: `${prefix}-${m[2]!.toUpperCase()}`, serviceInterest: PREFIX_TO_SERVICE[prefix]! };
}

const websiteNote = (ref: string) => `Came from the website's WhatsApp button (ref ${ref}).`;

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
    notes: websiteNote(website.ref),
  };
}

/**
 * How long after a WhatsApp lead is auto-created a website ref in a LATER
 * message still re-attributes it. Long enough for "Hi" now, pre-filled message
 * after lunch; short enough that a months-old lead who happens to visit the
 * site keeps the source it actually came from.
 */
export const LATE_WEBSITE_REF_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The lead fields lateWebsiteRefAttribution reads. */
export interface LeadForLateWebsiteRef {
  sourceChannel: string | null;
  createdAt: Date;
  convertedAt: Date | null;
  metaSource: string | null;
  metaAdId: string | null;
  serviceInterest: string | null;
  notes: string | null;
}

/**
 * Website attribution for an EXISTING lead, when the site's ref arrives in a
 * later message rather than the first.
 *
 * In production most website visitors send a short "Hi" before the button's
 * pre-filled text, so the lead is created from the "Hi" as plain 'whatsapp' and
 * inboundWhatsAppLeadAttribution never sees the ref (2026-10-23: every website
 * chat after #475 shipped arrived this way). This re-attributes such a lead —
 * and only such a lead:
 *
 *  - it is still the auto-created 'whatsapp' source (any other source — an
 *    earlier website tag, a walk-in, a referral — stays untouched);
 *  - no Meta ad started the chat (first touch wins: the ad keeps the credit);
 *  - it has not converted;
 *  - it was created within LATE_WEBSITE_REF_WINDOW_MS.
 *
 * Owner, status and round-robin are not touched — only the source, the service
 * if Sales hasn't set one, and the ref note. 'whatsapp-website' is in the same
 * daily-cap source list as 'whatsapp', so the cap counts don't move. Returns
 * the update, or null to leave the lead as it is.
 */
export function lateWebsiteRefAttribution(
  lead: LeadForLateWebsiteRef,
  messageText: string | null | undefined,
  now: Date,
): { sourceChannel: string; serviceInterest?: ServiceTypeCode; notes: string } | null {
  const website = parseWebsiteRef(messageText);
  if (!website) return null;
  if (lead.sourceChannel !== 'whatsapp') return null;
  if (lead.metaSource || lead.metaAdId) return null;
  if (lead.convertedAt) return null;
  if (now.getTime() - lead.createdAt.getTime() > LATE_WEBSITE_REF_WINDOW_MS) return null;

  const note = websiteNote(website.ref);
  return {
    sourceChannel: WEBSITE_WHATSAPP_SOURCE,
    ...(lead.serviceInterest ? {} : { serviceInterest: website.serviceInterest }),
    notes: !lead.notes ? note : lead.notes.includes(note) ? lead.notes : `${lead.notes}\n${note}`,
  };
}
