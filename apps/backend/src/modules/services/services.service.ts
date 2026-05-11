import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateServiceDto, UpdateServiceDto } from './services.dto';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(includeInactive = false) {
    return this.prisma.service.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  async create(dto: CreateServiceDto, actorUserId: string) {
    await this.ensureUnique(dto.name, dto.code);
    const service = await this.prisma.service.create({
      data: {
        name: dto.name,
        code: dto.code.toUpperCase(),
        description: dto.description,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.SERVICE_CREATED,
      entityType: 'Service',
      entityId: service.id,
      newValues: { name: service.name, code: service.code },
    });

    return service;
  }

  async update(id: string, dto: UpdateServiceDto, actorUserId: string) {
    const existing = await this.findById(id);
    await this.ensureUnique(dto.name, dto.code, id);

    const updated = await this.prisma.service.update({
      where: { id },
      data: {
        ...dto,
        code: dto.code ? dto.code.toUpperCase() : undefined,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.SERVICE_UPDATED,
      entityType: 'Service',
      entityId: id,
      oldValues: { name: existing.name, code: existing.code, isActive: existing.isActive },
      newValues: dto,
    });

    return updated;
  }

  private async ensureUnique(name?: string, code?: string, excludeId?: string) {
    if (!name && !code) return;

    const conflict = await this.prisma.service.findFirst({
      where: {
        AND: [excludeId ? { id: { not: excludeId } } : {}],
        OR: [
          ...(name ? [{ name }] : []),
          ...(code ? [{ code: code.toUpperCase() }] : []),
        ],
      },
    });

    if (conflict) {
      throw new ConflictException('Service name or code already exists');
    }
  }
}