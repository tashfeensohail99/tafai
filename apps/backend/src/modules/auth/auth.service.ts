import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '@prisma/client';
import type { StringValue } from 'ms';
import {
  extractRolesAndPermissions,
  type RequestUser,
} from '../../common/types/auth.types';
import {
  LoginDto,
  RefreshTokenDto,
  RequestPasswordResetDto,
  CompletePasswordResetDto,
  ChangePasswordDto,
} from './auth.dto';

const BCRYPT_ROUNDS = 12;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60; // 1 hour
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 1000 * 60 * 15; // 15 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auditLog: AuditLogService,
  ) {}

  async login(
    dto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.userAccount.findUnique({
      where: { email: dto.email, deletedAt: null },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });

    if (!user) {
      await this.auditLog.log({
        action: AuditAction.USER_LOGIN_FAILED,
        entityType: 'UserAccount',
        metadata: { email: dto.email, reason: 'user_not_found' },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account temporarily locked due to too many failed attempts',
      );
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordValid) {
      const attempts = user.failedLoginAttempts + 1;
      const lockUntil =
        attempts >= MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_DURATION_MS)
          : null;

      await this.prisma.userAccount.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts, lockedUntil: lockUntil },
      });

      await this.auditLog.log({
        actorUserId: user.id,
        action: AuditAction.USER_LOGIN_FAILED,
        entityType: 'UserAccount',
        entityId: user.id,
        metadata: { reason: 'invalid_password', failedAttempts: attempts },
        ipAddress,
        userAgent,
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      await this.auditLog.log({
        actorUserId: user.id,
        action: AuditAction.USER_LOGIN_FAILED,
        entityType: 'UserAccount',
        entityId: user.id,
        metadata: { reason: 'account_not_active', status: user.status },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Account is not active');
    }

    const { roles, permissions } = extractRolesAndPermissions(user);

    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email, roles, permissions },
      { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as StringValue },
    );

    const refreshToken = randomUUID();
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
      }),
      this.prisma.loginSession.create({
        data: {
          userId: user.id,
          refreshToken,
          ipAddress,
          userAgent,
          expiresAt: refreshExpiresAt,
        },
      }),
    ]);

    await this.auditLog.log({
      actorUserId: user.id,
      action: AuditAction.USER_LOGIN,
      entityType: 'UserAccount',
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    return { accessToken, refreshToken };
  }

  async refresh(
    dto: RefreshTokenDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const session = await this.prisma.loginSession.findUnique({
      where: { refreshToken: dto.refreshToken },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: { include: { permission: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.user.status !== 'ACTIVE' ||
      session.user.deletedAt
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const { roles, permissions } = extractRolesAndPermissions(session.user);

    const newAccessToken = this.jwt.sign(
      {
        sub: session.user.id,
        email: session.user.email,
        roles,
        permissions,
      },
      { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as StringValue },
    );

    const newRefreshToken = randomUUID();
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.loginSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.loginSession.create({
        data: {
          userId: session.userId,
          refreshToken: newRefreshToken,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          expiresAt: newExpiresAt,
        },
      }),
    ]);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string, actorUserId: string): Promise<void> {
    await this.prisma.loginSession.updateMany({
      where: { userId: actorUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.USER_LOGOUT,
      entityType: 'UserAccount',
      entityId: actorUserId,
    });
  }

  async requestPasswordReset(dto: RequestPasswordResetDto): Promise<void> {
    const user = await this.prisma.userAccount.findUnique({
      where: { email: dto.email, deletedAt: null },
    });

    // Always respond the same to prevent user enumeration
    if (!user) return;

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt },
    });

    await this.auditLog.log({
      actorUserId: user.id,
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      entityType: 'UserAccount',
      entityId: user.id,
    });

    // TODO: Send token via email when email module is ready
    this.logger.log(`Password reset token generated for user ${user.id}`);
  }

  async completePasswordReset(dto: CompletePasswordResetDto): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: dto.token },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id: record.userId },
        data: {
          passwordHash: hash,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Revoke all sessions on password change
      this.prisma.loginSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditLog.log({
      actorUserId: record.userId,
      action: AuditAction.PASSWORD_RESET_COMPLETED,
      entityType: 'UserAccount',
      entityId: record.userId,
    });
  }

  /**
   * Enriched current-user profile for GET /auth/me. Returns the JWT identity
   * (id/email/roles/permissions) PLUS the two fields the mobile app needs:
   *   - mustChangePassword → drives the force-change-password-on-first-login gate
   *   - employee {name, department} → header / profile display
   * Additive only — the web app reads id/email/roles/permissions and is
   * unaffected. One indexed lookup each; `employee` is null for accounts with no
   * Employee profile (e.g. system/service accounts).
   */
  async getProfile(user: RequestUser) {
    const [account, employee] = await Promise.all([
      this.prisma.userAccount.findUnique({
        where: { id: user.id },
        select: { mustChangePassword: true },
      }),
      this.prisma.employee.findUnique({
        where: { userId: user.id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          department: { select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      ...user,
      mustChangePassword: account?.mustChangePassword ?? false,
      employee,
    };
  }

  /**
   * Change the authenticated user's own password (mobile/web settings + the
   * force-change-on-first-login flow). Verifies the current password, rejects a
   * no-op reuse, and clears `mustChangePassword`.
   *
   * Unlike a password *reset* (forgot-password, not logged in — which revokes
   * all sessions), this deliberately does NOT revoke the caller's sessions: the
   * user just authenticated and should stay logged in, which is essential for
   * the first-login change flow. (Logging out other devices on change is a
   * separate feature, intentionally out of scope.)
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.userAccount.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const reused = await bcrypt.compare(dto.newPassword, user.passwordHash);
    if (reused) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const hash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.userAccount.update({
      where: { id: userId },
      data: {
        passwordHash: hash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });

    await this.auditLog.log({
      actorUserId: userId,
      action: AuditAction.PASSWORD_RESET_COMPLETED,
      entityType: 'UserAccount',
      entityId: userId,
      metadata: { via: 'self_service_change' },
    });
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }
}
