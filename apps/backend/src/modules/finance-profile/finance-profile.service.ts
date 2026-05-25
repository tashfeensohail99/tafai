import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Coerce a Prisma Decimal (or number/null) to a plain number for the UI. */
const num = (d: Prisma.Decimal | number | null | undefined): number =>
  d == null ? 0 : Number(d.toString());

/**
 * Read-only aggregation that powers the Finance customer-profile page: the
 * customer's bio + their agreement + service-contract ledger + invoices +
 * payments + receipts + running totals — stitched across the lead and (if
 * converted) the client, which share the same referenceCode.
 */
@Injectable()
export class FinanceProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getCustomerProfile(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        referenceCode: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        nationality: true,
        targetCountry: true,
        serviceInterest: true,
        status: true,
        sourceChannel: true,
        createdAt: true,
        convertedClientId: true,
        assignedEmployee: { select: { firstName: true, lastName: true } },
      },
    });
    if (!lead) throw new NotFoundException('Customer (lead) not found');

    const clientId = lead.convertedClientId;
    const ownerOr: Array<{ leadId: string } | { clientId: string }> = clientId
      ? [{ leadId }, { clientId }]
      : [{ leadId }];

    const [agreement, contract, invoices, payments, receipts] = await Promise.all([
      this.prisma.agreement.findFirst({
        where: { leadId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          agreementNumber: true,
          status: true,
          currency: true,
          totalAmount: true,
          grossAmount: true,
          discountAmount: true,
          generatedPdfKey: true,
          serviceContractId: true,
          bioData: true,
          sentAt: true,
          signedAt: true,
        },
      }),
      this.prisma.serviceContract.findFirst({
        where: { OR: ownerOr, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { installments: { orderBy: { sequence: 'asc' } } },
      }),
      this.prisma.invoice.findMany({ where: { OR: ownerOr }, orderBy: { createdAt: 'desc' } }),
      this.prisma.payment.findMany({ where: { invoice: { OR: ownerOr } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.receipt.findMany({ where: { OR: ownerOr }, orderBy: { issuedAt: 'desc' } }),
    ]);

    const fee = num(contract?.totalAmount) || num(agreement?.totalAmount);
    const paid = invoices.reduce((s, i) => s + num(i.paidAmount), 0);
    const currency = contract?.currency || agreement?.currency || 'CAD';

    // Allocate total verified payments across the installment schedule in
    // order (AR waterfall) so the ledger shows precise "paid X of Y" without
    // touching the payment pipeline. Installments arrive ordered by sequence.
    let remaining = paid;
    const now = Date.now();
    const installmentsView = (contract?.installments ?? []).map((i) => {
      const amount = num(i.amount);
      const covered = Math.max(0, Math.min(remaining, amount));
      remaining -= covered;
      const fullyPaid = amount > 0 && covered >= amount - 0.005;
      const overdue = !fullyPaid && i.dueDate ? new Date(i.dueDate).getTime() < now : false;
      return {
        id: i.id,
        sequence: i.sequence,
        dueDate: i.dueDate,
        amount,
        description: i.description,
        status: i.status,
        paidAmount: covered,
        paidStatus: fullyPaid ? 'PAID' : covered > 0 ? 'PARTIALLY_PAID' : overdue ? 'OVERDUE' : 'DUE',
      };
    });
    const installmentsPaid = installmentsView.filter((i) => i.paidStatus === 'PAID').length;

    return {
      lead: {
        id: lead.id,
        referenceCode: lead.referenceCode,
        firstName: lead.firstName,
        lastName: lead.lastName,
        phone: lead.phone,
        email: lead.email,
        nationality: lead.nationality,
        targetCountry: lead.targetCountry,
        serviceInterest: lead.serviceInterest,
        status: lead.status,
        sourceChannel: lead.sourceChannel,
        createdAt: lead.createdAt,
        assignedEmployee: lead.assignedEmployee,
      },
      clientId,
      agreement: agreement
        ? {
            id: agreement.id,
            agreementNumber: agreement.agreementNumber,
            status: agreement.status,
            currency: agreement.currency,
            totalAmount: num(agreement.totalAmount),
            grossAmount: num(agreement.grossAmount),
            discountAmount: num(agreement.discountAmount),
            hasPdf: !!agreement.generatedPdfKey,
            serviceContractId: agreement.serviceContractId,
            bioData: agreement.bioData,
            sentAt: agreement.sentAt,
            signedAt: agreement.signedAt,
          }
        : null,
      contract: contract
        ? {
            id: contract.id,
            contractNumber: contract.contractNumber,
            status: contract.status,
            totalAmount: num(contract.totalAmount),
            currency: contract.currency,
            signedDate: contract.signedDate,
            hasSignedAgreement: !!contract.agreementKey,
            agreementFileName: contract.agreementFileName,
          }
        : null,
      installments: installmentsView,
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        status: i.status,
        currency: i.currency,
        totalAmount: num(i.totalAmount),
        paidAmount: num(i.paidAmount),
        dueDate: i.dueDate,
        createdAt: i.createdAt,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: num(p.amount),
        currency: p.currency,
        status: p.status,
        paymentMethod: p.paymentMethod,
        paidAt: p.paidAt,
        verifiedAt: p.verifiedAt,
      })),
      receipts: receipts.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        amount: num(r.amount),
        currency: r.currency,
        issuedAt: r.issuedAt,
      })),
      totals: {
        fee,
        paid,
        outstanding: Math.max(0, fee - paid),
        currency,
        installmentsPaid,
        installmentsTotal: installmentsView.length,
      },
    };
  }
}
