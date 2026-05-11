import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateCountryDto, UpdateCountryDto } from './countries.dto';

@Injectable()
export class CountriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(includeInactive = false) {
    return this.prisma.country.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string) {
    const country = await this.prisma.country.findUnique({ where: { id } });
    if (!country) throw new NotFoundException('Country not found');
    return country;
  }

  async create(dto: CreateCountryDto, actorUserId: string) {
    await this.ensureUnique(dto.name, dto.code, dto.isoCode);
    const country = await this.prisma.country.create({
      data: {
        name: dto.name,
        code: dto.code.toUpperCase(),
        isoCode: dto.isoCode?.toUpperCase(),
        description: dto.description,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.COUNTRY_CREATED,
      entityType: 'Country',
      entityId: country.id,
      newValues: { name: country.name, code: country.code, isoCode: country.isoCode },
    });

    return country;
  }

  async update(id: string, dto: UpdateCountryDto, actorUserId: string) {
    const existing = await this.findById(id);
    await this.ensureUnique(dto.name, dto.code, dto.isoCode, id);

    const updated = await this.prisma.country.update({
      where: { id },
      data: {
        ...dto,
        code: dto.code ? dto.code.toUpperCase() : undefined,
        isoCode: dto.isoCode ? dto.isoCode.toUpperCase() : undefined,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.COUNTRY_UPDATED,
      entityType: 'Country',
      entityId: id,
      oldValues: { name: existing.name, code: existing.code, isoCode: existing.isoCode },
      newValues: dto,
    });

    return updated;
  }

  private async ensureUnique(name?: string, code?: string, isoCode?: string, excludeId?: string) {
    if (!name && !code && !isoCode) return;

    const country = await this.prisma.country.findFirst({
      where: {
        AND: [excludeId ? { id: { not: excludeId } } : {}],
        OR: [
          ...(name ? [{ name }] : []),
          ...(code ? [{ code: code.toUpperCase() }] : []),
          ...(isoCode ? [{ isoCode: isoCode.toUpperCase() }] : []),
        ],
      },
    });

    if (country) {
      throw new ConflictException('Country name, code, or ISO code already exists');
    }
  }
}