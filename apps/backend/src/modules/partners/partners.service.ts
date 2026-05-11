import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, PartnerStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  CreatePartnerDto,
  ListPartnersQueryDto,
  UpdatePartnerDto,
} from './partners.dto';

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(query: ListPartnersQueryDto) {
    return this.prisma.partner.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { companyName: { contains: query.search, mode: 'insensitive' } },
                { contactName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } },
                { referralCode: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, status: true } },
        _count: { select: { leads: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async findById(id: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      include: {
        branch: true,
        user: { select: { id: true, email: true, status: true } },
        leads: {
          where: { deletedAt: null },
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { leads: true } },
      },
    });
    if (!partner || partner.deletedAt) throw new NotFoundException('Partner not found');
    return partner;
  }

  async create(dto: CreatePartnerDto, actorUserId: string) {
    const organizationId = await this.resolveOrganizationId();
    const referralCode = dto.referralCode
      ? await this.ensureReferralCodeUnique(dto.referralCode)
      : await this.generateReferralCode(dto.companyName);

    if (dto.userId) {
      await this.ensureUserAvailable(dto.userId);
    }

    const partner = await this.prisma.partner.create({
      data: {
        organizationId,
        branchId: dto.branchId,
        userId: dto.userId,
        companyName: dto.companyName,
        contactName: dto.contactName,
        email: dto.email,
        phone: dto.phone,
        referralCode,
        notes: dto.notes,
        status: dto.status ?? PartnerStatus.ACTIVE,
        isActive: dto.isActive ?? true,
      },
      include: {
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, status: true } },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.PARTNER_CREATED,
      entityType: 'Partner',
      entityId: partner.id,
      newValues: {
        companyName: partner.companyName,
        contactName: partner.contactName,
        referralCode: partner.referralCode,
      },
    });

    return partner;
  }

  async update(id: string, dto: UpdatePartnerDto, actorUserId: string) {
    const existing = await this.findById(id);

    if (dto.userId && dto.userId !== existing.userId) {
      await this.ensureUserAvailable(dto.userId, id);
    }

    const referralCode = dto.referralCode
      ? await this.ensureReferralCodeUnique(dto.referralCode, id)
      : undefined;

    const updated = await this.prisma.partner.update({
      where: { id },
      data: {
        ...dto,
        referralCode,
      },
      include: {
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, status: true } },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.PARTNER_UPDATED,
      entityType: 'Partner',
      entityId: id,
      oldValues: {
        companyName: existing.companyName,
        contactName: existing.contactName,
        referralCode: existing.referralCode,
        status: existing.status,
        isActive: existing.isActive,
      },
      newValues: dto,
    });

    return updated;
  }

  private async resolveOrganizationId(): Promise<string> {
    const envOrgId = process.env.DEFAULT_ORG_ID?.trim();
    if (envOrgId) return envOrgId;

    const org = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) throw new NotFoundException('Default organization not found');
    return org.id;
  }

  private async ensureUserAvailable(userId: string, excludePartnerId?: string) {
    const user = await this.prisma.userAccount.findUnique({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('User account not found');

    const existing = await this.prisma.partner.findFirst({
      where: {
        userId,
        deletedAt: null,
        ...(excludePartnerId ? { id: { not: excludePartnerId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException('User account is already linked to another partner');
    }
  }

  private async ensureReferralCodeUnique(code: string, excludeId?: string): Promise<string> {
    const normalized = code.trim().toUpperCase().replace(/\s+/g, '_');
    const existing = await this.prisma.partner.findFirst({
      where: {
        referralCode: normalized,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException('Referral code already exists');
    }
    return normalized;
  }

  private async generateReferralCode(seedValue: string): Promise<string> {
    const base = seedValue
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 12) || 'PARTNER';

    for (let index = 1; index <= 50; index += 1) {
      const candidate = `${base}_${String(index).padStart(2, '0')}`;
      const exists = await this.prisma.partner.findFirst({
        where: { referralCode: candidate, deletedAt: null },
        select: { id: true },
      });
      if (!exists) return candidate;
    }

    throw new ConflictException('Unable to generate a unique referral code');
  }
}