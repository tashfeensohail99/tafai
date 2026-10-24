import {
  inboundWhatsAppLeadAttribution,
  LATE_WEBSITE_REF_WINDOW_MS,
  lateWebsiteRefAttribution,
  type LeadForLateWebsiteRef,
  parseWebsiteRef,
  WEBSITE_WHATSAPP_SOURCE,
} from './website-ref';
import { ONLINE_ROUND_ROBIN_SOURCE_CHANNELS } from './routing/daily-lead-cap';

describe('parseWebsiteRef', () => {
  // The exact text the live site's buttons pre-fill.
  it('reads the token the site appends to its pre-filled message', () => {
    expect(
      parseWebsiteRef('Hi, I’d like some advice about my immigration options. [Ref: WP-A6SG]'),
    ).toEqual({ ref: 'WP-A6SG', serviceInterest: 'WORK_PERMIT' });
  });

  it.each([
    ['[Ref: WP-7K2M]', 'WORK_PERMIT'],
    ['[Ref: VV-0A1B]', 'VISIT_VISA'],
    ['[Ref: JR-ZZ99]', 'JR_RESUBMISSION'],
    ['[Ref: SV-1234]', 'STUDY_VISA'],
  ])('maps %s → %s', (text, service) => {
    expect(parseWebsiteRef(text)?.serviceInterest).toBe(service);
  });

  // The site's free tools send a fixed token (components/tools/* on the site).
  it.each([
    ['[Ref: CRS-TOOL]', 'CRS-TOOL', 'PR_CASE'],
    ['[Ref: FSW-TOOL]', 'FSW-TOOL', 'PR_CASE'],
    ['[Ref: RF-TOOL]', 'RF-TOOL', 'JR_RESUBMISSION'],
  ])('reads the tool token %s', (text, ref, service) => {
    expect(parseWebsiteRef(`My score: 431\n\nI’d like to know my options.\n\n${text}`)).toEqual({ ref, serviceInterest: service });
  });

  it('tolerates a retyped token (case, spacing) and normalises it', () => {
    expect(parseWebsiteRef('hello [ref:wp-7k2m] thanks')).toEqual({ ref: 'WP-7K2M', serviceInterest: 'WORK_PERMIT' });
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['Hi, I want to apply for a work permit'],
    ['[Ref: XX-1234]'], // unknown prefix
    ['[Ref: WP-123]'], // code too short
    ['[Ref: WP-12345]'], // code too long
    ['Ref: WP-1234'], // no brackets
    ['[Ref: WP-12_4]'], // not base-36
    ['[Ref: XYZ-TOOL]'], // unknown tool
  ])('ignores %p', (text) => {
    expect(parseWebsiteRef(text)).toBeNull();
  });
});

describe('inboundWhatsAppLeadAttribution', () => {
  it('a website ref → website source, service and a traceable note', () => {
    expect(inboundWhatsAppLeadAttribution('Hi [Ref: VV-0A1B]')).toEqual({
      sourceChannel: 'whatsapp-website',
      serviceInterest: 'VISIT_VISA',
      notes: "Came from the website's WhatsApp button (ref VV-0A1B).",
    });
  });

  it('no ref → exactly what the webhook always wrote', () => {
    expect(inboundWhatsAppLeadAttribution('Salam, visa info?')).toEqual({ sourceChannel: 'whatsapp' });
    expect(inboundWhatsAppLeadAttribution(null)).toEqual({ sourceChannel: 'whatsapp' });
  });

  it('website WhatsApp leads still count toward the daily lead cap', () => {
    expect(ONLINE_ROUND_ROBIN_SOURCE_CHANNELS).toContain(WEBSITE_WHATSAPP_SOURCE);
  });

  it('website WhatsApp leads still classify as Auto-CRM (keyword match)', () => {
    // Same keywords as leads.service / the frontend deriveAssignmentType.
    expect(['whatsapp', 'web'].some((k) => WEBSITE_WHATSAPP_SOURCE.includes(k))).toBe(true);
  });
});

describe('lateWebsiteRefAttribution', () => {
  const now = new Date('2026-10-23T10:20:04Z');
  // The real shape seen in production: lead created from "Hi" two minutes before
  // the button's pre-filled message arrived.
  const fresh = (over: Partial<LeadForLateWebsiteRef> = {}): LeadForLateWebsiteRef => ({
    sourceChannel: 'whatsapp',
    createdAt: new Date('2026-10-23T10:18:14Z'),
    convertedAt: null,
    metaSource: null,
    metaAdId: null,
    serviceInterest: null,
    notes: null,
    ...over,
  });
  const REF = 'Hi, I’d like some advice about my immigration options. [Ref: WP-A6SG]';

  it('re-attributes a fresh auto-created lead to the website', () => {
    expect(lateWebsiteRefAttribution(fresh(), REF, now)).toEqual({
      sourceChannel: WEBSITE_WHATSAPP_SOURCE,
      serviceInterest: 'WORK_PERMIT',
      notes: "Came from the website's WhatsApp button (ref WP-A6SG).",
    });
  });

  it('keeps a service Sales already set, and appends the note to existing notes', () => {
    expect(lateWebsiteRefAttribution(fresh({ serviceInterest: 'STUDY_VISA', notes: 'Called back 10:30.' }), REF, now)).toEqual({
      sourceChannel: WEBSITE_WHATSAPP_SOURCE,
      notes: "Called back 10:30.\nCame from the website's WhatsApp button (ref WP-A6SG).",
    });
  });

  it('does not repeat a note that is already there', () => {
    const note = "Came from the website's WhatsApp button (ref WP-A6SG).";
    expect(lateWebsiteRefAttribution(fresh({ notes: note }), REF, now)?.notes).toBe(note);
  });

  it('still applies just inside the window', () => {
    const createdAt = new Date(now.getTime() - LATE_WEBSITE_REF_WINDOW_MS);
    expect(lateWebsiteRefAttribution(fresh({ createdAt }), REF, now)).not.toBeNull();
  });

  it.each<[string, Partial<LeadForLateWebsiteRef>]>([
    ['older than the window', { createdAt: new Date(now.getTime() - LATE_WEBSITE_REF_WINDOW_MS - 1) }],
    ['already a website lead', { sourceChannel: WEBSITE_WHATSAPP_SOURCE }],
    ['a different source (walk-in)', { sourceChannel: 'WALK_IN' }],
    ['a manual WhatsApp entry (not the auto-created source)', { sourceChannel: 'WHATSAPP' }],
    ['started by a click-to-WhatsApp ad', { metaSource: 'ctwa', metaAdId: '120210000000' }],
    ['ad id without source', { metaAdId: '120210000000' }],
    ['converted', { convertedAt: new Date('2026-10-23T10:19:00Z') }],
  ])('leaves the lead alone when %s', (_label, over) => {
    expect(lateWebsiteRefAttribution(fresh(over), REF, now)).toBeNull();
  });

  it('does nothing for a message without a ref', () => {
    expect(lateWebsiteRefAttribution(fresh(), 'Salam, visa info?', now)).toBeNull();
    expect(lateWebsiteRefAttribution(fresh(), null, now)).toBeNull();
  });
});
