import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies the `X-Hub-Signature-256` header Meta attaches to every webhook
 * POST. The signature is sha256=<hex_hmac> over the RAW request body using
 * the App Secret.
 *
 * Fail-closed: if META_APP_SECRET is unset, every webhook is rejected. Never
 * silently accept unsigned events.
 */
@Injectable()
export class WhatsAppWebhookSignatureService {
  constructor(private readonly config: ConfigService) {}

  verify(rawBody: Buffer, signatureHeader: string | undefined | null): boolean {
    const appSecret = this.config.get<string>('app.whatsapp.metaAppSecret');
    if (!appSecret) return false;
    if (!signatureHeader) return false;

    const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
