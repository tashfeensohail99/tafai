import { Injectable, NotFoundException } from '@nestjs/common';
import { WhatsAppChannelStatus, type WhatsAppChannel } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityTimelineService } from '../../activity-timeline/activity-timeline.service';
import { WhatsAppCryptoService } from '../crypto/crypto.service';

export interface CreateChannelInput {
  label: string;
  wabaId: string;
  phoneNumberId: string;
  displayNumber: string;
  // Plaintext Meta access token — encrypted before persisting.
  accessToken: string;
}

@Injectable()
export class WhatsAppChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: WhatsAppCryptoService,
    // Optional dependency — only used to log channel creation in the audit
    // timeline. If your activity-timeline module isn't wired, this can be made
    // optional later.
    private readonly timeline: ActivityTimelineService,
  ) {}

  /** Admin connects (or rotates credentials for) a WABA phone number. */
  async upsert(actorUserId: string, input: CreateChannelInput): Promise<PublicChannel> {
    const accessTokenEnc = this.crypto.encrypt(input.accessToken);

    const existing = await this.prisma.whatsAppChannel.findUnique({
      where: { phoneNumberId: input.phoneNumberId },
    });

    if (existing) {
      const updated = await this.prisma.whatsAppChannel.update({
        where: { id: existing.id },
        data: {
          label: input.label,
          wabaId: input.wabaId,
          displayNumber: input.displayNumber,
          accessTokenEnc,
          status: WhatsAppChannelStatus.ACTIVE,
        },
      });
      // Log token rotation distinctly from initial connect.
      await this.timeline
        .record({
          entityType: 'WhatsAppChannel',
          entityId: updated.id,
          eventType: 'NOTE_ADDED',
          description: `WhatsApp channel "${updated.label}" credentials rotated`,
          actorUserId,
          metadata: { phoneNumberId: updated.phoneNumberId, action: 'rotate' },
        })
        .catch(() => undefined);
      return toPublic(updated);
    }

    const created = await this.prisma.whatsAppChannel.create({
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
        entityId: created.id,
        eventType: 'NOTE_ADDED',
        description: `WhatsApp channel "${created.label}" connected`,
        actorUserId,
        metadata: { phoneNumberId: created.phoneNumberId, action: 'create' },
      })
      .catch(() => undefined);
    return toPublic(created);
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
