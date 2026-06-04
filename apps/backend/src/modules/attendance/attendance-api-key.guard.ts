import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Guards the outbound employee-directory endpoint that the camera-attendance
 * system polls. Authenticates with a single shared key in env
 * `ATTENDANCE_SYNC_API_KEY`, accepted as either `X-API-Key: <key>` or
 * `Authorization: Bearer <key>`. Constant-time compared. If the key isn't
 * configured, the endpoint is closed (401) rather than open.
 */
@Injectable()
export class AttendanceApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ATTENDANCE_SYNC_API_KEY ?? '';
    if (!expected) throw new UnauthorizedException('Attendance sync key not configured');

    const req = context.switchToHttp().getRequest<Request>();
    const headerKey =
      (req.headers['x-api-key'] as string | undefined) ??
      (typeof req.headers.authorization === 'string'
        ? req.headers.authorization.replace(/^Bearer\s+/i, '')
        : undefined) ??
      '';

    if (!headerKey || !this.safeEqual(headerKey, expected)) {
      throw new UnauthorizedException('Invalid attendance sync key');
    }
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
