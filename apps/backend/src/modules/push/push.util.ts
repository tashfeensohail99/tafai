/**
 * Pure helpers for FCM HTTP v1 push. No Nest/Prisma/network here so the wire
 * format + auth-claim shaping stay unit-testable. The transport (token mint +
 * HTTPS POST) lives in PushService.
 *
 * We talk FCM HTTP v1 directly (no firebase-admin dependency): mint a short
 * OAuth token from the Google service-account JSON, then POST one message per
 * device token. FCM HTTP v1 also bridges to APNs, so the same path delivers to
 * iOS once an iOS app registers an FCM token — "APNs later" needs no backend
 * change, only a key uploaded in the Firebase console.
 */

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
  projectId: string;
}

/** Base64url (no padding) — used for the JWT header/claim segments. */
export function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Parse + validate a Google service-account JSON string. Returns null (rather
 * than throwing) for anything unusable so the caller can simply no-op push.
 */
export function parseServiceAccount(json: string): ServiceAccount | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const clientEmail = typeof obj.client_email === 'string' ? obj.client_email : '';
  const privateKey = typeof obj.private_key === 'string' ? obj.private_key : '';
  const projectId = typeof obj.project_id === 'string' ? obj.project_id : '';
  const tokenUri =
    typeof obj.token_uri === 'string' && obj.token_uri
      ? obj.token_uri
      : 'https://oauth2.googleapis.com/token';
  if (!clientEmail || !privateKey || !projectId) return null;
  return { clientEmail, privateKey, tokenUri, projectId };
}

/** OAuth2 JWT-bearer claim set for the FCM messaging scope. */
export function buildJwtClaims(
  clientEmail: string,
  tokenUri: string,
  nowSeconds: number,
): {
  iss: string;
  scope: string;
  aud: string;
  iat: number;
  exp: number;
} {
  return {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
}

/** FCM HTTP v1 `messages:send` body for a single device token. */
export function buildFcmMessage(input: {
  token: string;
  title: string;
  body?: string | null;
  link?: string | null;
  type?: string | null;
}): { message: Record<string, unknown> } {
  const data: Record<string, string> = {};
  if (input.link) data.link = input.link;
  if (input.type) data.type = input.type;
  return {
    message: {
      token: input.token,
      notification: { title: input.title, body: input.body ?? '' },
      data,
      android: { priority: 'HIGH', notification: { sound: 'default' } },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
    },
  };
}

/**
 * FCM HTTP v1 body for a **data-only** high-priority message (no `notification`
 * block). Android delivers this straight to the app's background message
 * handler — even when backgrounded or the screen is locked — which is exactly
 * what we need to ring an incoming call via a native CallKit/ConnectionService
 * UI. A `notification` message would instead land silently in the tray.
 *
 * All `data` values MUST be strings (FCM rejects non-string data). A short TTL
 * keeps a stale call push from ringing minutes late.
 */
export function buildFcmDataMessage(input: {
  token: string;
  data: Record<string, string>;
  ttlSeconds?: number;
}): { message: Record<string, unknown> } {
  return {
    message: {
      token: input.token,
      data: input.data,
      android: {
        priority: 'HIGH',
        ttl: `${input.ttlSeconds ?? 60}s`,
      },
      // Android-only today; harmless for any future iOS VoIP bridge.
      apns: {
        headers: { 'apns-priority': '10', 'apns-push-type': 'background' },
        payload: { aps: { 'content-available': 1 } },
      },
    },
  };
}

/**
 * Should this token be pruned? FCM reports a permanently dead token as HTTP 404
 * (UNREGISTERED) or 400 INVALID_ARGUMENT on the `token` field. Anything else
 * (auth, quota, 5xx) is transient — keep the token and retry on a later event.
 */
export function isStaleTokenError(httpStatus: number, body: string): boolean {
  if (httpStatus === 404) return true;
  if (httpStatus === 400 && /UNREGISTERED|invalid.*registration|not a valid FCM/i.test(body)) {
    return true;
  }
  return /UNREGISTERED/.test(body);
}
