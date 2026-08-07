import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { deriveClientIp, isAllowed } from './smart-office-ip';

/**
 * Guards the Telenor Smart Office call-routing endpoint
 * (POST /integrations/telephony/smart-office/resolve), which the Telenor PBX
 * calls on every inbound call. NOT a user JWT — a single shared key in env
 * `TELENOR_SMART_OFFICE_API_KEY`, accepted as `X-API-Key: <key>` or
 * `Authorization: Bearer <key>`, constant-time compared. If the key isn't
 * configured the endpoint is closed (401) rather than open.
 *
 * Optional defence-in-depth: when `TELENOR_SMART_OFFICE_ALLOWED_IPS` is set
 * (comma-separated exact IPs and/or IPv4 CIDRs) the caller's address must match
 * one of them. The address is derived by walking the X-Forwarded-For chain from
 * the right and skipping our own infra hops — see deriveClientIp() for why a
 * fixed hop count was wrong. Leave the env unset to skip the IP check
 * (key-only). Every rejection is logged WITH the observed address and full
 * chain: when an integration partner insists their IP is allow-listed, that log
 * line is the only thing that settles it.
 */
@Injectable()
export class SmartOfficeApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(SmartOfficeApiKeyGuard.name);

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
      const { ip, chain } = deriveClientIp(
        req.headers['x-forwarded-for'] as string | undefined,
        req.ip,
        req.socket?.remoteAddress,
      );
      if (!isAllowed(ip, allow)) {
        // The key was valid, so this is a legitimate partner hitting us from an
        // address we don't know about — log the evidence rather than leaving
        // both sides guessing. Not logged to the response: the caller learns
        // only that the IP was refused.
        this.logger.warn(
          `Smart Office IP refused: observed=${ip || '(none)'} ` +
            `xff=[${chain.join(' -> ') || '(empty)'}] ` +
            `socket=${req.socket?.remoteAddress ?? '(none)'} ` +
            `allow=[${allow.join(',')}]`,
        );
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
