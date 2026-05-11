import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateBranchDto, UpdateBranchDto } from './branches.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll() {
    return this.prisma.branch.findMany({
      include: {
        _count: { select: { employees: true, leads: true, clients: true, partners: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: {
        _count: { select: { employees: true, leads: true, clients: true, partners: true } },
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async create(dto: CreateBranchDto, actorUserId: string) {
    const organizationId = await this.resolveOrganizationId();
    const branch = await this.prisma.branch.create({
      data: {
        organizationId,
        name: dto.name,
        city: dto.city,
        country: dto.country,
        phone: dto.phone,
        email: dto.email,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.BRANCH_CREATED,
      entityType: 'Branch',
      entityId: branch.id,
      newValues: { name: branch.name, city: branch.city, country: branch.country },
    });

    return branch;
  }

  async update(id: string, dto: UpdateBranchDto, actorUserId: string) {
    const branch = await this.findById(id);
    const updated = await this.prisma.branch.update({
      where: { id },
      data: dto,
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.BRANCH_UPDATED,
      entityType: 'Branch',
      entityId: id,
      oldValues: { name: branch.name, isActive: branch.isActive },
      newValues: dto,
    });

    return updated;
  }

  private async resolveOrganizationId(): Promise<string> {
    const envOrgId = process.env.DEFAULT_ORG_ID?.trim();
    if (envOrgId) return envOrgId;

    const org = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) {
      throw new NotFoundException('Default organization not found');
    }
    return org.id;
  }
}