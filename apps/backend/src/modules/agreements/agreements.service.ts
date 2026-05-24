import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AgreementStatus,
  PaymentPlanType,
  Prisma,
  ServiceContractStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EmailService } from '../email/email.service';
import {
  AgreementRenderService,
  type AgreementBioData,
  type AgreementPlanData,
} from './agreement-render.service';
import {
  CreateAgreementDto,
  ListAgreementsQueryDto,
  PaymentPlanDto,
  UpdateAgreementDto,
} from './agreements.dto';

/** Statuses a Finance reviewer can act on. */
const FINANCE_ACTIONABLE: AgreementStatus[] = [
  AgreementStatus.SUBMITTED,
  AgreementStatus.FINANCE_REVIEW,
];

/** Statuses where Sales may still edit the draft. */
const SALES_EDITABLE: AgreementStatus[] = [
  AgreementStatus.DRAFT,
  AgreementStatus.CHANGES_REQUESTED,
  AgreementStatus.EDITED_PENDING_SALES,
];

/** A plan shape sufficient for balance validation. */
interface BalanceCheckPlan {
  planType: string;
  grossAmount: number;
  discountAmount: number;
  netPayable: number;
  installments: Array<{ amount?: number | null }>;
}

@Injectable()
export class AgreementsService {
  private readonly log = new Logger(AgreementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly render: AgreementRenderService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
  ) {}

  /**
   * Email the Sales author of an agreement on a review decision. Non-fatal:
   * a notification failure must never roll back the review action itself.
   */
  private async notifyAuthor(
    createdByUserId: string | null,
    kind: 'changes' | 'approved',
    ctx: { agreementNumber: string; leadId?: string | null; note?: string },
  ): Promise<void> {
    try {
      if (!createdByUserId) return;
      const user = await this.prisma.userAccount.findUnique({
        where: { id: createdByUserId },
        select: { email: true },
      });
      if (!user?.email) return;
      const emp = await this.prisma.employee.findFirst({
        where: { userId: createdByUserId },
        select: { firstName: true },
      });
      const salesName = emp?.firstName ?? user.email.split('@')[0] ?? 'there';
      let leadName: string | null = null;
      if (ctx.leadId) {
        const lead = await this.prisma.lead.findUnique({
          where: { id: ctx.leadId },
          select: { firstName: true, lastName: true },
        });
        if (lead) leadName = `${lead.firstName} ${lead.lastName}`.trim();
      }
      if (kind === 'changes') {
        await this.email.sendAgreementChangesRequested({
          to: user.email,
          salesName,
          agreementNumber: ctx.agreementNumber,
          leadName,
          note: ctx.note ?? '',
        });
      } else {
        await this.email.sendAgreementApproved({
          to: user.email,
          salesName,
          agreementNumber: ctx.agreementNumber,
          leadName,
        });
      }
    } catch (err) {
      this.log.warn(`agreement author notification failed: ${(err as Error).message}`);
    }
  }

  // ─── Sales authoring ─────────────────────────────────────────────────────

