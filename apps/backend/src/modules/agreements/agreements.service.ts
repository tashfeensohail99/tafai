import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgreementStatus, PaymentPlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly render: AgreementRenderService,
  ) {}

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

    // Regenerate the stored body so it always matches the records.
    if (dto.paymentPlan || dto.bioData) {
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

  // ─── Reads ───────────────────────────────────────────────────────────────

  async get(id: string) {
    const agreement = await this.prisma.agreement.findFirst({
      where: { id, deletedAt: null },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');

    const [template, lead, events] = await Promise.all([
      this.prisma.agreementTemplate.findUnique({
        where: { id: agreement.templateId },
        select: { id: true, name: true, categoryKey: true, programTitle: true },
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

    return this.render.renderAgreementPdf(
      template.programTitle,
      template.bodyHtml,
      (agreement.bioData as AgreementBioData) ?? {},
      (agreement.paymentPlan as AgreementPlanData) ?? {},
      agreement.agreementNumber,
    );
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
    const sum = installments.reduce((acc, i) => acc + cents(Number(i.amount) || 0), 0);

    if (plan.planType === 'FULL') {
      if (installments.length > 1) {
        throw new BadRequestException('A full-payment plan can have at most one installment.');
      }
      if (installments.length === 1 && sum !== cents(plan.netPayable)) {
        throw new BadRequestException('The single payment must equal the net payable.');
      }
      return;
    }
    // INSTALLMENT / MILESTONE
    if (installments.length < 1) {
      throw new BadRequestException('Add at least one installment / milestone.');
    }
    if (sum !== cents(plan.netPayable)) {
      throw new BadRequestException(
        'The installment amounts must add up to the net payable.',
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
