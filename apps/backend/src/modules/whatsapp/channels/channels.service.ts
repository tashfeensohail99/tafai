import { Injectable, NotFoundException } from '@nestjs/common';
import {
  WhatsAppChannelStatus,
  WhatsAppChannelTier,
  type WhatsAppChannel,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityTimelineService } from '../../activity-timeline/activity-timeline.service';
import { WhatsAppCryptoService } from '../crypto/crypto.service';
import { WhatsAppMetaClientFactory } from '../meta/client.factory';
import { MetaApiError } from '../meta/cloud-client';

export interface CreateChannelInput {
  label: string;
  wabaId: string;
  phoneNumberId: string;
  displayNumber: string;
  // Plaintext Meta access token — encrypted before persisting.
  accessToken: string;
}

export interface VerifyResult {
  ok: boolean;
  verifiedName: string | null;
  displayPhoneNumber: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  codeVerificationStatus: string | null;
  platformType: string | null;
  /** Populated when ok=false. */
  error?: { code: number; message: string; title?: string };
}

// Map Meta's `messaging_limit_tier` string onto our Prisma enum. Tiers
// below TIER_1K (TIER_50, TIER_250) aren't in our enum yet — for those
// we leave the stored tier untouched rather than blocking the verify.
const META_TIER_MAP: Record<string, WhatsAppChannelTier> = {
  TIER_1K: WhatsAppChannelTier.TIER_1K,
  TIER_10K: WhatsAppChannelTier.TIER_10K,
  TIER_100K: WhatsAppChannelTier.TIER_100K,
  TIER_UNLIMITED: WhatsAppChannelTier.TIER_UNLIMITED,
};