  async createDraft(dto: CreateAgreementDto, userId: string) {
    const template = await this.prisma.agreementTemplate.findUnique({
      where: { id: dto.templateId },
    });
    if (!template || !template.isActive) {
      throw new BadRequestException('Template not found or inactive');
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        nationality: true,
        referenceCode: true,
        serviceFeeAmount: true,
        serviceFeeCurrency: true,
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    const bioData: AgreementBioData = {
      applicantName: `${lead.firstName} ${lead.lastName}`.trim(),
      nationality: lead.nationality ?? undefined,
      phone: lead.phone ?? undefined,
      email: lead.email ?? undefined,
      fileNumber: lead.referenceCode ?? undefined,
      agreementDate: '',
    };

    const currency = this.normalizeCurrency(lead.serviceFeeCurrency);
    const gross = lead.serviceFeeAmount ? Number(lead.serviceFeeAmount) : 0;
    const seedStages = Array.isArray(template.defaultStages)
      ? (template.defaultStages as Array<Record<string, unknown>>)
      : [];
    const plan: AgreementPlanData = {
      planType: seedStages.length > 0 ? 'INSTALLMENT' : 'FULL',
      currency,
      grossAmount: gross,
      discountAmount: 0,
      netPayable: gross,
      installments: seedStages.map((s, i) => ({
        sequence: i + 1,
        stage: typeof s.label === 'string' ? s.label : `Stage ${i + 1}`,
        amount: typeof s.amount === 'number' ? s.amount : 0,
        trigger: typeof s.trigger === 'string' ? s.trigger : null,
      })),
    };

    const agreementNumber = await this.generateAgreementNumber();
    const contentHtml = this.render.composeAgreementInner(
      template.bodyHtml,
      template.programTitle,
      bioData,
      plan,
      agreementNumber,
    );

    const created = await this.prisma.agreement.create({
      data: {
        agreementNumber,
        leadId: lead.id,
        templateId: template.id,
        categoryKey: template.categoryKey,
        status: AgreementStatus.DRAFT,
        currency,
        grossAmount: gross,
        discountAmount: 0,
        totalAmount: gross,
        paymentPlanType: this.toPlanTypeEnum(plan.planType),
        bioData: bioData as unknown as Prisma.InputJsonValue,
        paymentPlan: plan as unknown as Prisma.InputJsonValue,
        contentHtml,
        createdByUserId: userId,
      },
    });

    await this.recordEvent(
      created.id,
      userId,
      'CREATED',
      `Draft created from template "${template.name}"`,
      null,
      { agreementNumber, categoryKey: template.categoryKey },
    );

    return created;
  }

  async updateDraft(id: string, dto: UpdateAgreementDto, userId: string) {
    const existing = await this.prisma.agreement.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Agreement not found');
    if (!SALES_EDITABLE.includes(existing.status)) {
      throw new ConflictException(
        `Agreement is locked (status ${existing.status}). Ask Finance to reopen it before editing.`,
      );
    }

    const template = await this.prisma.agreementTemplate.findUnique({
      where: { id: existing.templateId },
    });
    if (!template) throw new NotFoundException('Agreement template missing');

    const before = {
      bioData: existing.bioData,
      paymentPlan: existing.paymentPlan,
      totalAmount: existing.totalAmount,
    };

    const bioData: AgreementBioData = dto.bioData
      ? (dto.bioData as AgreementBioData)
      : ((existing.bioData as AgreementBioData) ?? {});

    let plan: AgreementPlanData = (existing.paymentPlan as AgreementPlanData) ?? {};
    const data: Prisma.AgreementUpdateInput = {};

    if (dto.paymentPlan) {
      this.assertPlanBalances(dto.paymentPlan);
      plan = this.normalizePlan(dto.paymentPlan);
      data.currency = plan.currency;
      data.grossAmount = plan.grossAmount;
      data.discountAmount = plan.discountAmount;
      data.totalAmount = plan.netPayable;
      data.paymentPlanType = this.toPlanTypeEnum(plan.planType);
      data.paymentPlan = plan as unknown as Prisma.InputJsonValue;
    }
    if (dto.bioData) {
      data.bioData = bioData as unknown as Prisma.InputJsonValue;
    }
    if (dto.salesNotes !== undefined) {
      data.salesNotes = dto.salesNotes;
    }

    if (dto.contentHtml !== undefined) {
      // Sales edited the document directly — store it verbatim; it becomes
      // the source of truth for the PDF.
      data.contentHtml = dto.contentHtml;
    } else if (dto.paymentPlan || dto.bioData) {
      // Bio/plan changed without a manual edit — keep the document in sync.
      data.contentHtml = this.render.composeAgreementInner(
        template.bodyHtml,
        template.programTitle,
        bioData,
        plan,
        existing.agreementNumber,
      );
    }

    const updated = await this.prisma.agreement.update({ where: { id }, data });

    await this.recordEvent(
      id,
      userId,
      'UPDATED',
      this.summariseUpdate(dto),
      before as unknown as Prisma.InputJsonValue,
      {
        bioData: updated.bioData,
        paymentPlan: updated.paymentPlan,
        totalAmount: updated.totalAmount,
      } as unknown as Prisma.InputJsonValue,
    );

    return updated;
  }

  async submitToFinance(id: string, userId: string) {
    const existing = await this.prisma.agreement.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Agreement not found');
    if (!SALES_EDITABLE.includes(existing.status)) {
      throw new ConflictException(
        `Cannot submit from status ${existing.status}.`,
      );
    }

    const bio = (existing.bioData as AgreementBioData) ?? {};
    if (!bio.applicantName || !bio.applicantName.trim()) {
      throw new BadRequestException('Applicant name is required before submitting.');
    }
    this.assertPlanBalances(existing.paymentPlan as unknown as PaymentPlanDto);

    const updated = await this.prisma.agreement.update({
      where: { id },
      data: { status: AgreementStatus.SUBMITTED, submittedAt: new Date() },
    });

    await this.recordEvent(
      id,
      userId,
      'SUBMITTED',
      'Submitted to Finance for review',
      null,
      { agreementNumber: existing.agreementNumber },
    );

    return updated;
  }

  /** Soft-delete a draft so Sales can clean up unwanted drafts. Blocked once
   *  the agreement is approved or has materialised a contract. */
  async softDelete(id: string, userId: string) {
    const a = await this.prisma.agreement.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw new NotFoundException('Agreement not found');
    const finalised: AgreementStatus[] = [
      AgreementStatus.APPROVED,
      AgreementStatus.SENT,
      AgreementStatus.SIGNED,
    ];
    if (a.serviceContractId || finalised.includes(a.status)) {
      throw new ConflictException('This agreement is approved/finalised and cannot be deleted.');
    }
    await this.prisma.agreement.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.recordEvent(id, userId, 'DELETED', 'Agreement deleted', null, null);
    return { ok: true };
  }

  // ─── Finance review ──────────────────────────────────────────────────────

  /**
   * Finance approves: re-validate, lock the plan, materialise the ledger
   * (ServiceContract + Installments) once, and generate + store the final
   * PDF from the approved record.
   */
  async approve(id: string, userId: string) {
    const a = await this.prisma.agreement.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw new NotFoundException('Agreement not found');
    if (!FINANCE_ACTIONABLE.includes(a.status)) {
      throw new ConflictException(`Cannot approve from status ${a.status}.`);
    }

    const plan = (a.paymentPlan as AgreementPlanData) ?? {};
    this.assertPlanBalances({
      planType: plan.planType ?? 'INSTALLMENT',
      grossAmount: plan.grossAmount ?? 0,
      discountAmount: plan.discountAmount ?? 0,
      netPayable: plan.netPayable ?? Number(a.totalAmount.toString()),
      installments: plan.installments ?? [],
    });

    const serviceContractId =
      a.serviceContractId ?? (await this.materializeServiceContract(a, plan, userId));

    let pdfKey = a.generatedPdfKey;
    const template = await this.prisma.agreementTemplate.findUnique({
      where: { id: a.templateId },
    });
    if (template) {
      const inner =
        a.contentHtml && a.contentHtml.trim()
          ? a.contentHtml
          : this.render.composeAgreementInner(
              template.bodyHtml,
              template.programTitle,
              (a.bioData as AgreementBioData) ?? {},
              plan,
              a.agreementNumber,
            );
      const buffer = await this.render.renderStoredPdf(template.programTitle, inner);
      const up = await this.storage.upload(
        buffer,
        'application/pdf',
        'agreements',
        `${a.agreementNumber}.pdf`,
      );
      pdfKey = up.key;
    }

    const now = new Date();
    const updated = await this.prisma.agreement.update({
      where: { id },
      data: {
        status: AgreementStatus.APPROVED,
        financeReviewedByUserId: userId,
        reviewedAt: now,
        paymentPlanLockedAt: now,
        paymentPlanLockedByUserId: userId,
        serviceContractId,
        generatedPdfKey: pdfKey ?? undefined,
        generatedPdfAt: pdfKey ? now : undefined,
      },
    });

    await this.recordEvent(
      id,
      userId,
      'APPROVED',
      'Approved by Finance; payment plan locked and ledger contract created',
      null,
      { serviceContractId } as unknown as Prisma.InputJsonValue,
    );
    await this.notifyAuthor(a.createdByUserId, 'approved', {
      agreementNumber: a.agreementNumber,
      leadId: a.leadId,
    });
    return updated;
  }

  /** Finance bounces it back to Sales with a note (unlocks for editing). */
  async requestChanges(id: string, userId: string, note: string) {
    const a = await this.prisma.agreement.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw new NotFoundException('Agreement not found');
    if (!FINANCE_ACTIONABLE.includes(a.status)) {
      throw new ConflictException(`Cannot request changes from status ${a.status}.`);
    }
    const updated = await this.prisma.agreement.update({
      where: { id },
      data: {
        status: AgreementStatus.CHANGES_REQUESTED,
        financeNotes: note,
        financeReviewedByUserId: userId,
        reviewedAt: new Date(),
      },
    });
    await this.recordEvent(
      id,
      userId,
      'CHANGES_REQUESTED',
      `Finance requested changes: ${note}`,
      null,
      null,
    );
    await this.notifyAuthor(a.createdByUserId, 'changes', {
      agreementNumber: a.agreementNumber,
      leadId: a.leadId,
      note,
    });
    return updated;
  }

  /** Signed URL for the generated final PDF (Finance / Sales download). */
  async getPdfUrl(id: string): Promise<{ url: string }> {
    const a = await this.prisma.agreement.findFirst({
      where: { id, deletedAt: null },
      select: { generatedPdfKey: true },
    });
    if (!a) throw new NotFoundException('Agreement not found');
    if (!a.generatedPdfKey) {
      throw new BadRequestException('No generated PDF yet — approve the agreement first.');
    }
    return { url: await this.storage.getSignedUrl(a.generatedPdfKey) };
  }

  private async materializeServiceContract(
    a: {
      leadId: string;
      clientId: string | null;
      agreementNumber: string;
      currency: string;
      totalAmount: Prisma.Decimal;
    },
    plan: AgreementPlanData,
    userId: string,
  ): Promise<string> {
    const net = Number(a.totalAmount.toString());
    const approvalDate = new Date();
    let rows = plan.installments ?? [];
    if (rows.length === 0) {
      rows = [{ sequence: 1, stage: 'Full payment', amount: net, trigger: null, dueDate: null }];
    }
    const contractNumber = await this.generateContractNumber();
    const contract = await this.prisma.serviceContract.create({
      data: {
        contractNumber,
        leadId: a.leadId,
        clientId: a.clientId ?? undefined,
        totalAmount: a.totalAmount,
        currency: a.currency,
        signedDate: approvalDate,
        status: ServiceContractStatus.ACTIVE,
        notes: `Auto-created from agreement ${a.agreementNumber}`,
        createdByUserId: userId,
        installments: {
          create: rows.map((i, idx) => ({
            sequence: i.sequence ?? idx + 1,
            dueDate: i.dueDate ? new Date(i.dueDate) : approvalDate,
            amount: i.amount ?? 0,
            description:
              (i.stage ?? `Stage ${idx + 1}`) + (i.trigger ? ` — ${i.trigger}` : ''),
          })),
        },
      },
      select: { id: true },
    });
    return contract.id;
  }

  private async generateContractNumber(): Promise<string> {
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

  // ─── Reads ───────────────────────────────────────────────────────────────

  async get(id: string) {
    const agreement = await this.prisma.agreement.findFirst({
      where: { id, deletedAt: null },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');

    const [template, lead, events] = await Promise.all([
      this.prisma.agreementTemplate.findUnique({
        where: { id: agreement.templateId },
        select: { id: true, name: true, categoryKey: true, programTitle: true, bodyHtml: true },
      }),
      this.prisma.lead.findUnique({
        where: { id: agreement.leadId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          referenceCode: true,
        },
      }),
      this.prisma.agreementEvent.findMany({
        where: { agreementId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    return { ...agreement, template, lead, events };
  }

  list(query: ListAgreementsQueryDto, userId: string, canViewAll: boolean) {
    const where: Prisma.AgreementWhereInput = { deletedAt: null };
    if (!canViewAll || query.mine) where.createdByUserId = userId;
    if (query.status && this.isStatus(query.status)) where.status = query.status;
    if (query.leadId) where.leadId = query.leadId;
    if (query.clientId) where.clientId = query.clientId;
    if (query.search) {
      where.agreementNumber = { contains: query.search.trim(), mode: 'insensitive' };
    }

    return this.prisma.agreement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        agreementNumber: true,
        categoryKey: true,
        status: true,
        currency: true,
        totalAmount: true,
        grossAmount: true,
        discountAmount: true,
        paymentPlanType: true,
        leadId: true,
        clientId: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
        submittedAt: true,
      },
    });
  }

  async previewPdf(id: string): Promise<Buffer> {
    const agreement = await this.prisma.agreement.findFirst({
      where: { id, deletedAt: null },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    const template = await this.prisma.agreementTemplate.findUnique({
      where: { id: agreement.templateId },
    });
    if (!template) throw new NotFoundException('Agreement template missing');

    const inner =
      agreement.contentHtml && agreement.contentHtml.trim()
        ? agreement.contentHtml
        : this.render.composeAgreementInner(
            template.bodyHtml,
            template.programTitle,
            (agreement.bioData as AgreementBioData) ?? {},
            (agreement.paymentPlan as AgreementPlanData) ?? {},
            agreement.agreementNumber,
          );
    return this.render.renderStoredPdf(template.programTitle, inner);
  }

  /** Re-derive the document from template + current bio + plan (discards
   *  manual edits). Backs the "Regenerate from template + data" action. */
  async regenerate(id: string, userId: string) {
    const a = await this.prisma.agreement.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw new NotFoundException('Agreement not found');
    if (!SALES_EDITABLE.includes(a.status)) {
      throw new ConflictException(`Agreement is locked (status ${a.status}).`);
    }
    const template = await this.prisma.agreementTemplate.findUnique({
      where: { id: a.templateId },
    });
    if (!template) throw new NotFoundException('Agreement template missing');
    const contentHtml = this.render.composeAgreementInner(
      template.bodyHtml,
      template.programTitle,
      (a.bioData as AgreementBioData) ?? {},
      (a.paymentPlan as AgreementPlanData) ?? {},
      a.agreementNumber,
    );
    const updated = await this.prisma.agreement.update({
      where: { id },
      data: { contentHtml },
    });
    await this.recordEvent(
      id,
      userId,
      'DOCUMENT_REGENERATED',
      'Document regenerated from template + data',
      null,
      null,
    );
    return updated;
  }

  /** Active templates for the Sales picker (minimal fields). */
  templateOptions() {
    return this.prisma.agreementTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, categoryKey: true, name: true, programTitle: true },
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /** Throws BadRequestException if the plan's totals don't balance. */
  private assertPlanBalances(plan: BalanceCheckPlan): void {
    const cents = (n: number) => Math.round((Number(n) || 0) * 100);
    if (cents(plan.discountAmount) > cents(plan.grossAmount)) {
      throw new BadRequestException('Discount cannot exceed the gross amount.');
    }
    if (cents(plan.netPayable) !== cents(plan.grossAmount) - cents(plan.discountAmount)) {
      throw new BadRequestException(
        'Net payable must equal gross amount minus discount.',
      );
    }
    const installments = plan.installments ?? [];
    if (installments.length === 0) {
      // No schedule rows: only valid as a single full payment of the net.
      // Plan type is otherwise just a label — any rows that sum to the net
      // are accepted regardless of type.
      if (plan.planType !== 'FULL') {
        throw new BadRequestException('Add at least one installment / milestone.');
      }
      return;
    }
    const sum = installments.reduce((acc, i) => acc + cents(Number(i.amount) || 0), 0);
    if (sum !== cents(plan.netPayable)) {
      throw new BadRequestException(
        'The payment amounts must add up to the net payable.',
      );
    }
  }

  private normalizePlan(dto: PaymentPlanDto): AgreementPlanData {
    return {
      planType: dto.planType,
      currency: dto.currency,
      grossAmount: dto.grossAmount,
      discountAmount: dto.discountAmount,
      netPayable: dto.netPayable,
      taxAmount: dto.taxAmount ?? undefined,
      installments: dto.installments.map((i) => ({
        sequence: i.sequence,
        stage: i.stage,
        amount: i.amount,
        trigger: i.trigger ?? null,
        dueDate: i.dueDate ?? null,
        notes: i.notes ?? null,
      })),
      governmentFees: (dto.governmentFees ?? []).map((g) => ({
        label: g.label,
        amount: g.amount,
        currency: g.currency ?? dto.currency,
        payableBy: g.payableBy ?? undefined,
      })),
      refundable: dto.refundable ?? undefined,
      refundPolicyText: dto.refundPolicyText ?? undefined,
      notes: dto.notes ?? undefined,
    };
  }

  private summariseUpdate(dto: UpdateAgreementDto): string {
    const parts: string[] = [];
    if (dto.paymentPlan) parts.push('payment plan');
    if (dto.bioData) parts.push('applicant bio');
    if (dto.salesNotes !== undefined) parts.push('sales notes');
    return parts.length ? `Updated ${parts.join(', ')}` : 'Updated agreement';
  }

  private recordEvent(
    agreementId: string,
    actorUserId: string | null,
    type: string,
    summary: string,
    dataBefore: Prisma.InputJsonValue | null,
    dataAfter: Prisma.InputJsonValue | null,
  ) {
    return this.prisma.agreementEvent.create({
      data: {
        agreementId,
        actorUserId: actorUserId ?? undefined,
        type,
        summary,
        ...(dataBefore !== null ? { dataBefore } : {}),
        ...(dataAfter !== null ? { dataAfter } : {}),
      },
    });
  }

  private async generateAgreementNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const count = await this.prisma.agreement.count({
        where: { createdAt: { gte: yearStart, lt: yearEnd } },
      });
      const candidate = `AGR-${year}-${String(count + 1 + attempt).padStart(5, '0')}`;
      const existing = await this.prisma.agreement.findUnique({
        where: { agreementNumber: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    throw new Error('Unable to generate a unique agreement number');
  }

  private normalizeCurrency(raw: string | null): string {
    const allowed = ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'PKR'];
    const up = (raw ?? '').toUpperCase();
    return allowed.includes(up) ? up : 'CAD';
  }

  private toPlanTypeEnum(value: string | undefined): PaymentPlanType | undefined {
    if (value === 'FULL') return PaymentPlanType.FULL;
    if (value === 'INSTALLMENT') return PaymentPlanType.INSTALLMENT;
    if (value === 'MILESTONE') return PaymentPlanType.MILESTONE;
    return undefined;
  }

  private isStatus(value: string): value is AgreementStatus {
    return (Object.values(AgreementStatus) as string[]).includes(value);
  }
}
