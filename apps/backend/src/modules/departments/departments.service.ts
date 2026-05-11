import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '@prisma/client';
import { CreateDepartmentDto, UpdateDepartmentDto } from './departments.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll() {
    return this.prisma.department.findMany({
      where: { isActive: true },
      include: { _count: { select: { employees: true, cases: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      include: {
        employees: {
          where: { isActive: true },
          include: { user: { select: { email: true } } },
        },
        _count: { select: { cases: true } },
      },
    });
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  async create(dto: CreateDepartmentDto, actorUserId: string, orgId: string) {
    const dept = await this.prisma.department.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.DEPARTMENT_CREATED,
      entityType: 'Department',
      entityId: dept.id,
      newValues: { name: dept.name },
    });

    return dept;
  }

  async update(id: string, dto: UpdateDepartmentDto, actorUserId: string) {
    const dept = await this.findById(id);

    const updated = await this.prisma.department.update({
      where: { id },
      data: dto,
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.DEPARTMENT_UPDATED,
      entityType: 'Department',
      entityId: id,
      oldValues: { name: dept.name, isActive: dept.isActive },
      newValues: dto,
    });

    return updated;
  }
}