@Injectable()
export class WhatsAppChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: WhatsAppCryptoService,
    // Optional dependency — only used to log channel creation in the audit
    // timeline. If your activity-timeline module isn't wired, this can be made
    // optional later.
    private readonly timeline: ActivityTimelineService,
    private readonly metaClientFactory: WhatsAppMetaClientFactory,
  ) {}

  /**
   * Admin connects (or rotates credentials for) a WABA phone number.
   *
   * After the credentials are persisted we run a verification ping against
   * Meta's Graph API (`GET /{phone_number_id}?fields=...`). If that succeeds
   * we know the token is valid for this phone-number-id and we capture
   * Meta's reported tier + last verified timestamp. If it fails the row is
   * still persisted (so the admin can rotate without losing the record)
   * but the verification result is returned so the UI can show what's
   * wrong — invalid token, wrong phone-number-id, app not approved, etc.
   *
   * This is the difference between "credentials saved" and "credentials
   * actually work". The Settings → Integrations page calls this once and
   * gets back a definitive answer on whether the integration is live.
   */
  async upsert(
    actorUserId: string,
    input: CreateChannelInput,
  ): Promise<PublicChannel & { verification: VerifyResult }> {
    const accessTokenEnc = this.crypto.encrypt(input.accessToken);

    const existing = await this.prisma.whatsAppChannel.findUnique({
      where: { phoneNumberId: input.phoneNumberId },
    });

    let row: WhatsAppChannel;
    if (existing) {
      row = await this.prisma.whatsAppChannel.update({
        where: { id: existing.id },
        data: {
          label: input.label,
          wabaId: input.wabaId,
          displayNumber: input.displayNumber,
          accessTokenEnc,
          status: WhatsAppChannelStatus.ACTIVE,
        },
      });
      await this.timeline
        .record({
          entityType: 'WhatsAppChannel',
          entityId: row.id,
          eventType: 'NOTE_ADDED',
          description: `WhatsApp channel "${row.label}" credentials rotated`,
          actorUserId,
          metadata: { phoneNumberId: row.phoneNumberId, action: 'rotate' },
        })
        .catch(() => undefined);
    } else {
      row = await this.prisma.whatsAppChannel.create({
        data: {
          label: input.label,
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
          displayNumber: input.displayNumber,
          accessTokenEnc,
        },
      });
      await this.timeline
        .record({
          entityType: 'WhatsAppChannel',
          entityId: row.id,
          eventType: 'NOTE_ADDED',
          description: `WhatsApp channel "${row.label}" connected`,
          actorUserId,
          metadata: { phoneNumberId: row.phoneNumberId, action: 'create' },
        })
        .catch(() => undefined);
    }

    // Auto-verify the credentials we just saved by pinging Meta. If the
    // call succeeds, lastSyncAt and tier get updated in-place; otherwise
    // we leave the row alone and surface the Meta error to the caller.
    const verification = await this.runVerify(row);
    if (verification.ok) {
      row = await this.prisma.whatsAppChannel.update({
        where: { id: row.id },
        data: {
          lastSyncAt: new Date(),
          ...(verification.messagingLimitTier &&
          META_TIER_MAP[verification.messagingLimitTier]
            ? { tier: META_TIER_MAP[verification.messagingLimitTier] }
            : {}),
        },
      });
    }

    return { ...toPublic(row), verification };
  }

  /**
   * Verify a saved channel's credentials against Meta. Idempotent — safe
   * to call repeatedly from the UI's "Test connection" button. Returns
   * the Meta-reported state of the phone number (verified business name,
   * quality rating, messaging tier) and updates lastSyncAt on success.
   */
  async verify(channelId: string): Promise<VerifyResult> {
    const row = await this.prisma.whatsAppChannel.findUnique({
      where: { id: channelId },
    });
    if (!row) throw new NotFoundException('WhatsApp channel not found');

    const verification = await this.runVerify(row);
    if (verification.ok) {
      await this.prisma.whatsAppChannel.update({
        where: { id: row.id },
        data: {
          lastSyncAt: new Date(),
          ...(verification.messagingLimitTier &&
          META_TIER_MAP[verification.messagingLimitTier]
            ? { tier: META_TIER_MAP[verification.messagingLimitTier] }
            : {}),
        },
      });
    }
    return verification;
  }

  /** Internal: actually hit Meta with the decrypted token. */
  private async runVerify(row: WhatsAppChannel): Promise<VerifyResult> {
    try {
      const client = this.metaClientFactory.forChannel({
        phoneNumberId: row.phoneNumberId,
        accessTokenEnc: row.accessTokenEnc,
      });
      const info = await client.getPhoneNumberInfo();
      return {
        ok: true,
        verifiedName: info.verified_name,
        displayPhoneNumber: info.display_phone_number,
        qualityRating: info.quality_rating,
        messagingLimitTier: info.messaging_limit_tier,
        codeVerificationStatus: info.code_verification_status,
        platformType: info.platform_type,
      };
    } catch (err) {
      const meta = err instanceof MetaApiError ? err : null;
      return {
        ok: false,
        verifiedName: null,
        displayPhoneNumber: null,
        qualityRating: null,
        messagingLimitTier: null,
        codeVerificationStatus: null,
        platformType: null,
        error: meta
          ? {
              code: meta.detail.code,
              message: meta.detail.message,
              title: meta.detail.title,
            }
          : { code: 0, message: err instanceof Error ? err.message : 'Unknown error' },
      };
    }
  }

  async list(): Promise<PublicChannel[]> {
    const rows = await this.prisma.whatsAppChannel.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toPublic);
  }

  async getOrFail(id: string): Promise<PublicChannel> {
    const ch = await this.prisma.whatsAppChannel.findUnique({ where: { id } });
    if (!ch) throw new NotFoundException('WhatsApp channel not found');
    return toPublic(ch);
  }

  async setStatus(actorUserId: string, id: string, status: WhatsAppChannelStatus): Promise<PublicChannel> {
    const before = await this.prisma.whatsAppChannel.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('WhatsApp channel not found');
    const updated = await this.prisma.whatsAppChannel.update({
      where: { id },
      data: { status },
    });
    await this.timeline
      .record({
        entityType: 'WhatsAppChannel',
        entityId: id,
        eventType: 'NOTE_ADDED',
        description: `WhatsApp channel "${before.label}" status changed to ${status}`,
        actorUserId,
        metadata: { before: before.status, after: status },
      })
      .catch(() => undefined);
    return toPublic(updated);
  }

  /**
   * Look up the channel a Meta webhook is meant for. Phone-number ids are
   * unique per Meta App, so this is the natural routing key.
   */
  async findByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppChannel | null> {
    return this.prisma.whatsAppChannel.findUnique({ where: { phoneNumberId } });
  }
}

export interface PublicChannel {
  id: string;
  label: string;
  wabaId: string;
  phoneNumberId: string;
  displayNumber: string;
  tier: string;
  status: string;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(c: WhatsAppChannel): PublicChannel {
  // Deliberately strips `accessTokenEnc` — never returned over the wire.
  return {
    id: c.id,
    label: c.label,
    wabaId: c.wabaId,
    phoneNumberId: c.phoneNumberId,
    displayNumber: c.displayNumber,
    tier: c.tier,
    status: c.status,
    lastSyncAt: c.lastSyncAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
