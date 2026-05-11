import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '@prisma/client';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './roles.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll() {
    return this.prisma.role.findMany({
      where: { isActive: true },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
      orderBy: { displayName: 'asc' },
    });
  }

  async findById(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async create(dto: CreateRoleDto, actorUserId: string) {
    const existing = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException('Role name already exists');

    const permissionIds = dto.permissionKeys?.length
      ? await this.resolvePermissionIds(dto.permissionKeys)
      : [];

    const role = await this.prisma.role.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description,
        rolePermissions: {
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      include: { rolePermissions: { include: { permission: true } } },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.ROLE_CREATED,
      entityType: 'Role',
      entityId: role.id,
      newValues: { name: role.name, displayName: role.displayName },
    });

    return role;
  }

  async update(id: string, dto: UpdateRoleDto, actorUserId: string) {
    const role = await this.findById(id);
    if (role.isSystem && dto.isActive === false) {
      throw new BadRequestException('System roles cannot be deactivated');
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: dto,
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.ROLE_UPDATED,
      entityType: 'Role',
      entityId: id,
      oldValues: { displayName: role.displayName, isActive: role.isActive },
      newValues: dto,
    });

    return updated;
  }

  async assignPermissions(
    id: string,
    dto: AssignPermissionsDto,
    actorUserId: string,
  ) {
    const role = await this.findById(id);
    if (role.isSystem) {
      throw new BadRequestException('System role permissions cannot be changed');
    }

    const permissionIds = await this.resolvePermissionIds(dto.permissionKeys);

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
      }),
    ]);

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.PERMISSION_CHANGED,
      entityType: 'Role',
      entityId: id,
      newValues: { permissionKeys: dto.permissionKeys },
    });

    return this.findById(id);
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
    });
    if (permissions.length !== keys.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = permissions.map((p: any) => p.key as string);
      const missing = keys.filter((k) => !found.includes(k));
      throw new BadRequestException(`Unknown permissions: ${missing.join(', ')}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return permissions.map((p: any) => p.id as string);
  }
}
