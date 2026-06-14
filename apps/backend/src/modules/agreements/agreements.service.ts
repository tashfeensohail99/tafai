import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AgreementStatus,
  AuditAction,
  PaymentPlanType,
  Prisma,
  ServiceContractStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { StorageService } from '../storage/storage.service';
import { isCanonicalServiceCode } from '../../common/service-types';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
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
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // One agreement per lead. A lead may have at most one non-deleted
    // agreement; to start over, the existing one must be deleted first.
    // Approved/finalised agreements can't be deleted, which correctly blocks
    // a second agreement once a deal is locked.
    const existingAgreement = await this.prisma.agreement.findFirst({
      where: { leadId: dto.leadId, deletedAt: null },
      select: { agreementNumber: true, status: true },
    });
    if (existingAgreement) {
      throw new ConflictException(
        `This lead already has an agreement (${existingAgreement.agreementNumber} — ` +
          `${existingAgreement.status.replace(/_/g, ' ').toLowerCase()}). ` +
          'Open or delete it before creating a new one.',
      );
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

    // Sales → Finance data-quality gate. Block submission until the underlying
    // lead is complete: first + last name on file (so Finance + downstream PDFs
    // render properly) AND a verified email address (so receipts / agreement
    // links don't bounce or land in the wrong inbox). Without this guard the
    // first time anyone notices the data is missing is when Finance is already
    // trying to issue a receipt — too late.
    const lead = await this.prisma.lead.findUnique({
      where: { id: existing.leadId },
      select: { firstName: true, lastName: true, email: true, emailVerified: true, serviceInterest: true },
    });
    if (!lead) throw new BadRequestException('Lead not found for this agreement');
    const missing: string[] = [];
    if (!lead.firstName?.trim()) missing.push('first name');
    if (!lead.lastName?.trim()) missing.push('last name');
    if (!lead.email?.trim()) missing.push('email address');
    else if (!lead.emailVerified) missing.push('email verification');
    // Coded service type — required for downstream processing-checklist
    // routing. Legacy free-text values don't count: sales must reclassify
    // to one of the canonical codes before this case can move to Finance.
    if (!lead.serviceInterest?.trim() || !isCanonicalServiceCode(lead.serviceInterest)) {
      missing.push('service type (pick one of the coded options)');
    }
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot submit to Finance — the lead profile is incomplete (${missing.join(', ')}). ` +
        `Open the lead profile, fill in any missing fields, and use the Verification tab to confirm the email before re-submitting.`,
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
   * Finance approves: re-validate, lock the plan, and generate + store the
   * final PDF from the approved record. Crucially this does NOT yet create
   * a ServiceContract — the **ledger** (ServiceContract + Installments) is
   * a binding billing schedule and only materialises the moment the signed
   * agreement is uploaded (see `uploadSignedAgreement`). Per the finance
   * team: until the client signs, there's a *proposal*, not a ledger.
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
      },
    });

    await this.recordEvent(
      id,
      userId,
      'APPROVED',
      'Approved by Finance; payment plan locked. Ledger materializes on signed-agreement upload.',
      null,
      null,
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
    if (!a.generatedPdfKey) {
      throw new ConflictException('No generated PDF to send — re-approve to regenerate it.');
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

    const file = await this.storage.download(a.generatedPdfKey);
    const ok = await this.email.sendAgreementToClient({
      to,
      clientName,
      agreementNumber: a.agreementNumber,
      pdf: file.bytes,
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
      select: { generatedPdfKey: true },
    });
    if (!a) throw new NotFoundException('Agreement not found');
    if (a.generatedPdfKey) {
      return { url: await this.storage.getSignedUrl(a.generatedPdfKey) };
    }
    const buffer = await this.previewPdf(id);
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
  ): Promise<string> {
    const net = Number(a.totalAmount.toString());
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
        status: ServiceContractStatus.ACTIVE,
        notes: `Materialised on signature from agreement ${a.agreementNumber}`,
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
