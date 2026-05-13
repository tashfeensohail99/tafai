import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload, RequestUser } from '../../common/types/auth.types';

/**
 * JwtStrategy — verifies the JWT and builds the request user from the
 * payload alone.
 *
 * The previous implementation ran a deep nested Prisma query
 * (UserAccount → UserRole → Role → RolePermission → Permission) on
 * EVERY authenticated request. For a super_admin (128 permissions) that
 * join cost ~2-4s on the Supabase pooler — turning every API call
 * sluggish and making the inbox feel broken.
 *
 * The JWT already carries `sub`, `email`, `roles`, `permissions` baked
 * in at login time. passport-jwt verifies the signature for us, so the
 * payload is trustworthy. Build RequestUser directly; no DB hop.
 *
 * Tradeoff: revoking a user's access requires the token to expire
 * (default 15 min) or rotating the JWT secret. Acceptable — this is
 * standard for any JWT-based system. Faster revocation comes from
 * shortening the access-token TTL, not from a per-request DB lookup.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not set. Refusing to start.');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    if (!payload?.sub || !payload?.email) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
    };
  }
}
