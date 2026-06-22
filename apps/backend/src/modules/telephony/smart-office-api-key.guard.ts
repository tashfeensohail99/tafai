import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Guards the Telenor Smart Office call-routing endpoint
 * (POST /integrations/telephony/smart-office/resolve), which the Telenor PBX
 * calls on every inbound call. NOT a user JWT — a single shared key in env
 * `TELENOR_SMART_OFFICE_API_KEY`, accepted as `X-API-Key: <key>` or
 * `Authorization: Bearer <key>`, constant-time compared. If the key isn't
 * configured the endpoint is closed (401) rather than open.
 *
 * Optional defence-in-depth: when `TELENOR_SMART_OFFICE_ALLOWED_IPS` is set
 * (comma-separated exact IPs), the source IP must match one of them. Behind
 * Railway's proxy the real client IP is the first `X-Forwarded-For` hop, so we
 * check that, `req.ip`, and the socket address. Leave the env unset to skip the
 * IP check (key-only). Mirrors AttendanceApiKeyGuard.
 */
@Injectable()
export class SmartOfficeApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.TELENOR_SMART_OFFICE_API_KEY ?? '';
    if (!expected) {
      throw new UnauthorizedException('Smart Office API key not configured');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const headerKey =
      (req.headers['x-api-key'] as string | undefined) ??
      (typeof req.headers.authorization === 'string'
        ? req.headers.authorization.replace(/^Bearer\s+/i, '')
        : undefined) ??
      '';

    if (!headerKey || !this.safeEqual(headerKey, expected)) {
      throw new UnauthorizedException('Invalid Smart Office API key');
    }

    const allow = (process.env.TELENOR_SMART_OFFICE_ALLOWED_IPS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allow.length > 0) {
      // Spoofing-resistant: trust only the hop our own proxy appended (the
      // RIGHTMOST X-Forwarded-For entry) plus the transport-level peer — never
      // arbitrary client-supplied entries earlier in the chain (a caller can
      // forge "X-Forwarded-For: <allowed-ip>, <real>"). The API key is the
      // primary control; this IP check is optional defence-in-depth, so verify
      // the matched hop against real Telenor IPs when you enable it.
      const xffHops = ((req.headers['x-forwarded-for'] as string | undefined) ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const proxyAppended = xffHops.length > 0 ? xffHops[xffHops.length - 1] : '';
      const candidates = [proxyAppended, req.ip ?? '', req.socket?.remoteAddress ?? ''].filter(
        Boolean,
      );
      if (!candidates.some((ip) => allow.includes(ip))) {
        throw new ForbiddenException('Source IP not allowed');
      }
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
