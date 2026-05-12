/**
 * @tashfeen/shared-types — entities/auth.types.ts
 * JWT and session types shared between backend (NestJS) and frontend.
 */

export interface JwtPayload {
  /** User account ID (UUID). */
  sub: string;
  email: string;
  roles: string[];
  permissions: string[];
  /** Issued-at (Unix timestamp). */
  iat?: number;
  /** Expiry (Unix timestamp). */
  exp?: number;
}

export interface RequestUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  user: {
    id: string;
    email: string;
    roles: string[];
    permissions: string[];
    mustChangePassword: boolean;
  };
  tokens: AuthTokens;
}
