import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  FinanceHandoverStatus,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  TimelineEventType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import { StorageService } from '../storage/storage.service';
import {
  CreateFinanceHandoverDto,
  CreateInvoiceDto,
  CreatePaymentDto,
  FinanceHandoverReviewAction,
  FinanceHandoverReviewDto,
  ListFinanceHandoversQueryDto,
  ListFinanceQueueQueryDto,
  ListInvoicesQueryDto,
  RefundPaymentDto,
  UpdateFinanceHandoverDto,
  UpdateInvoiceDto,
  VerifyPaymentDto,
} from './finance.dto';
import { LeadsService } from '../leads/leads.service';
import { CasesService } from '../cases/cases.service';

type FinanceHandoverRecord = Prisma.FinanceHandoverGetPayload<{
  include: {
    lead: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
        phone: true;
        status: true;
        serviceInterest: true;
        targetCountry: true;
      };
    };
    invoice: {
      include: {
        lead: {
          select: {
            id: true;
            firstName: true;
            lastName: true;
            phone: true;
          };
        };
        client: {
          select: {
            id: true;
            firstName: true;
            lastName: true;
            phone: true;
          };
        };
      };
    };
    payment: true;
  };
}>;

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
    private readonly leadsService: LeadsService,
    private readonly casesService: CasesService,
    private readonly storage: StorageService,
  ) {}

  async listInvoices(query: ListInvoicesQueryDto) {
    return this.prisma.invoice.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.ownerType === 'lead' ? { leadId: { not: null } } : {}),
        ...(query.ownerType === 'client' ? { clientId: { not: null } } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.search
          ? {
              OR: [
                { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
                { notes: { contains: query.search, mode: 'insensitive' } },
                {
                  lead: {
                    OR: [
                      { firstName: { contains: query.search, mode: 'insensitive' } },
                      { lastName: { contains: query.search, mode: 'insensitive' } },
                      { phone: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
                {
                  client: {
                    OR: [
                      { firstName: { contains: query.search, mode: 'insensitive' } },
                      { lastName: { contains: query.search, mode: 'insensitive' } },
                      { phone: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, phone: true, serviceInterest: true, targetCountry: true } },
        client: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findInvoiceById(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        lead: true,
        client: true,
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  /**
   * Revenue grouped by service (immigration service line). Joins through
   * the Lead/Client on each Invoice to pick up `serviceInterest` /
   * `serviceType`. Returns totals for this month, year-to-date, and
   * all-time so the admin Finance page can show a quick rollup card.
   */
  async getRevenueByService(): Promise<{
    asOf: Date;
    totals: { month: number; ytd: number; allTime: number };
    byService: Array<{ service: string; month: number; ytd: number; allTime: number }>;
  }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Pull every verified payment with the invoice + lead/client joined so we
    // can derive the service. Dataset is small enough (months × hundreds of
    // payments) that an in-process group is fine; if it ever grows we'd
    // switch to a $queryRaw with COALESCE on the service columns.
    const payments = await this.prisma.payment.findMany({
      where: {
        status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
        verifiedAt: { not: null },
      },
      select: {
        amount: true,
        verifiedAt: true,
        invoice: {
          select: {
            lead: { select: { serviceInterest: true } },
            client: { select: { serviceType: true } },
          },
        },
      },
    });

    const buckets = new Map<
      string,
      { service: string; month: number; ytd: number; allTime: number }
    >();
    let totalMonth = 0;
    let totalYtd = 0;
    let totalAll = 0;

    for (const p of payments) {
      const amount = Number(p.amount);
      const service =
        p.invoice.client?.serviceType ??
        p.invoice.lead?.serviceInterest ??
        'Unclassified';

      const bucket =
        buckets.get(service) ?? { service, month: 0, ytd: 0, allTime: 0 };
      bucket.allTime += amount;
      totalAll += amount;

      const verifiedAt = p.verifiedAt!;
      if (verifiedAt >= yearStart) {
        bucket.ytd += amount;
        totalYtd += amount;
      }
      if (verifiedAt >= monthStart) {
        bucket.month += amount;
        totalMonth += amount;
      }
      buckets.set(service, bucket);
    }

    return {
      asOf: now,
      totals: { month: totalMonth, ytd: totalYtd, allTime: totalAll },
      byService: Array.from(buckets.values()).sort((a, b) => b.allTime - a.allTime),
    };
  }

  async getQueue(query: ListFinanceQueueQueryDto) {
    return this.prisma.payment.findMany({
      where: {
        status: query.paymentStatus ?? PaymentStatus.PENDING,
        ...(query.search
          ? {
              OR: [
                { paymentMethod: { contains: query.search, mode: 'insensitive' } },
                { transactionRef: { contains: query.search, mode: 'insensitive' } },
                {
                  invoice: {
                    OR: [
                      { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
                      {
                        lead: {
                          OR: [
                            { firstName: { contains: query.search, mode: 'insensitive' } },
                            { lastName: { contains: query.search, mode: 'insensitive' } },
                            { phone: { contains: query.search, mode: 'insensitive' } },
                          ],
                        },
                      },
                      {
                        client: {
                          OR: [
                            { firstName: { contains: query.search, mode: 'insensitive' } },
                            { lastName: { contains: query.search, mode: 'insensitive' } },
                            { phone: { contains: query.search, mode: 'insensitive' } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        invoice: {
          include: {
            lead: { select: { id: true, firstName: true, lastName: true, phone: true, serviceInterest: true, targetCountry: true } },
            client: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listHandovers(query: ListFinanceHandoversQueryDto, user: RequestUser) {
    const handovers = await this.prisma.financeHandover.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...this.buildHandoverScopeFilter(user),
        ...(query.search
          ? {
              OR: [
                { paymentMethod: { contains: query.search, mode: 'insensitive' } },
                { transactionRef: { contains: query.search, mode: 'insensitive' } },
                { notes: { contains: query.search, mode: 'insensitive' } },
                {
                  lead: {
                    OR: [
                      { firstName: { contains: query.search, mode: 'insensitive' } },
                      { lastName: { contains: query.search, mode: 'insensitive' } },
                      { phone: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      include: this.financeHandoverInclude,
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(handovers.map(async (handover) => ({
      ...handover,
      receiptDownloadUrl: await this.getSignedReceiptUrl(handover.receiptKey),
    })));
  }

  async findHandoverByIdAccessible(id: string, user: RequestUser) {
    const handover = await this.prisma.financeHandover.findFirst({
      where: {
        id,
        ...this.buildHandoverScopeFilter(user),
      },
      include: this.financeHandoverInclude,
    });

    if (!handover) {
      throw new NotFoundException('Finance handover not found');
    }

    return {
      ...handover,
      receiptDownloadUrl: await this.getSignedReceiptUrl(handover.receiptKey),
    };
  }

  async createInvoice(dto: CreateInvoiceDto, actorUserId: string) {
    await this.assertInvoiceOwner(dto.leadId, dto.clientId);

    if (dto.leadId) {
      await this.ensureLeadExists(dto.leadId);
    }

    if (dto.clientId) {
      await this.ensureClientExists(dto.clientId);
    }

    const subtotal = Number(dto.subtotal);
    const taxAmount = Number(dto.taxAmount ?? '0');
    const discountAmount = Number(dto.discountAmount ?? '0');
    const totalAmount = dto.totalAmount ? Number(dto.totalAmount) : subtotal + taxAmount - discountAmount;

    const created = await this.prisma.invoice.create({
      data: {
        leadId: dto.leadId,
        clientId: dto.clientId,
        caseId: dto.caseId,
        invoiceNumber: await this.generateInvoiceNumber(),
        status: dto.status ?? InvoiceStatus.SENT,
        currency: dto.currency ?? 'CAD',
        subtotal: subtotal.toString(),
        taxAmount: taxAmount.toString(),
        discountAmount: discountAmount.toString(),
        totalAmount: totalAmount.toString(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        notes: dto.notes,
        createdByUserId: actorUserId,
      },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, phone: true } },
        client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.INVOICE_CREATED,
      entityType: 'Invoice',
      entityId: created.id,
      newValues: {
        invoiceNumber: created.invoiceNumber,
        leadId: created.leadId,
        clientId: created.clientId,
        totalAmount: created.totalAmount,
        status: created.status,
      },
    });

    await this.recordFinanceNote(created.leadId, created.clientId, null, `Finance initiated with invoice ${created.invoiceNumber}`, actorUserId);

    return created;
  }

  async updateInvoice(id: string, dto: UpdateInvoiceDto, actorUserId: string) {
    const existing = await this.findInvoiceById(id);
    const subtotal = dto.subtotal !== undefined ? Number(dto.subtotal) : Number(existing.subtotal);
    const taxAmount = dto.taxAmount !== undefined ? Number(dto.taxAmount) : Number(existing.taxAmount);
    const discountAmount = dto.discountAmount !== undefined ? Number(dto.discountAmount) : Number(existing.discountAmount);
    const totalAmount = dto.totalAmount !== undefined ? Number(dto.totalAmount) : subtotal + taxAmount - discountAmount;

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: dto.status,
        currency: dto.currency,
        subtotal: subtotal.toString(),
        taxAmount: taxAmount.toString(),
        discountAmount: discountAmount.toString(),
        totalAmount: totalAmount.toString(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        notes: dto.notes,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.INVOICE_UPDATED,
      entityType: 'Invoice',
      entityId: id,
      oldValues: {
        status: existing.status,
        subtotal: existing.subtotal,
        totalAmount: existing.totalAmount,
        dueDate: existing.dueDate,
      },
      newValues: dto,
    });

    return this.findInvoiceById(id);
  }

  async recordPayment(dto: CreatePaymentDto, actorUserId: string) {
    const invoice = await this.findInvoiceById(dto.invoiceId);

    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: dto.invoiceId,
        amount: dto.amount,
        currency: dto.currency ?? invoice.currency,
        status: PaymentStatus.PENDING,
        paymentMethod: dto.paymentMethod,
        transactionRef: dto.transactionRef,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        notes: dto.notes,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.PAYMENT_RECORDED,
      entityType: 'Payment',
      entityId: payment.id,
      newValues: {
        invoiceId: payment.invoiceId,
        amount: payment.amount,
        paymentMethod: payment.paymentMethod,
        transactionRef: payment.transactionRef,
        status: payment.status,
      },
    });

    await this.recordFinanceNote(invoice.leadId, invoice.clientId, invoice.caseId, `Payment recorded for invoice ${invoice.invoiceNumber} and queued for finance verification`, actorUserId);

    return payment;
  }

  async createHandover(dto: CreateFinanceHandoverDto, user: RequestUser) {
    const lead = await this.ensureLeadAccessibleForHandover(dto.leadId, user);

    if (dto.invoiceId) {
      await this.ensureInvoiceBelongsToLead(dto.invoiceId, dto.leadId);
    }

    const receiptBuffer = this.decodeBase64(dto.receiptContentBase64);
    const upload = await this.storage.upload(
      receiptBuffer,
      dto.receiptMimeType ?? 'application/octet-stream',
      'finance-handovers',
      dto.receiptFileName,
    );

    const created = await this.prisma.financeHandover.create({
      data: {
        leadId: dto.leadId,
        invoiceId: dto.invoiceId,
        createdByUserId: user.id,
        submittedAmount: dto.submittedAmount,
        currency: dto.currency ?? 'CAD',
        paymentMethod: dto.paymentMethod,
        transactionRef: dto.transactionRef,
        notes: dto.notes,
        receiptKey: upload.key,
        receiptFileName: dto.receiptFileName,
        receiptMimeType: dto.receiptMimeType ?? upload.mimeType,
        receiptSizeBytes: upload.sizeBytes,
      },
      include: this.financeHandoverInclude,
    });

    await this.auditLog.log({
      actorUserId: user.id,
      action: AuditAction.FINANCE_HANDOVER_CREATED,
      entityType: 'FinanceHandover',
      entityId: created.id,
      newValues: {
        leadId: created.leadId,
        invoiceId: created.invoiceId,
        submittedAmount: created.submittedAmount,
        currency: created.currency,
        paymentMethod: created.paymentMethod,
        status: created.status,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: lead.id,
      leadId: lead.id,
      eventType: TimelineEventType.FINANCE_HANDOVER_SUBMITTED,
      description: `Finance handover submitted with receipt ${created.receiptFileName}`,
      actorUserId: user.id,
      metadata: {
        financeHandoverId: created.id,
        submittedAmount: created.submittedAmount,
        currency: created.currency,
        invoiceId: created.invoiceId,
      },
    });

    return {
      ...created,
      receiptDownloadUrl: await this.getSignedReceiptUrl(created.receiptKey),
    };
  }

  async updateHandover(id: string, dto: UpdateFinanceHandoverDto, user: RequestUser) {
    const existing = await this.prisma.financeHandover.findFirst({
      where: { id, createdByUserId: user.id },
      include: this.financeHandoverInclude,
    });

    if (!existing) {
      throw new NotFoundException('Finance handover not found');
    }

    if (!([FinanceHandoverStatus.SUBMITTED, FinanceHandoverStatus.REJECTED] as FinanceHandoverStatus[]).includes(existing.status)) {
      throw new BadRequestException('Only submitted or rejected handovers can be updated');
    }

    if (dto.invoiceId) {
      await this.ensureInvoiceBelongsToLead(dto.invoiceId, existing.leadId);
    }

    let receiptKey = existing.receiptKey;
    let receiptFileName = existing.receiptFileName;
    let receiptMimeType = existing.receiptMimeType;
    let receiptSizeBytes = existing.receiptSizeBytes;

    if (dto.receiptContentBase64) {
      const receiptBuffer = this.decodeBase64(dto.receiptContentBase64);
      const upload = await this.storage.upload(
        receiptBuffer,
        dto.receiptMimeType ?? existing.receiptMimeType ?? 'application/octet-stream',
        'finance-handovers',
        dto.receiptFileName ?? existing.receiptFileName,
      );

      receiptKey = upload.key;
      receiptFileName = dto.receiptFileName ?? existing.receiptFileName;
      receiptMimeType = dto.receiptMimeType ?? upload.mimeType;
      receiptSizeBytes = upload.sizeBytes;

      if (existing.receiptKey) {
        await this.storage.delete(existing.receiptKey).catch(() => undefined);
      }
    }

    const updated = await this.prisma.financeHandover.update({
      where: { id },
      data: {
        invoiceId: dto.invoiceId ?? existing.invoiceId,
        submittedAmount: dto.submittedAmount ?? existing.submittedAmount,
        currency: dto.currency ?? existing.currency,
        paymentMethod: dto.paymentMethod ?? existing.paymentMethod,
        transactionRef: dto.transactionRef ?? existing.transactionRef,
        notes: dto.notes ?? existing.notes,
        receiptKey,
        receiptFileName,
        receiptMimeType,
        receiptSizeBytes,
        status: FinanceHandoverStatus.SUBMITTED,
        reviewedByUserId: null,
        reviewedAt: null,
      },
      include: this.financeHandoverInclude,
    });

    await this.auditLog.log({
      actorUserId: user.id,
      action: AuditAction.FINANCE_HANDOVER_UPDATED,
      entityType: 'FinanceHandover',
      entityId: updated.id,
      oldValues: {
        submittedAmount: existing.submittedAmount,
        paymentMethod: existing.paymentMethod,
        transactionRef: existing.transactionRef,
        status: existing.status,
      },
      newValues: dto,
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: updated.leadId,
      leadId: updated.leadId,
      eventType: TimelineEventType.NOTE_ADDED,
      description: 'Finance handover updated and resubmitted',
      actorUserId: user.id,
      metadata: { financeHandoverId: updated.id },
    });

    return {
      ...updated,
      receiptDownloadUrl: await this.getSignedReceiptUrl(updated.receiptKey),
    };
  }

  async reviewHandover(id: string, dto: FinanceHandoverReviewDto, actorUserId: string) {
    const existing = await this.prisma.financeHandover.findUnique({
      where: { id },
      include: this.financeHandoverInclude,
    });

    if (!existing) {
      throw new NotFoundException('Finance handover not found');
    }

    if (([
      FinanceHandoverStatus.PAYMENT_RECORDED,
      FinanceHandoverStatus.PAYMENT_VERIFIED,
      FinanceHandoverStatus.CANCELLED,
    ] as FinanceHandoverStatus[]).includes(existing.status)) {
      throw new BadRequestException('This finance handover can no longer be reviewed');
    }

    if (dto.action === FinanceHandoverReviewAction.MARK_IN_REVIEW) {
      const inReview = await this.prisma.financeHandover.update({
        where: { id },
        data: {
          status: FinanceHandoverStatus.IN_REVIEW,
          reviewedByUserId: actorUserId,
          reviewedAt: new Date(),
          financeNotes: dto.financeNotes ?? existing.financeNotes,
        },
        include: this.financeHandoverInclude,
      });

      await this.auditLog.log({
        actorUserId,
        action: AuditAction.FINANCE_HANDOVER_REVIEWED,
        entityType: 'FinanceHandover',
        entityId: id,
        oldValues: { status: existing.status },
        newValues: { status: inReview.status, financeNotes: dto.financeNotes },
      });

      await this.activityTimeline.record({
        entityType: 'Lead',
        entityId: inReview.leadId,
        leadId: inReview.leadId,
        eventType: TimelineEventType.FINANCE_HANDOVER_REVIEWED,
        description: 'Finance handover moved into review',
        actorUserId,
        metadata: { financeHandoverId: id },
      });

      return {
        ...inReview,
        receiptDownloadUrl: await this.getSignedReceiptUrl(inReview.receiptKey),
      };
    }

    if (dto.action === FinanceHandoverReviewAction.REJECT) {
      // If the operator already clicked "Verify payment" once (which
      // ran RECORD_PAYMENT and created an Invoice + a PENDING Payment
      // row) and is now rejecting, those rows would otherwise sit
      // orphaned in the database. The next handover for the same lead
      // would create yet another Invoice, and any aggregate over the
      // lead's invoices/payments would double-count the rejected
      // attempt as money still owed/received. Void them here so the
      // ledger reflects reality.
      //
      // We use updateMany with a status-guard so a Payment that's
      // already been verified (status: PAID/PARTIAL) is not touched —
      // that would only happen if someone reverses verification, which
      // isn't a supported flow today, but the guard is cheap insurance.
      if (existing.paymentId) {
        await this.prisma.payment.updateMany({
          where: {
            id: existing.paymentId,
            status: PaymentStatus.PENDING,
          },
          data: { status: PaymentStatus.CANCELLED },
        });
      }
      if (existing.invoiceId) {
        await this.prisma.invoice.updateMany({
          where: {
            id: existing.invoiceId,
            // Only cancel an invoice that hasn't been paid yet. If the
            // invoice already shows partial/full payment we leave it
            // alone — that money is real and live elsewhere.
            status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.SENT] },
          },
          data: { status: InvoiceStatus.CANCELLED },
        });
      }

      const rejected = await this.prisma.financeHandover.update({
        where: { id },
        data: {
          status: FinanceHandoverStatus.REJECTED,
          reviewedByUserId: actorUserId,
          reviewedAt: new Date(),
          financeNotes: dto.financeNotes ?? existing.financeNotes,
        },
        include: this.financeHandoverInclude,
      });

      await this.auditLog.log({
        actorUserId,
        action: AuditAction.FINANCE_HANDOVER_REVIEWED,
        entityType: 'FinanceHandover',
        entityId: id,
        oldValues: { status: existing.status },
        newValues: {
          status: rejected.status,
          financeNotes: dto.financeNotes,
          voidedInvoiceId: existing.invoiceId,
          voidedPaymentId: existing.paymentId,
        },
      });

      await this.activityTimeline.record({
        entityType: 'Lead',
        entityId: rejected.leadId,
        leadId: rejected.leadId,
        eventType: TimelineEventType.FINANCE_HANDOVER_REVIEWED,
        description: existing.invoiceId
          ? 'Finance handover rejected and returned to sales (recorded invoice + payment voided)'
          : 'Finance handover rejected and returned to sales',
        actorUserId,
        metadata: {
          financeHandoverId: id,
          voidedInvoiceId: existing.invoiceId,
          voidedPaymentId: existing.paymentId,
        },
      });

      return {
        ...rejected,
        receiptDownloadUrl: await this.getSignedReceiptUrl(rejected.receiptKey),
      };
    }

    const invoice = existing.invoiceId
      ? await this.findInvoiceById(existing.invoiceId)
      : dto.invoiceId
        ? await this.findInvoiceById(dto.invoiceId)
        : await this.createInvoice(
          {
            leadId: existing.leadId,
            subtotal: existing.submittedAmount.toString(),
            taxAmount: '0',
            discountAmount: '0',
            currency: existing.currency,
            dueDate: dto.dueDate,
            notes: `Created from finance handover ${existing.id}`,
          },
          actorUserId,
        );

    if (invoice.leadId !== existing.leadId) {
      throw new BadRequestException('Selected invoice does not belong to this lead');
    }

    const payment = await this.recordPayment(
      {
        invoiceId: invoice.id,
        amount: existing.submittedAmount.toString(),
        currency: existing.currency,
        paymentMethod: dto.paymentMethod ?? existing.paymentMethod ?? undefined,
        transactionRef: dto.transactionRef ?? existing.transactionRef ?? undefined,
        notes: this.combineNotes(
          `Created from finance handover ${existing.id}`,
          existing.notes,
          dto.financeNotes,
        ) ?? undefined,
      },
      actorUserId,
    );

    const recorded = await this.prisma.financeHandover.update({
      where: { id },
      data: {
        invoiceId: invoice.id,
        paymentId: payment.id,
        status: FinanceHandoverStatus.PAYMENT_RECORDED,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        financeNotes: dto.financeNotes ?? existing.financeNotes,
      },
      include: this.financeHandoverInclude,
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.FINANCE_HANDOVER_REVIEWED,
      entityType: 'FinanceHandover',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: recorded.status,
        invoiceId: invoice.id,
        paymentId: payment.id,
        financeNotes: dto.financeNotes,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: recorded.leadId,
      leadId: recorded.leadId,
      eventType: TimelineEventType.FINANCE_HANDOVER_REVIEWED,
      description: `Finance handover recorded against invoice ${invoice.invoiceNumber}`,
      actorUserId,
      metadata: { financeHandoverId: id, invoiceId: invoice.id, paymentId: payment.id },
    });

    return {
      ...recorded,
      receiptDownloadUrl: await this.getSignedReceiptUrl(recorded.receiptKey),
    };
  }

  async verifyPayment(id: string, dto: VerifyPaymentDto, actorUserId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        financeHandover: true,
        invoice: {
          include: {
            lead: true,
            client: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException('Only pending payments can be verified');
    }

    let clientId = payment.invoice.clientId;
    if (!clientId && payment.invoice.leadId) {
      const conversion = await this.leadsService.convertToClient(payment.invoice.leadId, actorUserId);
      clientId = conversion.client.id;
    }

    const newPaidAmount = Number(payment.invoice.paidAmount) + Number(payment.amount);
    const totalAmount = Number(payment.invoice.totalAmount);
    const invoiceStatus = newPaidAmount >= totalAmount ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
    const paymentStatus = newPaidAmount >= totalAmount ? PaymentStatus.PAID : PaymentStatus.PARTIAL;

    const updatedPayment = await this.prisma.payment.update({
      where: { id },
      data: {
        status: paymentStatus,
        verifiedByUserId: actorUserId,
        verifiedAt: new Date(),
        notes: dto.notes ? [payment.notes, dto.notes].filter(Boolean).join('\n\n') : payment.notes,
      },
    });

    let caseId = payment.invoice.caseId;
    if (!caseId && clientId && payment.invoice.lead) {
      const createdCase = await this.casesService.createFromVerifiedPayment({
        clientId,
        actorUserId,
        serviceType: payment.invoice.lead.serviceInterest ?? 'General Service',
        targetCountry: payment.invoice.lead.targetCountry ?? 'General',
        assignedEmployeeId: payment.invoice.lead.assignedEmployeeId,
        notes: 'Created automatically after finance verified the initial payment.',
      });
      caseId = createdCase.id;
    }

    const updatedInvoice = await this.prisma.invoice.update({
      where: { id: payment.invoiceId },
      data: {
        clientId,
        caseId,
        paidAmount: newPaidAmount.toString(),
        status: invoiceStatus,
      },
      include: {
        lead: true,
        client: true,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.PAYMENT_VERIFIED,
      entityType: 'Payment',
      entityId: updatedPayment.id,
      oldValues: { status: payment.status },
      newValues: {
        status: updatedPayment.status,
        verifiedByUserId: updatedPayment.verifiedByUserId,
        verifiedAt: updatedPayment.verifiedAt,
        invoiceStatus,
        clientId,
        caseId,
      },
    });

    await this.recordPaymentTimeline(updatedInvoice.leadId, updatedInvoice.clientId, updatedInvoice.caseId, `Payment verified for invoice ${payment.invoice.invoiceNumber}`, actorUserId);

    if (payment.financeHandover) {
      await this.prisma.financeHandover.update({
        where: { id: payment.financeHandover.id },
        data: {
          status: FinanceHandoverStatus.PAYMENT_VERIFIED,
          reviewedByUserId: actorUserId,
          reviewedAt: new Date(),
        },
      });
    }

    return {
      payment: updatedPayment,
      invoice: updatedInvoice,
      caseId,
      clientId,
    };
  }

  async refundPayment(id: string, dto: RefundPaymentDto, actorUserId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { invoice: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== PaymentStatus.PAID && payment.status !== PaymentStatus.PARTIAL) {
      throw new BadRequestException('Only verified payments can be refunded');
    }

    const updatedPayment = await this.prisma.payment.update({
      where: { id },
      data: {
        status: PaymentStatus.REFUNDED,
        notes: dto.notes ? [payment.notes, dto.notes].filter(Boolean).join('\n\n') : payment.notes,
      },
    });

    const newPaidAmount = Math.max(Number(payment.invoice.paidAmount) - Number(payment.amount), 0);
    await this.prisma.invoice.update({
      where: { id: payment.invoiceId },
      data: {
        paidAmount: newPaidAmount.toString(),
        status: newPaidAmount === 0 ? InvoiceStatus.SENT : InvoiceStatus.PARTIALLY_PAID,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.PAYMENT_REFUNDED,
      entityType: 'Payment',
      entityId: id,
      oldValues: { status: payment.status },
      newValues: { status: PaymentStatus.REFUNDED, notes: dto.notes },
    });

    return updatedPayment;
  }

  private async ensureLeadExists(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId, deletedAt: null },
      select: { id: true },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
  }

  private async ensureLeadAccessibleForHandover(leadId: string, user: RequestUser) {
    const canViewAll = user.permissions.includes('finance_handover.view_all') || user.permissions.includes('leads.view_all');

    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        deletedAt: null,
        ...(!canViewAll
          ? {
              OR: [
                { assignedEmployee: { userId: user.id } },
                { createdByUserId: user.id },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        status: true,
        assignedEmployeeId: true,
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return lead;
  }

  private async ensureClientExists(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }
  }

  private async assertInvoiceOwner(leadId?: string, clientId?: string) {
    if (!leadId && !clientId) {
      throw new BadRequestException('An invoice must belong to either a lead or a client');
    }

    if (leadId && clientId) {
      throw new BadRequestException('An invoice cannot belong to both a lead and a client at creation time');
    }
  }

  private async generateInvoiceNumber() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
      const suffix = Math.random().toString().slice(2, 6);
      const invoiceNumber = `INV-${timestamp}-${suffix}`;
      const existing = await this.prisma.invoice.findUnique({
        where: { invoiceNumber },
        select: { id: true },
      });

      if (!existing) {
        return invoiceNumber;
      }
    }

    throw new Error('Unable to generate a unique invoice number');
  }

  private buildHandoverScopeFilter(user: RequestUser): Prisma.FinanceHandoverWhereInput {
    if (user.permissions.includes('finance_handover.view_all')) {
      return {};
    }

    if (!user.permissions.includes('finance_handover.view_own')) {
      throw new ForbiddenException('You do not have access to finance handovers');
    }

    return {
      OR: [
        { createdByUserId: user.id },
        { lead: { assignedEmployee: { userId: user.id } } },
      ],
    };
  }

  private async ensureInvoiceBelongsToLead(invoiceId: string, leadId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, leadId: true },
    });

    if (!invoice || invoice.leadId !== leadId) {
      throw new BadRequestException('Invoice does not belong to the selected lead');
    }
  }

  private decodeBase64(value: string) {
    const normalised = value.includes(',') ? value.split(',').pop() ?? '' : value;
    const buffer = Buffer.from(normalised, 'base64');

    if (!buffer.length) {
      throw new BadRequestException('Receipt content is empty');
    }

    if (buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Receipt uploads must be 10 MB or smaller');
    }

    return buffer;
  }

  private combineNotes(...parts: Array<string | null | undefined>) {
    const lines = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
    return lines.length > 0 ? lines.join('\n\n') : null;
  }

  private async getSignedReceiptUrl(receiptKey: string) {
    return this.storage.getSignedUrl(receiptKey).catch(() => null);
  }

  private readonly financeHandoverInclude = {
    lead: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        status: true,
        serviceInterest: true,
        targetCountry: true,
      },
    },
    invoice: {
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, phone: true } },
        client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    },
    payment: true,
  } satisfies Prisma.FinanceHandoverInclude;

  private async recordFinanceNote(
    leadId: string | null,
    clientId: string | null,
    caseId: string | null,
    description: string,
    actorUserId: string,
  ) {
    if (leadId) {
      await this.activityTimeline.record({
        entityType: 'Lead',
        entityId: leadId,
        leadId,
        eventType: TimelineEventType.NOTE_ADDED,
        description,
        actorUserId,
      });
    }

    if (clientId) {
      await this.activityTimeline.record({
        entityType: caseId ? 'Case' : 'Client',
        entityId: caseId ?? clientId,
        clientId,
        caseId: caseId ?? undefined,
        eventType: TimelineEventType.NOTE_ADDED,
        description,
        actorUserId,
      });
    }
  }

  private async recordPaymentTimeline(
    leadId: string | null,
    clientId: string | null,
    caseId: string | null,
    description: string,
    actorUserId: string,
  ) {
    if (leadId) {
      await this.activityTimeline.record({
        entityType: 'Lead',
        entityId: leadId,
        leadId,
        clientId: clientId ?? undefined,
        eventType: TimelineEventType.PAYMENT_RECEIVED,
        description,
        actorUserId,
      });
    }

    if (clientId) {
      await this.activityTimeline.record({
        entityType: caseId ? 'Case' : 'Client',
        entityId: caseId ?? clientId,
        clientId,
        caseId: caseId ?? undefined,
        eventType: TimelineEventType.PAYMENT_RECEIVED,
        description,
        actorUserId,
      });
    }
  }
}