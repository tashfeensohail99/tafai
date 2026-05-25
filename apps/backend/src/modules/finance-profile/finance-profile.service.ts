import { Injectable, NotFoundException } from '@nestjs/common';
import { AgreementStatus, FinanceHandoverStatus, Prisma } from '@prisma/client';
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

    const [agreement, contract, invoices, payments, receipts, handovers, processingCase, expenses] = await Promise.all([
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
      this.prisma.invoice.findMany({ where: { OR: ownerOr, deletedAt: null }, orderBy: { createdAt: 'desc' } }),
      this.prisma.payment.findMany({ where: { deletedAt: null, invoice: { OR: ownerOr } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.receipt.findMany({ where: { OR: ownerOr }, orderBy: { issuedAt: 'desc' } }),
      this.prisma.financeHandover.findMany({
        where: { leadId },
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          status: true,
          submittedAmount: true,
          currency: true,
          paymentId: true,
          receiptFileName: true,
          submittedAt: true,
          reviewedAt: true,
        },
      }),
      // The "in processing" indicator reads the CRM Case that verifyPayment
      // actually opens (createFromVerifiedPayment), keyed by the converted
      // client — not the separate ProcessingCase model which this flow never
      // populates. Null until the customer has been converted + a case opened.
      clientId
        ? this.prisma.case.findFirst({
            where: { clientId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, status: true, serviceType: true, targetCountry: true },
          })
        : Promise.resolve(null),
      this.prisma.expense.findMany({
        where: { OR: ownerOr, deletedAt: null },
        orderBy: { incurredAt: 'desc' },
        select: {
          id: true,
          category: true,
          description: true,
          amount: true,
          currency: true,
          billable: true,
          incurredAt: true,
          receiptFileName: true,
          receiptKey: true,
          createdAt: true,
        },
      }),
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
        // Revenue recognition (accrual): when this milestone was delivered.
        recognizedAt: i.recognizedAt,
      };
    });
    const installmentsPaid = installmentsView.filter((i) => i.paidStatus === 'PAID').length;
    const totalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0);
    // Billable disbursements are recoverable (client reimburses) → not a cost.
    // Only absorbed expenses reduce margin.
    const billableExpenses = expenses.filter((e) => e.billable).reduce((s, e) => s + num(e.amount), 0);
    const absorbedExpenses = totalExpenses - billableExpenses;

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
      handovers: handovers.map((h) => ({
        id: h.id,
        status: h.status,
        amount: num(h.submittedAmount),
        currency: h.currency,
        verified: !!h.paymentId,
        receiptFileName: h.receiptFileName,
        submittedAt: h.submittedAt,
        reviewedAt: h.reviewedAt,
      })),
      processingCase: processingCase
        ? {
            id: processingCase.id,
            stage: processingCase.status, // CaseStatus (OPEN/DOCUMENTATION/PROCESSING/…)
            service: processingCase.serviceType ?? '',
            targetCountry: processingCase.targetCountry ?? '',
            slaStatus: '',
          }
        : null,
      expenses: expenses.map((e) => ({
        id: e.id,
        category: e.category,
        description: e.description,
        amount: num(e.amount),
        currency: e.currency,
        billable: e.billable,
        incurredAt: e.incurredAt,
        receiptFileName: e.receiptFileName,
        hasReceipt: !!e.receiptKey,
        createdAt: e.createdAt,
      })),
      totals: {
        fee,
        paid,
        outstanding: Math.max(0, fee - paid),
        currency,
        installmentsPaid,
        installmentsTotal: installmentsView.length,
        expenses: totalExpenses,
        billableExpenses,
        absorbedExpenses,
        // Margin = fee minus ABSORBED costs only. Billable disbursements are
        // recoverable (client reimburses), so they don't reduce margin.
        margin: fee - absorbedExpenses,
      },
    };
  }

  /**
   * Searchable customer list that powers the Finance "Customers" screen — the
   * home base that opens the 360° profile. A "customer" here is any lead that
   * has entered the finance flow: it has an agreement, a service contract, or a
   * payment handover. Money figures (fee/paid/outstanding) are computed in a
   * handful of batched queries (no per-row N+1), so the list stays fast.
   */
  async listCustomers(search?: string) {
    const s = search?.trim();

    // 1) Candidate leadIds: anyone finance is actually handling — a submitted+
    // agreement (DRAFTs are still in Sales' hands), a contract, or a handover.
    const [agrLeads, scLeads, hoLeads] = await Promise.all([
      this.prisma.agreement.findMany({ where: { deletedAt: null, status: { not: AgreementStatus.DRAFT } }, select: { leadId: true }, distinct: ['leadId'] }),
      this.prisma.serviceContract.findMany({ where: { deletedAt: null, leadId: { not: null } }, select: { leadId: true }, distinct: ['leadId'] }),
      this.prisma.financeHandover.findMany({ select: { leadId: true }, distinct: ['leadId'] }),
    ]);
    const candidateIds = [
      ...new Set(
        [...agrLeads, ...scLeads, ...hoLeads].map((r) => r.leadId).filter((x): x is string => !!x),
      ),
    ];
    if (candidateIds.length === 0) return [];

    // 2) The leads themselves (with optional search across name/phone/ref/email).
    const leads = await this.prisma.lead.findMany({
      where: {
        id: { in: candidateIds },
        deletedAt: null,
        ...(s
          ? {
              OR: [
                { firstName: { contains: s, mode: 'insensitive' } },
                { lastName: { contains: s, mode: 'insensitive' } },
                { phone: { contains: s } },
                { referenceCode: { contains: s, mode: 'insensitive' } },
                { email: { contains: s, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        referenceCode: true,
        firstName: true,
        lastName: true,
        phone: true,
        status: true,
        serviceInterest: true,
        targetCountry: true,
        convertedClientId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (leads.length === 0) return [];

    const ids = leads.map((l) => l.id);
    const clientIds = leads.map((l) => l.convertedClientId).filter((x): x is string => !!x);
    const ownerOr = [{ leadId: { in: ids } }, { clientId: { in: clientIds } }];

    // 3) Batch the money + status data for every listed lead.
    const [contracts, agreements, invoices, cases, pendingHandovers] = await Promise.all([
      this.prisma.serviceContract.findMany({
        where: { OR: ownerOr, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { leadId: true, clientId: true, totalAmount: true, currency: true, status: true },
      }),
      this.prisma.agreement.findMany({
        where: { leadId: { in: ids }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { leadId: true, totalAmount: true, currency: true, status: true },
      }),
      this.prisma.invoice.findMany({
        where: { OR: ownerOr, deletedAt: null },
        select: { leadId: true, clientId: true, paidAmount: true },
      }),
      this.prisma.processingCase.findMany({
        where: { leadId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        select: { leadId: true, stage: true },
      }),
      // Payments recorded but not yet verified — the "to verify" worklist.
      this.prisma.financeHandover.findMany({
        where: {
          leadId: { in: ids },
          status: { in: [FinanceHandoverStatus.SUBMITTED, FinanceHandoverStatus.IN_REVIEW, FinanceHandoverStatus.PAYMENT_RECORDED] },
        },
        select: { leadId: true },
        distinct: ['leadId'],
      }),
    ]);
    const pendingLeadIds = new Set(pendingHandovers.map((h) => h.leadId));

    // First match wins (queries are ordered newest-first).
    const matchesOwner = (row: { leadId: string | null; clientId: string | null }, lead: (typeof leads)[number]) =>
      row.leadId === lead.id || (!!lead.convertedClientId && row.clientId === lead.convertedClientId);

    return leads.map((lead) => {
      const contract = contracts.find((c) => matchesOwner(c, lead));
      const agreement = agreements.find((a) => a.leadId === lead.id);
      const paid = invoices
        .filter((i) => matchesOwner(i, lead))
        .reduce((sum, i) => sum + num(i.paidAmount), 0);
      const fee = num(contract?.totalAmount) || num(agreement?.totalAmount);
      const stage = cases.find((c) => c.leadId === lead.id)?.stage ?? null;
      return {
        leadId: lead.id,
        referenceCode: lead.referenceCode,
        firstName: lead.firstName,
        lastName: lead.lastName,
        phone: lead.phone,
        serviceInterest: lead.serviceInterest,
        targetCountry: lead.targetCountry,
        status: lead.status,
        agreementStatus: agreement?.status ?? null,
        hasContract: !!contract,
        contractStatus: contract?.status ?? null,
        processingStage: stage,
        hasPendingPayment: pendingLeadIds.has(lead.id),
        fee,
        paid,
        outstanding: Math.max(0, fee - paid),
        currency: contract?.currency || agreement?.currency || 'CAD',
      };
    });
  }
}
