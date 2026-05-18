import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthService } from '../auth/auth.service';
import { AuditAction } from '@prisma/client';
import {
  CreateUserDto,
  UpdateUserDto,
  AssignRolesDto,
} from './users.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly authService: AuthService,
  ) {}

  async findAll() {
    return this.prisma.userAccount.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        userRoles: {
          include: { role: { select: { id: true, name: true, displayName: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.userAccount.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: { include: { permission: true } },
              },
            },
          },
        },
        employee: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto, actorUserId: string) {
    const existing = await this.prisma.userAccount.findFirst({
      where: {
        OR: [
          { email: dto.email },
          ...(dto.phone ? [{ phone: dto.phone }] : []),
        ],
        deletedAt: null,
      },
    });
    if (existing) throw new ConflictException('Email or phone already in use');

    const roleRecords = dto.roleNames?.length
      ? await this.prisma.role.findMany({
          where: { name: { in: dto.roleNames }, isActive: true },
        })
      : [];

    const passwordHash = await this.authService.hashPassword(dto.password);

    const user = await this.prisma.userAccount.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: true,
        userRoles: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: roleRecords.map((r: any) => ({ roleId: r.id as string })),
        },
      },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        userRoles: {
          include: { role: { select: { name: true, displayName: true } } },
        },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.USER_CREATED,
      entityType: 'UserAccount',
      entityId: user.id,
      newValues: { email: user.email, roles: dto.roleNames },
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorUserId: string) {
    const user = await this.findById(id);

    if (dto.email && dto.email !== user.email) {
      const taken = await this.prisma.userAccount.findFirst({
        where: { email: dto.email, deletedAt: null, id: { not: id } },
      });
      if (taken) throw new ConflictException('Email already in use');
    }

    const updated = await this.prisma.userAccount.update({
      where: { id },
      data: dto,
      select: { id: true, email: true, phone: true, status: true, updatedAt: true },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.USER_UPDATED,
      entityType: 'UserAccount',
      entityId: id,
      oldValues: { email: user.email, phone: user.phone },
      newValues: dto,
    });

    return updated;
  }

  async assignRoles(id: string, dto: AssignRolesDto, actorUserId: string) {
    await this.findById(id);

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({
        data: dto.roleIds.map((roleId) => ({ userId: id, roleId, grantedBy: actorUserId })),
      }),
    ]);

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.USER_ROLE_ASSIGNED,
      entityType: 'UserAccount',
      entityId: id,
      newValues: { roleIds: dto.roleIds },
    });

    return this.findById(id);
  }

  async deactivate(id: string, actorUserId: string) {
    const user = await this.findById(id);

    await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id },
        data: { status: 'INACTIVE' },
      }),
      // Revoke all active sessions
      this.prisma.loginSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.USER_DEACTIVATED,
      entityType: 'UserAccount',
      entityId: id,
      oldValues: { status: user.status },
      newValues: { status: 'INACTIVE' },
    });
  }

  async activate(id: string, actorUserId: string) {
    const user = await this.findById(id);

    await this.prisma.userAccount.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        // Unlock the account in case it was also locked out from failed logins
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.USER_REACTIVATED,
      entityType: 'UserAccount',
      entityId: id,
      oldValues: { status: user.status },
      newValues: { status: 'ACTIVE' },
    });
  }

  /**
   * Admin-set temp password. Forces a change on next login and revokes all
   * current sessions so an attacker holding an old token can't keep working.
   * The new password is never echoed in the audit log — only that a reset
   * happened.
   */
  async resetPassword(id: string, newPassword: string, actorUserId: string) {
    const user = await this.findById(id);
    const passwordHash = await this.authService.hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          // Unlock the account if the previous owner had locked themselves
          // out — the admin presumably wants them able to log in again.
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.loginSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.PASSWORD_RESET_COMPLETED,
      entityType: 'UserAccount',
      entityId: id,
      metadata: { targetEmail: user.email, byAdmin: true },
    });
  }
}
