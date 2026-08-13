import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AgreementChangeStatus,
  AgreementChangeType,
  AgreementStatus,
  type AgreementChangeRequest,
  AuditAction,
  InstallmentStatus,
  InvoiceStatus,
  PaymentPlanType,
  Prisma,
  ServiceContractStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { StorageService } from '../storage/storage.service';
import { isCanonicalServiceCode } from '../../common/service-types';
import {
  looksLikePhoneSearch,
  phoneSearchCandidates,
} from '../../common/phone/phone-search.util';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  AgreementRenderService,
  type AgreementBioData,
  type AgreementPlanData,
} from './agreement-render.service';
import {
  AdminSignedListQueryDto,
  CreateAgreementDto,
  CreateChangeRequestDto,
  ListAgreementsQueryDto,
  ListChangeRequestsQueryDto,
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

/** "Passed to Finance" — every status except an in-progress DRAFT or a
 *  CANCELLED agreement. Drives the admin Signed-Agreements correction console. */
const PASSED_TO_FINANCE: AgreementStatus[] = [
  AgreementStatus.SUBMITTED,
  AgreementStatus.FINANCE_REVIEW,
  AgreementStatus.CHANGES_REQUESTED,
  AgreementStatus.APPROVED,
  AgreementStatus.EDITED_PENDING_SALES,
  AgreementStatus.SENT,
  AgreementStatus.SIGNED,
];

/** UTC instant of the most recent midnight in Pakistan (UTC+5), so "today" /
 *  "this week" counters line up with the team's working day, not UTC. */
function startOfPktDay(d: Date): Date {
  const shifted = new Date(d.getTime() + 5 * 3600 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 5 * 3600 * 1000);
}

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
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
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

      // In-app notification (also fans out to push) — independent of email, so
      // the Sales author is alerted in the bell + on mobile even with no email
      // on file. Mirrors the email decision below.
      await this.notifications.create({
        userId: createdByUserId,
        type: kind === 'approved' ? 'AGREEMENT_APPROVED' : 'AGREEMENT_CHANGES_REQUESTED',
        title:
          kind === 'approved'
            ? `Agreement ${ctx.agreementNumber} approved`
            : `Changes requested: ${ctx.agreementNumber}`,
        body:
          kind === 'changes'
            ? ctx.note || 'Finance requested changes to your agreement.'
            : 'Finance approved your agreement.',
        link: ctx.leadId ? `/sales/leads/${ctx.leadId}` : '/sales/agreements',
      });

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

  /** Active finance users to alert on submission (fallback: super_admin). */
  private async financeRecipientEmails(): Promise<string[]> {
    const users = await this.prisma.userAccount.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        userRoles: { some: { role: { name: { in: ['finance', 'finance_manager'] } } } },
      },
      select: { email: true },
    });
    let emails = users.map((u) => u.email).filter(Boolean);
    if (emails.length === 0) {
      // No finance users yet — fall back to super_admin so the alert isn't lost.
      const admins = await this.prisma.userAccount.findMany({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          userRoles: { some: { role: { name: 'super_admin' } } },
        },
        select: { email: true },
      });
      emails = admins.map((u) => u.email).filter(Boolean);
    }
    return [...new Set(emails)];
  }

  /**
   * Email the finance team when Sales submits / re-submits for review — so a
   * fixed agreement arriving back isn't just a silent badge bump. Non-fatal.
   */
  private async notifyFinanceOfSubmission(
    agreement: { agreementNumber: string; leadId: string | null; financeNotes: string | null },
    submitterUserId: string,
    resubmitted: boolean,
  ): Promise<void> {
    try {
      const to = await this.financeRecipientEmails();
      if (to.length === 0) return;
      const emp = await this.prisma.employee.findFirst({
        where: { userId: submitterUserId },
        select: { firstName: true, lastName: true },
      });
      const salesName = emp ? `${emp.firstName} ${emp.lastName}`.trim() : 'Sales';
      let leadName: string | null = null;
      if (agreement.leadId) {
        const lead = await this.prisma.lead.findUnique({
          where: { id: agreement.leadId },
          select: { firstName: true, lastName: true },
        });
        if (lead) leadName = `${lead.firstName} ${lead.lastName}`.trim();
      }
      await this.email.sendAgreementSubmittedToFinance({
        to,
        agreementNumber: agreement.agreementNumber,
        leadName,
        salesName,
        resubmitted,
        note: resubmitted ? agreement.financeNotes : null,
      });
    } catch (err) {
      this.log.warn(`finance submission notification failed: ${(err as Error).message}`);
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
        targetCountry: true,
        serviceFeeAmount: true,
        serviceFeeCurrency: true,
        convertedClientId: true,
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // A lead/client can hold multiple agreements ACROSS DIFFERENT services (one
    // per program they apply for) — the finance ledger attributes each
    // invoice/payment to its agreement (Invoice.agreementId). But a SECOND
    // agreement for the SAME service on the same lead is almost always an
    // accidental duplicate — a rep re-creating instead of editing the existing
    // one, or a double-click. Block it (force "edit the existing") unless the
    // rep explicitly confirms (allowDuplicate) — e.g. a genuinely different
    // applicant under one lead. A CANCELLED prior agreement doesn't block a redo.
    if (!dto.allowDuplicate) {
      const dup = await this.prisma.agreement.findFirst({
        where: {
          leadId: lead.id,
          categoryKey: template.categoryKey,
          deletedAt: null,
          status: { not: AgreementStatus.CANCELLED },
        },
        select: { id: true, agreementNumber: true, status: true },
        orderBy: { createdAt: 'desc' },
      });
      if (dup) {
        // Structured 409 so the frontend can render a "Open existing agreement"
        // action instead of a dead-end text banner. `message` stays the human
        // sentence apiFetch surfaces by default.
        throw new ConflictException({
          error: 'Conflict',
          reason: 'duplicate-category-agreement',
          message:
            `This lead already has a ${template.categoryKey} agreement ` +
            `(${dup.agreementNumber}, ${dup.status}). Open and edit that agreement ` +
            `instead of creating a new one. Create a separate agreement only if it is ` +
            `for a different service or a genuinely different applicant.`,
          match: {
            agreementId: dup.id,
            agreementNumber: dup.agreementNumber,
            status: dup.status,
            categoryKey: template.categoryKey,
          },
        });
      }
    }

    const bioData: AgreementBioData = {
      applicantName: `${lead.firstName} ${lead.lastName}`.trim(),
      nationality: lead.nationality ?? undefined,
      phone: lead.phone ?? undefined,
      email: lead.email ?? undefined,
      fileNumber: lead.referenceCode ?? undefined,
      agreementDate: '',
      // Destination defaults from the lead's country of interest; Sales can
      // change it in the editor. Drives the Canada→country rewrite.
      country: lead.targetCountry ?? undefined,
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
        // Stamp the converted client (if the lead has become one) so the
        // finance ledger can attribute this agreement's invoices by clientId
        // too — multi-agreement people are often already clients.
        clientId: lead.convertedClientId ?? null,
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

    // Sales → Finance data-quality gate. Block submission only on the fields
    // downstream steps genuinely can't run without: first + last name (so
    // Finance + the generated PDFs render properly) and a coded service type
    // (for processing-checklist routing).
    //
    // Email is intentionally NOT a hard blocker here. Requiring a *verified*
    // email up front stalled deals whenever the client hadn't yet clicked the
    // verification link (it expires after 48h, and not every client checks
    // email promptly). Instead the email's status — missing, or present but
    // unverified — is surfaced as a flag on the Finance review screen (see
    // get()), so Finance can chase it before issuing receipts / emailing the
    // signed agreement, without holding up the handover.
    const lead = await this.prisma.lead.findUnique({
      where: { id: existing.leadId },
      select: { firstName: true, lastName: true, serviceInterest: true },
    });
    if (!lead) throw new BadRequestException('Lead not found for this agreement');
    const missing: string[] = [];
    if (!lead.firstName?.trim()) missing.push('first name');
    if (!lead.lastName?.trim()) missing.push('last name');
    // Coded service type — required for downstream processing-checklist
    // routing. Legacy free-text values don't count: sales must reclassify
    // to one of the canonical codes before this case can move to Finance.
    if (!lead.serviceInterest?.trim() || !isCanonicalServiceCode(lead.serviceInterest)) {
      missing.push('service type (pick one of the coded options)');
    }
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot submit to Finance — the lead profile is incomplete (${missing.join(', ')}). ` +
        `Open the lead profile, fill in any missing fields, and re-submit.`,
      );
    }

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

    // Alert the finance team. `existing` still holds the pre-update status, so
    // CHANGES_REQUESTED means this is a re-submission after a bounce.
    await this.notifyFinanceOfSubmission(
      existing,
      userId,
      existing.status === AgreementStatus.CHANGES_REQUESTED,
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
   * Finance approves: re-validate, lock the plan, generate + store the final
   * PDF, and materialise the **ledger** (ServiceContract + Installments) as a
   * DRAFT (unsigned) contract. Approval is the gate that unlocks Finance's
   * money actions — no invoice / payment / receipt can be recorded for the
   * client until an approved agreement (hence a real ledger) exists. The
   * signed-copy upload (see `uploadSignedAgreement`) later flips the contract
   * ACTIVE with the real signed date; until then it's an approved proposal
   * with a provisional ledger.
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
      const buffer = await this.render.renderStoredPdf(
        template.programTitle,
        inner,
        ((a.bioData as AgreementBioData) ?? {}).country,
      );
      const up = await this.storage.upload(
        buffer,
        'application/pdf',
        'agreements',
        `${a.agreementNumber}.pdf`,
      );
      pdfKey = up.key;
    }

    const now = new Date();
    // Materialise the ledger NOW: approving locks the plan AND creates the
    // service contract + installment schedule (as a DRAFT contract, since the
    // client hasn't signed yet — the signed-copy upload flips it to ACTIVE).
    // This is the point that unlocks Finance's money actions: no invoice /
    // payment / receipt can be recorded for the client until an approved
    // agreement (hence a real ledger) exists. Idempotent: reuse the contract
    // if one already exists (e.g. re-approval after CHANGES_REQUESTED).
    const serviceContractId =
      a.serviceContractId ?? (await this.materializeServiceContract(a, plan, userId, { signed: false }));

    const updated = await this.prisma.agreement.update({
      where: { id },
      data: {
        status: AgreementStatus.APPROVED,
        financeReviewedByUserId: userId,
        reviewedAt: now,
        paymentPlanLockedAt: now,
        paymentPlanLockedByUserId: userId,
        generatedPdfKey: pdfKey ?? undefined,
        generatedPdfAt: pdfKey ? now : undefined,
        serviceContractId,
      },
    });

    await this.recordEvent(
      id,
      userId,
      'APPROVED',
      'Approved by Finance; payment plan locked and service contract + installment ledger created.',
      null,
      { serviceContractId } as unknown as Prisma.InputJsonValue,
    );
    await this.notifyAuthor(a.createdByUserId, 'approved', {
      agreementNumber: a.agreementNumber,
      leadId: a.leadId,
    });
    return updated;
  }

  /**
   * Finance uploads the client's signed agreement → materialises the
   * ServiceContract + Installments NOW (signedDate = today), stores the
   * signed PDF on the contract, and marks the agreement SIGNED. This is the
   * moment the **ledger** starts existing — before this, the agreement is
   * just a finance-approved proposal awaiting the client's signature.
   *
   * Backward-compat: agreements approved before this fix already have a
   * ServiceContract row; in that case we attach the signed PDF onto the
   * existing contract instead of creating a duplicate.
   */
  async uploadSignedAgreement(
    agreementId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    userId: string,
  ) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Signed agreement file is required');
    }
    const allowedMime = new Set([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
    ]);
    if (!allowedMime.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${file.mimetype}. Use PDF or image (PNG/JPEG/WebP).`,
      );
    }

    const a = await this.prisma.agreement.findFirst({ where: { id: agreementId, deletedAt: null } });
    if (!a) throw new NotFoundException('Agreement not found');
    const uploadable: AgreementStatus[] = [
      AgreementStatus.APPROVED,
      AgreementStatus.SENT,
      AgreementStatus.SIGNED,
    ];
    if (!uploadable.includes(a.status)) {
      throw new ConflictException(
        `Cannot upload a signed copy from status ${a.status} — approve the agreement first.`,
      );
    }

    // Materialise the ledger NOW (or reuse the legacy one if it already
    // exists from the old approve-time flow).
    const plan = (a.paymentPlan as AgreementPlanData) ?? {};
    const serviceContractId =
      a.serviceContractId ?? (await this.materializeServiceContract(a, plan, userId));

    const uploaded = await this.storage.upload(
      file.buffer,
      file.mimetype,
      'service-contracts',
      file.originalname,
    );

    const now = new Date();
    await this.prisma.serviceContract.update({
      where: { id: serviceContractId },
      data: {
        agreementKey: uploaded.key,
        agreementFileName: file.originalname,
        agreementMimeType: file.mimetype,
        agreementSizeBytes: file.size,
        signedDate: now,
        status: ServiceContractStatus.ACTIVE,
      },
    });

    const updated = await this.prisma.agreement.update({
      where: { id: agreementId },
      data: {
        status: AgreementStatus.SIGNED,
        signedAt: now,
        serviceContractId,
      },
    });

    await this.recordEvent(
      agreementId,
      userId,
      'SIGNED',
      'Signed agreement uploaded by Finance; ledger materialised.',
      null,
      { serviceContractId } as unknown as Prisma.InputJsonValue,
    );

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

  /**
   * Finance sends the approved agreement PDF to the client (attached by email)
   * → status SENT. Re-sendable while SENT. The signed copy comes back via the
   * customer profile's signed-agreement upload.
   */
  async sendToClient(id: string, userId: string) {
    const a = await this.prisma.agreement.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw new NotFoundException('Agreement not found');
    const sendable: AgreementStatus[] = [AgreementStatus.APPROVED, AgreementStatus.SENT];
    if (!sendable.includes(a.status)) {
      throw new ConflictException(`Cannot send from status ${a.status}. Approve the agreement first.`);
    }
    const bio = (a.bioData as { email?: string; applicantName?: string }) ?? {};
    const lead = a.leadId
      ? await this.prisma.lead.findUnique({
          where: { id: a.leadId },
          select: { firstName: true, lastName: true, email: true },
        })
      : null;
    const to = lead?.email || bio.email || null;
    if (!to) {
      throw new BadRequestException('No client email on file — add an email to the lead first.');
    }
    const clientName = lead ? `${lead.firstName} ${lead.lastName}`.trim() : bio.applicantName ?? 'Client';

    // Use the cached PDF when present; otherwise regenerate fresh — the cache
    // may have been cleared (e.g. by the layout-fix backfill), and a send must
    // never hard-fail. Regenerating also means the client always receives the
    // current, correctly-paginated document.
    let pdfBytes: Buffer;
    if (a.generatedPdfKey) {
      pdfBytes = (await this.storage.download(a.generatedPdfKey)).bytes;
    } else {
      pdfBytes = await this.previewPdf(id);
      const key = `agreements/preview/${id}.pdf`;
      await this.storage.uploadAt(key, pdfBytes, 'application/pdf');
      await this.prisma.agreement.update({
        where: { id },
        data: { generatedPdfKey: key, generatedPdfAt: new Date() },
      });
    }
    const ok = await this.email.sendAgreementToClient({
      to,
      clientName,
      agreementNumber: a.agreementNumber,
      pdf: pdfBytes,
      fileName: `${a.agreementNumber}.pdf`,
    });
    if (!ok) {
      throw new ConflictException('Could not send the email (SMTP not configured or the send failed).');
    }

    const updated = await this.prisma.agreement.update({
      where: { id },
      data: { status: AgreementStatus.SENT, sentAt: new Date() },
    });
    await this.recordEvent(id, userId, 'SENT', `Agreement sent to client (${to})`, null, null);
    return updated;
  }

  /**
   * Signed URL for an agreement PDF.
   *
   * Approved agreements serve their official, locked PDF (generated at approve
   * time). Not-yet-approved ones (DRAFT / SUBMITTED / REJECTED) have no stored
   * PDF, so we render the current document on the fly — this mirrors the web's
   * preview endpoint and lets Sales view a draft in the app. The preview is
   * written to a stable per-agreement key (overwritten each view, so orphan
   * files never pile up) and is deliberately NOT recorded as generatedPdfKey —
   * it must never be mistaken for the locked, approved document.
   */
  async getPdfUrl(id: string): Promise<{ url: string }> {
    const a = await this.prisma.agreement.findFirst({
      where: { id, deletedAt: null },
      select: { generatedPdfKey: true, status: true, agreementNumber: true },
    });
    if (!a) throw new NotFoundException('Agreement not found');
    if (a.generatedPdfKey) {
      return { url: await this.storage.getSignedUrl(a.generatedPdfKey) };
    }
    const buffer = await this.previewPdf(id);
    // A finalised agreement with no stored key must RE-ACQUIRE a locked official
    // PDF — e.g. after a bio correction whose eager render failed, or a legacy
    // approved agreement. Render to the official key and persist it, so we don't
    // re-render on every future view. Non-finalised (draft) agreements keep the
    // throwaway preview key and are never mistaken for the locked document.
    const FINALISED: AgreementStatus[] = [
      AgreementStatus.APPROVED,
      AgreementStatus.SENT,
      AgreementStatus.SIGNED,
    ];
    if (FINALISED.includes(a.status)) {
      const up = await this.storage.upload(buffer, 'application/pdf', 'agreements', `${a.agreementNumber}.pdf`);
      await this.prisma.agreement.update({
        where: { id },
        data: { generatedPdfKey: up.key, generatedPdfAt: new Date() },
      });
      return { url: await this.storage.getSignedUrl(up.key) };
    }
    const key = `agreements/preview/${id}.pdf`;
    await this.storage.uploadAt(key, buffer, 'application/pdf');
    return { url: await this.storage.getSignedUrl(key) };
  }

  /**
   * Creates the ServiceContract + Installments from the agreement's locked
   * plan. Called the moment the signed agreement lands (from
   * `uploadSignedAgreement`) — never at approval time. Trigger-based
   * milestones without a real due date fall back to `signedDate` as a
   * placeholder; the receipt renderer detects same-day collisions with the
   * contract's signedDate and prints "—" so the client never sees a
   * fabricated date.
   */
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
    opts?: { signed?: boolean },
  ): Promise<string> {
    // `signed` = the client's signed copy is on file (contract is live).
    // Finance approval materialises the ledger EARLY as a DRAFT (unsigned)
    // so payments can be recorded against a real contract; the signed-copy
    // upload later flips it to ACTIVE with the real signed date.
    const signed = opts?.signed ?? true;
    const net = Number(a.totalAmount.toString());
    // signedDate doubles as the anchor/placeholder date for trigger-based
    // installments (the receipt view nulls any installment whose dueDate equals
    // it). Always set it; the `signed` flag drives only the contract STATUS
    // (DRAFT when materialised at approval → ACTIVE once the signed copy lands).
    const signedDate = new Date();
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
        signedDate,
        status: signed ? ServiceContractStatus.ACTIVE : ServiceContractStatus.DRAFT,
        notes: signed
          ? `Materialised on signature from agreement ${a.agreementNumber}`
          : `Materialised on Finance approval of agreement ${a.agreementNumber} (awaiting client signature)`,
        createdByUserId: userId,
        installments: {
          create: rows.map((i, idx) => ({
            sequence: i.sequence ?? idx + 1,
            dueDate: i.dueDate ? new Date(i.dueDate) : signedDate,
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

  private generateContractNumber(): Promise<string> {
    return this.numbering.next('SC');
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /** True when the user created the agreement or owns its lead (creator or
   *  assignee). Used to scope reads + correction requests for non-view-all
   *  users so one rep can't reach another rep's agreement (and its bio/plan
   *  PII + correction history) by id. */
  private async userOwnsAgreement(
    a: { createdByUserId: string | null; leadId: string | null },
    userId: string,
  ): Promise<boolean> {
    if (a.createdByUserId === userId) return true;
    if (!a.leadId) return false;
    const lead = await this.prisma.lead.findFirst({
      where: { id: a.leadId, deletedAt: null },
      select: { createdByUserId: true, assignedEmployee: { select: { userId: true } } },
    });
    return !!lead && (lead.createdByUserId === userId || lead.assignedEmployee?.userId === userId);
  }

  async get(id: string, userId?: string, canViewAll = true) {
    const agreement = await this.prisma.agreement.findFirst({
      where: { id, deletedAt: null },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    // Object-level authorization: a non-view-all user may only read their own
    // agreements. 404 (not 403) so a stranger can't probe which ids exist.
    if (userId && !canViewAll && !(await this.userOwnsAgreement(agreement, userId))) {
      throw new NotFoundException('Agreement not found');
    }

    const [template, lead, events, changeRequests] = await Promise.all([
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
          // Surfaced so the Finance review screen can flag a missing /
          // unverified email — it's no longer a submit blocker (see
          // submitToFinance), but Finance still needs to chase it before
          // emailing receipts / the signed agreement.
          emailVerified: true,
          referenceCode: true,
        },
      }),
      this.prisma.agreementEvent.findMany({
        where: { agreementId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.agreementChangeRequest.findMany({
        where: { agreementId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return { ...agreement, template, lead, events, changeRequests };
  }

  async list(query: ListAgreementsQueryDto, userId: string, canViewAll: boolean) {
    const where: Prisma.AgreementWhereInput = { deletedAt: null };

    // Visibility: by default a non-view-all user only sees agreements they
    // created. BUT when the query is scoped to a single lead and the user can
    // access that lead (its creator/assignee, or has view-all), show ALL of
    // that lead's agreements — a sales rep was otherwise missing agreements
    // that Finance (or another rep) drafted for their own lead.
    let leadScopedAccess = false;
    if (query.leadId) {
      where.leadId = query.leadId;
      if (canViewAll) {
        leadScopedAccess = true;
      } else {
        const lead = await this.prisma.lead.findFirst({
          where: { id: query.leadId, deletedAt: null },
          select: {
            createdByUserId: true,
            assignedEmployee: { select: { userId: true } },
          },
        });
        leadScopedAccess =
          !!lead &&
          (lead.createdByUserId === userId ||
            lead.assignedEmployee?.userId === userId);
      }
    }

    if ((!canViewAll && !leadScopedAccess) || query.mine) {
      where.createdByUserId = userId;
    }
    if (query.status && this.isStatus(query.status)) where.status = query.status;
    if (query.clientId) where.clientId = query.clientId;
    if (query.search) {
      where.agreementNumber = { contains: query.search.trim(), mode: 'insensitive' };
    }

    const rows = await this.prisma.agreement.findMany({
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
        financeNotes: true,
      },
    });

    // Attach the lead's name + reference code for the Applicant/Ref columns.
    // Agreement has no Prisma `lead` relation (just a leadId column), so we
    // resolve them in a second query and merge — a relation select would throw.
    const leadIds = [...new Set(rows.map((r) => r.leadId).filter(Boolean))];
    const leads = leadIds.length
      ? await this.prisma.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, firstName: true, lastName: true, referenceCode: true },
        })
      : [];
    const leadMap = new Map(leads.map((l) => [l.id, l]));
    return rows.map((r) => ({
      ...r,
      lead: r.leadId ? leadMap.get(r.leadId) ?? null : null,
    }));
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
    return this.render.renderStoredPdf(
      template.programTitle,
      inner,
      ((agreement.bioData as AgreementBioData) ?? {}).country,
    );
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

  /**
   * Counts for the sidebar badges + dashboard widget:
   *   financeToReview      — agreements submitted/under review (Finance queue)
   *   salesChangesRequested — this user's agreements bounced back for changes
   */
  async reviewCounts(
    userId: string,
  ): Promise<{ financeToReview: number; salesChangesRequested: number }> {
    const [financeToReview, salesChangesRequested] = await Promise.all([
      this.prisma.agreement.count({
        where: {
          deletedAt: null,
          status: { in: [AgreementStatus.SUBMITTED, AgreementStatus.FINANCE_REVIEW] },
        },
      }),
      this.prisma.agreement.count({
        where: {
          deletedAt: null,
          status: AgreementStatus.CHANGES_REQUESTED,
          createdByUserId: userId,
        },
      }),
    ]);
    return { financeToReview, salesChangesRequested };
  }

  // ─── Admin: Signed Agreements correction console ──────────────────────────

  /**
   * Resolve a free-text search term to matching lead + client ids, so the admin
   * can search signed agreements by applicant name / phone (+92·0313·92) /
   * email as well as by agreement number. Phone terms use the equality-on-index
   * path (`phoneSearchCandidates`); text terms match name/email/reference.
   */
  private async resolveSearchTargets(
    term: string,
  ): Promise<{ leadIds: string[]; clientIds: string[] }> {
    const t = term.trim();
    if (!t) return { leadIds: [], clientIds: [] };

    if (looksLikePhoneSearch(t)) {
      const candidates = phoneSearchCandidates(t);
      if (candidates.length === 0) return { leadIds: [], clientIds: [] };
      const [leads, clients] = await Promise.all([
        this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM crm.leads WHERE "deletedAt" IS NULL
             AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1::text[]) LIMIT 500`,
          candidates,
        ),
        this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM crm.clients WHERE "deletedAt" IS NULL
             AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1::text[]) LIMIT 500`,
          candidates,
        ),
      ]);
      return { leadIds: leads.map((r) => r.id), clientIds: clients.map((r) => r.id) };
    }

    const contains = { contains: t, mode: 'insensitive' as const };
    const [leads, clients] = await Promise.all([
      this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          OR: [
            { firstName: contains },
            { lastName: contains },
            { email: contains },
            { referenceCode: contains },
          ],
        },
        select: { id: true },
        take: 500,
      }),
      this.prisma.client.findMany({
        where: {
          deletedAt: null,
          OR: [
            { firstName: contains },
            { lastName: contains },
            { email: contains },
            { referenceCode: contains },
          ],
        },
        select: { id: true },
        take: 500,
      }),
    ]);
    return { leadIds: leads.map((l) => l.id), clientIds: clients.map((c) => c.id) };
  }

  /** Admin list of every agreement passed to Finance, with applicant-aware
   *  search, status + date filters, and a per-row pending-change-request count. */
  async adminListSigned(query: AdminSignedListQueryDto) {
    const where: Prisma.AgreementWhereInput = {
      deletedAt: null,
      status:
        query.status && this.isStatus(query.status)
          ? query.status
          : { in: PASSED_TO_FINANCE },
    };

    if (query.createdFrom || query.createdTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.createdFrom) createdAt.gte = new Date(query.createdFrom);
      if (query.createdTo) {
        const to = new Date(query.createdTo);
        to.setUTCHours(23, 59, 59, 999);
        createdAt.lte = to;
      }
      where.createdAt = createdAt;
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      const { leadIds, clientIds } = await this.resolveSearchTargets(term);
      const or: Prisma.AgreementWhereInput[] = [
        { agreementNumber: { contains: term, mode: 'insensitive' } },
      ];
      if (leadIds.length) or.push({ leadId: { in: leadIds } });
      if (clientIds.length) or.push({ clientId: { in: clientIds } });
      where.AND = [{ OR: or }];
    }

    if (query.changeRequested) {
      const pend = await this.prisma.agreementChangeRequest.findMany({
        where: { status: 'PENDING' },
        select: { agreementId: true },
        distinct: ['agreementId'],
      });
      const ids = pend.map((p) => p.agreementId);
      // No pending requests → force an empty result rather than "all".
      where.id = { in: ids.length ? ids : ['__none__'] };
    }

    const rows = await this.prisma.agreement.findMany({
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
        serviceContractId: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
        submittedAt: true,
      },
    });

    const leadIds = [...new Set(rows.map((r) => r.leadId).filter(Boolean))] as string[];
    const leads = leadIds.length
      ? await this.prisma.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, firstName: true, lastName: true, phone: true, email: true, referenceCode: true },
        })
      : [];
    const leadMap = new Map(leads.map((l) => [l.id, l]));

    const agIds = rows.map((r) => r.id);
    const pendCounts = agIds.length
      ? await this.prisma.agreementChangeRequest.groupBy({
          by: ['agreementId'],
          where: { agreementId: { in: agIds }, status: 'PENDING' },
          _count: { _all: true },
        })
      : [];
    const pendMap = new Map(pendCounts.map((p) => [p.agreementId, p._count._all]));

    return rows.map((r) => ({
      ...r,
      lead: r.leadId ? leadMap.get(r.leadId) ?? null : null,
      pendingChangeCount: pendMap.get(r.id) ?? 0,
    }));
  }

  /** Dashboard counters for the Signed-Agreements console. */
  async adminSignedStats() {
    const now = new Date();
    const startToday = startOfPktDay(now);
    const startWeek = new Date(startToday.getTime() - 6 * 86400 * 1000);
    const passed: Prisma.AgreementWhereInput = {
      deletedAt: null,
      status: { in: PASSED_TO_FINANCE },
    };
    const [total, newToday, thisWeek, pendReqs] = await Promise.all([
      this.prisma.agreement.count({ where: passed }),
      this.prisma.agreement.count({ where: { ...passed, createdAt: { gte: startToday } } }),
      this.prisma.agreement.count({ where: { ...passed, createdAt: { gte: startWeek } } }),
      this.prisma.agreementChangeRequest.findMany({
        where: { status: 'PENDING' },
        select: { agreementId: true },
        distinct: ['agreementId'],
      }),
    ]);
    return { total, newToday, thisWeek, changeRequested: pendReqs.length };
  }

  /** Full admin detail for one agreement: bio + plan + template + parties +
   *  the materialised finance ledger (contract, installments, invoices with
   *  their payments/receipts/credit-notes) + its change-request history. */
  async adminSignedDetail(id: string) {
    const agreement = await this.prisma.agreement.findFirst({
      where: { id, deletedAt: null },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');

    const [template, lead, client, events, changeRequests, contract] = await Promise.all([
      this.prisma.agreementTemplate.findUnique({
        where: { id: agreement.templateId },
        select: { id: true, name: true, categoryKey: true, programTitle: true },
      }),
      agreement.leadId
        ? this.prisma.lead.findUnique({
            where: { id: agreement.leadId },
            select: { id: true, firstName: true, lastName: true, phone: true, email: true, emailVerified: true, referenceCode: true },
          })
        : null,
      agreement.clientId
        ? this.prisma.client.findUnique({
            where: { id: agreement.clientId },
            select: { id: true, firstName: true, lastName: true, phone: true, email: true, referenceCode: true },
          })
        : null,
      this.prisma.agreementEvent.findMany({
        where: { agreementId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.agreementChangeRequest.findMany({
        where: { agreementId: id },
        orderBy: { createdAt: 'desc' },
      }),
      agreement.serviceContractId
        ? this.prisma.serviceContract.findUnique({
            where: { id: agreement.serviceContractId },
            include: { installments: { orderBy: { sequence: 'asc' } } },
          })
        : null,
    ]);

    const invoices = await this.prisma.invoice.findMany({
      where: { agreementId: id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        payments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        receipts: { orderBy: { issuedAt: 'asc' } },
        creditNotes: { orderBy: { issuedAt: 'asc' } },
      },
    });

    return { ...agreement, template, lead, client, events, changeRequests, contract, invoices };
  }

  // ─── Correction requests (rep → admin) ────────────────────────────────────

  /** Statuses a rep may raise a post-lock correction request against. The
   *  pre-approval loop (DRAFT/CHANGES_REQUESTED/EDITED_PENDING_SALES) is edited
   *  directly; these are the finalised, locked ones. */
  private static readonly REQUESTABLE: AgreementStatus[] = [
    AgreementStatus.APPROVED,
    AgreementStatus.SENT,
    AgreementStatus.SIGNED,
  ];

  /** Rep raises a correction against a FINALISED agreement. Server snapshots
   *  `before` from the live agreement (never trusts the client for it) and
   *  validates the corrected section. Never touches the template body. */
  async createChangeRequest(
    agreementId: string,
    userId: string,
    dto: CreateChangeRequestDto,
    canManageAll: boolean,
  ) {
    const a = await this.prisma.agreement.findFirst({
      where: { id: agreementId, deletedAt: null },
    });
    if (!a) throw new NotFoundException('Agreement not found');
    if (!AgreementsService.REQUESTABLE.includes(a.status)) {
      throw new ConflictException(
        `Corrections can only be requested on a finalised agreement (this one is ${a.status}). ` +
          `Draft / bounced agreements can be edited directly.`,
      );
    }

    // Ownership: only an admin/finance (canManageAll) may request on any
    // agreement; everyone else is limited to their own (creator or lead owner).
    if (!canManageAll && !(await this.userOwnsAgreement(a, userId))) {
      throw new ForbiddenException('You can only request changes on your own agreements.');
    }

    const type = dto.type as AgreementChangeType;

    // One pending request per type per agreement — keeps the admin queue clean.
    const dup = await this.prisma.agreementChangeRequest.findFirst({
      where: { agreementId, type, status: AgreementChangeStatus.PENDING },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException(
        `There is already a pending ${type === 'BIO' ? 'applicant-bio' : 'payment-plan'} ` +
          `change request for this agreement. Cancel it before raising another.`,
      );
    }

    let before: Prisma.InputJsonValue;
    let after: Prisma.InputJsonValue;
    if (type === AgreementChangeType.BIO) {
      if (!dto.bioData) throw new BadRequestException('bioData is required for a BIO change.');
      if (!dto.bioData.applicantName?.trim()) {
        throw new BadRequestException('Applicant name is required.');
      }
      before = (a.bioData ?? {}) as Prisma.InputJsonValue;
      after = dto.bioData as unknown as Prisma.InputJsonValue;
    } else {
      if (!dto.paymentPlan) {
        throw new BadRequestException('paymentPlan is required for a PAYMENT_PLAN change.');
      }
      this.assertPlanBalances(dto.paymentPlan);
      before = (a.paymentPlan ?? {}) as Prisma.InputJsonValue;
      after = this.normalizePlan(dto.paymentPlan) as unknown as Prisma.InputJsonValue;
    }

    const cr = await this.prisma.agreementChangeRequest.create({
      data: {
        agreementId,
        agreementNumber: a.agreementNumber,
        leadId: a.leadId,
        clientId: a.clientId,
        requestedByUserId: userId,
        type,
        reason: dto.reason ?? null,
        before,
        after,
      },
    });

    await this.recordEvent(
      agreementId,
      userId,
      'CHANGE_REQUESTED',
      `Correction requested (${type === 'BIO' ? 'applicant bio' : 'payment plan'})` +
        (dto.reason ? `: ${dto.reason}` : ''),
      before,
      after,
    );

    return cr;
  }

  /** Admin queue: list correction requests, optionally by status / agreement,
   *  enriched with the requester + applicant name for display. */
  async listChangeRequests(query: ListChangeRequestsQueryDto) {
    const where: Prisma.AgreementChangeRequestWhereInput = {};
    if (
      query.status &&
      (['PENDING', 'APPLIED', 'REJECTED', 'CANCELLED'] as string[]).includes(query.status)
    ) {
      where.status = query.status as AgreementChangeStatus;
    }
    if (query.agreementId) where.agreementId = query.agreementId;

    const rows = await this.prisma.agreementChangeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const userIds = [...new Set(rows.map((r) => r.requestedByUserId))];
    const emps = userIds.length
      ? await this.prisma.employee.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, firstName: true, lastName: true },
        })
      : [];
    const empMap = new Map(emps.map((e) => [e.userId, e]));

    const leadIds = [...new Set(rows.map((r) => r.leadId).filter(Boolean))] as string[];
    const leads = leadIds.length
      ? await this.prisma.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const leadMap = new Map(leads.map((l) => [l.id, l]));

    return rows.map((r) => ({
      ...r,
      requestedBy: empMap.get(r.requestedByUserId) ?? null,
      lead: r.leadId ? leadMap.get(r.leadId) ?? null : null,
    }));
  }

  /** Admin rejects a pending correction request (no ledger change). */
  async rejectChangeRequest(id: string, userId: string, note?: string) {
    const cr = await this.prisma.agreementChangeRequest.findUnique({ where: { id } });
    if (!cr) throw new NotFoundException('Change request not found');
    if (cr.status !== AgreementChangeStatus.PENDING) {
      throw new ConflictException(`This request is already ${cr.status.toLowerCase()}.`);
    }
    const updated = await this.prisma.agreementChangeRequest.update({
      where: { id },
      data: {
        status: AgreementChangeStatus.REJECTED,
        rejectedByUserId: userId,
        rejectedAt: new Date(),
        reviewNote: note ?? null,
      },
    });
    await this.recordEvent(
      cr.agreementId,
      userId,
      'CHANGE_REJECTED',
      `Correction request rejected${note ? `: ${note}` : ''}`,
      null,
      null,
    );
    return updated;
  }

  /** Rep cancels their own pending request (or an admin cancels any). */
  async cancelChangeRequest(id: string, userId: string, canManageAll: boolean) {
    const cr = await this.prisma.agreementChangeRequest.findUnique({ where: { id } });
    if (!cr) throw new NotFoundException('Change request not found');
    if (cr.status !== AgreementChangeStatus.PENDING) {
      throw new ConflictException(`This request is already ${cr.status.toLowerCase()}.`);
    }
    if (!canManageAll && cr.requestedByUserId !== userId) {
      throw new ForbiddenException('You can only cancel your own request.');
    }
    const updated = await this.prisma.agreementChangeRequest.update({
      where: { id },
      data: { status: AgreementChangeStatus.CANCELLED },
    });
    await this.recordEvent(cr.agreementId, userId, 'CHANGE_CANCELLED', 'Correction request cancelled', null, null);
    return updated;
  }

  /**
   * Admin APPLIES a pending BIO correction. Cascade (no money moves):
   *   1. Agreement — bioData := after, recompose contentHtml from the template
   *      + corrected bio (the old name is baked into contentHtml), regenerate
   *      the stored PDF (best-effort; puppeteer is prod-only, so a render
   *      failure nulls the key for lazy regen instead of failing the apply).
   *   2. Client + Lead — update the applicant NAME (split from applicantName)
   *      so downstream renders (receipts render the client name LIVE) pick it
   *      up. Never touches the unique/routing phone or the guarded email.
   *   3. Receipts — null pdfStorageKey on the agreement's (non-voided) receipts
   *      so each re-renders with the corrected name on next download.
   * Payment-plan corrections are routed to {@link applyPlanChangeRequest}
   * (contract + installment + invoice + receipt cascade).
   */
  async applyChangeRequest(id: string, userId: string) {
    const cr = await this.prisma.agreementChangeRequest.findUnique({ where: { id } });
    if (!cr) throw new NotFoundException('Change request not found');
    if (cr.status !== AgreementChangeStatus.PENDING) {
      throw new ConflictException(`This request is already ${cr.status.toLowerCase()}.`);
    }
    if (cr.type === AgreementChangeType.PAYMENT_PLAN) {
      return this.applyPlanChangeRequest(cr, userId);
    }

    const a = await this.prisma.agreement.findFirst({
      where: { id: cr.agreementId, deletedAt: null },
    });
    if (!a) throw new NotFoundException('Agreement not found');
    const template = await this.prisma.agreementTemplate.findUnique({
      where: { id: a.templateId },
    });
    if (!template) throw new NotFoundException('Agreement template missing');

    const newBio = (cr.after ?? {}) as AgreementBioData;
    const beforeBio = (cr.before ?? {}) as AgreementBioData;
    const plan = (a.paymentPlan as AgreementPlanData) ?? {};

    // Correct the document by surgically replacing the CHANGED bio VALUES in the
    // existing contentHtml. This preserves any manual body edits and avoids
    // drifting back to the current template (both of which a full recompose
    // would cause). Fall back to a template recompose only when there is no
    // stored body. (A field that was previously EMPTY has no anchor to replace,
    // so it's carried only on the stored bioData, not re-rendered — acceptable
    // for typo corrections.)
    const baseHtml =
      a.contentHtml && a.contentHtml.trim()
        ? a.contentHtml
        : this.render.composeAgreementInner(
            template.bodyHtml,
            template.programTitle,
            newBio,
            plan,
            a.agreementNumber,
          );
    const inner = this.applyBioTextCorrections(baseHtml, beforeBio, newBio);

    // Regenerate the locked PDF — best-effort. Off-prod (no Chromium) this
    // throws; we then null the key so getPdfUrl re-renders AND re-locks with the
    // corrected content on next view (see getPdfUrl). The apply still succeeds.
    let pdfKey: string | null = null;
    try {
      const buffer = await this.render.renderStoredPdf(template.programTitle, inner, newBio.country);
      const up = await this.storage.upload(buffer, 'application/pdf', 'agreements', `${a.agreementNumber}.pdf`);
      pdfKey = up.key;
    } catch (e) {
      this.log.warn(`bio-apply PDF render failed (will lazy-regenerate): ${(e as Error).message}`);
    }

    // Name change → split applicantName into first/last (canonical codebase
    // split). Only touch names when the name actually changed.
    const nameChanged =
      (newBio.applicantName ?? '').trim() !== (beforeBio.applicantName ?? '').trim();
    const parts = (newBio.applicantName ?? '').trim().split(/\s+/).filter(Boolean);
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ');

    // Only the applicant NAME is visible on a receipt, so only refresh receipt
    // PDFs when the name actually changed.
    let receiptIds: string[] = [];
    if (nameChanged) {
      const invoices = await this.prisma.invoice.findMany({
        where: { agreementId: a.id, deletedAt: null },
        select: { id: true },
      });
      const invoiceIds = invoices.map((i) => i.id);
      receiptIds = invoiceIds.length
        ? (
            await this.prisma.receipt.findMany({
              where: { invoiceId: { in: invoiceIds }, voidedAt: null },
              select: { id: true },
            })
          ).map((r) => r.id)
        : [];
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Atomic claim: only proceed if the request is STILL pending, so two
      // concurrent applies (or apply racing reject) can't both run the cascade.
      const claim = await tx.agreementChangeRequest.updateMany({
        where: { id, status: AgreementChangeStatus.PENDING },
        data: { status: AgreementChangeStatus.APPLIED, appliedByUserId: userId, appliedAt: now },
      });
      if (claim.count === 0) {
        throw new ConflictException('This request was already actioned by someone else.');
      }

      await tx.agreement.update({
        where: { id: a.id },
        data: {
          bioData: newBio as unknown as Prisma.InputJsonValue,
          contentHtml: inner,
          generatedPdfKey: pdfKey,
          generatedPdfAt: pdfKey ? now : null,
        },
      });

      if (nameChanged && firstName) {
        // Explicit admin correction — authoritative, so bypass the implicit
        // lead→client name-sync guard. updateMany (not update) so a dangling /
        // soft-deleted client or lead id can't abort the whole apply. Never
        // blank an existing surname when the corrected name is a single token.
        const nameData = lastName ? { firstName, lastName } : { firstName };
        if (a.clientId) {
          await tx.client.updateMany({ where: { id: a.clientId, deletedAt: null }, data: nameData });
        }
        if (a.leadId) {
          await tx.lead.updateMany({ where: { id: a.leadId, deletedAt: null }, data: nameData });
        }
      }

      if (receiptIds.length) {
        await tx.receipt.updateMany({
          where: { id: { in: receiptIds } },
          data: { pdfStorageKey: null, pdfGeneratedAt: null },
        });
      }
    });

    // Best-effort audit — never fail the (already-committed) apply on a logging
    // hiccup, which would otherwise 500 and make a retry hit "already applied".
    try {
      await this.recordEvent(
        a.id,
        userId,
        'CHANGE_APPLIED',
        `Applied bio correction${nameChanged ? ` — name → ${newBio.applicantName}` : ''}` +
          (receiptIds.length ? ` (${receiptIds.length} receipt(s) queued to re-render)` : ''),
        cr.before as Prisma.InputJsonValue,
        cr.after as Prisma.InputJsonValue,
      );
    } catch (e) {
      this.log.warn(`bio-apply audit event failed (apply committed): ${(e as Error).message}`);
    }

    return {
      ok: true,
      nameChanged,
      receiptsRefreshed: receiptIds.length,
      pdfRegenerated: !!pdfKey,
    };
  }

  /**
   * Admin APPLIES a pending PAYMENT_PLAN correction. Cascade:
   *   1. Agreement — paymentPlan / gross / discount / total / currency :=
   *      corrected; SWAP the plan table + fix inline totals inside contentHtml
   *      (surgical, so manual edits survive and the doc never drifts to a newer
   *      template); regenerate the stored PDF (best-effort).
   *   2. ServiceContract — totalAmount / currency := corrected.
   *   3. Installments — each stage's amount / dueDate / description := corrected;
   *      for any UNPAID stage that already has an invoice, update that invoice's
   *      amount too (so the next payment bills the corrected figure).
   *   4. Receipts — null pdfStorageKey on the agreement's (non-voided) receipts
   *      so each re-renders with the corrected engagement total / balance /
   *      upcoming schedule (a receipt shows the whole account, not just its own
   *      line).
   *
   * SAFETY — money already received is never silently moved. The apply is
   * REFUSED (409) when it would:
   *   • change an already-PAID stage's amount  → needs a finance credit note /
   *     refund;
   *   • change the NUMBER of stages            → restructure belongs in Finance;
   *   • change the currency once any payment exists.
   */
  private async applyPlanChangeRequest(cr: AgreementChangeRequest, userId: string) {
    const a = await this.prisma.agreement.findFirst({
      where: { id: cr.agreementId, deletedAt: null },
    });
    if (!a) throw new NotFoundException('Agreement not found');

    const before = (cr.before ?? {}) as unknown as AgreementPlanData;
    const after = (cr.after ?? {}) as unknown as AgreementPlanData;
    // Defensive: the corrected plan must still balance (validated at request
    // time, but the ledger writes below trust it).
    this.assertPlanBalances({
      planType: after.planType ?? '',
      grossAmount: after.grossAmount ?? 0,
      discountAmount: after.discountAmount ?? 0,
      netPayable: after.netPayable ?? 0,
      installments: after.installments ?? [],
    });

    const cents = (n: number | null | undefined) => Math.round((Number(n) || 0) * 100);
    const newNet = Number(after.netPayable ?? 0);
    const newCurrency = after.currency ?? a.currency;

    // Load the agreement's contract + its installments (each with its 0/1 invoice).
    const contract = a.serviceContractId
      ? await this.prisma.serviceContract.findFirst({
          where: { id: a.serviceContractId, deletedAt: null },
          include: {
            installments: {
              orderBy: { sequence: 'asc' },
              include: {
                invoice: { select: { id: true, status: true, paidAmount: true, deletedAt: true } },
              },
            },
          },
        })
      : null;

    const carriesMoney = (
      inv: { status: InvoiceStatus; paidAmount: Prisma.Decimal } | null | undefined,
    ) =>
      !!inv &&
      (Number(inv.paidAmount) > 0 ||
        inv.status === InvoiceStatus.PAID ||
        inv.status === InvoiceStatus.PARTIALLY_PAID);

    // Live (non-cancelled) stages, ordered; matched positionally to the corrected
    // schedule (both sorted by sequence).
    const stages = (contract?.installments ?? []).filter(
      (i) => i.status !== InstallmentStatus.CANCELLED,
    );
    const newRows = (after.installments ?? [])
      .slice()
      .sort((x, y) => (x.sequence ?? 0) - (y.sequence ?? 0));
    // Money received against THIS agreement — scoped exactly like the receipt /
    // finance-profile views (sum paidAmount across the agreement's invoices).
    // The primary payment flow records EVERY payment on a single agreement-linked
    // invoice (installmentId NULL, anchored to the whole fee), so a per-installment
    // invoice back-link is NOT a reliable "is this stage paid?" signal — the AR
    // waterfall over total-paid (what computeReceiptAccountContext and
    // syncInstallmentStatuses use) is.
    const agInvoices = contract
      ? await this.prisma.invoice.findMany({
          where: { agreementId: a.id, deletedAt: null },
          select: { id: true, paidAmount: true },
        })
      : [];
    const totalPaid = agInvoices.reduce((s, i) => s + Number(i.paidAmount), 0);
    const anyPaid = totalPaid > 0.005;
    // Allocate total-paid across the CURRENT stages in sequence order; a stage
    // that receives ANY coverage is treated as paid and is immutable here.
    let paidPool = totalPaid;
    const stagePaid = stages.map((s) => {
      const amt = Number(s.amount) || 0;
      const covered = Math.max(0, Math.min(paidPool, amt));
      paidPool -= covered;
      return covered > 0.005;
    });

    // ── Safety guards (only meaningful once a ledger exists) ──
    if (contract && stages.length > 0) {
      if (newRows.length !== stages.length) {
        throw new ConflictException(
          `This correction changes the number of payment stages (was ${stages.length}, now ${newRows.length}). ` +
            `Adding or removing a stage must be done in Finance — reject this and rebuild the schedule there.`,
        );
      }
      if (anyPaid && newCurrency !== contract.currency) {
        throw new ConflictException(
          `This correction changes the currency (${contract.currency} → ${newCurrency}) but payments have already ` +
            `been recorded. A currency change with recorded payments must be handled in Finance.`,
        );
      }
      if (cents(newNet) < cents(totalPaid)) {
        throw new ConflictException(
          `This correction lowers the total to ${newCurrency} ${newNet.toLocaleString()}, below the ` +
            `${contract.currency} ${totalPaid.toLocaleString()} already received. Reducing a fee below money ` +
            `already collected needs a finance credit note / refund — handle it in Finance.`,
        );
      }
      for (let k = 0; k < stages.length; k++) {
        if (stagePaid[k] && cents(Number(stages[k].amount)) !== cents(newRows[k].amount)) {
          throw new ConflictException(
            `Stage ${stages[k].sequence} has already received a payment — its amount can't be changed here. ` +
              `Correcting a paid stage needs a finance credit note / refund; reject this and adjust it in Finance.`,
          );
        }
      }
    }

    // ── Corrected document (surgical: swap plan table + fix inline totals) ──
    const template = await this.prisma.agreementTemplate.findUnique({
      where: { id: a.templateId },
    });
    const bio = (a.bioData ?? {}) as AgreementBioData;
    const currentPlan = (a.paymentPlan as AgreementPlanData) ?? before;
    const baseHtml =
      a.contentHtml && a.contentHtml.trim()
        ? a.contentHtml
        : template
          ? this.render.composeAgreementInner(
              template.bodyHtml,
              template.programTitle,
              bio,
              after,
              a.agreementNumber,
            )
          : '';
    const inner = baseHtml ? this.applyPlanTextCorrections(baseHtml, currentPlan, after) : a.contentHtml;

    // Regenerate the locked PDF — best-effort (puppeteer is prod-only). On
    // failure the key is nulled and getPdfUrl re-renders + re-locks on next view.
    let pdfKey: string | null = null;
    if (inner && template) {
      try {
        const buffer = await this.render.renderStoredPdf(template.programTitle, inner, bio.country);
        const up = await this.storage.upload(buffer, 'application/pdf', 'agreements', `${a.agreementNumber}.pdf`);
        pdfKey = up.key;
      } catch (e) {
        this.log.warn(`plan-apply PDF render failed (will lazy-regenerate): ${(e as Error).message}`);
      }
    }

    // The agreement's non-voided receipts — the corrected total / balance /
    // schedule shows on every one, so refresh them all. (Reuse the invoice ids
    // already loaded for paid-detection.)
    const invoiceIds = agInvoices.map((i) => i.id);
    const receiptIds = invoiceIds.length
      ? (
          await this.prisma.receipt.findMany({
            where: { invoiceId: { in: invoiceIds }, voidedAt: null },
            select: { id: true },
          })
        ).map((r) => r.id)
      : [];

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Atomic claim — one apply per request, race-safe with a second apply /
      // a reject.
      const claim = await tx.agreementChangeRequest.updateMany({
        where: { id: cr.id, status: AgreementChangeStatus.PENDING },
        data: { status: AgreementChangeStatus.APPLIED, appliedByUserId: userId, appliedAt: now },
      });
      if (claim.count === 0) {
        throw new ConflictException('This request was already actioned by someone else.');
      }

      await tx.agreement.update({
        where: { id: a.id },
        data: {
          paymentPlan: after as unknown as Prisma.InputJsonValue,
          grossAmount: after.grossAmount ?? undefined,
          discountAmount: after.discountAmount ?? undefined,
          totalAmount: newNet,
          currency: newCurrency,
          paymentPlanType: this.toPlanTypeEnum(after.planType),
          ...(inner ? { contentHtml: inner } : {}),
          generatedPdfKey: pdfKey,
          generatedPdfAt: pdfKey ? now : null,
        },
      });

      if (contract) {
        await tx.serviceContract.update({
          where: { id: contract.id },
          data: { totalAmount: newNet, currency: newCurrency },
        });
        for (let k = 0; k < stages.length; k++) {
          const ex = stages[k];
          const nw = newRows[k];
          const amount = Number(nw.amount) || 0;
          const dueDate = nw.dueDate ? new Date(nw.dueDate) : ex.dueDate;
          const desc = (nw.stage ?? '').trim() + (nw.trigger ? ` — ${nw.trigger}` : '');
          await tx.installment.update({
            where: { id: ex.id },
            data: { amount, dueDate, ...(desc ? { description: desc } : {}) },
          });
          // Keep an UNPAID invoice's amount in step so the next payment bills the
          // corrected figure. Paid invoices are money-locked (and guarded above),
          // so they're left untouched. The write is conditioned on the invoice
          // being STILL unpaid at write time (updateMany with a status/paidAmount
          // filter) — so a payment verified between our read and here can never
          // have its recorded amount silently rewritten.
          if (ex.invoice && ex.invoice.deletedAt == null && !stagePaid[k] && !carriesMoney(ex.invoice)) {
            await tx.invoice.updateMany({
              where: {
                id: ex.invoice.id,
                deletedAt: null,
                paidAmount: 0,
                status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.SENT] },
              },
              data: { subtotal: amount, totalAmount: amount, currency: newCurrency },
            });
          }
        }
      }

      if (receiptIds.length) {
        await tx.receipt.updateMany({
          where: { id: { in: receiptIds } },
          data: { pdfStorageKey: null, pdfGeneratedAt: null },
        });
      }
    });

    // Best-effort audit — never fail an already-committed apply on a logging hiccup.
    try {
      await this.recordEvent(
        a.id,
        userId,
        'CHANGE_APPLIED',
        `Applied payment-plan correction — total ${newCurrency} ${newNet.toLocaleString()}` +
          (stages.length ? `, ${stages.length} stage(s) updated` : '') +
          (receiptIds.length ? ` (${receiptIds.length} receipt(s) queued to re-render)` : ''),
        cr.before as Prisma.InputJsonValue,
        cr.after as Prisma.InputJsonValue,
      );
    } catch (e) {
      this.log.warn(`plan-apply audit event failed (apply committed): ${(e as Error).message}`);
    }

    return {
      ok: true,
      planChanged: true,
      installmentsUpdated: contract ? stages.length : 0,
      receiptsRefreshed: receiptIds.length,
      pdfRegenerated: !!pdfKey,
    };
  }

  /**
   * Correct a payment plan inside an agreement's stored HTML by SWAPPING the
   * `{{PAYMENT_PLAN}}` table (value-independent, so amount AND row changes are
   * handled) and find-replacing the old inline total ("PKR 120,000" → "PKR
   * 125,000") in the surrounding prose — preserving every manual edit and never
   * drifting to a newer template. The table swap runs first so the old total in
   * the old table is gone before the prose replace, and the new table's new
   * total (which differs from the old) is never touched.
   */
  private applyPlanTextCorrections(
    html: string,
    before: AgreementPlanData,
    after: AgreementPlanData,
  ): string {
    let out = html;
    const table = /<table class="payplan">[\s\S]*?<\/table>/;
    if (table.test(out)) {
      const fresh = this.render.renderPaymentPlanTable(after);
      out = out.replace(table, () => fresh);
    }
    const oldTotal = this.render.agreementTotalText(before);
    const newTotal = this.render.agreementTotalText(after);
    if (oldTotal && oldTotal !== newTotal) out = out.split(oldTotal).join(newTotal);
    return out;
  }

  /**
   * Replace the CHANGED bio field VALUES (old → new) inside an agreement's
   * stored HTML — a surgical correction that preserves the rest of the
   * document. Both the raw and HTML-escaped spellings of the old value are
   * swapped; the replacement is applied via a function so `$` in a value is
   * never treated as a regex back-reference.
   */
  private applyBioTextCorrections(
    html: string,
    before: AgreementBioData,
    after: AgreementBioData,
  ): string {
    const keys: (keyof AgreementBioData)[] = [
      'applicantName', 'fatherName', 'cnic', 'passport', 'dob', 'nationality',
      'address', 'phone', 'email', 'fileNumber', 'country', 'agreementDate',
    ];
    const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let out = html;
    for (const k of keys) {
      const oldV = String(before[k] ?? '').trim();
      const newV = String(after[k] ?? '');
      if (!oldV || oldV === newV.trim()) continue;
      out = out.replace(new RegExp(escRe(oldV), 'g'), () => newV);
      const oldEsc = escHtml(oldV);
      if (oldEsc !== oldV) out = out.replace(new RegExp(escRe(oldEsc), 'g'), () => escHtml(newV));
    }
    return out;
  }

  private summariseUpdate(dto: UpdateAgreementDto): string {
    const parts: string[] = [];
    if (dto.paymentPlan) parts.push('payment plan');
    if (dto.bioData) parts.push('applicant bio');
    if (dto.salesNotes !== undefined) parts.push('sales notes');
    return parts.length ? `Updated ${parts.join(', ')}` : 'Updated agreement';
  }

  private async recordEvent(
    agreementId: string,
    actorUserId: string | null,
    type: string,
    summary: string,
    dataBefore: Prisma.InputJsonValue | null,
    dataAfter: Prisma.InputJsonValue | null,
  ) {
    const event = await this.prisma.agreementEvent.create({
      data: {
        agreementId,
        actorUserId: actorUserId ?? undefined,
        type,
        summary,
        ...(dataBefore !== null ? { dataBefore } : {}),
        ...(dataAfter !== null ? { dataAfter } : {}),
      },
    });

    // Mirror every agreement lifecycle transition into the audit trail. One
    // point covers submit / approve / changes-requested / sent / signed /
    // delete — the specific transition is carried in metadata.type.
    await this.auditLog.log({
      actorUserId: actorUserId ?? undefined,
      action: AuditAction.AGREEMENT_STATUS_CHANGED,
      entityType: 'Agreement',
      entityId: agreementId,
      newValues: { type, summary },
    });

    return event;
  }

  private generateAgreementNumber(): Promise<string> {
    return this.numbering.next('AGR');
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
