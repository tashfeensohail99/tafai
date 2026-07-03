import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Opaque, expiring, single-payment token for the public "scan & upload your
 * receipt" flow. Stateless HMAC (no DB storage): the token is
 * `base64url(visitorPaymentId.expiryMs).sha256hmac`. It carries no PII — just an
 * id + expiry, signed so it can't be forged or tampered. Bound to ONE
 * VisitorPayment, so a leaked token only lets someone attach a receipt image to
 * that one pending payment (which finance still verifies).
 */
const DEV_FALLBACK_SECRET = 'dev-consult-pay-secret-change-me';

@Injectable()
export class ConsultPayTokenService {
  private readonly log = new Logger(ConsultPayTokenService.name);
  private readonly ttlMs = 60 * 60 * 1000; // 1 hour — a desk-visit window
  private readonly secret =
    process.env.CONSULT_PAY_TOKEN_SECRET ||
    process.env.WHATSAPP_ENCRYPTION_KEY ||
    DEV_FALLBACK_SECRET;

  constructor() {
    // A public, token-gated surface: if the signing secret is the built-in dev
    // default, anyone could forge an upload token. FAIL CLOSED in production —
    // refuse to boot rather than serve forgeable tokens; only warn in dev.
    if (this.secret === DEV_FALLBACK_SECRET) {
      const msg =
        'consult-pay tokens are using the built-in dev secret — set CONSULT_PAY_TOKEN_SECRET or WHATSAPP_ENCRYPTION_KEY so QR receipt-upload tokens are unforgeable.';
      if (process.env.NODE_ENV === 'production') throw new Error(msg);
      this.log.warn(msg);
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('hex');
  }

  make(visitorPaymentId: string): { token: string; expiresAt: string } {
    const exp = Date.now() + this.ttlMs;
    const payload = `${visitorPaymentId}.${exp}`;
    const token = `${Buffer.from(payload).toString('base64url')}.${this.sign(payload)}`;
    return { token, expiresAt: new Date(exp).toISOString() };
  }

  /** The visitorPaymentId if the token is authentic AND unexpired, else null. */
  verify(token: string): string | null {
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const b64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    let payload: string;
    try {
      payload = Buffer.from(b64, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const expected = this.sign(payload);
    // Constant-time compare; bail if lengths differ (timingSafeEqual throws).
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

    const sep = payload.indexOf('.');
    if (sep <= 0) return null;
    const vpId = payload.slice(0, sep);
    const exp = Number(payload.slice(sep + 1));
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    return vpId;
  }
}
