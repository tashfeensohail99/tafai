import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, ClientStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { generateOrphanClientReferenceCode } from '../../common/reference-codes/reference-codes';
import { matchAllTokens } from '../../common/search/multi-word-search';
import {
  looksLikePhoneSearch,
  phoneSearchCandidates,
} from '../../common/phone/phone-search.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateClientDto, ListClientsQueryDto, UpdateClientDto } from './clients.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Client ids whose stored phone is the same number as the typed term in any
   * format — the client mirror of the lead lookup. A client converted from a
   * lead carries the canonical `+92…`, while staff search the local `0…` form.
   */
  private async phoneSearchClientIds(term: string): Promise<string[]> {
    if (!looksLikePhoneSearch(term)) return [];
    const candidates = phoneSearchCandidates(term);
    if (!candidates.length) return [];
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM crm.clients
      WHERE regexp_replace(phone, '[^0-9]', '', 'g') IN (${Prisma.join(candidates)})
        AND "deletedAt" IS NULL
      LIMIT 500`;
    return rows.map((r) => r.id);
  }

  async findAll(query: ListClientsQueryDto) {
    const phoneMatchIds = query.search ? await this.phoneSearchClientIds(query.search) : [];
    // Multi-word search: each token must hit ONE of the direct fields, OR the
    // client's id is in the pre-computed phone-digit set. Same fix as #269 in
    // processing — "abdul qadir" now matches a client with firstName Abdul,
    // lastName Qadir. See common/search/multi-word-search.ts.
    const tokenMatch = query.search
      ? matchAllTokens(query.search, (tok): Prisma.ClientWhereInput => ({
          OR: [
            { firstName: { contains: tok, mode: 'insensitive' } },
            { lastName: { contains: tok, mode: 'insensitive' } },
            { email: { contains: tok, mode: 'insensitive' } },
            { phone: { contains: tok, mode: 'insensitive' } },
          ],
        }))
      : undefined;
    const searchOrClauses: Prisma.ClientWhereInput[] = [];
    if (tokenMatch) searchOrClauses.push(tokenMatch);
    if (phoneMatchIds.length) searchOrClauses.push({ id: { in: phoneMatchIds } });

    return this.prisma.client.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(searchOrClauses.length ? { OR: searchOrClauses } : {}),
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

  /**
   * Create a DEPENDENT applicant under a payer client — an additional person
   * (family / group member) who shares the payer's phone/email contact. The
   * dependent gets its OWN reference code (file number) + Processing case +
   * finance ledger, but NO phone of its own (the payer is the single contact
   * point). This lets one payer carry several applicants without the unique-
   * phone collision that used to force them all onto one lead + file number.
   */
  async createDependentApplicant(
    payerClientId: string,
    dto: {
      firstName: string;
      lastName: string;
      cnic?: string | null;
      nationality?: string | null;
      serviceType?: string | null;
      targetCountry?: string | null;
    },
    actorUserId: string,
  ) {
    const payer = await this.prisma.client.findFirst({ where: { id: payerClientId, deletedAt: null } });
    if (!payer) throw new NotFoundException('Payer client not found');
    if (payer.payerClientId) {
      throw new ConflictException('That client is itself a dependent — add applicants under the top-level payer.');
    }
    const firstName = dto.firstName?.trim();
    const lastName = dto.lastName?.trim();
    if (!firstName || !lastName) throw new ConflictException('An applicant needs a first and last name.');

    const referenceCode = await generateOrphanClientReferenceCode(this.prisma);
    const dependent = await this.prisma.client.create({
      data: {
        referenceCode,
        firstName,
        lastName,
        cnic: dto.cnic?.trim() || null,
        nationality: dto.nationality ?? payer.nationality,
        phone: null, // no contact of its own — reached through the payer
        email: null,
        payerClientId: payer.id,
        branchId: payer.branchId,
        assignedEmployeeId: payer.assignedEmployeeId,
        sourceLeadId: payer.sourceLeadId,
        serviceType: dto.serviceType ?? payer.serviceType,
        targetCountry: dto.targetCountry ?? payer.targetCountry,
        status: ClientStatus.NEW_CLIENT,
        createdByUserId: actorUserId,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.CLIENT_CREATED,
      entityType: 'Client',
      entityId: dependent.id,
      newValues: { firstName, lastName, referenceCode, payerClientId: payer.id, dependent: true },
    });

    return dependent;
  }

  /**
   * Point an agreement (+ its non-cancelled invoices) at a specific applicant
   * client, and swap the agreement's bioData/document file number to that
   * applicant's own reference code — moving an agreement that was created for a
   * family member off the payer's/lead's shared file onto the applicant's own.
   * Money is untouched; only attribution + the file identifier move.
   */
  async assignAgreementApplicant(agreementId: string, clientId: string, actorUserId: string) {
    const [agreement, client] = await Promise.all([
      this.prisma.agreement.findFirst({ where: { id: agreementId, deletedAt: null } }),
      this.prisma.client.findFirst({ where: { id: clientId, deletedAt: null } }),
    ]);
    if (!agreement) throw new NotFoundException('Agreement not found');
    if (!client) throw new NotFoundException('Applicant client not found');

    const bio = (agreement.bioData ?? {}) as Record<string, unknown>;
    const oldFile = typeof bio.fileNumber === 'string' ? bio.fileNumber : null;
    const newBio = { ...bio, fileNumber: client.referenceCode };
    // Swap the (unique) file-number token in the stored document too, and null
    // the cached PDF so it re-renders with the applicant's own file number.
    const newHtml =
      oldFile && agreement.contentHtml
        ? agreement.contentHtml.split(oldFile).join(client.referenceCode)
        : agreement.contentHtml;

    await this.prisma.$transaction([
      this.prisma.agreement.update({
        where: { id: agreement.id },
        data: {
          clientId: client.id,
          bioData: newBio as unknown as Prisma.InputJsonValue,
          ...(newHtml !== agreement.contentHtml
            ? { contentHtml: newHtml, generatedPdfKey: null, generatedPdfAt: null }
            : {}),
        },
      }),
      this.prisma.invoice.updateMany({
        where: { agreementId: agreement.id, deletedAt: null },
        data: { clientId: client.id },
      }),
    ]);

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.CLIENT_UPDATED,
      entityType: 'Agreement',
      entityId: agreement.id,
      oldValues: { clientId: agreement.clientId, fileNumber: oldFile },
      newValues: {
        clientId: client.id,
        fileNumber: client.referenceCode,
        applicant: `${client.firstName} ${client.lastName}`.trim(),
      },
    });

    return { ok: true, agreementId: agreement.id, clientId: client.id, fileNumber: client.referenceCode };
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