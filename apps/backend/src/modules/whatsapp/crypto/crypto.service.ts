import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM envelope encryption for secrets stored in the database,
 * primarily Meta Cloud API access tokens on the `WhatsAppChannel` row.
 *
 * Ciphertext format: base64(iv) + ":" + base64(ciphertext) + ":" + base64(authTag)
 *
 * Key rotation: when rotating, we'd add a key-id prefix to ciphertext and
 * keep a map of key-id -> key. Out of scope for v1.
 */
@Injectable()
export class WhatsAppCryptoService {
  private readonly key: Buffer;
  private static readonly ALGO = 'aes-256-gcm';
  private static readonly IV_BYTES = 12; // 96-bit IV per GCM spec

  constructor(config: ConfigService) {
    const hex = config.get<string>('app.whatsapp.encryptionKey');
    if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(
        'WHATSAPP_ENCRYPTION_KEY must be 64 hex chars (32 bytes). Generate with: ' +
          "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    this.key = Buffer.from(hex, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(WhatsAppCryptoService.IV_BYTES);
    const cipher = createCipheriv(WhatsAppCryptoService.ALGO, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), encrypted.toString('base64'), authTag.toString('base64')].join(
      ':',
    );
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) throw new Error('Invalid ciphertext format');
    const [ivB64, dataB64, tagB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = createDecipheriv(WhatsAppCryptoService.ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /** Constant-time string comparison for security-sensitive equality checks. */
  static safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
