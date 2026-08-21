import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { CreateCounselDto, UpdateCounselDto } from './judicial-review.dto';

/**
 * The JR counsel directory (jr.counsel.manage). A JrCounsel is a lawyer/firm the
 * desk can set as a matter's counsel of record (setCounselOfRecord) or that
 * records a matter's merits view (recordMerits) — both of which require a live
 * JrCounsel.id. This is the only surface that creates/edits those rows; without
 * it the RETAINED gate can never be satisfied.
 *
 * Every mutation writes a JrAuditLog row (matterId: null — counsel is a
 * cross-matter directory entry) inside the same transaction, mirroring the JR
 * services' audit convention. Counsel directory data is not client work-product,
 * so the controller captures the request body.
 */
@Injectable()
export class JrCounselService {
  constructor(private readonly prisma: PrismaService) {}

  /** List counsel, optionally active-only, ordered by legal name. */
  async list(activeOnly: boolean) {
    return this.prisma.jrCounsel.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { legalName: 'asc' },
    });
  }

  /** Create a counsel directory entry. */
  async create(dto: CreateCounselDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.jrCounsel.create({
        data: {
          legalName: dto.legalName,
          firmName: dto.firmName,
          lawSocietyProvince: dto.lawSocietyProvince,
          licenceNumber: dto.licenceNumber,
          email: dto.email,
          addressForServiceCanada: dto.addressForServiceCanada,
          directoryUrl: dto.directoryUrl ?? null,
          phone: dto.phone ?? null,
          notes: dto.notes ?? null,
        },
      });
      await this.writeAudit(tx, {
        actorUserId: user.id,
        action: 'counsel_created',
        entityId: created.id,
        newValues: {
          legalName: created.legalName,
          firmName: created.firmName,
          lawSocietyProvince: created.lawSocietyProvince,
          licenceNumber: created.licenceNumber,
        },
      });
      return created;
    });
  }

  /** Edit a counsel entry (only the supplied fields; 404 if missing). */
  async update(id: string, dto: UpdateCounselDto, user: RequestUser) {
    const existing = await this.prisma.jrCounsel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Counsel not found');

    const data: Prisma.JrCounselUpdateInput = {};
    if (dto.legalName !== undefined) data.legalName = dto.legalName;
    if (dto.firmName !== undefined) data.firmName = dto.firmName;
    if (dto.lawSocietyProvince !== undefined) data.lawSocietyProvince = dto.lawSocietyProvince;
    if (dto.licenceNumber !== undefined) data.licenceNumber = dto.licenceNumber;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.addressForServiceCanada !== undefined)
      data.addressForServiceCanada = dto.addressForServiceCanada;
    if (dto.directoryUrl !== undefined) data.directoryUrl = dto.directoryUrl;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.goodStandingVerifiedAt !== undefined)
      data.goodStandingVerifiedAt = new Date(dto.goodStandingVerifiedAt);

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrCounsel.update({ where: { id }, data });
      await this.writeAudit(tx, {
        actorUserId: user.id,
        action: 'counsel_updated',
        entityId: id,
        oldValues: { isActive: existing.isActive, goodStandingVerifiedAt: existing.goodStandingVerifiedAt },
        newValues: { isActive: next.isActive, goodStandingVerifiedAt: next.goodStandingVerifiedAt },
      });
      return next;
    });
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    input: {
      actorUserId: string;
      action: string;
      entityId: string;
      oldValues?: Prisma.InputJsonValue;
      newValues?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.jrAuditLog.create({
      data: {
        matterId: null,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: 'JrCounsel',
        entityId: input.entityId,
        oldValues: input.oldValues,
        newValues: input.newValues,
      },
    });
  }
}
