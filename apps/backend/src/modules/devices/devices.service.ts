import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RegisterDeviceDto } from './devices.dto';

/**
 * Device-token registry for push. A client registers its FCM token on login and
 * removes it on logout. Tokens are unique, so a re-register from the same device
 * (token rotation, reinstall) is an upsert — never a duplicate row.
 */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Register (or refresh) the caller's device token. Keyed on the unique
   * `token`: if the same token was previously registered — even to a different
   * user on a shared device — it's reassigned to the current caller.
   */
  async register(userId: string, dto: RegisterDeviceDto) {
    const now = new Date();
    const row = await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform,
        deviceInfo: dto.deviceInfo ?? null,
        lastSeenAt: now,
      },
      update: {
        userId,
        platform: dto.platform,
        deviceInfo: dto.deviceInfo ?? null,
        lastSeenAt: now,
      },
      select: { id: true, platform: true, createdAt: true },
    });
    return { id: row.id, platform: row.platform, registered: true };
  }

  /** Remove a token — scoped to the caller so you can only unregister your own. */
  async unregister(userId: string, token: string): Promise<{ removed: number }> {
    const res = await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
    return { removed: res.count };
  }

  /** The caller's own registered devices (no tokens returned). */
  listForUser(userId: string) {
    return this.prisma.deviceToken.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, platform: true, deviceInfo: true, lastSeenAt: true, createdAt: true },
    });
  }
}
