import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDecipheriv } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Supplies a Meta access token with `leads_retrieval` + Page access for the
 * Lead Ads retrieval calls.
 *
 * We reuse the System User token already stored (AES-256-GCM encrypted) on a
 * WhatsApp channel — the same Meta Business owns the WhatsApp + Page assets, so
 * one token serves both. An explicit `META_PAGE_ACCESS_TOKEN` env var takes
 * precedence if ever set (e.g. to scope a dedicated token).
 *
 * Channels whose ciphertext can't be decrypted (encryption key rotated after
 * they were saved) are skipped — we walk to the next working one.
 */
@Injectable()
export class MetaCredentialsService {
  private readonly log = new Logger(MetaCredentialsService.name);
  private cached: { token: string; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  graphBase(): string {
    const ver = this.config.get<string>('app.whatsapp.metaGraphApiVersion') ?? 'v21.0';
    return `https://graph.facebook.com/${ver}`;
  }

  /** Returns a usable token, or null if none can be resolved. Cached 5 min. */
  async getAccessToken(): Promise<string | null> {
    const envToken = process.env.META_PAGE_ACCESS_TOKEN;
    if (envToken && envToken.trim()) return envToken.trim();

    if (this.cached && Date.now() - this.cached.at < 5 * 60_000) return this.cached.token;

    const key = this.config.get<string>('app.whatsapp.encryptionKey');
    if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
      this.log.error('WHATSAPP_ENCRYPTION_KEY missing/invalid — cannot decrypt a Meta token');
      return null;
    }

    const channels = await this.prisma.whatsAppChannel.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { label: true, accessTokenEnc: true },
    });
    for (const ch of channels) {
      try {
        const token = this.decrypt(ch.accessTokenEnc, key);
        this.cached = { token, at: Date.now() };
        return token;
      } catch {
        this.log.warn(`channel "${ch.label}" token failed to decrypt (key rotated?) — trying next`);
      }
    }
    this.log.error('No WhatsApp channel token could be decrypted for Meta lead retrieval');
    return null;
  }

  private decrypt(payload: string, keyHex: string): string {
    const [ivB64, dataB64, tagB64] = payload.split(':');
    if (!ivB64 || !dataB64 || !tagB64) throw new Error('bad ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }
}
