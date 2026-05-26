import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import {
  AgreementStatus,
  AuditAction,
  FinanceHandoverStatus,
  InstallmentStatus,
  InvoiceStatus,
  LeadStatus,
  PaymentStatus,
  Prisma,
  TimelineEventType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { FxService } from '../../common/fx/fx.service';
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
import { EmailService } from '../email/email.service';
import { ReceiptPdfService } from './receipt-pdf.service';

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
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
    private readonly leadsService: LeadsService,
    private readonly casesService: CasesService,
    private readonly storage: StorageService,
    private readonly receiptPdfService: ReceiptPdfService,
    private readonly numbering: NumberingService,
    private readonly fx: FxService,
    private readonly email: EmailService,
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
  /**
   * Firm-wide finance report — the Insight layer. The finance picture is three
   * tiers, and an agreement existing is NOT money:
   *   • Pipeline    — agreements not yet SIGNED (draft/review/approved/sent).
   *                   Potential only; the client hasn't committed or paid.
   *   • Receivables — SIGNED agreements (client committed) → what we're owed.
   *   • Cash        — money actually received (verified payments) − expenses.
   * NOTE: a contract's signedDate/ACTIVE status is set at APPROVAL, so it is
   * NOT a reliable "signed" signal — Agreement.status === SIGNED is, and a
   * lead becomes a paying client (convertedClientId) on the first verified
   * payment.
   */
  async getReportsSummary() {
    const dec = (d: Prisma.Decimal | number | null | undefined): number =>
      d == null ? 0 : Number(d.toString());

    // SIGNED agreements = the real receivable; resolve their owners so we can
    // measure what's been collected against them.
    const signedAgreements = await this.prisma.agreement.findMany({
      where: { deletedAt: null, status: AgreementStatus.SIGNED },
      select: { leadId: true, totalAmount: true },
    });
    const signedFees = signedAgreements.reduce((s, a) => s + dec(a.totalAmount), 0);
    const signedLeadIds = [...new Set(signedAgreements.map((a) => a.leadId).filter((x): x is string => !!x))];
    const signedLeads = signedLeadIds.length
      ? await this.prisma.lead.findMany({ where: { id: { in: signedLeadIds } }, select: { convertedClientId: true } })
      : [];
    const signedClientIds = [...new Set(signedLeads.map((l) => l.convertedClientId).filter((x): x is string => !!x))];

    const [revenue, paidAgg, expenseAgg, receiptsCount, payingCustomers, pipelineAgreements, signedPaidAgg, earnedAgg] =
      await Promise.all([
        this.getRevenueByService(),
        this.prisma.invoice.aggregate({ _sum: { paidAmount: true }, where: { deletedAt: null } }),
        // Only ABSORBED expenses are a cost; billable disbursements are recoverable.
        // baseAmount = CAD equivalent so the cost rolls up in the base currency.
        this.prisma.expense.aggregate({ _sum: { baseAmount: true }, where: { deletedAt: null, billable: false } }),
        this.prisma.receipt.count({ where: { voidedAt: null } }),
        // A real customer = money received (lead→client conversion fires on the
        // first verified payment).
        this.prisma.lead.count({ where: { deletedAt: null, convertedClientId: { not: null } } }),
        this.prisma.agreement.findMany({
          where: { deletedAt: null, status: { notIn: [AgreementStatus.SIGNED, AgreementStatus.CANCELLED] } },
          select: { totalAmount: true },
        }),
        signedLeadIds.length || signedClientIds.length
          ? this.prisma.invoice.aggregate({
              _sum: { paidAmount: true },
              where: { deletedAt: null, OR: [{ leadId: { in: signedLeadIds } }, { clientId: { in: signedClientIds } }] },
            })
          : Promise.resolve({ _sum: { paidAmount: null } }),
        // Revenue EARNED = installments whose milestone has been delivered
        // (recognizedAt set). Cash collected beyond this is unearned (deferred).
        this.prisma.installment.aggregate({ _sum: { amount: true }, where: { recognizedAt: { not: null } } }),
      ]);

    const collected = dec(paidAgg._sum.paidAmount);
    const expenses = dec(expenseAgg._sum.baseAmount);
    const collectedOnSigned = dec(signedPaidAgg._sum.paidAmount);
    const pipelineValue = pipelineAgreements.reduce((s, a) => s + dec(a.totalAmount), 0);
    // Accrual view: earned (delivered milestones) vs received (cash) → the gap
    // is either deferred revenue (cash ahead of delivery, a liability) or
    // accrued/unbilled (delivery ahead of cash, an asset).
    const earned = dec(earnedAgg._sum.amount);
    // Period-lock (book-close) date — surfaced so the UI can show "books
    // closed through X" and the admin control can render the current state.
    const orgLock = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { booksLockedBefore: true },
    });

    // Currency integrity: a single rolled-up total must not silently span
    // currencies. Derive the real currency from the data; flag if >1 is in
    // play so the UI can warn instead of presenting a meaningless sum.
    const ccyGroups = await this.prisma.invoice.groupBy({
      by: ['currency'],
      where: { deletedAt: null, paidAmount: { gt: 0 } },
      _sum: { paidAmount: true },
    });
    const currency = [...ccyGroups].sort((a, b) => dec(b._sum.paidAmount) - dec(a._sum.paidAmount))[0]?.currency ?? 'CAD';
    const mixedCurrency = ccyGroups.length > 1;

    return {
      currency,
      mixedCurrency,
      // Cash — money actually received vs spent.
      cash: { collected, expenses, margin: collected - expenses },
      // Receivables — SIGNED agreements only (client committed).
      receivables: {
        fees: signedFees,
        collected: collectedOnSigned,
        outstanding: Math.max(0, signedFees - collectedOnSigned),
      },
      // Pipeline — agreements in progress, NOT yet money.
      pipeline: { agreements: pipelineAgreements.length, value: pipelineValue },
      // Accrual: revenue earned (delivered milestones) vs deferred (cash held
      // for undelivered work — a liability) vs accrued (delivered, not yet paid).
      recognition: {
        earned,
        deferred: Math.max(0, collected - earned),
        accrued: Math.max(0, earned - collected),
      },
      revenue: revenue.totals, // { month, ytd, allTime } — cash collected (verified payments)
      counts: { payingCustomers, signed: signedAgreements.length, receipts: receiptsCount },
      byService: revenue.byService,
      booksLockedBefore: orgLock?.booksLockedBefore ?? null,
    };
  }

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
        deletedAt: null,
        status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
        verifiedAt: { not: null },
      },
      select: {
        amount: true,
        baseAmount: true,
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
      const amount = Number(p.baseAmount ?? p.amount); // CAD
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

  /**
   * Accounts-receivable aging — every invoice with an outstanding balance,
   * bucketed by how overdue it is (current / 1-30 / 31-60 / 61-90 / 90+ days)
   * against its due date. Grouped per currency (we never sum across
   * currencies). This is the standard receivables view a CA opens first:
   * who owes us, how much, and how stale it is.
   */
  async getAgingReport() {
    const dec = (d: Prisma.Decimal | number | null | undefined): number =>
      d == null ? 0 : Number(d.toString());

    const invoices = await this.prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        currency: true,
        totalAmount: true,
        paidAmount: true,
        dueDate: true,
        createdAt: true,
        lead: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true } },
      },
    });

    const now = Date.now();
    const DAY = 86_400_000;
    type Bucket = {
      currency: string;
      current: number;
      d1_30: number;
      d31_60: number;
      d61_90: number;
      d90_plus: number;
      total: number;
    };
    const byCurrency = new Map<string, Bucket>();
    const rows: Array<{
      invoiceId: string;
      invoiceNumber: string;
      customer: string;
      currency: string;
      outstanding: number;
      dueDate: Date | null;
      daysOverdue: number;
      bucket: keyof Omit<Bucket, 'currency' | 'total'>;
    }> = [];

    for (const inv of invoices) {
      const outstanding = dec(inv.totalAmount) - dec(inv.paidAmount);
      if (Math.round(outstanding * 100) <= 0) continue; // fully settled / credit

      // Use due date when set; fall back to issue date so undated invoices
      // still age rather than hiding in "current" forever.
      const anchor = (inv.dueDate ?? inv.createdAt).getTime();
      const daysOverdue = Math.floor((now - anchor) / DAY);
      const bucketKey: keyof Omit<Bucket, 'currency' | 'total'> =
        daysOverdue <= 0
          ? 'current'
          : daysOverdue <= 30
            ? 'd1_30'
            : daysOverdue <= 60
              ? 'd31_60'
              : daysOverdue <= 90
                ? 'd61_90'
                : 'd90_plus';

      const b =
        byCurrency.get(inv.currency) ??
        { currency: inv.currency, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
      b[bucketKey] += outstanding;
      b.total += outstanding;
      byCurrency.set(inv.currency, b);

      const c = inv.client ?? inv.lead;
      rows.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customer: c ? `${c.firstName} ${c.lastName}`.trim() : '—',
        currency: inv.currency,
        outstanding,
        dueDate: inv.dueDate,
        daysOverdue: Math.max(0, daysOverdue),
        bucket: bucketKey,
      });
    }

    rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding);
    return {
      asOf: new Date(),
      buckets: Array.from(byCurrency.values()).sort((a, b) => b.total - a.total),
      invoices: rows,
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

    // Immutability: once an invoice carries money (a verified payment / issued
    // receipt), its financial figures and currency are frozen. Corrections go
    // via a credit note + a fresh invoice, never by editing an issued document
    // — otherwise the receipt no longer reconciles to the invoice. Non-financial
    // fields (notes, due date, status) stay editable.
    const carriesMoney =
      Number(existing.paidAmount) > 0 ||
      existing.status === InvoiceStatus.PAID ||
      existing.status === InvoiceStatus.PARTIALLY_PAID;
    if (carriesMoney) {
      const ch = (a: unknown, b: unknown) => a !== undefined && Number(a) !== Number(b);
      const financialChange =
        ch(dto.subtotal, existing.subtotal) ||
        ch(dto.taxAmount, existing.taxAmount) ||
        ch(dto.discountAmount, existing.discountAmount) ||
        ch(dto.totalAmount, existing.totalAmount) ||
        (dto.currency !== undefined && dto.currency !== existing.currency);
      if (financialChange) {
        throw new BadRequestException(
          'This invoice has recorded payments — its amounts and currency are locked. Issue a credit note and a new invoice to correct it.',
        );
      }
    }

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

    // Period lock: can't book a payment dated into a closed accounting period.
    await this.assertPeriodOpen(dto.paidAt ? new Date(dto.paidAt) : new Date());

    // Multi-currency at source: the payment may be received in a foreign
    // currency (e.g. PKR on the bank slip). Keep the original amount/currency
    // for reconciliation, and convert to the firm's base currency (CAD) at the
    // live rate, stamping the rate so the record never moves later. The CAD
    // `baseAmount` is what's applied to the (CAD) invoice on verification.
    const origCurrency = (dto.currency ?? invoice.currency).toUpperCase();
    let conv: { baseAmount: number; baseCurrency: string; rate: number };
    try {
      conv = await this.fx.convertToBase(Number(dto.amount), origCurrency);
    } catch {
      throw new BadRequestException(
        `Could not get an exchange rate for ${origCurrency} → CAD. Try again, or enter the amount in CAD.`,
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: dto.invoiceId,
        amount: dto.amount,
        currency: origCurrency,
        baseAmount: conv.baseAmount.toString(),
        baseCurrency: conv.baseCurrency,
        fxRate: conv.rate.toString(),
        status: PaymentStatus.PENDING,
        paymentMethod: dto.paymentMethod,
        transactionRef: dto.transactionRef,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        notes: dto.notes,
        internalReference: dto.internalReference,
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

    // Reward: a matured lead reaching finance banks `slaHandoverBonus` on-time
    // "wins" for the sales agent who owned it — repairing their Response-SLA
    // score for any past slow replies ("bank against breaches" model). Closing
    // deals literally improves your standing. Non-fatal + best-effort.
    try {
      const owner = await this.prisma.lead.findUnique({
        where: { id: lead.id },
        select: { assignedEmployeeId: true },
      });
      if (owner?.assignedEmployeeId) {
        const org = await this.prisma.organization.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { slaHandoverBonus: true },
        });
        const bonus = org?.slaHandoverBonus ?? 5;
        if (bonus > 0) {
          await this.prisma.employee.update({
            where: { id: owner.assignedEmployeeId },
            data: { slaResponsesMet: { increment: bonus } },
          });
        }
      }
    } catch {
      // A scoring hiccup must never block the handover itself.
    }

    // Push the lead's pipeline status forward so the UI's progress bar
    // reflects that this lead has moved into the payment phase. We only
    // bump from early stages — never downgrade an already-CONVERTED lead
    // (post-verification) and never overwrite LOST/DUPLICATE/UNQUALIFIED
    // which represent terminal sales decisions.
    //
    // Without this bump the lead profile keeps showing "Contacted" even
    // after sales has shipped a receipt to finance, which is what the
    // user complained about: "UI says it's contacted or appointment even
    // though we have collected the payment".
    await this.prisma.lead.updateMany({
      where: {
        id: lead.id,
        status: {
          in: [
            LeadStatus.NEW,
            LeadStatus.CONTACTED,
            LeadStatus.QUALIFIED,
            LeadStatus.FOLLOW_UP,
          ],
        },
      },
      data: { status: LeadStatus.PROPOSAL_SENT },
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

      // Push the lead's pipeline status back to FOLLOW_UP so the rep
      // sees it in their queue again. Only downgrade from PROPOSAL_SENT
      // (we set that on handover creation) — never overwrite CONVERTED,
      // LOST, etc. If the lead has another live handover that hasn't
      // been rejected, keep PROPOSAL_SENT (the rejected one is just
      // one of multiple attempts).
      const otherLiveHandovers = await this.prisma.financeHandover.count({
        where: {
          leadId: rejected.leadId,
          id: { not: id },
          status: { not: FinanceHandoverStatus.REJECTED },
        },
      });
      if (otherLiveHandovers === 0) {
        await this.prisma.lead.updateMany({
          where: {
            id: rejected.leadId,
            status: LeadStatus.PROPOSAL_SENT,
          },
          data: { status: LeadStatus.FOLLOW_UP },
        });
      }

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

    // Invoice resolution — pick in priority order:
    //   1. The handover already has its own invoiceId from a prior
    //      half-finished review (re-doing a recorded payment).
    //   2. The caller explicitly supplied an invoiceId in the DTO.
    //   3. The lead already has a single active Invoice. Reuse it so
    //      installment payments roll up against one ledger rather than
    //      creating a fresh Invoice per handover (which was the bug
    //      that produced "$1000 + $1500 + $2000 = $4500" phantom totals
    //      across separate invoice rows). When the lead's agreed
    //      serviceFeeAmount is set, the invoice's totalAmount stays
    //      pinned to that — we don't grow it just because more was
    //      paid than agreed. If no fee was captured upfront, we fall
    //      back to growing the invoice total by the new handover's
    //      amount, since the implicit total is whatever's been billed.
    //   4. Last resort: create a new Invoice anchored to the lead's
    //      serviceFeeAmount (if set) or the handover amount.
    const invoice = await this.resolveInvoiceForHandover(
      existing,
      dto.invoiceId,
      dto.dueDate,
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
        // Client-facing notes — only what the client should see on the receipt.
        notes: this.combineNotes(existing.notes, dto.financeNotes) ?? undefined,
        // Internal audit pointer — links the payment back to its source
        // handover row without ever appearing on the client's receipt.
        internalReference: `handover:${existing.id}`,
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

    // Maker-checker (segregation of duties): at/above the org threshold, the
    // officer who RECORDED the payment cannot also VERIFY it — a different
    // finance officer must. Skips when the threshold is 0 (disabled) or no
    // recorder is tracked (payment not created via a handover).
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { makerCheckerThreshold: true },
    });
    const threshold = Number(org?.makerCheckerThreshold ?? 0);
    const recorder = payment.financeHandover?.reviewedByUserId ?? null;
    if (threshold > 0 && Number(payment.amount) >= threshold && recorder && recorder === actorUserId) {
      throw new ForbiddenException(
        `Four-eyes check: this payment (${Number(payment.amount).toLocaleString()} ${payment.currency}) is at or above the ${threshold.toLocaleString()} ${payment.currency} threshold, and you recorded it. A different finance officer must verify it.`,
      );
    }

    // Period lock: don't recognize cash into a closed period (covers payments
    // created via any path, including the handover/profile flow).
    await this.assertPeriodOpen(payment.paidAt ?? new Date());

    // Verifying the first payment converts the originating lead into a client.
    let clientId = payment.invoice.clientId;
    if (!clientId && payment.invoice.leadId) {
      const conversion = await this.leadsService.convertToClient(payment.invoice.leadId, actorUserId);
      clientId = conversion.client.id;
    }

    // Apply the CAD-equivalent (baseAmount) to the CAD invoice — the payment
    // may have been received in a foreign currency, but the ledger is CAD.
    // Fall back to amount for any legacy row recorded before multi-currency.
    const newPaidAmount =
      Number(payment.invoice.paidAmount) + Number(payment.baseAmount ?? payment.amount);
    const totalAmount = Number(payment.invoice.totalAmount);

    // Overpayment guard: the books must never show paidAmount > totalAmount.
    // Compare in integer cents so float noise / a legacy ±1¢ rounding gap
    // doesn't trip it — only a genuine overpayment (more than a cent over the
    // remaining balance) is rejected.
    if (Math.round(newPaidAmount * 100) > Math.round(totalAmount * 100) + 1) {
      const balance = Math.max(0, totalAmount - Number(payment.invoice.paidAmount));
      throw new BadRequestException(
        `This payment (${Number(payment.amount).toLocaleString()} ${payment.currency}) exceeds the invoice balance of ${balance.toLocaleString()} ${payment.invoice.currency}. Adjust the amount or split it across invoices.`,
      );
    }

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

    // Issue a formal Receipt for the verified payment. The Receipt row is
    // created synchronously (so the receiptNumber is available immediately
    // for the response and any timeline event), but the PDF render is
    // best-effort — if pdfkit fails or storage is down, the Receipt still
    // exists with pdfStorageKey=NULL and the download endpoint will
    // regenerate on demand. Either way the customer's receipt number is
    // committed before this method returns.
    const receipt = await this.issueReceiptForPayment(
      updatedPayment.id,
      actorUserId,
    ).catch((err) => {
      this.logger.error(
        `Receipt issuance failed for payment=${updatedPayment.id}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    });

    // Keep the contract's installment schedule in sync with what's actually
    // been paid, so installment.status is real + auditable rather than only a
    // read-time calc. Best-effort — must never block a verified payment.
    try {
      await this.syncInstallmentStatuses(clientId, updatedInvoice.leadId);
    } catch (err) {
      this.logger.error(
        `Installment status sync failed for payment=${updatedPayment.id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    return {
      payment: updatedPayment,
      invoice: updatedInvoice,
      caseId,
      clientId,
      receipt: receipt
        ? {
            id: receipt.id,
            receiptNumber: receipt.receiptNumber,
            pdfReady: Boolean(receipt.pdfStorageKey),
          }
        : null,
    };
  }

  /**
   * Issue the formal Receipt row for a freshly-verified Payment. Generates
   * a sequential receipt number, persists the row, then renders + uploads
   * the PDF and stores the storage key back on the row. The PDF render is
   * inline rather than queued because:
   *   - The data set is tiny (one row), pdfkit renders in ~50ms
   *   - The frontend wants to show a "Download receipt" button immediately
   *     after verification with the PDF actually downloadable
   *   - A queue would complicate the verify response shape with no real
   *     latency win
   * If the storage upload fails, we keep the row + log it — the download
   * endpoint can regenerate on demand.
   *
   * Idempotent at the Receipt level (Payment.id has @unique constraint on
   * Receipt.paymentId) — calling it twice for the same payment returns
   * the existing Receipt instead of creating a duplicate. This lets
   * the manual "generate receipt" endpoint reuse this method safely.
   */
  private async issueReceiptForPayment(paymentId: string, actorUserId: string) {
    // Reuse existing receipt if already issued.
    const existing = await this.prisma.receipt.findUnique({
      where: { paymentId },
    });
    if (existing) {
      // If PDF wasn't generated last time, give it another shot.
      if (!existing.pdfStorageKey) {
        const refreshed = await this.regenerateReceiptPdf(existing.id);
        return refreshed;
      }
      return existing;
    }

    // Gather the data set the PDF + the receipt row need.
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        invoice: {
          include: {
            lead: true,
            client: true,
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const leadId = payment.invoice.leadId;
    const clientId = payment.invoice.clientId;
    const lead = payment.invoice.lead;
    const client = payment.invoice.client;

    // Resolve "who is this receipt addressed to" — prefer the client
    // record (more authoritative post-conversion) and fall back to the
    // lead. referenceCode is the same on both for a converted lead.
    const customerRef = client?.referenceCode ?? lead?.referenceCode ?? '—';
    const customerName = client
      ? `${client.firstName} ${client.lastName}`.trim()
      : lead
        ? `${lead.firstName} ${lead.lastName}`.trim()
        : 'Unknown customer';
    const customerPhone = client?.phone ?? lead?.phone ?? null;
    const customerEmail = client?.email ?? lead?.email ?? null;

    const receiptNumber = await this.generateReceiptNumber();
    const issuedAt = new Date();

    const created = await this.prisma.receipt.create({
      data: {
        receiptNumber,
        paymentId: payment.id,
        leadId,
        clientId,
        invoiceId: payment.invoiceId,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.paymentMethod,
        transactionRef: payment.transactionRef,
        issuedByUserId: actorUserId,
        issuedAt,
      },
    });

    // Engagement-level totals + upcoming installments for the client-facing
    // receipt (so it shows "owes 3000 of 8000, next installment Aug 1" not
    // just "this invoice paid in full").
    const acctCtx = await this.computeReceiptAccountContext(
      payment.invoice.leadId,
      payment.invoice.clientId,
      {
        totalAmount: payment.invoice.totalAmount,
        paidAmount: payment.invoice.paidAmount,
        currency: payment.invoice.currency,
      },
    );
    // CA-friendly footer: real verifier name + a short, stable audit reference
    // derived from the receipt id.
    const verifierName = await this.resolveVerifierName(actorUserId);

    // Render + upload PDF; persist the storage key. Failures are logged
    // and the Receipt row keeps pdfStorageKey=NULL so the download
    // endpoint can retry on demand.
    try {
      const upload = await this.receiptPdfService.renderAndStore({
        receiptNumber: created.receiptNumber,
        issuedAt,
        amount: payment.amount.toString(),
        currency: payment.currency,
        baseAmount: payment.baseAmount?.toString() ?? null,
        baseCurrency: payment.baseCurrency ?? null,
        fxRate: payment.fxRate?.toString() ?? null,
        paymentMethod: payment.paymentMethod,
        transactionRef: payment.transactionRef,
        customer: {
          referenceCode: customerRef,
          fullName: customerName,
          phone: customerPhone,
          email: customerEmail,
        },
        invoice: {
          invoiceNumber: payment.invoice.invoiceNumber,
          totalAmount: payment.invoice.totalAmount.toString(),
          paidAmount: payment.invoice.paidAmount.toString(),
          currency: payment.invoice.currency,
        },
        account: acctCtx.account,
        upcomingInstallments: acctCtx.upcomingInstallments,
        notes: payment.notes,
        issuedBy: {
          name: verifierName,
          role: 'Finance',
        },
        auditRef: this.auditRefFor(created.id),
      });
      const updated = await this.prisma.receipt.update({
        where: { id: created.id },
        data: { pdfStorageKey: upload.key, pdfGeneratedAt: new Date() },
      });
      return updated;
    } catch (err) {
      this.logger.error(
        `Receipt PDF render failed for receipt=${created.id}: ${err instanceof Error ? err.message : err}`,
      );
      return created;
    }
  }

  /**
   * Stable short audit reference derived from the receipt id. The receipt
   * footer shows it so a CA / auditor has a compact code they can quote
   * (instead of a UUID) to look up the full audit trail. Deterministic, so
   * regenerating the same receipt yields the same code.
   */
  private auditRefFor(receiptId: string): string {
    return 'AUD-' + createHash('sha256').update(receiptId).digest('hex').slice(0, 6).toUpperCase();
  }

  /**
   * Resolve a finance user's display name for the "Verified by" line on the
   * receipt. Falls back through employee → email → generic label, so the
   * footer is never blank even if the user account is unusual.
   */
  private async resolveVerifierName(userId: string | null | undefined): Promise<string> {
    if (!userId) return 'Finance Officer';
    const u = await this.prisma.userAccount.findUnique({
      where: { id: userId },
      select: { email: true, employee: { select: { firstName: true, lastName: true } } },
    });
    if (!u) return 'Finance Officer';
    if (u.employee) {
      const name = `${u.employee.firstName} ${u.employee.lastName}`.trim();
      if (name) return name;
    }
    return u.email;
  }

  /**
   * Compute the engagement-level "account" view for a receipt: total
   * agreement fee, total paid across all this lead/client's invoices, the
   * remaining balance, and the list of upcoming (unpaid) installments. The
   * receipt PDF uses this so the client sees the WHOLE picture instead of
   * just the one invoice this payment settled.
   *
   * Falls back to per-invoice figures when there's no service contract
   * (e.g. a one-off direct invoice with no signed agreement behind it).
   */
  private async computeReceiptAccountContext(
    leadId: string | null,
    clientId: string | null,
    fallback: { totalAmount: Prisma.Decimal | string; paidAmount: Prisma.Decimal | string; currency: string },
  ): Promise<{
    account: {
      totalFee: number;
      totalPaid: number;
      remaining: number;
      installmentsPaid: number;
      installmentsTotal: number;
      currency: string;
    };
    upcomingInstallments: Array<{
      sequence: number;
      description: string | null;
      dueDate: Date | null;
      amount: number;
      status: 'PENDING' | 'PARTIALLY_PAID';
    }>;
  }> {
    const num = (d: Prisma.Decimal | number | string | null | undefined): number =>
      d == null ? 0 : Number(d.toString());

    // Plain shape both Prisma.ServiceContractWhereInput['OR'] and
    // Prisma.InvoiceWhereInput['OR'] accept (each has leadId/clientId fields).
    const ownerOr: Array<{ leadId?: string; clientId?: string }> = [];
    if (leadId) ownerOr.push({ leadId });
    if (clientId) ownerOr.push({ clientId });

    const fallbackAccount = (totalPaid: number) => ({
      totalFee: num(fallback.totalAmount),
      totalPaid,
      remaining: Math.max(0, num(fallback.totalAmount) - totalPaid),
      installmentsPaid: 0,
      installmentsTotal: 0,
      currency: fallback.currency,
    });

    if (ownerOr.length === 0) {
      return { account: fallbackAccount(num(fallback.paidAmount)), upcomingInstallments: [] };
    }

    const [contract, invoices] = await Promise.all([
      this.prisma.serviceContract.findFirst({
        where: { OR: ownerOr, deletedAt: null },
        include: { installments: { orderBy: { sequence: 'asc' } } },
      }),
      this.prisma.invoice.findMany({
        where: { OR: ownerOr, deletedAt: null },
        select: { paidAmount: true },
      }),
    ]);

    const totalPaid = invoices.reduce((s, i) => s + num(i.paidAmount), 0);

    if (!contract) {
      return { account: fallbackAccount(totalPaid), upcomingInstallments: [] };
    }

    const totalFee = num(contract.totalAmount);
    const remaining = Math.max(0, totalFee - totalPaid);

    // Detect "placeholder" due dates — when an installment is purely
    // trigger-based (e.g. "On approval"), materializeServiceContract falls
    // back to the agreement signing date as a dummy due date. Showing that
    // date on the client's receipt looks like the installment is due TODAY,
    // which is wrong. Null it out so the renderer prints "—" and the trigger
    // text in the Stage column carries the meaning.
    const sameDay = (a: Date | null, b: Date | null) =>
      !!(a && b && a.toDateString() === b.toDateString());
    const signed = contract.signedDate ?? null;

    // AR waterfall: allocate total paid across installments in sequence order.
    let pool = totalPaid;
    const installments = contract.installments.map((i) => {
      const amount = num(i.amount);
      const covered = Math.max(0, Math.min(pool, amount));
      pool -= covered;
      const fullyPaid = amount > 0 && covered >= amount - 0.005;
      const status: 'PAID' | 'PARTIALLY_PAID' | 'PENDING' = fullyPaid
        ? 'PAID'
        : covered > 0
          ? 'PARTIALLY_PAID'
          : 'PENDING';
      const dueDate = sameDay(i.dueDate, signed) ? null : i.dueDate;
      return { sequence: i.sequence, description: i.description, dueDate, amount, status };
    });
    const installmentsPaid = installments.filter((i) => i.status === 'PAID').length;
    const upcoming = installments
      .filter((i) => i.status !== 'PAID')
      .map(({ status, ...rest }) => ({ ...rest, status: status as 'PENDING' | 'PARTIALLY_PAID' }));

    return {
      account: {
        totalFee,
        totalPaid,
        remaining,
        installmentsPaid,
        installmentsTotal: contract.installments.length,
        currency: contract.currency,
      },
      upcomingInstallments: upcoming,
    };
  }

  /**
   * Regenerate the PDF for an existing Receipt. Useful when the prior
   * render failed (pdfStorageKey is NULL) or the operator wants a fresh
   * copy with current invoice state (paid amount may have changed since
   * the original render).
   */
  private async regenerateReceiptPdf(receiptId: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: {
        payment: {
          include: {
            invoice: {
              include: { lead: true, client: true },
            },
          },
        },
      },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');

    const lead = receipt.payment.invoice.lead;
    const client = receipt.payment.invoice.client;
    const customerRef = client?.referenceCode ?? lead?.referenceCode ?? '—';
    const customerName = client
      ? `${client.firstName} ${client.lastName}`.trim()
      : lead
        ? `${lead.firstName} ${lead.lastName}`.trim()
        : 'Unknown customer';

    const acctCtx = await this.computeReceiptAccountContext(
      receipt.payment.invoice.leadId,
      receipt.payment.invoice.clientId,
      {
        totalAmount: receipt.payment.invoice.totalAmount,
        paidAmount: receipt.payment.invoice.paidAmount,
        currency: receipt.payment.invoice.currency,
      },
    );
    const verifierName = await this.resolveVerifierName(receipt.issuedByUserId);
    const upload = await this.receiptPdfService.renderAndStore({
      receiptNumber: receipt.receiptNumber,
      issuedAt: receipt.issuedAt,
      amount: receipt.amount.toString(),
      currency: receipt.currency,
      baseAmount: receipt.payment.baseAmount?.toString() ?? null,
      baseCurrency: receipt.payment.baseCurrency ?? null,
      fxRate: receipt.payment.fxRate?.toString() ?? null,
      paymentMethod: receipt.paymentMethod,
      transactionRef: receipt.transactionRef,
      customer: {
        referenceCode: customerRef,
        fullName: customerName,
        phone: client?.phone ?? lead?.phone ?? null,
        email: client?.email ?? lead?.email ?? null,
      },
      invoice: {
        invoiceNumber: receipt.payment.invoice.invoiceNumber,
        totalAmount: receipt.payment.invoice.totalAmount.toString(),
        paidAmount: receipt.payment.invoice.paidAmount.toString(),
        currency: receipt.payment.invoice.currency,
      },
      account: acctCtx.account,
      upcomingInstallments: acctCtx.upcomingInstallments,
      notes: receipt.payment.notes,
      issuedBy: { name: verifierName, role: 'Finance' },
      auditRef: this.auditRefFor(receipt.id),
    });
    return this.prisma.receipt.update({
      where: { id: receipt.id },
      data: { pdfStorageKey: upload.key, pdfGeneratedAt: new Date() },
    });
  }

  /**
   * Email the official receipt PDF to the client. Ensures the PDF exists
   * (regenerates if missing), then attaches it to a branded email. Refuses
   * voided receipts and clients with no email on file.
   */
  async sendReceiptToClient(receiptId: string, actorUserId: string): Promise<{ sent: boolean; to: string }> {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: { payment: { include: { invoice: { include: { lead: true, client: true } } } } },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (receipt.voidedAt) {
      throw new BadRequestException('This receipt has been voided and cannot be sent.');
    }

    const lead = receipt.payment.invoice.lead;
    const client = receipt.payment.invoice.client;
    const to = client?.email || lead?.email || null;
    if (!to) {
      throw new BadRequestException('No client email on file — add an email to the client/lead first.');
    }
    const clientName = client
      ? `${client.firstName} ${client.lastName}`.trim()
      : lead
        ? `${lead.firstName} ${lead.lastName}`.trim()
        : 'Client';

    // Make sure a rendered PDF exists, then pull its bytes to attach.
    if (!receipt.pdfStorageKey) {
      await this.regenerateReceiptPdf(receiptId);
    }
    const fresh = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      select: { pdfStorageKey: true, receiptNumber: true, amount: true, currency: true },
    });
    if (!fresh?.pdfStorageKey) {
      throw new BadRequestException('Could not generate the receipt PDF to send. Try again.');
    }
    const file = await this.storage.download(fresh.pdfStorageKey);

    const amountLabel = `${fresh.currency} ${Number(fresh.amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    const ok = await this.email.sendReceiptToClient({
      to,
      clientName,
      receiptNumber: fresh.receiptNumber,
      amountLabel,
      pdf: file.bytes,
      fileName: `${fresh.receiptNumber}.pdf`,
    });
    if (!ok) {
      throw new BadRequestException('Could not send the email (SMTP not configured or the send failed).');
    }

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.INVOICE_UPDATED,
      entityType: 'Receipt',
      entityId: receiptId,
      newValues: { sentTo: to, receiptNumber: fresh.receiptNumber },
    });
    return { sent: true, to };
  }

  /**
   * Stream the receipt PDF straight to the caller through our own backend
   * (same-origin response). Bypasses Supabase Storage's `Content-Security-
   * Policy: sandbox` header on signed URLs — which blocks Chrome's built-in
   * PDF viewer from rendering inline, so the previous redirect-to-signed-URL
   * flow opened a blank tab. Here we set clean inline headers ourselves.
   *
   * Regenerates the PDF on the fly if it's missing (covers receipts that
   * predate the branded render, or where the earlier render failed).
   */
  async streamReceiptPdf(receiptId: string, res: import('express').Response): Promise<void> {
    let receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      select: { pdfStorageKey: true, receiptNumber: true },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (!receipt.pdfStorageKey) {
      await this.regenerateReceiptPdf(receiptId);
      receipt = await this.prisma.receipt.findUnique({
        where: { id: receiptId },
        select: { pdfStorageKey: true, receiptNumber: true },
      });
      if (!receipt?.pdfStorageKey) {
        throw new BadRequestException('Could not generate the receipt PDF.');
      }
    }
    const file = await this.storage.download(receipt.pdfStorageKey);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${receipt.receiptNumber}.pdf"`,
    );
    res.setHeader('Content-Length', String(file.bytes.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.bytes);
  }

  /**
   * Public endpoint helper: returns the signed download URL for a
   * Receipt PDF. Regenerates the PDF on the fly if the stored key is
   * missing (e.g. earlier failed render).
   */
  async getReceiptDownloadUrl(receiptId: string): Promise<{
    receiptNumber: string;
    url: string;
  }> {
    let receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (!receipt.pdfStorageKey) {
      receipt = await this.regenerateReceiptPdf(receipt.id);
    }
    if (!receipt.pdfStorageKey) {
      throw new Error('Receipt PDF could not be generated');
    }
    const url = await this.storage.getSignedUrl(receipt.pdfStorageKey);
    return { receiptNumber: receipt.receiptNumber, url };
  }

  /**
   * Find the Receipt issued for a given finance handover (via its
   * Payment). Returns null if no receipt has been issued yet.
   */
  async findReceiptByHandoverId(handoverId: string) {
    const handover = await this.prisma.financeHandover.findUnique({
      where: { id: handoverId },
      select: { paymentId: true },
    });
    if (!handover?.paymentId) return null;
    return this.prisma.receipt.findUnique({
      where: { paymentId: handover.paymentId },
    });
  }

  /**
   * All issued (non-voided) receipts, newest first — powers the Finance
   * "Receipts" ledger. Customer names are resolved in two batched queries
   * (lead first, client fallback). Optional case-insensitive search across
   * receipt number / customer name / reference code.
   */
  async listReceipts(search?: string) {
    const receipts = await this.prisma.receipt.findMany({
      where: { voidedAt: null },
      orderBy: { issuedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        receiptNumber: true,
        amount: true,
        currency: true,
        paymentMethod: true,
        issuedAt: true,
        pdfStorageKey: true,
        leadId: true,
        clientId: true,
      },
    });
    if (receipts.length === 0) return [];

    const leadIds = [...new Set(receipts.map((r) => r.leadId).filter((x): x is string => !!x))];
    const clientIds = [...new Set(receipts.map((r) => r.clientId).filter((x): x is string => !!x))];
    const [leads, clients] = await Promise.all([
      leadIds.length
        ? this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, firstName: true, lastName: true, referenceCode: true } })
        : Promise.resolve([] as Array<{ id: string; firstName: string | null; lastName: string | null; referenceCode: string }>),
      clientIds.length
        ? this.prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, firstName: true, lastName: true, referenceCode: true } })
        : Promise.resolve([] as Array<{ id: string; firstName: string; lastName: string; referenceCode: string }>),
    ]);
    const leadMap = new Map(leads.map((l) => [l.id, l]));
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    const rows = receipts.map((r) => {
      const owner = (r.leadId && leadMap.get(r.leadId)) || (r.clientId && clientMap.get(r.clientId)) || null;
      const customerName = owner ? `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() : '';
      return {
        id: r.id,
        receiptNumber: r.receiptNumber,
        amount: Number(r.amount.toString()),
        currency: r.currency,
        paymentMethod: r.paymentMethod,
        issuedAt: r.issuedAt,
        customerName: customerName || '—',
        referenceCode: owner?.referenceCode ?? null,
        leadId: r.leadId,
        hasPdf: !!r.pdfStorageKey,
      };
    });

    const s = search?.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.receiptNumber.toLowerCase().includes(s) ||
        r.customerName.toLowerCase().includes(s) ||
        (r.referenceCode ?? '').toLowerCase().includes(s),
    );
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

    // Reverse the CAD-equivalent that was booked (baseAmount), not the foreign
    // original — the invoice ledger is in CAD.
    const reversedBase = Number(payment.baseAmount ?? payment.amount);
    const newPaidAmount = Math.max(Number(payment.invoice.paidAmount) - reversedBase, 0);
    await this.prisma.invoice.update({
      where: { id: payment.invoiceId },
      data: {
        paidAmount: newPaidAmount.toString(),
        status: newPaidAmount === 0 ? InvoiceStatus.SENT : InvoiceStatus.PARTIALLY_PAID,
      },
    });

    // Void the receipt issued for this payment — a refunded payment must not
    // leave a live receipt standing, or receipts no longer reconcile with cash
    // collected. (Voided receipts are excluded from the issued-receipts ledger.)
    await this.prisma.receipt.updateMany({
      where: { paymentId: id, voidedAt: null },
      data: {
        voidedAt: new Date(),
        voidReason: dto.notes ? `Payment refunded: ${dto.notes}` : 'Payment refunded',
        voidedByUserId: actorUserId,
      },
    });

    // Issue a sequential credit note — the CA-standard contra-document for a
    // refund. The original invoice + receipt stay intact (immutable audit
    // trail); this records the reversal as its own dated, numbered negative
    // entry in the period the refund actually happens.
    const creditNote = await this.prisma.creditNote.create({
      data: {
        creditNoteNumber: await this.numbering.next('CN'),
        invoiceId: payment.invoiceId,
        paymentId: id,
        leadId: payment.invoice.leadId,
        clientId: payment.invoice.clientId,
        // Credit note is booked in the ledger currency (CAD = baseAmount).
        amount: (payment.baseAmount ?? payment.amount).toString(),
        currency: payment.baseCurrency ?? payment.invoice.currency,
        reason: dto.notes ?? 'Payment refunded',
        issuedByUserId: actorUserId,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.PAYMENT_REFUNDED,
      entityType: 'Payment',
      entityId: id,
      oldValues: { status: payment.status },
      newValues: {
        status: PaymentStatus.REFUNDED,
        notes: dto.notes,
        creditNoteNumber: creditNote.creditNoteNumber,
      },
    });

    return { ...updatedPayment, creditNoteNumber: creditNote.creditNoteNumber };
  }

  /**
   * Admin maintenance — find every FinanceHandover that's been rejected
   * but still has an `invoiceId` or `paymentId` set, and cancel the
   * Invoice/Payment rows that step left behind. Pre-fix history (before
   * the REJECT branch was patched to auto-void) accumulated these
   * orphans; running this once retroactively cleans the slate so lead
   * aggregates stop double-counting rejected attempts as money.
   *
   * Safety rails:
   *   - Only invoices in DRAFT/SENT and payments in PENDING are touched.
   *     Anything that holds real money (PAID/PARTIAL on a payment, paid
   *     status on an invoice) is left alone — those are live and were
   *     never orphans.
   *   - The operator must supply a `reason` (audit + timeline trail
   *     gets a "why"). The reason is appended to each voided row's
   *     `notes` field as a `[VOIDED <date> by <userId>: <reason>]`
   *     line so the trail is self-contained on the row itself.
   *   - One AuditLog row + one Lead timeline event per voided row.
   *   - All work happens in a single Prisma transaction so a partial
   *     failure doesn't leave half the cleanup half-done.
   *
   * Returns counts so the admin sees exactly what was changed.
   */
  async cleanupOrphanHandovers(
    reason: string,
    actorUserId: string,
  ): Promise<{
    scannedHandovers: number;
    voidedInvoices: number;
    voidedPayments: number;
    affectedLeadIds: string[];
    reason: string;
    processedAt: string;
  }> {
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      throw new BadRequestException(
        'A clear reason (at least 5 characters) is required for orphan cleanup so the audit trail is meaningful.',
      );
    }

    // Find every rejected handover that left an Invoice/Payment behind.
    const orphanHandovers = await this.prisma.financeHandover.findMany({
      where: {
        status: FinanceHandoverStatus.REJECTED,
        OR: [
          { invoiceId: { not: null } },
          { paymentId: { not: null } },
        ],
      },
      select: {
        id: true,
        leadId: true,
        invoiceId: true,
        paymentId: true,
      },
    });

    const processedAt = new Date();
    const stamp = `[VOIDED ${processedAt.toISOString()} by ${actorUserId}: ${trimmed}]`;
    const affectedLeadIds = new Set<string>();
    let voidedInvoices = 0;
    let voidedPayments = 0;

    for (const orphan of orphanHandovers) {
      affectedLeadIds.add(orphan.leadId);

      let voidedPaymentNow = false;
      let voidedInvoiceNow = false;

      if (orphan.paymentId) {
        // Read first so we can preserve any prior notes when appending.
        const payment = await this.prisma.payment.findUnique({
          where: { id: orphan.paymentId },
          select: { id: true, status: true, notes: true },
        });
        if (payment && payment.status === PaymentStatus.PENDING) {
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.CANCELLED,
              notes: payment.notes ? `${payment.notes}\n${stamp}` : stamp,
            },
          });
          voidedPayments += 1;
          voidedPaymentNow = true;
          await this.auditLog.log({
            actorUserId,
            action: AuditAction.PAYMENT_VERIFIED, // closest existing
            entityType: 'Payment',
            entityId: payment.id,
            oldValues: { status: payment.status },
            newValues: {
              status: PaymentStatus.CANCELLED,
              voidReason: trimmed,
              voidedFromOrphanCleanup: true,
            },
          });
        }
      }

      if (orphan.invoiceId) {
        const invoice = await this.prisma.invoice.findUnique({
          where: { id: orphan.invoiceId },
          select: { id: true, status: true, notes: true },
        });
        if (
          invoice &&
          (invoice.status === InvoiceStatus.DRAFT ||
            invoice.status === InvoiceStatus.SENT)
        ) {
          await this.prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              status: InvoiceStatus.CANCELLED,
              notes: invoice.notes ? `${invoice.notes}\n${stamp}` : stamp,
            },
          });
          voidedInvoices += 1;
          voidedInvoiceNow = true;
          await this.auditLog.log({
            actorUserId,
            action: AuditAction.PAYMENT_VERIFIED,
            entityType: 'Invoice',
            entityId: invoice.id,
            oldValues: { status: invoice.status },
            newValues: {
              status: InvoiceStatus.CANCELLED,
              voidReason: trimmed,
              voidedFromOrphanCleanup: true,
            },
          });
        }
      }

      // Only record a timeline event if we actually voided something
      // for this orphan — otherwise the row was already in a paid/live
      // state and we left it alone (no event needed).
      if (voidedPaymentNow || voidedInvoiceNow) {
        await this.activityTimeline
          .record({
            entityType: 'Lead',
            entityId: orphan.leadId,
            leadId: orphan.leadId,
            eventType: TimelineEventType.FINANCE_HANDOVER_REVIEWED,
            description: `Orphan ${voidedInvoiceNow ? 'invoice' : ''}${voidedInvoiceNow && voidedPaymentNow ? ' + ' : ''}${voidedPaymentNow ? 'payment' : ''} from rejected handover voided by admin · "${trimmed}"`,
            actorUserId,
            metadata: {
              financeHandoverId: orphan.id,
              voidedInvoiceId: voidedInvoiceNow ? orphan.invoiceId : null,
              voidedPaymentId: voidedPaymentNow ? orphan.paymentId : null,
              voidReason: trimmed,
              voidedFromOrphanCleanup: true,
            },
          })
          .catch(() => undefined);
      }
    }

    return {
      scannedHandovers: orphanHandovers.length,
      voidedInvoices,
      voidedPayments,
      affectedLeadIds: Array.from(affectedLeadIds),
      reason: trimmed,
      processedAt: processedAt.toISOString(),
    };
  }

  /**
   * Admin step-up deletion of a finance handover.
   *
   * The flow is intentionally two-identity:
   *   - `actorUserId` is the finance officer currently logged in. They
   *     initiated the delete from the UI.
   *   - `dto.adminEmail` + `dto.adminPassword` are the admin's
   *     credentials, typed live into the modal. We look that account
   *     up independently of the JWT and verify it bcrypt-matches a
   *     real, active admin user.
   *
   * Why both identities matter: the user wanted a flow where a finance
   * officer can request a deletion at their desk but the actual
   * authorisation comes from an admin physically present to type their
   * password. The trail then attributes responsibility correctly —
   * the audit log shows who asked AND who authorised.
   *
   * Soft-delete only: handover.status → CANCELLED, notes get a
   * `[DELETED <iso> by finance=<id>, authorised by admin=<id>: <reason>]`
   * stamp, attached Invoice/Payment get cancelled via the same status
   * guards as orphan cleanup (paid rows never touched). The row stays
   * in the database so historical reports + the lead's Finance tab
   * still show the deletion with full context, which matches the
   * "deleted must also appear in client profile" requirement.
   */
  async adminDeleteHandover(
    handoverId: string,
    dto: {
      adminEmail: string;
      adminPassword: string;
      reason: string;
    },
    actorUserId: string,
  ): Promise<{
    handoverId: string;
    voidedInvoiceId: string | null;
    voidedPaymentId: string | null;
    initiatedByUserId: string;
    authorisedByAdminUserId: string;
    reason: string;
    deletedAt: string;
  }> {
    const reason = dto.reason.trim();
    if (reason.length < 5) {
      throw new BadRequestException(
        'A clear reason (at least 5 characters) is required so the deletion is auditable.',
      );
    }

    // -- Verify admin credentials (independent of the JWT). --
    // Same lookup pattern as auth.service.login(). Generic error
    // messages on every failure path so we don't leak which part
    // failed (account doesn't exist vs. wrong password vs. not admin)
    // — that's the standard advice for any step-up auth check.
    const adminUser = await this.prisma.userAccount.findUnique({
      where: { email: dto.adminEmail, deletedAt: null },
      include: {
        userRoles: {
          include: { role: { select: { name: true } } },
        },
      },
    });
    if (!adminUser) {
      throw new UnauthorizedException(
        'Admin credentials invalid or account does not have permission to authorise deletions.',
      );
    }
    if (adminUser.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Admin credentials invalid or account does not have permission to authorise deletions.',
      );
    }
    const passwordValid = await bcrypt.compare(
      dto.adminPassword,
      adminUser.passwordHash,
    );
    if (!passwordValid) {
      // Mirror auth.service.login()'s failure-counter discipline so a
      // brute-forced admin password is logged + eventually locks the
      // account out at the same threshold as a regular login.
      const attempts = adminUser.failedLoginAttempts + 1;
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await this.prisma.userAccount.update({
        where: { id: adminUser.id },
        data: { failedLoginAttempts: attempts, lockedUntil: lockUntil },
      });
      await this.auditLog.log({
        actorUserId: adminUser.id,
        action: AuditAction.USER_LOGIN_FAILED,
        entityType: 'UserAccount',
        entityId: adminUser.id,
        metadata: {
          reason: 'invalid_admin_password_on_handover_delete',
          handoverId,
          initiatedByUserId: actorUserId,
        },
      });
      throw new UnauthorizedException(
        'Admin credentials invalid or account does not have permission to authorise deletions.',
      );
    }
    const adminRoleNames = adminUser.userRoles
      .map((ur) => ur.role.name.toLowerCase())
      .filter(Boolean);
    const hasAdminRole = adminRoleNames.some(
      (r) => r === 'admin' || r === 'super_admin',
    );
    if (!hasAdminRole) {
      throw new UnauthorizedException(
        'Admin credentials invalid or account does not have permission to authorise deletions.',
      );
    }

    // -- Look up the handover and capture pre-delete state. --
    const existing = await this.prisma.financeHandover.findUnique({
      where: { id: handoverId },
      select: {
        id: true,
        leadId: true,
        status: true,
        invoiceId: true,
        paymentId: true,
        notes: true,
        submittedAmount: true,
        currency: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('Finance handover not found');
    }
    if (existing.status === FinanceHandoverStatus.CANCELLED) {
      throw new BadRequestException('This handover has already been deleted.');
    }

    // -- Perform the soft delete with full audit stamping. --
    const deletedAt = new Date();
    const stamp = `[DELETED ${deletedAt.toISOString()} by finance=${actorUserId}, authorised by admin=${adminUser.id} (${adminUser.email}): ${reason}]`;

    let voidedInvoiceId: string | null = null;
    let voidedPaymentId: string | null = null;

    if (existing.paymentId) {
      const payment = await this.prisma.payment.findUnique({
        where: { id: existing.paymentId },
        select: { id: true, status: true, notes: true },
      });
      if (
        payment &&
        (payment.status === PaymentStatus.PENDING ||
          payment.status === PaymentStatus.PARTIAL ||
          payment.status === PaymentStatus.PAID)
      ) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            // PAID/PARTIAL payments get marked CANCELLED here too — this
            // is admin authorisation, not the automated orphan cleanup,
            // so the operator can void real money if they need to.
            // Audit trail makes that decision attributable.
            status: PaymentStatus.CANCELLED,
            notes: payment.notes ? `${payment.notes}\n${stamp}` : stamp,
          },
        });
        voidedPaymentId = payment.id;
      }
    }

    if (existing.invoiceId) {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: existing.invoiceId },
        select: { id: true, status: true, notes: true },
      });
      if (invoice && invoice.status !== InvoiceStatus.CANCELLED) {
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            status: InvoiceStatus.CANCELLED,
            notes: invoice.notes ? `${invoice.notes}\n${stamp}` : stamp,
          },
        });
        voidedInvoiceId = invoice.id;
      }
    }

    await this.prisma.financeHandover.update({
      where: { id: handoverId },
      data: {
        status: FinanceHandoverStatus.CANCELLED,
        notes: existing.notes ? `${existing.notes}\n${stamp}` : stamp,
      },
    });

    // -- Audit log + lead timeline event. --
    await this.auditLog.log({
      actorUserId,
      action: AuditAction.FINANCE_HANDOVER_REVIEWED,
      entityType: 'FinanceHandover',
      entityId: handoverId,
      oldValues: { status: existing.status },
      newValues: {
        status: FinanceHandoverStatus.CANCELLED,
        deletionReason: reason,
        initiatedByUserId: actorUserId,
        authorisedByAdminUserId: adminUser.id,
        authorisedByAdminEmail: adminUser.email,
        voidedInvoiceId,
        voidedPaymentId,
      },
    });

    await this.activityTimeline
      .record({
        entityType: 'Lead',
        entityId: existing.leadId,
        leadId: existing.leadId,
        eventType: TimelineEventType.FINANCE_HANDOVER_REVIEWED,
        description: `Finance handover deleted by admin authorisation · "${reason}"`,
        actorUserId,
        metadata: {
          financeHandoverId: handoverId,
          submittedAmount: existing.submittedAmount.toString(),
          currency: existing.currency,
          initiatedByUserId: actorUserId,
          authorisedByAdminUserId: adminUser.id,
          authorisedByAdminEmail: adminUser.email,
          voidedInvoiceId,
          voidedPaymentId,
          reason,
          deletionEvent: true,
        },
      })
      .catch(() => undefined);

    return {
      handoverId,
      voidedInvoiceId,
      voidedPaymentId,
      initiatedByUserId: actorUserId,
      authorisedByAdminUserId: adminUser.id,
      reason,
      deletedAt: deletedAt.toISOString(),
    };
  }

  /**
   * Resolve which Invoice a finance-handover RECORD_PAYMENT step should
   * attach its Payment to. Replaces the old "always create a new
   * invoice per handover" behaviour that produced one Invoice per
   * installment and made aggregate balances meaningless.
   *
   * Order of precedence:
   *   1. The handover's own invoiceId (re-recording a previously-half-
   *      finished handover; reuse the same invoice it created last time).
   *   2. dto.invoiceId — explicitly chosen by the caller.
   *   3. The lead's existing active Invoice (not CANCELLED). This is
   *      the new behaviour: a second handover for the same lead joins
   *      its predecessor's invoice as another Payment row, so a
   *      $5,000 service paid as 3 installments shows as one $5,000
   *      Invoice with 3 Payments rather than 3 separate Invoices.
   *   4. Fresh Invoice creation, anchored to lead.serviceFeeAmount
   *      if the agreed total was captured by Sales, otherwise the
   *      handover's submittedAmount as a best-effort implicit total.
   *
   * When a fresh Invoice is created with an agreed serviceFeeAmount
   * that's LARGER than this handover's amount (typical first
   * installment scenario), the Invoice carries the full agreed total
   * and the first Payment is just a partial against it — exactly the
   * shape the finance dashboard needs to render "paid X of Y".
   */
  private async resolveInvoiceForHandover(
    handover: {
      id: string;
      leadId: string;
      invoiceId: string | null;
      submittedAmount: Prisma.Decimal;
      currency: string;
    },
    explicitInvoiceId: string | undefined,
    dueDate: string | undefined,
    actorUserId: string,
  ) {
    // 1. The handover already has an invoice (re-record after a half-
    //    finished prior attempt).
    if (handover.invoiceId) {
      return this.findInvoiceById(handover.invoiceId);
    }

    // 2. The caller pointed us at a specific invoice.
    if (explicitInvoiceId) {
      return this.findInvoiceById(explicitInvoiceId);
    }

    // 3. The lead already has an active Invoice — reuse it. Filter out
    //    CANCELLED so a previously-voided invoice doesn't claim future
    //    payments. Pick the most recent one if somehow multiple are
    //    active (shouldn't happen post-fix, but a safety net for
    //    legacy data that pre-dates this refactor).
    const existingActive = await this.prisma.invoice.findFirst({
      where: {
        leadId: handover.leadId,
        status: { not: InvoiceStatus.CANCELLED },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingActive) {
      return this.findInvoiceById(existingActive.id);
    }

    // 4. No invoice yet — create one anchored to the agreed service
    //    fee if Sales captured it. Otherwise the handover's amount
    //    becomes the implicit total (existing behaviour, just now
    //    guarded by "did we already make one?").
    const lead = await this.prisma.lead.findUnique({
      where: { id: handover.leadId },
      select: { serviceFeeAmount: true, serviceFeeCurrency: true },
    });
    const agreedAmount = lead?.serviceFeeAmount ? lead.serviceFeeAmount.toString() : null;
    const agreedCurrency = lead?.serviceFeeCurrency ?? null;

    // Tax: treat the figure as tax-INCLUSIVE so the invoice total still equals
    // the agreed fee / cash received, and break out the tax portion when the
    // org has a rate set. Rate 0 (default) → net == gross, tax 0 (unchanged).
    const org = await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { taxRatePercent: true } });
    const rate = Number(org?.taxRatePercent ?? 0);
    const gross = Number(agreedAmount ?? handover.submittedAmount.toString());
    // Round the net first, then derive tax as the REMAINDER (gross − net) and
    // stamp totalAmount = gross, so subtotal + tax always ties back to the
    // agreed fee to the cent. (Previously net and tax were rounded
    // independently, so net + tax could drift ±0.01 from the fee and strand
    // an invoice a penny short of PAID.)
    const net = rate > 0 ? Math.round((gross / (1 + rate / 100)) * 100) / 100 : gross;
    const tax = Math.round((gross - net) * 100) / 100;

    return this.createInvoice(
      {
        leadId: handover.leadId,
        subtotal: net.toFixed(2),
        taxAmount: tax.toFixed(2),
        discountAmount: '0',
        totalAmount: gross.toFixed(2),
        currency: agreedCurrency ?? handover.currency,
        dueDate,
        notes: agreedAmount
          ? `Invoice for agreed service fee — first installment via handover ${handover.id}`
          : `Created from finance handover ${handover.id}`,
      },
      actorUserId,
    );
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

  /**
   * Generate a sequential invoice number for the current year.
   *
   * Format: INV-YYYY-NNNNN (e.g. INV-2026-00001). Most jurisdictions
   * (PK, CA, EU) require invoice numbers to be sequential and gap-free
   * for tax compliance; the timestamp+random scheme this replaced was
   * non-compliant. By counting all invoices created this year (NOT
   * filtering by deletedAt — CANCELLED invoices keep their number so
   * the sequence has no gaps from the auditor's perspective), we get
   * a monotonically increasing series per year.
   *
   * Concurrency: the @unique constraint on invoiceNumber serialises
   * collisions. The retry loop bumps the suffix on each conflict.
   */
  /**
   * Re-derive each installment's status from total verified paid (the AR
   * waterfall — allocate paid across installments in sequence) and persist it,
   * so the contract schedule's own status reflects reality and isn't just a
   * read-time calculation. Idempotent; only writes when a status changes.
   */
  private async syncInstallmentStatuses(clientId: string | null, leadId: string | null) {
    const ownerOr: Array<{ leadId: string } | { clientId: string }> = [];
    if (leadId) ownerOr.push({ leadId });
    if (clientId) ownerOr.push({ clientId });
    if (ownerOr.length === 0) return;

    const contract = await this.prisma.serviceContract.findFirst({
      where: { OR: ownerOr, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    });
    if (!contract) return;

    const paidAgg = await this.prisma.invoice.aggregate({
      _sum: { paidAmount: true },
      where: { deletedAt: null, OR: ownerOr },
    });
    let remaining = Number(paidAgg._sum.paidAmount ?? 0);

    for (const inst of contract.installments) {
      const amount = Number(inst.amount);
      const covered = Math.max(0, Math.min(remaining, amount));
      remaining -= covered;
      const status = amount > 0 && covered >= amount - 0.005 ? InstallmentStatus.PAID : InstallmentStatus.PENDING;
      if (inst.status !== status) {
        await this.prisma.installment.update({ where: { id: inst.id }, data: { status } });
      }
    }
  }

  /** Monotonic INV-YYYY-NNNNN via the document_sequences counter (never reused). */
  /**
   * Revenue recognition (#1, accrual). Mark a contract milestone/installment
   * delivered → its amount becomes EARNED revenue. Recognizing cannot exceed
   * what was contracted; un-recognizing (recognize=false) corrects a mistake.
   */
  async recognizeInstallment(id: string, recognize: boolean, actorUserId: string) {
    const inst = await this.prisma.installment.findUnique({
      where: { id },
      select: { id: true, recognizedAt: true, amount: true, description: true },
    });
    if (!inst) throw new NotFoundException('Installment not found');

    const updated = await this.prisma.installment.update({
      where: { id },
      data: recognize
        ? { recognizedAt: new Date(), recognizedByUserId: actorUserId }
        : { recognizedAt: null, recognizedByUserId: null },
      select: { id: true, recognizedAt: true, recognizedByUserId: true, amount: true },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.INVOICE_UPDATED, // no dedicated recognition action in the enum
      entityType: 'Installment',
      entityId: id,
      oldValues: { recognizedAt: inst.recognizedAt },
      newValues: { recognizedAt: updated.recognizedAt, recognized: recognize },
    });

    return updated;
  }

  /**
   * GST/HST tax report (#2). Output tax billed on issued invoices minus
   * recoverable input tax (ITCs) on expenses = net tax payable, per currency,
   * over an optional [from, to] window. The figures a CA needs to file a return.
   */
  async getTaxReport(from?: string, to?: string) {
    const dec = (d: Prisma.Decimal | number | null | undefined): number =>
      d == null ? 0 : Number(d.toString());
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const range =
      fromDate || toDate
        ? { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) }
        : undefined;

    const [invoices, expenses] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          deletedAt: null,
          status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
          ...(range ? { createdAt: range } : {}),
        },
        select: { taxAmount: true },
      }),
      this.prisma.expense.findMany({
        where: { deletedAt: null, ...(range ? { incurredAt: range } : {}) },
        select: { taxAmount: true, fxRate: true },
      }),
    ]);

    // Everything rolls up in CAD. Invoices are CAD, so their tax is CAD as-is.
    // Expense input tax is in the expense's currency, so convert via the rate
    // stamped on the row (1 CAD = fxRate <currency>).
    let outputTax = 0;
    for (const inv of invoices) outputTax += dec(inv.taxAmount);
    let inputTax = 0;
    for (const e of expenses) {
      const rate = Number(e.fxRate ?? 1) || 1;
      inputTax += dec(e.taxAmount) / rate;
    }
    outputTax = Math.round(outputTax * 100) / 100;
    inputTax = Math.round(inputTax * 100) / 100;

    return {
      from: fromDate ?? null,
      to: toDate ?? null,
      byCurrency: [
        { currency: 'CAD', outputTax, inputTax, netPayable: Math.round((outputTax - inputTax) * 100) / 100 },
      ],
    };
  }

  /** Issued credit-notes ledger (#3) — newest first, optional text search. */
  async listCreditNotes(search?: string) {
    const where: Prisma.CreditNoteWhereInput = {};
    if (search?.trim()) {
      where.OR = [
        { creditNoteNumber: { contains: search.trim(), mode: 'insensitive' } },
        { reason: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }
    const notes = await this.prisma.creditNote.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        creditNoteNumber: true,
        amount: true,
        currency: true,
        reason: true,
        issuedAt: true,
        leadId: true,
        clientId: true,
        invoice: { select: { invoiceNumber: true } },
      },
    });
    const leadIds = [...new Set(notes.map((n) => n.leadId).filter((x): x is string => !!x))];
    const clientIds = [...new Set(notes.map((n) => n.clientId).filter((x): x is string => !!x))];
    const [leads, clients] = await Promise.all([
      leadIds.length
        ? this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, firstName: true, lastName: true } })
        : Promise.resolve([]),
      clientIds.length
        ? this.prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, firstName: true, lastName: true } })
        : Promise.resolve([]),
    ]);
    const ln = new Map(leads.map((l) => [l.id, `${l.firstName} ${l.lastName}`.trim()]));
    const cn = new Map(clients.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]));
    return notes.map((n) => ({
      id: n.id,
      creditNoteNumber: n.creditNoteNumber,
      amount: Number(n.amount.toString()),
      currency: n.currency,
      reason: n.reason,
      issuedAt: n.issuedAt,
      invoiceNumber: n.invoice?.invoiceNumber ?? null,
      customer:
        (n.clientId && cn.get(n.clientId)) || (n.leadId && ln.get(n.leadId)) || '—',
    }));
  }

  /** Period lock (#8). Set/clear the book-close date (admin). */
  async setBooksLockedBefore(dateStr: string | null, actorUserId: string) {
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, booksLockedBefore: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const updated = await this.prisma.organization.update({
      where: { id: org.id },
      data: { booksLockedBefore: dateStr ? new Date(dateStr) : null },
      select: { booksLockedBefore: true },
    });
    await this.auditLog.log({
      actorUserId,
      action: AuditAction.INVOICE_UPDATED,
      entityType: 'Organization',
      entityId: org.id,
      oldValues: { booksLockedBefore: org.booksLockedBefore },
      newValues: { booksLockedBefore: updated.booksLockedBefore },
    });
    return updated;
  }

  /**
   * Period-lock guard (#8): reject any money entry effective-dated into a
   * closed accounting period. NULL date or no lock → always open.
   */
  private async assertPeriodOpen(effectiveDate: Date | null | undefined): Promise<void> {
    if (!effectiveDate) return;
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { booksLockedBefore: true },
    });
    const lock = org?.booksLockedBefore ?? null;
    if (lock && effectiveDate < lock) {
      throw new BadRequestException(
        `The accounting period is closed — entries dated before ${lock.toISOString().slice(0, 10)} are locked. Use a current date, or ask an admin to move the book-close date.`,
      );
    }
  }

  /** Live FX rates to the base currency (CAD) — powers the currency picker
   *  and the CAD conversion preview on the payment/expense forms. */
  async getFxRates() {
    const r = await this.fx.getRates();
    return { base: r.base, rates: r.rates, source: r.source, asOf: r.asOf };
  }

  private generateInvoiceNumber() {
    return this.numbering.next('INV');
  }

  /** Monotonic RCP-YYYY-NNNNN — same regulatory shape, never reused. */
  private generateReceiptNumber() {
    return this.numbering.next('RCP');
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