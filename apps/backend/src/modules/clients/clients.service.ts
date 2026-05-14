import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { generateOrphanClientReferenceCode } from '../../common/reference-codes/reference-codes';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateClientDto, ListClientsQueryDto, UpdateClientDto } from './clients.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(query: ListClientsQueryDto) {
    return this.prisma.client.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        branch: { select: { id: true, name: true } },
        _count: {
          select: { cases: true, documents: true, appointments: true, invoices: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id, deletedAt: null },
      include: {
        branch: true,
        cases: { orderBy: { createdAt: 'desc' } },
        documents: { orderBy: { createdAt: 'desc' }, take: 20 },
        appointments: { orderBy: { scheduledAt: 'desc' }, take: 20 },
        invoices: { orderBy: { createdAt: 'desc' }, take: 20 },
        timelineEvents: { orderBy: { createdAt: 'desc' }, take: 30 },
      },
    });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  async create(dto: CreateClientDto, actorUserId: string) {
    await this.ensureUniqueClient(dto.phone, dto.email);
    // Direct client create (not from a lead). Generate an orphan-series
    // reference code (TIS-YYYY-01000+) so the customer has the same
    // identifier shape as lead-derived clients but in a distinct range.
    const referenceCode = await generateOrphanClientReferenceCode(this.prisma);

    const client = await this.prisma.client.create({
      data: {
        referenceCode,
        branchId: dto.branchId,
        createdByUserId: actorUserId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        alternatePhone: dto.alternatePhone,
        nationality: dto.nationality,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        gender: dto.gender,
        passportNumber: dto.passportNumber,
        passportExpiry: dto.passportExpiry ? new Date(dto.passportExpiry) : undefined,
        nationalId: dto.nationalId,
        address: dto.address,
        status: dto.status,
      },
      include: { branch: { select: { id: true, name: true } } },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.CLIENT_CREATED,
      entityType: 'Client',
      entityId: client.id,
      newValues: {
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone,
        email: client.email,
      },
    });

    return client;
  }

  async update(id: string, dto: UpdateClientDto, actorUserId: string) {
    const existing = await this.findById(id);
    if (dto.phone || dto.email) {
      await this.ensureUniqueClient(dto.phone, dto.email, id);
    }

    const updated = await this.prisma.client.update({
      where: { id },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        passportExpiry: dto.passportExpiry ? new Date(dto.passportExpiry) : undefined,
      },
      include: { branch: { select: { id: true, name: true } } },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.CLIENT_UPDATED,
      entityType: 'Client',
      entityId: id,
      oldValues: {
        phone: existing.phone,
        email: existing.email,
        status: existing.status,
      },
      newValues: dto,
    });

    return updated;
  }

  private async ensureUniqueClient(phone?: string, email?: string, excludeId?: string) {
    if (!phone && !email) return;

    const duplicateClient = await this.prisma.client.findFirst({
      where: {
        deletedAt: null,
        AND: [excludeId ? { id: { not: excludeId } } : {}],
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
      select: { id: true },
    });

    if (duplicateClient) {
      throw new ConflictException('A client with the same phone or email already exists');
    }
  }
}