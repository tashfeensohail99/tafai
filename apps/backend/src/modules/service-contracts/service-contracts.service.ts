import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InstallmentStatus,
  InvoiceStatus,
  Prisma,
  ServiceContractStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CreateServiceContractDto,
  ListServiceContractsQueryDto,
  UpdateServiceContractDto,
} from './service-contracts.dto';

const CONTACT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  referenceCode: true,
} as const;

@Injectable()
export class ServiceContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListServiceContractsQueryDto) {
    const where: Prisma.ServiceContractWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.leadId) where.leadId = query.leadId;
    if (query.clientId) where.clientId = query.clientId;
    if (query.search) {
      const q = query.search.trim();
      where.OR = [
        { contractNumber: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
        {
          lead: {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { referenceCode: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
        {
          client: {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { referenceCode: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    return this.prisma.serviceContract.findMany({
      where,
      include: {
        lead: { select: CONTACT_SELECT },
        client: { select: CONTACT_SELECT },
        installments: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            sequence: true,
            dueDate: true,
            amount: true,
            status: true,
            invoice: { select: { id: true, invoiceNumber: true, status: true, paidAmount: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const contract = await this.prisma.serviceContract.findFirst({
      where: { id, deletedAt: null },
      include: {
        lead: { select: CONTACT_SELECT },
        client: { select: CONTACT_SELECT },
        installments: {
          orderBy: { sequence: 'asc' },
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                status: true,
                totalAmount: true,
                paidAmount: true,
                dueDate: true,
              },
            },
          },
        },
      },
    });
    if (!contract) throw new NotFoundException('Service contract not found');
    return contract;
  }

  async create(dto: CreateServiceContractDto, actorUserId: string) {
    if (!dto.leadId && !dto.clientId) {
      throw new BadRequestException('Either leadId or clientId is required');
    }

    if (dto.leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: dto.leadId, deletedAt: null },
        select: { id: true },
      });
      if (!lead) throw new NotFoundException('Lead not found');
    }
    if (dto.clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: dto.clientId, deletedAt: null },
        select: { id: true },
      });
      if (!client) throw new NotFoundException('Client not found');
    }

    const sumInstallments = dto.installments.reduce((acc, i) => acc + Number(i.amount), 0);
    if (Math.abs(sumInstallments - dto.totalAmount) > 0.01) {
      throw new BadRequestException(
        `Installment amounts (${sumInstallments.toFixed(2)}) must sum to the contract total (${dto.totalAmount.toFixed(2)})`,
      );
    }

    const sequences = new Set(dto.installments.map((i) => i.sequence));
    if (sequences.size !== dto.installments.length) {
      throw new BadRequestException('Installment sequences must be unique');
    }

    const contractNumber = await this.generateContractNumber();

    return this.prisma.serviceContract.create({
      data: {
        contractNumber,
        leadId: dto.leadId,
        clientId: dto.clientId,
        totalAmount: dto.totalAmount.toString(),
        currency: dto.currency ?? 'CAD',
        signedDate: dto.signedDate ? new Date(dto.signedDate) : undefined,
        notes: dto.notes,
        status: dto.signedDate ? ServiceContractStatus.ACTIVE : ServiceContractStatus.DRAFT,
        createdByUserId: actorUserId,
        installments: {
          create: dto.installments.map((i) => ({
            sequence: i.sequence,
            dueDate: new Date(i.dueDate),
            amount: i.amount.toString(),
            description: i.description,
          })),
        },
      },
      include: {
        installments: { orderBy: { sequence: 'asc' } },
      },
    });
  }

  async update(id: string, dto: UpdateServiceContractDto) {
    await this.findById(id);
    return this.prisma.serviceContract.update({
      where: { id },
      data: {
        status: dto.status,
        notes: dto.notes,
        signedDate: dto.signedDate ? new Date(dto.signedDate) : undefined,
      },
    });
  }

  async generateInvoiceForInstallment(installmentId: string, actorUserId: string) {
    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      include: { contract: true },
    });
    if (!installment) throw new NotFoundException('Installment not found');
    if (installment.invoice) {
      throw new BadRequestException('Invoice already generated for this installment');
    }
    if (installment.status === InstallmentStatus.CANCELLED) {
      throw new BadRequestException('Installment is cancelled');
    }
    if (installment.contract.deletedAt) {
      throw new BadRequestException('Contract is deleted');
    }
    if (installment.contract.status === ServiceContractStatus.CANCELLED) {
      throw new BadRequestException('Contract is cancelled');
    }

    const invoiceNumber = await this.generateInvoiceNumber();
    const amount = installment.amount.toString();

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          installmentId: installment.id,
          leadId: installment.contract.leadId,
          clientId: installment.contract.clientId,
          invoiceNumber,
          status: InvoiceStatus.SENT,
          currency: installment.contract.currency,
          subtotal: amount,
          totalAmount: amount,
          dueDate: installment.dueDate,
          notes: installment.description
            ? `Installment ${installment.sequence}: ${installment.description}`
            : `Installment ${installment.sequence} of contract ${installment.contract.contractNumber}`,
          createdByUserId: actorUserId,
        },
      });

      await tx.installment.update({
        where: { id: installment.id },
        data: { status: InstallmentStatus.INVOICED },
      });

      return invoice;
    });
  }

  private async generateContractNumber() {
    const year = new Date().getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const count = await this.prisma.serviceContract.count({
        where: { createdAt: { gte: yearStart, lt: yearEnd } },
      });
      const candidate = `SC-${year}-${String(count + 1 + attempt).padStart(5, '0')}`;
      const existing = await this.prisma.serviceContract.findUnique({
        where: { contractNumber: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    throw new Error('Unable to generate a unique contract number');
  }

  private async generateInvoiceNumber() {
    const year = new Date().getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const count = await this.prisma.invoice.count({
        where: { createdAt: { gte: yearStart, lt: yearEnd } },
      });
      const candidate = `INV-${year}-${String(count + 1 + attempt).padStart(5, '0')}`;
      const existing = await this.prisma.invoice.findUnique({
        where: { invoiceNumber: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    throw new Error('Unable to generate a unique invoice number');
  }
}
