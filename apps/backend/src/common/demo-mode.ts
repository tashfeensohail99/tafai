/**
 * DEMO_MODE — a single switch that turns this deployment into the sales demo:
 *
 *  - every outbound channel (WhatsApp / Messenger sends, email, push) is
 *    blocked at the lowest send step; message rows are still persisted so the
 *    demo inbox looks and behaves like production;
 *  - the ONLY exception is the "live lane": WhatsApp channels whose Meta
 *    phone_number_id is listed in DEMO_LIVE_PHONE_NUMBER_IDS. Those belong to
 *    a demo number a prospect messages from their own phone, so the AI reply
 *    must really go out;
 *  - the frontend reads `demoMode` from GET /config to show the banner and
 *    media placeholders.
 *
 * Read from process.env directly (like the rest of the kill switches in this
 * codebase) so it can be used before Nest DI is up.
 */
export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.DEMO_MODE ?? '').toLowerCase() === 'true';
}

export function demoLivePhoneNumberIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return String(env.DEMO_LIVE_PHONE_NUMBER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when outbound traffic on this Meta phone_number_id may really leave the box. */
export function isDemoLiveChannel(phoneNumberId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!phoneNumberId) return false;
  return demoLivePhoneNumberIds(env).includes(phoneNumberId);
}

/**
 * Outbound on this channel must be blocked: demo mode is on AND the channel is
 * not one of the live-lane numbers.
 */
export function isOutboundBlocked(phoneNumberId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return isDemoMode(env) && !isDemoLiveChannel(phoneNumberId, env);
}

/** Demo-facing brand (also used by the AI prompts + WhatsApp copy). */
export function brandName(env: NodeJS.ProcessEnv = process.env): string {
  return env.BRAND_NAME?.trim() || 'Tashfeen Immigration Solutions';
}

export function brandShortName(env: NodeJS.ProcessEnv = process.env): string {
  return env.BRAND_SHORT_NAME?.trim() || 'Tashfeen Immigration';
}

/** Marker stored in media columns instead of a real key; the UI blurs it. */
export const DEMO_MEDIA_PLACEHOLDER = 'demo:placeholder';

export function isDemoMediaPlaceholder(mediaUrl: string | null | undefined): boolean {
  return !!mediaUrl && (mediaUrl === DEMO_MEDIA_PLACEHOLDER || mediaUrl.startsWith('demo:') || mediaUrl.startsWith('meta:demo-'));
}
