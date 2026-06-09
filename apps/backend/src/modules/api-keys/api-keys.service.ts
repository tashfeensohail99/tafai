import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WhatsAppCryptoService } from '../whatsapp/crypto/crypto.service';

/**
 * Single source of truth for third-party API keys (OpenAI etc.).
 *
 * - Plaintext keys are NEVER stored. `keyEnc` is AES-256-GCM ciphertext using
 *   the existing `WHATSAPP_ENCRYPTION_KEY` env (same key already trusted to
 *   hold Meta access tokens).
 * - `keyTail` (last 4 chars) is kept in plain text so the admin UI can render
 *   "sk-...AbCd" without round-tripping through decrypt.
 * - Consumers (AI module, future providers) call `getActiveKey(provider)` —
 *   results are cached in-process for `CACHE_TTL_MS` so rotation via the
 *   admin tab propagates within a few seconds without restarting pods.
 *
 * Cache invalidation: any write through this service (create/update/delete/
 * setActive) clears the cache for the affected provider.
 */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  key: string; // decrypted plaintext
  fetchedAt: number;
}

@Injectable()
export class ApiKeysService {
  private readonly log = new Logger(ApiKeysService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: WhatsAppCryptoService,
  ) {}

  /**
   * Fetch the active, decrypted API key for a provider. Throws if none set.
   * Caches the decrypted value for {@link CACHE_TTL_MS} so we don't decrypt
   * on every OpenAI call.
   */
  async getActiveKey(provider: string): Promise<string> {
    const cached = this.cache.get(provider);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.key;
    }
    const row = await this.prisma.apiKey.findFirst({
      where: { provider, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) {
      throw new NotFoundException(
        `No active API key configured for "${provider}". Set one in Admin → API Keys.`,
      );
    }
    const plaintext = this.crypto.decrypt(row.keyEnc);
    this.cache.set(provider, { key: plaintext, fetchedAt: Date.now() });
    // Fire-and-forget lastUsedAt bump (don't block the caller on the write).
    void this.prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    return plaintext;
  }

  /** Does an active key exist for this provider (without decrypting)? */
  async hasActiveKey(provider: string): Promise<boolean> {
    const row = await this.prisma.apiKey.findFirst({
      where: { provider, isActive: true },
      select: { id: true },
    });
    return !!row;
  }

  /** Admin list — returns metadata only, never the key itself. */
  async list(organizationId: string) {
    const rows = await this.prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: [{ provider: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        provider: true,
        label: true,
        keyTail: true,
        isActive: true,
        lastUsedAt: true,
        lastTestedAt: true,
        lastTestOk: true,
        lastTestError: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows;
  }

  /** Create or replace an API key. Plaintext goes in once, never out. */
  async upsert(
    organizationId: string,
    input: { provider: string; label: string; key: string },
    actorUserId: string,
  ) {
    const { provider, label } = input;
    const key = input.key.trim();
    if (!provider || !label || !key) {
      throw new BadRequestException('Provider, label, and key are all required.');
    }
    if (key.length < 8) {
      throw new BadRequestException('Key looks too short. Did you paste the whole thing?');
    }
    const keyEnc = this.crypto.encrypt(key);
    const keyTail = key.slice(-4);

    // Deactivate any previous active keys for the same provider — only one
    // "active" key per provider at a time keeps the get-active path simple.
    await this.prisma.apiKey.updateMany({
      where: { organizationId, provider, isActive: true },
      data: { isActive: false },
    });

    const existing = await this.prisma.apiKey.findFirst({
      where: { organizationId, provider, label },
    });
    const row = existing
      ? await this.prisma.apiKey.update({
          where: { id: existing.id },
          data: {
            keyEnc,
            keyTail,
            isActive: true,
            // Clear stale test status — the key has changed.
            lastTestedAt: null,
            lastTestOk: null,
            lastTestError: null,
          },
        })
      : await this.prisma.apiKey.create({
          data: {
            organizationId,
            provider,
            label,
            keyEnc,
            keyTail,
            isActive: true,
            createdByUserId: actorUserId,
          },
        });

    this.cache.delete(provider);
    this.log.log(`API key set for ${provider} (label="${label}", tail="…${keyTail}")`);
    return this.publicRow(row);
  }

  /** Toggle isActive on a specific key id. */
  async setActive(id: string, isActive: boolean) {
    const row = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('API key not found');

    if (isActive) {
      // Enforce single-active-per-provider invariant.
      await this.prisma.apiKey.updateMany({
        where: {
          organizationId: row.organizationId,
          provider: row.provider,
          id: { not: id },
          isActive: true,
        },
        data: { isActive: false },
      });
    }
    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: { isActive },
    });
    this.cache.delete(row.provider);
    return this.publicRow(updated);
  }

  async delete(id: string) {
    const row = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('API key not found');
    await this.prisma.apiKey.delete({ where: { id } });
    this.cache.delete(row.provider);
    return { id, deleted: true };
  }

  /**
   * Smoke-test a stored key by making a 1-token inference call. Persists the
   * test outcome on the row so the admin UI shows a green/red status badge.
   * Provider-specific — currently OpenAI; extend with a switch when adding
   * more providers.
   */
  async test(id: string): Promise<{ ok: boolean; error: string | null }> {
    const row = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('API key not found');
    const plaintext = this.crypto.decrypt(row.keyEnc);

    let ok = false;
    let error: string | null = null;
    try {
      if (row.provider === 'openai') {
        // Minimal call: list models. Cheap, no tokens billed.
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${plaintext}` },
        });
        if (!res.ok) {
          error = `OpenAI returned ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`;
        } else {
          ok = true;
        }
      } else if (row.provider === 'fcm') {
        // Structural check: confirm the blob is a well-formed Google
        // service-account JSON (catches pasting the wrong file / a truncated
        // copy). We don't call Google here — PushService mints a token on the
        // first real send and prunes dead device tokens itself.
        try {
          const sa = JSON.parse(plaintext) as Record<string, unknown>;
          const missing = ['type', 'project_id', 'private_key', 'client_email', 'token_uri'].filter(
            (k) => !sa[k],
          );
          if (missing.length > 0) {
            error = `Not a valid service-account JSON — missing field(s): ${missing.join(', ')}`;
          } else if (sa.type !== 'service_account') {
            error = `Expected "type":"service_account" but got "${String(sa.type)}"`;
          } else {
            ok = true;
          }
        } catch {
          error = 'Could not parse as JSON — paste the full service-account file contents.';
        }
      } else {
        error = `No test handler implemented for provider "${row.provider}"`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    }

    await this.prisma.apiKey.update({
      where: { id },
      data: { lastTestedAt: new Date(), lastTestOk: ok, lastTestError: error },
    });
    // Bust cache in case the key was rotated externally between fetch + test.
    this.cache.delete(row.provider);
    return { ok, error };
  }

  /** Strip ciphertext from public-facing responses. */
  private publicRow<T extends { keyEnc?: string }>(row: T): Omit<T, 'keyEnc'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { keyEnc, ...rest } = row;
    return rest;
  }
}
