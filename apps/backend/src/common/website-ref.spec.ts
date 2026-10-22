import { inboundWhatsAppLeadAttribution, parseWebsiteRef, WEBSITE_WHATSAPP_SOURCE } from './website-ref';
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
