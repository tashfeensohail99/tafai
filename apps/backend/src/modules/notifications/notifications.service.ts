import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PushService } from '../push/push.service';

/**
 * In-app notifications shown in the bell badge on the employee shell.
 * Producers call `create()` directly. The frontend polls every 30 seconds for
 * the bell; in addition, every notification is fanned out to the recipient's
 * registered devices via {@link PushService} (a no-op until push is configured
 * and a device is registered), so the future mobile app gets the same events.
 *
 * All reads are scoped to the calling user. `markAllRead` and the
 * unread counter help the bell render quickly.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** Create a notification. Caller already knows the recipient userId. */
  async create(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
        },
      });
    } catch (e) {
      // Notifications are best-effort — never let a write failure here
      // break the business flow that produced the event.
      this.log.warn(`notification write failed (${input.type}): ${(e as Error).message}`);
    }

    // Fan out to push (mobile/web). Fire-and-forget and self-contained — push
    // failures are swallowed inside PushService and must not affect the caller.
    void this.push.sendToUser(input.userId, {
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      type: input.type,
    });
  }

  /** Latest N notifications for the caller. Default 20. */
  list(userId: string, limit = 20) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  /** Unread count — drives the bell badge. */
  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, read: false } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
    return { updated: res.count };
  }
}
