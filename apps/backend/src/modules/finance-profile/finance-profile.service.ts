import { Injectable, NotFoundException } from '@nestjs/common';
import { AgreementStatus, FinanceHandoverStatus, Prisma, VisitType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FxService } from '../../common/fx/fx.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

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

    const [agreementRows, contractRows, invoices, payments, receipts, handovers, processingCase, expenses, realProcessingCase, consultVisits] = await Promise.all([
      // ALL non-deleted agreements (programs) for this person, newest first — a
      // person can now hold more than one. Index 0 is the "primary" and backs the
      // flat top-level fields for backward compatibility.
      this.prisma.agreement.findMany({
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
          categoryKey: true,
          bioData: true,
          sentAt: true,
          signedAt: true,
        },
      }),
      this.prisma.serviceContract.findMany({
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
          baseAmount: true,
          baseCurrency: true,
          fxRate: true,
          billable: true,
          incurredAt: true,
          receiptFileName: true,
          receiptKey: true,
          createdAt: true,
        },
      }),
      // Real ProcessingCase row (the operational entity the processing team
      // works on) — used to decide whether finance's "Send to Processing"
      // button should still be available or has already been pressed. We
      // only need its existence (button hides once a case is open), so a
      // minimal select keeps the query cheap.
      this.prisma.processingCase.findFirst({
        where: { leadId },
        select: { id: true },
      }),
      // Paid consultation fees this customer has that are creditable against the
      // service fee (audit #1). These are INFORMATIONAL: the credit already applies
      // automatically, because each consult fee's paid Invoice carries the same
      // lead/client — so its payment is netted into `paid`/`outstanding` (and the
      // overpay ceiling) below, reducing what they owe by the consult amount. This
      // list simply lets finance SEE the credit is in effect.
      this.prisma.visit.findMany({
        where: { visitType: VisitType.PAID_CONSULT, consultFeeCreditable: true, paymentId: { not: null }, OR: ownerOr },
        select: { id: true, feeAmount: true, feeCurrency: true, invoiceId: true, checkedInAt: true },
        orderBy: { checkedInAt: 'desc' },
      }),
    ]);

    const invById = new Map(invoices.map((i) => [i.id, i]));
    const consultCredits = consultVisits
      .filter((v) => num(v.feeAmount) > 0)
      .map((v) => ({
        visitId: v.id,
        amount: num(v.feeAmount),
        currency: v.feeCurrency ?? 'CAD',
        consultInvoiceNumber: v.invoiceId ? (invById.get(v.invoiceId)?.invoiceNumber ?? null) : null,
        paidAt: v.checkedInAt,
      }));

    // ── Per-agreement ledgers ────────────────────────────────────────────────
    // Attribute each invoice's PAID to its own agreement (Invoice.agreementId) so
    // every program shows its OWN fee / paid / outstanding, instead of one
    // agreement's fee with the whole person's payments folded in. Consult and
    // legacy unattributed invoices (agreementId = null) net into the newest
    // program OF THE MATCHING CURRENCY — that preserves audit-#1 (the consult
    // fee still credits against the service fee, no double-charge, even when the
    // consult currency differs from the primary program's) AND keeps
    // single-agreement numbers byte-identical to before.
    const paidByAgreement = new Map<string, number>();
    const unattributedPaidByCurrency = new Map<string, number>();
    for (const i of invoices) {
      const amt = num(i.paidAmount);
      if (amt === 0) continue;
      if (i.agreementId) {
        paidByAgreement.set(i.agreementId, (paidByAgreement.get(i.agreementId) ?? 0) + amt);
      } else {
        const c = i.currency || 'CAD';
        unattributedPaidByCurrency.set(c, (unattributedPaidByCurrency.get(c) ?? 0) + amt);
      }
    }

    const now = Date.now();
    // AR waterfall: allocate an agreement's paid across its installment schedule
    // (ordered by sequence) so the ledger shows precise "paid X of Y".
    const buildInstallmentView = (
      insts: (typeof contractRows)[number]['installments'],
      paidPool: number,
    ) => {
      let remaining = paidPool;
      return insts.map((i) => {
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
          recognizedAt: i.recognizedAt,
        };
      });
    };

    // Which ledger absorbs each currency's unattributed (consult/legacy) paid:
    // the FIRST (newest, since agreementRows is createdAt-desc) agreement of that
    // currency. This keeps a consult netting against a SAME-currency program even
    // when it isn't the primary — without it a PKR consult on a customer whose
    // newest agreement is CAD would be dropped, re-opening the audit-#1
    // double-charge for that PKR program.
    const currencyOfAgreement = (a: (typeof agreementRows)[number]) => {
      const c = contractRows.find((ct) => ct.id === a.serviceContractId) ?? null;
      return c?.currency || a.currency || 'CAD';
    };
    const unattributedAbsorberIdx = new Map<string, number>();
    agreementRows.forEach((a, idx) => {
      const cur = currencyOfAgreement(a);
      if (!unattributedAbsorberIdx.has(cur)) unattributedAbsorberIdx.set(cur, idx);
    });

    const agreementLedgers = agreementRows.map((a, idx) => {
      const c = contractRows.find((ct) => ct.id === a.serviceContractId) ?? null;
      const ledgerCurrency = c?.currency || a.currency || 'CAD';
      const ledgerFee = num(c?.totalAmount) || num(a.totalAmount);
      const extra =
        unattributedAbsorberIdx.get(ledgerCurrency) === idx
          ? (unattributedPaidByCurrency.get(ledgerCurrency) ?? 0)
          : 0;
      const ledgerPaid = (paidByAgreement.get(a.id) ?? 0) + extra;
      const insts = buildInstallmentView(c?.installments ?? [], ledgerPaid);
      return {
        agreement: {
          id: a.id,
          agreementNumber: a.agreementNumber,
          status: a.status,
          currency: a.currency,
          totalAmount: num(a.totalAmount),
          grossAmount: num(a.grossAmount),
          discountAmount: num(a.discountAmount),
          hasPdf: !!a.generatedPdfKey,
          serviceContractId: a.serviceContractId,
          categoryKey: a.categoryKey,
          bioData: a.bioData,
          sentAt: a.sentAt,
          signedAt: a.signedAt,
        },
        contract: c
          ? {
              id: c.id,
              contractNumber: c.contractNumber,
              status: c.status,
              totalAmount: num(c.totalAmount),
              currency: c.currency,
              signedDate: c.signedDate,
              hasSignedAgreement: !!c.agreementKey,
              agreementFileName: c.agreementFileName,
            }
          : null,
        installments: insts,
        totals: {
          fee: ledgerFee,
          paid: ledgerPaid,
          outstanding: Math.max(0, ledgerFee - ledgerPaid),
          currency: ledgerCurrency,
          installmentsPaid: insts.filter((i) => i.paidStatus === 'PAID').length,
          installmentsTotal: insts.length,
        },
      };
    });

    // Primary = newest agreement; it backs the flat top-level fields so existing
    // callers (and single-agreement customers) are unchanged.
    const primary = agreementLedgers[0] ?? null;
    const fee = primary?.totals.fee ?? 0;
    // Consult-only customer (no service agreement yet): surface the consult /
    // unattributed paid in the flat Paid/currency so the money strip isn't a
    // bare "Paid 0" (the pre-multi-agreement behaviour summed those invoices).
    // fee stays 0 → outstanding 0; this only restores visibility of what was paid.
    const consultOnlyFallback =
      !primary && unattributedPaidByCurrency.size > 0
        ? Array.from(unattributedPaidByCurrency.entries()).sort((a, b) => b[1] - a[1])[0]
        : null;
    const paid = primary?.totals.paid ?? consultOnlyFallback?.[1] ?? 0;
    const currency = primary?.totals.currency ?? consultOnlyFallback?.[0] ?? 'CAD';
    const installmentsView = primary?.installments ?? [];
    const installmentsPaid = primary?.totals.installmentsPaid ?? 0;
    const perCurrencySummary = Array.from(
      agreementLedgers.reduce((m, l) => {
        const s = m.get(l.totals.currency) ?? { currency: l.totals.currency, fee: 0, paid: 0, outstanding: 0 };
        s.fee += l.totals.fee;
        s.paid += l.totals.paid;
        s.outstanding += l.totals.outstanding;
        m.set(l.totals.currency, s);
        return m;
      }, new Map<string, { currency: string; fee: number; paid: number; outstanding: number }>()).values(),
    );
    // Express expenses in the AGREEMENT's own currency so the whole ledger is
    // native and internally consistent — a PKR agreement's margin is PKR fee −
    // PKR cost, never PKR − CAD. An expense already in that currency contributes
    // its native amount; one in a different currency is converted from its
    // stored CAD base at the current rate (the per-CAD rate is cached, so this
    // is cheap and only runs when a foreign-currency expense is actually present).
    const nativePart = (list: typeof expenses) =>
      list
        .filter((e) => (e.currency || currency) === currency)
        .reduce((s, e) => s + num(e.amount), 0);
    const convForeign = async (list: typeof expenses): Promise<number> => {
      const cad = list
        .filter((e) => (e.currency || currency) !== currency)
        .reduce((s, e) => s + num(e.baseAmount ?? e.amount), 0);
      if (cad <= 0) return 0;
      try {
        return await this.fx.convertFromBase(cad, currency);
      } catch {
        // No live rate for this agreement currency — degrade gracefully to the
        // CAD figure (the pre-native behaviour) rather than 500-ing the whole
        // customer profile over an unconvertible foreign-currency expense.
        return cad;
      }
    };
    const billableList = expenses.filter((e) => e.billable);
    const [totalForeign, billableForeign] = await Promise.all([
      convForeign(expenses),
      convForeign(billableList),
    ]);
    const totalExpenses = nativePart(expenses) + totalForeign;
    // Billable disbursements are recoverable (client reimburses) → not a cost.
    // Only absorbed expenses reduce margin.
    const billableExpenses = nativePart(billableList) + billableForeign;
    const absorbedExpenses = totalExpenses - billableExpenses;

    // "Send to Processing" gate — finance manually hands the file over after
    // they've verified payment. The button on the customer profile stays grey
    // until a PAYMENT_VERIFIED handover exists, and disappears once a real
    // ProcessingCase row is on file (so we can't double-send).
    const verifiedReadyHandover = handovers.find(
      (h) => h.status === FinanceHandoverStatus.PAYMENT_VERIFIED,
    );
    // Judicial Review agreements route to a JrMatter (JR Head's queue) instead of
    // a ProcessingCase — same button, same permission, different target. The
    // "already sent" signal for JR is an opened JrMatter keyed on one of this
    // file's handover ids (JrMatter.financeHandoverId is a bare cross-schema id).
    const isJudicialReview = lead.serviceInterest === 'JR_RESUBMISSION';
    const handoverIds = handovers.map((h) => h.id);
    const jrMatter =
      isJudicialReview && handoverIds.length > 0
        ? await this.prisma.jrMatter.findFirst({
            where: { financeHandoverId: { in: handoverIds } },
            select: { id: true },
          })
        : null;
    const alreadySent = isJudicialReview ? !!jrMatter : !!realProcessingCase;
    const sendToProcessing = {
      ready: !!verifiedReadyHandover && !alreadySent,
      handoverId: verifiedReadyHandover?.id ?? null,
      alreadySent,
      isJudicialReview,
      target: (isJudicialReview ? 'JR' : 'PROCESSING') as 'JR' | 'PROCESSING',
      reason: alreadySent
        ? isJudicialReview
          ? 'Already opened as a JR matter.'
          : 'Already in processing.'
        : !verifiedReadyHandover
          ? 'Verify a payment first to enable.'
          : null,
    };

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
      // One ledger per agreement (program), newest first. Each carries its own
      // agreement + contract + installments + { fee, paid, outstanding }.
      agreements: agreementLedgers,
      // Per-currency roll-up across all programs (avoids mixing PKR + CAD).
      summary: { byCurrency: perCurrencySummary, agreementCount: agreementLedgers.length },
      // ── Backward-compat: flat fields mirror the PRIMARY (newest) program so
      //    existing single-agreement callers are unchanged. ──
      agreement: primary?.agreement ?? null,
      contract: primary?.contract ?? null,
      installments: installmentsView,
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        status: i.status,
        currency: i.currency,
        totalAmount: num(i.totalAmount),
        paidAmount: num(i.paidAmount),
        isConsultation: i.isConsultation,
        dueDate: i.dueDate,
        createdAt: i.createdAt,
      })),
      // Paid consult fees creditable against a service invoice (audit #1).
      consultCredits,
      payments: payments.map((p) => ({
        id: p.id,
        amount: num(p.amount),
        currency: p.currency,
        baseAmount: p.baseAmount != null ? num(p.baseAmount) : num(p.amount),
        baseCurrency: p.baseCurrency ?? 'CAD',
        fxRate: p.fxRate != null ? num(p.fxRate) : 1,
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
      sendToProcessing,
      expenses: expenses.map((e) => ({
        id: e.id,
        category: e.category,
        description: e.description,
        amount: num(e.amount),
        currency: e.currency,
        baseAmount: e.baseAmount != null ? num(e.baseAmount) : num(e.amount),
        baseCurrency: e.baseCurrency ?? 'CAD',
        fxRate: e.fxRate != null ? num(e.fxRate) : 1,
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
  async listCustomers(search?: string, opts: { take?: number; cursor?: string } = {}) {
    const s = search?.trim();
    // Perf: `take` caps the page (default 50). Combined with the debounced
    // search input on the frontend, this stops the Customers list from firing
    // an 8-query fan-out over every finance-touched lead on every keystroke.
    const take = Math.max(1, Math.min(200, opts.take ?? 50));

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
      take,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
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
        select: { id: true, leadId: true, clientId: true, totalAmount: true, currency: true, status: true },
      }),
      this.prisma.agreement.findMany({
        where: { leadId: { in: ids }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, leadId: true, totalAmount: true, currency: true, status: true, serviceContractId: true },
      }),
      this.prisma.invoice.findMany({
        where: { OR: ownerOr, deletedAt: null },
        select: { leadId: true, clientId: true, paidAmount: true, agreementId: true, currency: true },
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
      const agreement = agreements.find((a) => a.leadId === lead.id); // newest = primary
      // Anchor the contract to the PRIMARY agreement's own contract (not just the
      // newest contract of any program) so fee, paid and currency all describe the
      // same program — otherwise a multi-agreement customer's fee (program B's
      // contract) and paid (program A's invoices) would describe different deals.
      const contract =
        (agreement?.serviceContractId
          ? contracts.find((c) => c.id === agreement.serviceContractId)
          : undefined) ?? undefined;
      const rowCurrency = contract?.currency || agreement?.currency || 'CAD';
      // Paid for the PRIMARY agreement only (matches the profile's primary program
      // + fee below), plus consult/legacy unattributed invoices in that currency.
      // The old sum-all-invoices mixed currencies AND folded in other programs'
      // payments, inflating `paid` and breaking outstanding for multi-agreement.
      const paid = invoices
        .filter((i) => matchesOwner(i, lead))
        .reduce((sum, i) => {
          if (i.agreementId) return i.agreementId === agreement?.id ? sum + num(i.paidAmount) : sum;
          return (i.currency || rowCurrency) === rowCurrency ? sum + num(i.paidAmount) : sum;
        }, 0);
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
