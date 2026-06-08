import {
  base64url,
  buildFcmMessage,
  buildJwtClaims,
  isStaleTokenError,
  parseServiceAccount,
} from './push.util';

describe('push.util', () => {
  describe('base64url', () => {
    it('strips padding', () => {
      // 'hi' → std base64 "aGk=" → padding removed
      expect(base64url('hi')).toBe('aGk');
    });
    it('is URL-safe (+ and / become - and _)', () => {
      // bytes 0xFF,0xFF,0xFE → std base64 "///+" → url-safe "___-"
      const out = base64url(Buffer.from([0xff, 0xff, 0xfe]));
      expect(out).toBe('___-');
      expect(out).not.toMatch(/[+/=]/);
    });
  });

  describe('parseServiceAccount', () => {
    const valid = JSON.stringify({
      client_email: 'svc@proj.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      project_id: 'proj-123',
      token_uri: 'https://oauth2.googleapis.com/token',
    });
    it('parses a valid service account', () => {
      const sa = parseServiceAccount(valid);
      expect(sa).not.toBeNull();
      expect(sa!.clientEmail).toBe('svc@proj.iam.gserviceaccount.com');
      expect(sa!.projectId).toBe('proj-123');
    });
    it('defaults token_uri when absent', () => {
      const sa = parseServiceAccount(
        JSON.stringify({ client_email: 'a@b.c', private_key: 'k', project_id: 'p' }),
      );
      expect(sa!.tokenUri).toBe('https://oauth2.googleapis.com/token');
    });
    it('returns null for missing required fields', () => {
      expect(parseServiceAccount(JSON.stringify({ client_email: 'a@b.c' }))).toBeNull();
      expect(parseServiceAccount(JSON.stringify({ private_key: 'k', project_id: 'p' }))).toBeNull();
    });
    it('returns null (not throws) for invalid JSON', () => {
      expect(parseServiceAccount('not json')).toBeNull();
      expect(parseServiceAccount('')).toBeNull();
    });
  });

  describe('buildJwtClaims', () => {
    it('sets the messaging scope and a 1-hour expiry', () => {
      const c = buildJwtClaims('svc@x.com', 'https://t.example/token', 1_000);
      expect(c.iss).toBe('svc@x.com');
      expect(c.aud).toBe('https://t.example/token');
      expect(c.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
      expect(c.iat).toBe(1_000);
      expect(c.exp).toBe(1_000 + 3600);
    });
  });

  describe('buildFcmMessage', () => {
    it('builds an HTTP v1 message with notification + high priority', () => {
      const m = buildFcmMessage({
        token: 'tok-1',
        title: 'Hi',
        body: 'There',
        link: '/sales/leads',
        type: 'LEAD_ASSIGNED',
      }).message as Record<string, any>;
      expect(m.token).toBe('tok-1');
      expect(m.notification).toEqual({ title: 'Hi', body: 'There' });
      expect(m.data).toEqual({ link: '/sales/leads', type: 'LEAD_ASSIGNED' });
      expect(m.android.priority).toBe('HIGH');
      expect(m.apns.headers['apns-priority']).toBe('10');
    });
    it('defaults body to empty string and omits absent data keys', () => {
      const m = buildFcmMessage({ token: 't', title: 'T' }).message as Record<string, any>;
      expect(m.notification.body).toBe('');
      expect(m.data).toEqual({});
    });
  });

  describe('isStaleTokenError', () => {
    it('prunes on 404', () => {
      expect(isStaleTokenError(404, '{"error":{"status":"NOT_FOUND"}}')).toBe(true);
    });
    it('prunes on 400 UNREGISTERED', () => {
      expect(isStaleTokenError(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}')).toBe(
        true,
      );
    });
    it('keeps the token on transient/auth errors', () => {
      expect(isStaleTokenError(401, 'unauthenticated')).toBe(false);
      expect(isStaleTokenError(500, 'internal')).toBe(false);
      expect(isStaleTokenError(400, 'INVALID_ARGUMENT: bad message body')).toBe(false);
    });
  });
});
