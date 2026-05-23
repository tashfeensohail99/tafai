import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Stamps `Employee.lastActivityAt` on every authenticated HTTP request so
 * presence (online / away / offline) reflects REAL CRM usage automatically —
 * opening a lead, sending a WhatsApp reply, searching, anything. No manual
 * heartbeat or presence toggle required; if the agent is doing things in the
 * app, they're "online".
 *
 * Throttled in-memory to one DB write per user per 60s (presence windows are
 * minutes-wide, so finer resolution is just wasted writes). Fire-and-forget:
 * it never blocks or fails the request, skips unauthenticated routes, and
 * no-ops for users without an Employee row (e.g. the super-admin) via
 * updateMany.
 */
@Injectable()
export class ActivityTrackerInterceptor implements NestInterceptor {
  private readonly lastStampMs = new Map<string, number>();
  private static readonly THROTTLE_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only HTTP requests carry an authenticated `req.user`; skip WS/RPC.
    if (ctx.getType() !== 'http') return next.handle();

    const req = ctx.switchToHttp().getRequest<{ user?: { id?: string } }>();
    const userId = req?.user?.id;
    if (userId) {
      const now = Date.now();
      const prev = this.lastStampMs.get(userId) ?? 0;
      if (now - prev >= ActivityTrackerInterceptor.THROTTLE_MS) {
        this.lastStampMs.set(userId, now);
        // Fire-and-forget — must never delay or break the response. updateMany
        // so a user with no Employee row (super-admin) is a harmless no-op.
        this.prisma.employee
          .updateMany({ where: { userId }, data: { lastActivityAt: new Date() } })
          .catch(() => undefined);
      }
    }
    return next.handle();
  }
}
