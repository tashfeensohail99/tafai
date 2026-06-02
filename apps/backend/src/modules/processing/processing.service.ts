import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  AuthorityDecision,
  CorrectionRequiredAction,
  CorrectionStatus,
  CorrectionType,
  DocumentCriticality,
  DocumentItemStatus,
  InboundDocumentSource,
  InboundDocumentStatus,
  FinanceHandoverStatus,
  Prisma,
  ProcessingCasePriority,
  ProcessingCaseStage,
  ProcessingNoteType,
  ProcessingTaskStatus,
  TimelineEventType,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  WhatsAppThreadStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { isCanonicalServiceCode } from '../../common/service-types';
import { generateLeadReferenceCode } from '../../common/reference-codes/reference-codes';
import { getMilestonesForService } from './milestone-templates';
import { DocumentAiService } from './document-ai/document-ai.service';
import { DocumentIntakeService } from './document-ai/document-intake.service';
import { reconcileIdentity } from './identity-reconciliation';
import { computeValidityExpiry } from './expiry';
import { applyCrmAutoFill } from './crm-auto-fill.helper';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import { StorageService } from '../storage/storage.service';
import { LeadsService } from '../leads/leads.service';
import {
  WHATSAPP_QUEUE,
  type OutboundMessageJob,
} from '../whatsapp/queues/queue-contracts';
import {
  AcknowledgeIntakeDto,
  AddDocumentItemDto,
  AssignCaseDto,
  ChangeCaseStageDto,
  CreateAuthoritySubmissionDto,
  CreateCorrectionRequestDto,
  CreateDocumentTemplateDto,
  CreateManualClientCaseDto,
  CreateProcessingCaseDto,
  CreateProcessingNoteDto,
  CreateProcessingTaskDto,
  EscalateCorrectionRequestDto,
  ListCorrectionRequestsQueryDto,
  ListIntakeQueueQueryDto,
  ListProcessingCasesQueryDto,
  ReportDateRangeQueryDto,
  ReportExportQueryDto,
  RequestDocumentDto,
  ResolveCorrectionRequestDto,
  ReviewDocumentDto,
  SendCommunicationDto,
  UpdateAttestationDto,
  UpdateAuthoritySubmissionDto,
  UpdateCasePriorityDto,
  UpdateDocumentTemplateDto,
  UpdateProcessingTaskDto,
  WaiveDocumentItemDto,
} from './processing.dto';

/**
 * Resolve a human display name for a UserAccount. UserAccount has NO name
 * column — the name lives on the Employee relation. Callers must include
 * `{ email, employee: { select: { firstName, lastName } } }`. Returns null
 * when the officer arg itself is null (e.g. unassigned case).
 */
function officerDisplayName(
  officer:
    | { email: string; employee: { firstName: string; lastName: string } | null }
    | null
    | undefined,
): string | null {
  if (!officer) return null;
  const name = officer.employee
    ? `${officer.employee.firstName} ${officer.employee.lastName}`.trim()
    : '';
  return name || officer.email;
}

// Stage gate: which transitions are allowed from each stage
const ALLOWED_TRANSITIONS: Partial<Record<ProcessingCaseStage, ProcessingCaseStage[]>> = {
  INTAKE_PENDING: [ProcessingCaseStage.DOCUMENTS_COLLECTION],
  DOCUMENTS_COLLECTION: [ProcessingCaseStage.DOCUMENTS_UNDER_REVIEW],
  DOCUMENTS_UNDER_REVIEW: [
    ProcessingCaseStage.DOCUMENTS_INCOMPLETE,
    ProcessingCaseStage.DOCUMENTS_COMPLETE,
  ],
  DOCUMENTS_INCOMPLETE: [ProcessingCaseStage.DOCUMENTS_COLLECTION],
  DOCUMENTS_COMPLETE: [ProcessingCaseStage.READY_FOR_SUBMISSION],
  READY_FOR_SUBMISSION: [ProcessingCaseStage.SUBMITTED],
  SUBMITTED: [ProcessingCaseStage.UNDER_AUTHORITY_REVIEW],
  UNDER_AUTHORITY_REVIEW: [
    ProcessingCaseStage.ADDITIONAL_INFO_REQUESTED,
    ProcessingCaseStage.DECISION_RECEIVED,
  ],
  ADDITIONAL_INFO_REQUESTED: [ProcessingCaseStage.UNDER_AUTHORITY_REVIEW],
  DECISION_RECEIVED: [
    ProcessingCaseStage.APPROVED,
    ProcessingCaseStage.REJECTED,
  ],
  APPROVED: [ProcessingCaseStage.COMPLETED],
  REJECTED: [ProcessingCaseStage.APPEAL_IN_PROGRESS],
  APPEAL_IN_PROGRESS: [ProcessingCaseStage.UNDER_AUTHORITY_REVIEW],
};

// Stages that cannot be cancelled by non-manager
const MANAGER_ONLY_CANCEL_STAGES = new Set<ProcessingCaseStage>([
  ProcessingCaseStage.COMPLETED,
  ProcessingCaseStage.CANCELLED,
]);

// Criticality levels that block READY_FOR_SUBMISSION
const BLOCKING_CRITICALITIES = new Set<DocumentCriticality>([
  DocumentCriticality.CRITICAL,
  DocumentCriticality.REQUIRED,
]);

const TERMINAL_STAGES = new Set<ProcessingCaseStage>([
  ProcessingCaseStage.COMPLETED,
  ProcessingCaseStage.CANCELLED,
]);

/**
 * Map every operational ProcessingCase.stage to the coarse-grained
 * Client.status it should reflect in admin/portal summary views.
 *
 * Per the rule the user laid down: "ProcessingCase.stage remains the
 * operational truth. Client.status is the client-level summary."
 *
 * Stages absent from this map don't change the Client.status (e.g. the
 * intermediate review stages stay summarized as UNDER_PROCESSING).
 */
const STAGE_TO_CLIENT_STATUS: Partial<Record<ProcessingCaseStage, string>> = {
  [ProcessingCaseStage.INTAKE_PENDING]: 'UNDER_PROCESSING',
  [ProcessingCaseStage.DOCUMENTS_COLLECTION]: 'DOCUMENTS_PENDING',
  [ProcessingCaseStage.DOCUMENTS_UNDER_REVIEW]: 'UNDER_PROCESSING',
  [ProcessingCaseStage.DOCUMENTS_INCOMPLETE]: 'DOCUMENTS_PENDING',
  [ProcessingCaseStage.DOCUMENTS_COMPLETE]: 'UNDER_PROCESSING',
  [ProcessingCaseStage.READY_FOR_SUBMISSION]: 'UNDER_PROCESSING',
  [ProcessingCaseStage.SUBMITTED]: 'SUBMITTED',
  [ProcessingCaseStage.UNDER_AUTHORITY_REVIEW]: 'SUBMITTED',
  [ProcessingCaseStage.ADDITIONAL_INFO_REQUESTED]: 'SUBMITTED',
  [ProcessingCaseStage.DECISION_RECEIVED]: 'SUBMITTED',
  [ProcessingCaseStage.APPROVED]: 'APPROVED',
  [ProcessingCaseStage.REJECTED]: 'REJECTED',
  [ProcessingCaseStage.APPEAL_IN_PROGRESS]: 'SUBMITTED',
  [ProcessingCaseStage.COMPLETED]: 'COMPLETED',
  [ProcessingCaseStage.CANCELLED]: 'CANCELLED',
};

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly storage: StorageService,
    private readonly timeline: ActivityTimelineService,
    // Used to auto-convert Lead → Client at the moment Finance sends a case
    // into processing.
    private readonly leadsService: LeadsService,
    // Outbound WhatsApp queue — used by sendCommunication to put a real
    // WA message on the wire when officers tick the WhatsApp channel. The
    // queues module is @Global() so we get this without extra wiring.
    @InjectQueue(WHATSAPP_QUEUE.OUTBOUND_MESSAGE)
    private readonly outboundWhatsAppQueue: Queue<OutboundMessageJob>,
    // Phase D2 — enqueue document-AI assessment on upload.
    private readonly documentAi: DocumentAiService,
    // Phase 2 — bundle-split safety net for officer uploads.
    private readonly documentIntake: DocumentIntakeService,
  ) {}

  // -------------------------------------------------------------------------
  // INTAKE
  // -------------------------------------------------------------------------

  /**
   * Called by Finance when sending a verified handover to Processing.
   * Rule 1: handover must exist with PAYMENT_VERIFIED status.
   * Rule 1 corollary: only one processing case per handover.
   */
  async createFromHandover(dto: CreateProcessingCaseDto, user: RequestUser): Promise<Prisma.ProcessingCaseGetPayload<{
    include: { financeHandover: true; lead: true; client: true }
  }>> {
    const handover = await this.prisma.financeHandover.findUnique({
      where: { id: dto.financeHandoverId },
      include: { lead: true },
    });

    if (!handover) {
      throw new NotFoundException('Finance handover not found');
    }

    if (handover.status !== FinanceHandoverStatus.PAYMENT_VERIFIED) {
      throw new BadRequestException(
        `Handover must be in PAYMENT_VERIFIED status to send to processing. Current status: ${handover.status}`,
      );
    }

    const existing = await this.prisma.processingCase.findUnique({
      where: { financeHandoverId: dto.financeHandoverId },
    });
    if (existing) {
      throw new ConflictException('A processing case has already been created for this handover');
    }

    // Resolve service and country from lead. The Sales→Finance gate
    // (agreements.service.ts) already requires a canonical service code
    // before the agreement can be submitted, so by the time a finance
    // handover exists the lead.serviceInterest should be one of the codes
    // in SERVICE_TYPE_CODES. Defensive check here too — surfaces a clear
    // error if a legacy free-text or null value somehow reaches here.
    const service = handover.lead.serviceInterest;
    if (!service || !isCanonicalServiceCode(service)) {
      throw new BadRequestException(
        `Lead ${handover.leadId} has no canonical service code on file (got: "${service ?? 'null'}"). ` +
          'Sales must reclassify the lead to one of the coded service types before this case can move to Processing.',
      );
    }
    const targetCountry = handover.lead.targetCountry ?? 'Unknown';

    const processingCase = await this.prisma.$transaction(async (tx) => {
      // RULE: "Lead becomes Client when Finance sends verified case to Processing."
      // If the lead hasn't been converted yet, convert it now — same tx, so the
      // whole intake either creates Client + Case + handover-status-change as a
      // single atomic step or rolls back together.
      const conversion = await this.leadsService.convertToClient(
        handover.leadId,
        user.id,
        'Auto-converted on send-to-processing',
        tx,
      );
      const clientId = conversion.client.id;

      // Create the case — clientId is now non-null per the schema's required FK.
      const created = await tx.processingCase.create({
        data: {
          financeHandoverId: dto.financeHandoverId,
          leadId: handover.leadId,
          clientId,
          branchId: handover.lead.branchId ?? undefined,
          service,
          targetCountry,
          priority: dto.priority ?? ProcessingCasePriority.NORMAL,
          financeHandoverNote: dto.financeHandoverNote ?? handover.financeNotes ?? undefined,
          createdByUserId: user.id,
        },
        include: { financeHandover: true, lead: true, client: true },
      });

      // Mark handover as sent to processing
      await tx.financeHandover.update({
        where: { id: dto.financeHandoverId },
        data: { status: FinanceHandoverStatus.SENT_TO_PROCESSING },
      });

      // Bump client status to UNDER_PROCESSING — the operational truth lives on
      // ProcessingCase.stage, but Client.status is the summary used by admin /
      // portal dashboards.
      await tx.client.update({
        where: { id: clientId },
        data: { status: 'UNDER_PROCESSING' },
      });

      // Audit log
      await tx.processingAuditLog.create({
        data: {
          caseId: created.id,
          actorUserId: user.id,
          action: 'case_created',
          entityType: 'processing_case',
          entityId: created.id,
          newValues: { stage: created.stage, priority: created.priority },
        },
      });

      return created;
    });

    // Record on activity timeline (after transaction commits).
    // Non-fatal — timeline failure must never roll back the completed intake.
    this.timeline.record({
      entityType: 'processing_case',
      entityId: processingCase.id,
      leadId: processingCase.leadId ?? undefined,
      clientId: processingCase.clientId ?? undefined,
      eventType: TimelineEventType.PROCESSING_CASE_CREATED,
      description: `Processing case opened — ${service} / ${targetCountry}`,
      actorUserId: user.id,
      metadata: { handoverId: dto.financeHandoverId, priority: processingCase.priority },
    }).catch(() => { /* timeline is non-fatal — processing_audit_log is the source of truth */ });

    return processingCase;
  }

  /**
   * Manual client on-ramp (Processing Manager). Creates a Lead → Client →
   * INTAKE_PENDING ProcessingCase WITHOUT a Finance handover, so the case
   * lands in the intake queue exactly like a finance-originated one. Used to
   * (a) onboard pre-existing clients and (b) generate clients to exercise a
   * service's checklist / attestation / communication flows.
   *
   * Reuses LeadsService.convertToClient (dedupes by phone/email, so importing
   * a person who already exists links to their existing Client). The Lead is
   * created directly (not via the sales intake path) so round-robin never
   * fires, and convertToClient flips it to CONVERTED in the same tx so it
   * never surfaces as an assignable sales lead.
   */
  async createManualClientCase(dto: CreateManualClientCaseDto, user: RequestUser) {
    const service = dto.service.trim();
    if (!isCanonicalServiceCode(service)) {
      throw new BadRequestException(`Unknown service code: ${service}`);
    }
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const email = dto.email?.trim() || null;
    const targetCountry = dto.targetCountry.trim();

    // Reference code generated before the tx (the generator reads counts off
    // the live table; same pattern as leads.service / lead-import).
    const referenceCode = await generateLeadReferenceCode(this.prisma);

    // Phone is optional for imported/test clients. Client.phone is @unique +
    // required, so when blank we store a unique, clearly non-dialable
    // placeholder keyed off the reference code. The manager edits in the real
    // number later (WhatsApp stays inactive until then).
    const phone = dto.phone?.trim() || `MANUAL-${referenceCode}`;

    const processingCase = await this.prisma.$transaction(async (tx) => {
      // 1. Lead (manual origin). Created direct → no round-robin.
      const lead = await tx.lead.create({
        data: {
          referenceCode,
          firstName,
          lastName,
          email,
          phone,
          nationality: dto.nationality?.trim() || null,
          targetCountry,
          serviceInterest: service,
          sourceChannel: 'PROCESSING_MANUAL',
          createdByUserId: user.id,
        },
      });

      // 2. Lead → Client (reuse; dedupes by phone/email, sets portal access,
      //    flips lead to CONVERTED).
      const conversion = await this.leadsService.convertToClient(
        lead.id,
        user.id,
        'Created by Processing Manager (manual client)',
        tx,
      );
      const clientId = conversion.client.id;

      // 3. The case — financeHandoverId null (no finance origin).
      const created = await tx.processingCase.create({
        data: {
          financeHandoverId: null,
          leadId: lead.id,
          clientId,
          service,
          targetCountry,
          priority: dto.priority ?? ProcessingCasePriority.NORMAL,
          processingNote: 'Manually created by Processing Manager',
          createdByUserId: user.id,
        },
        include: { lead: true, client: true },
      });

      // 4. Audit
      await tx.processingAuditLog.create({
        data: {
          caseId: created.id,
          actorUserId: user.id,
          action: 'manual_client_created',
          entityType: 'processing_case',
          entityId: created.id,
          newValues: {
            stage: created.stage,
            service,
            targetCountry,
            referenceCode,
            wasExistingClient: conversion.wasExistingClient,
          },
        },
      });

      return created;
    });

    // Timeline (post-commit, non-fatal).
    this.timeline.record({
      entityType: 'processing_case',
      entityId: processingCase.id,
      leadId: processingCase.leadId ?? undefined,
      clientId: processingCase.clientId ?? undefined,
      eventType: TimelineEventType.PROCESSING_CASE_CREATED,
      description: `Processing case opened (manual) — ${service} / ${targetCountry}`,
      actorUserId: user.id,
      metadata: { manual: true, priority: processingCase.priority },
    }).catch(() => { /* timeline is non-fatal */ });

    return processingCase;
  }

  async listIntakeQueue(query: ListIntakeQueueQueryDto) {
    return this.prisma.processingCase.findMany({
      where: {
        stage: ProcessingCaseStage.INTAKE_PENDING,
        ...(query.priority ? { priority: query.priority } : {}),
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            serviceInterest: true,
            targetCountry: true,
          },
        },
        client: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
        financeHandover: {
          select: {
            id: true,
            submittedAmount: true,
            currency: true,
            receiptFileName: true,
            submittedAt: true,
            createdByUserId: true,
          },
        },
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
      skip: ((query.page ?? 1) - 1) * (query.limit ?? 20),
      take: query.limit ?? 20,
    });
  }

  /**
   * Acknowledge an intake case: assign officer + move to DOCUMENTS_COLLECTION
   * + auto-build checklist from template.
   */
  async acknowledgeIntake(
    caseId: string,
    dto: AcknowledgeIntakeDto,
    user: RequestUser,
  ) {
    const processingCase = await this.prisma.processingCase.findUnique({
      where: { id: caseId },
    });
    if (!processingCase) throw new NotFoundException('Processing case not found');
    if (processingCase.stage !== ProcessingCaseStage.INTAKE_PENDING) {
      throw new BadRequestException('Case has already been acknowledged');
    }

    // Manager-only by route permission. Per the Processing workflow the
    // manager MUST nominate a real associate — never self-assign — so cases
    // are visible only to the person actually doing the work.
    const officerId = dto.assignOfficerId;
    const assignee = await this.prisma.userAccount.findUnique({
      where: { id: officerId },
      select: {
        id: true,
        email: true,
        userRoles: {
          select: { role: { select: { name: true } } },
        },
      },
    });
    if (!assignee) {
      throw new BadRequestException('Assignee not found');
    }
    const assigneeRoles = assignee.userRoles.map((r) => r.role.name);
    // Accept anyone who can work cases — associate (processing), manager
    // (processing_manager), documentation specialist, or admin. We block
    // assignment to non-processing roles (sales, finance, support) to keep
    // the work boundary clean.
    const PROCESSING_WORKERS = new Set(['processing', 'processing_manager', 'documentation', 'super_admin', 'admin']);
    if (!assigneeRoles.some((r) => PROCESSING_WORKERS.has(r))) {
      throw new BadRequestException(
        'Assignee must be a Processing Associate, Manager, or Documentation specialist',
      );
    }

    // Service-type override: manager re-confirms the case category at
    // acknowledge time. If they pick a different code, we re-template the
    // checklist against the new (service, targetCountry) pair.
    const effectiveService = dto.service ?? processingCase.service;
    const serviceChanged = dto.service && dto.service !== processingCase.service;
    // Phase F — optional specific program (C11/ICT/LMIA/VISIT…). When set, the
    // checklist is built from the program-specific requirement set first.
    const effectiveProgramCode = dto.programCode?.trim() || null;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Assign, move stage, optionally update service code
      const c = await tx.processingCase.update({
        where: { id: caseId },
        data: {
          stage: ProcessingCaseStage.DOCUMENTS_COLLECTION,
          assignedOfficerId: officerId,
          updatedByUserId: user.id,
          ...(serviceChanged ? { service: dto.service } : {}),
        },
      });

      // Record stage history
      await tx.processingCaseStageHistory.create({
        data: {
          caseId,
          fromStage: ProcessingCaseStage.INTAKE_PENDING,
          toStage: ProcessingCaseStage.DOCUMENTS_COLLECTION,
          changedByUserId: user.id,
          reason: serviceChanged
            ? `Case acknowledged by manager; service set to ${dto.service}; assigned to associate`
            : 'Case acknowledged by manager; assigned to associate',
        },
      });

      // Auto-build checklist from templates. Lookup ladder (program-specific
      // first, then the generic service baseline):
      //   1. (programCode, targetCountry)  — e.g. C11·Canada
      //   2. (programCode, 'GLOBAL')        — program, any country
      //   3. (service, targetCountry)       — generic, country-specific
      //   4. (service, 'GLOBAL')            — generic baseline
      //      (see migrations 20260528130000 + 20260531150000)
      //   5. Empty checklist + warning — officer adds items by hand.
      const findTemplates = (where: Prisma.DocumentRequirementTemplateWhereInput) =>
        tx.documentRequirementTemplate.findMany({
          where: { ...where, isActive: true },
          orderBy: { sortOrder: 'asc' },
        });

      let templates: Awaited<ReturnType<typeof findTemplates>> = [];
      if (effectiveProgramCode) {
        templates = await findTemplates({
          programCode: effectiveProgramCode,
          targetCountry: processingCase.targetCountry,
        });
        if (templates.length === 0) {
          templates = await findTemplates({
            programCode: effectiveProgramCode,
            targetCountry: 'GLOBAL',
          });
        }
      }
      if (templates.length === 0) {
        templates = await findTemplates({
          service: effectiveService,
          targetCountry: processingCase.targetCountry,
        });
      }
      if (templates.length === 0) {
        templates = await findTemplates({ service: effectiveService, targetCountry: 'GLOBAL' });
      }

      // Soft fallback: if NO template exists for this service yet, don't
      // block the officer — they can still acknowledge + add doc items
      // manually via POST /cases/:id/documents. We just log a warning so
      // the admin team knows a template is missing.
      if (templates.length === 0) {
        this.logger.warn(
          `acknowledgeIntake: no DocumentRequirementTemplate for service="${effectiveService}" / country="${processingCase.targetCountry}" (and no GLOBAL fallback). Case acknowledged with an empty checklist — officer can add doc items manually.`,
        );
      } else {
        await tx.caseDocumentItem.createMany({
          data: templates.map((t) => ({
            caseId,
            templateId: t.id,
            documentName: t.documentName,
            description: t.description ?? undefined,
            criticality: t.criticality,
            expectedFormats: t.expectedFormats,
            maxFileSizeMb: t.maxFileSizeMb,
            validityRule: t.validityRule,
            validityMonths: t.validityMonths ?? undefined,
            validityBufferDays: t.validityBufferDays,
            // Phase D — carry the doc-type + photo requirement onto the
            // per-case item so the parser knows what to validate against.
            docType: t.docType ?? undefined,
            documentKind: t.documentKind,
            photoSpec: t.photoSpec ?? undefined,
            // Phase F — carry program/attestation/staging + client guidance.
            applicantRole: t.applicantRole,
            stageGroup: t.stageGroup,
            attestationChain: t.attestationChain ?? undefined,
            attestationStatus: t.attestationRequired ? 'REQUIRED_PENDING' : 'NOT_REQUIRED',
            translationStatus: t.translationRequired ? 'REQUIRED_PENDING' : 'NOT_REQUIRED',
            whyText: t.whyText ?? undefined,
            exampleGoodUrl: t.exampleGoodUrl ?? undefined,
            exampleBadUrl: t.exampleBadUrl ?? undefined,
            sortOrder: t.sortOrder,
          })),
        });
      }

      // Per-case-type milestone checklist — the granular progress narrative
      // the associate ticks off (e.g. WORK_PERMIT cases get LMIA + Offer
      // Letter; E2_VISA gets Business Meeting + Incorporation). Independent
      // of the gated stage machine. See milestone-templates.ts.
      // "Case Initiated" is the first milestone in every template — we mark
      // it complete immediately so the timeline reflects what just happened.
      const milestoneTemplates = getMilestonesForService(effectiveService);
      if (milestoneTemplates.length > 0) {
        await tx.caseMilestone.createMany({
          data: milestoneTemplates.map((m, idx) => ({
            caseId,
            title: m.title,
            description: m.description ?? null,
            sortOrder: idx,
            // First milestone is "Case Initiated" by convention — auto-tick
            // it here so the associate doesn't have to. If a template ever
            // omits it from position 0 the only consequence is no auto-tick.
            ...(idx === 0
              ? { completedAt: new Date(), completedByUserId: user.id }
              : {}),
          })),
        });
      }

      // Audit
      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'case_acknowledged_and_assigned',
          entityType: 'processing_case',
          entityId: caseId,
          oldValues: {
            stage: ProcessingCaseStage.INTAKE_PENDING,
            service: processingCase.service,
            assignedOfficerId: null,
          },
          newValues: {
            stage: ProcessingCaseStage.DOCUMENTS_COLLECTION,
            service: effectiveService,
            assignedOfficerId: officerId,
            checklistItemsCreated: templates.length,
          },
        },
      });

      return c;
    });

    // Non-fatal — timeline failure must never undo the completed acknowledge.
    this.timeline.record({
      entityType: 'processing_case',
      entityId: caseId,
      leadId: processingCase.leadId ?? undefined,
      clientId: processingCase.clientId ?? undefined,
      eventType: TimelineEventType.PROCESSING_STAGE_CHANGED,
      description: `Case acknowledged — moved to Document Collection. Checklist built.`,
      actorUserId: user.id,
      metadata: {
        fromStage: ProcessingCaseStage.INTAKE_PENDING,
        toStage: ProcessingCaseStage.DOCUMENTS_COLLECTION,
        assignedOfficerId: officerId,
      },
    }).catch(() => { /* non-fatal */ });

    return updated;
  }

  // -------------------------------------------------------------------------
  // CASES
  // -------------------------------------------------------------------------

  async listCases(query: ListProcessingCasesQueryDto, user: RequestUser) {
    const canViewAll = user.permissions.includes('processing.case.view_all');
    // Date-range filters. Workflow doc asks for "filters: duration, last
    // activity" — `createdAt` covers intake-date / duration since intake,
    // `updatedAt` covers last-activity (any field change bumps it).
    const createdAtFilter: Prisma.DateTimeFilter | undefined =
      query.createdFrom || query.createdTo
        ? {
            ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
            ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
          }
        : undefined;
    const updatedAtFilter: Prisma.DateTimeFilter | undefined =
      query.updatedFrom || query.updatedTo
        ? {
            ...(query.updatedFrom ? { gte: new Date(query.updatedFrom) } : {}),
            ...(query.updatedTo ? { lte: new Date(query.updatedTo) } : {}),
          }
        : undefined;
    // Multi-stage wins over single stage when both are passed — keeps the
    // History page's "all terminal stages" query in a single round trip.
    const stageFilter: Prisma.ProcessingCaseWhereInput | undefined =
      query.stages && query.stages.length > 0
        ? { stage: { in: query.stages } }
        : query.stage
          ? { stage: query.stage }
          : undefined;

    const whereClause: Prisma.ProcessingCaseWhereInput = {
      ...(canViewAll ? {} : { assignedOfficerId: user.id }),
      ...(stageFilter ?? {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assignedOfficerId ? { assignedOfficerId: query.assignedOfficerId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.service ? { service: query.service } : {}),
      ...(query.targetCountry ? { targetCountry: query.targetCountry } : {}),
      ...(query.authorityDecision ? { authorityDecision: query.authorityDecision } : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      ...(updatedAtFilter ? { updatedAt: updatedAtFilter } : {}),
      ...(query.search
        ? {
            OR: [
              {
                lead: {
                  OR: [
                    { firstName: { contains: query.search, mode: 'insensitive' } },
                    { lastName: { contains: query.search, mode: 'insensitive' } },
                  ],
                },
              },
              { service: { contains: query.search, mode: 'insensitive' } },
              { id: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [cases, total] = await this.prisma.$transaction([
      this.prisma.processingCase.findMany({
        where: whereClause,
        include: {
          lead: { select: { id: true, firstName: true, lastName: true, phone: true } },
          client: { select: { id: true, firstName: true, lastName: true, phone: true } },
          assignedOfficer: { select: { id: true, email: true } },
          _count: { select: { documentItems: true } },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: ((query.page ?? 1) - 1) * (query.limit ?? 20),
        take: query.limit ?? 20,
      }),
      this.prisma.processingCase.count({ where: whereClause }),
    ]);

    return { cases, total, page: query.page ?? 1, limit: query.limit ?? 20 };
  }

  async getCaseById(caseId: string, user: RequestUser) {
    const processingCase = await this.prisma.processingCase.findUnique({
      where: { id: caseId },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            serviceInterest: true,
            targetCountry: true,
          },
        },
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            nationality: true,
            dateOfBirth: true,
            passportNumber: true,
            passportExpiry: true,
          },
        },
        assignedOfficer: { select: { id: true, email: true } },
        financeHandover: {
          select: {
            id: true,
            submittedAmount: true,
            currency: true,
            receiptFileName: true,
            submittedAt: true,
          },
        },
        stageHistory: { orderBy: { createdAt: 'asc' } },
        _count: { select: { documentItems: true, tasks: true, notes: true } },
      },
    });

    if (!processingCase) throw new NotFoundException('Processing case not found');

    this.assertCaseAccess(processingCase, user);
    return processingCase;
  }

  async assignCase(caseId: string, dto: AssignCaseDto, user: RequestUser) {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);

    // No-op short-circuit — clicking Reassign and picking the same officer
    // shouldn't write an audit row or bump updatedByUserId.
    if (processingCase.assignedOfficerId === dto.officerId) {
      return processingCase;
    }

    // Same role guard as acknowledgeIntake (P5.1): reassignment can only
    // target a processing-side user. Blocks accidentally re-routing to
    // sales/finance/support.
    const assignee = await this.prisma.userAccount.findUnique({
      where: { id: dto.officerId },
      select: {
        id: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!assignee) {
      throw new BadRequestException('Assignee not found');
    }
    const PROCESSING_WORKERS = new Set(['processing', 'processing_manager', 'documentation', 'super_admin', 'admin']);
    const assigneeRoles = assignee.userRoles.map((r) => r.role.name);
    if (!assigneeRoles.some((r) => PROCESSING_WORKERS.has(r))) {
      throw new BadRequestException(
        'Assignee must be a Processing Associate, Manager, or Documentation specialist',
      );
    }

    // Differentiate initial assignment vs reassignment in the audit log so
    // the manager-dashboard / compliance review can tell them apart.
    const action = processingCase.assignedOfficerId
      ? 'case_reassigned'
      : 'case_assigned';

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.processingCase.update({
        where: { id: caseId },
        data: { assignedOfficerId: dto.officerId, updatedByUserId: user.id },
      });
      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action,
          entityType: 'processing_case',
          entityId: caseId,
          oldValues: { assignedOfficerId: processingCase.assignedOfficerId },
          newValues: { assignedOfficerId: dto.officerId },
        },
      });
      return c;
    });

    return updated;
  }

  async updateCasePriority(caseId: string, dto: UpdateCasePriorityDto, user: RequestUser) {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);

    return this.prisma.processingCase.update({
      where: { id: caseId },
      data: { priority: dto.priority, updatedByUserId: user.id },
    });
  }

  // -------------------------------------------------------------------------
  // OFFICER ROSTER
  //
  // Picker list for the manager-acknowledge flow + reassignment UI. Returns
  // every active user account that holds a processing-side role (associate,
  // manager, documentation, admin) so the manager can route a case to the
  // right hands. Sales/finance/support roles are excluded.
  // -------------------------------------------------------------------------

  async listProcessingOfficers() {
    const officers = await this.prisma.userAccount.findMany({
      where: {
        // UserAccount has no `isActive` — active state is `status` +
        // soft-delete via `deletedAt`. (Employee has isActive; UserAccount
        // doesn't.)
        status: 'ACTIVE',
        deletedAt: null,
        userRoles: {
          some: {
            role: {
              name: { in: ['processing', 'processing_manager', 'documentation', 'super_admin', 'admin'] },
            },
          },
        },
      },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true } },
        userRoles: { select: { role: { select: { name: true } } } },
      },
      orderBy: { email: 'asc' },
    });

    return officers.map((u) => {
      // UserAccount has no name column — the human name lives on the
      // Employee relation. Fall back to the email handle when there's no
      // employee record (e.g. seeded/test accounts).
      const employeeName = u.employee
        ? `${u.employee.firstName} ${u.employee.lastName}`.trim()
        : '';
      const displayName = employeeName || u.email;
      const roles = u.userRoles.map((r) => r.role.name);
      // Surface the most senior role so the UI can label managers vs
      // associates without a second lookup.
      const primaryRole = roles.includes('processing_manager')
        ? 'processing_manager'
        : roles.includes('processing')
          ? 'processing'
          : roles[0] ?? 'processing';
      return {
        id: u.id,
        email: u.email,
        name: displayName,
        primaryRole,
      };
    });
  }

  // -------------------------------------------------------------------------
  // CROSS-CASE TASKS / DOCUMENTS
  //
  // Side-page queries used by /processing/tasks (cross-case task list) and
  // /processing/documents (cross-case docs needing officer attention). Both
  // are scoped by user permission — view_assigned users only see their own
  // cases, view_all (managers) see everything. Each row carries enough case
  // context that the UI doesn't need a second roundtrip per row.
  // -------------------------------------------------------------------------

  async listAggregatedTasks(user: RequestUser) {
    const canViewAll = user.permissions.includes('processing.case.view_all');

    const tasks = await this.prisma.processingTask.findMany({
      where: {
        status: { in: [
          ProcessingTaskStatus.OPEN,
          ProcessingTaskStatus.IN_PROGRESS,
          ProcessingTaskStatus.BLOCKED,
        ]},
        case: {
          // Non-terminal cases only — once a case is COMPLETED/CANCELLED its
          // tasks shouldn't clutter the queue.
          stage: { notIn: [ProcessingCaseStage.COMPLETED, ProcessingCaseStage.CANCELLED] },
          ...(canViewAll ? {} : { assignedOfficerId: user.id }),
        },
      },
      include: {
        case: {
          select: {
            id: true,
            service: true,
            targetCountry: true,
            priority: true,
            stage: true,
            lead: { select: { firstName: true, lastName: true } },
            client: { select: { firstName: true, lastName: true } },
          },
        },
        assignedTo: { select: { id: true, email: true } },
      },
      // Server-side sort: URGENT first, then due date asc (nulls last), then
      // created. Frontend can re-sort on filter changes.
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });

    return { tasks };
  }

  async listAggregatedDocuments(user: RequestUser) {
    const canViewAll = user.permissions.includes('processing.case.view_all');

    // Status mix the officer cares about cross-case: actively pending review
    // (SUBMITTED, UNDER_REVIEW), client-side blockers (REJECTED — client
    // needs to re-upload), and validity risks (EXPIRING_SOON, EXPIRED).
    const items = await this.prisma.caseDocumentItem.findMany({
      where: {
        status: { in: [
          DocumentItemStatus.SUBMITTED,
          DocumentItemStatus.UNDER_REVIEW,
          DocumentItemStatus.REJECTED,
          DocumentItemStatus.EXPIRING_SOON,
          DocumentItemStatus.EXPIRED,
        ]},
        case: {
          stage: { notIn: [ProcessingCaseStage.COMPLETED, ProcessingCaseStage.CANCELLED] },
          ...(canViewAll ? {} : { assignedOfficerId: user.id }),
        },
      },
      include: {
        case: {
          select: {
            id: true,
            service: true,
            targetCountry: true,
            priority: true,
            stage: true,
            lead: { select: { firstName: true, lastName: true } },
            client: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [
        // SUBMITTED first (officer's main inbox), then UNDER_REVIEW, then the
        // rest. Within each, ascending sortOrder so checklist position is
        // preserved.
        { status: 'asc' },
        { sortOrder: 'asc' },
      ],
      take: 500,
    });

    return { items };
  }

  // -------------------------------------------------------------------------
  // REFUND / ESCALATION LANE
  //
  // Workflow doc: when the authority rejects a case, the team picks one of two
  // paths — refund the client (Finance handles the money side) or escalate to
  // APPEAL_IN_PROGRESS. We surface both REJECTED-state actions in a dedicated
  // lane so processing officers don't have to scroll through the main caseload
  // to find the rejections that need handling.
  //
  // Escalation reuses changeCaseStage (REJECTED → APPEAL_IN_PROGRESS is in
  // ALLOWED_TRANSITIONS and the gate already requires processing.case.view_all).
  // Refund needs its own marker: no stage transition fits the "we're refunding
  // out-of-band but the case stays REJECTED" semantics, so we record it as a
  // pinned ProcessingNote + an audit-log entry, and surface the most recent
  // refund-initiated timestamp on the lane list so officers can see at a
  // glance which rejections still need action.
  // -------------------------------------------------------------------------

  async listRefundLane(user: RequestUser) {
    const canViewAll = user.permissions.includes('processing.case.view_all');
    const where: Prisma.ProcessingCaseWhereInput = {
      ...(canViewAll ? {} : { assignedOfficerId: user.id }),
      OR: [
        { authorityDecision: AuthorityDecision.REJECTED },
        { stage: ProcessingCaseStage.REJECTED },
      ],
    };

    const cases = await this.prisma.processingCase.findMany({
      where,
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, phone: true } },
        client: { select: { id: true, firstName: true, lastName: true, phone: true } },
        assignedOfficer: { select: { id: true, email: true } },
      },
      orderBy: [{ authorityDecisionDate: 'desc' }, { updatedAt: 'desc' }],
    });

    if (cases.length === 0) return { cases: [] };

    // Pull the latest refund-initiated audit-log entry per case in one shot.
    // findMany + groupBy isn't worth it for what's normally a handful of rows,
    // and Prisma's distinct lets us collapse to "most recent per case" cleanly.
    const caseIds = cases.map((c) => c.id);
    const refundLogs = await this.prisma.processingAuditLog.findMany({
      where: { caseId: { in: caseIds }, action: 'case_refund_initiated' },
      orderBy: { createdAt: 'desc' },
      distinct: ['caseId'],
      select: { caseId: true, createdAt: true, actorUserId: true },
    });
    const refundByCaseId = new Map(refundLogs.map((r) => [r.caseId, r]));

    return {
      cases: cases.map((c) => {
        const refund = refundByCaseId.get(c.id);
        return {
          ...c,
          refundInitiatedAt: refund?.createdAt ?? null,
          refundInitiatedByUserId: refund?.actorUserId ?? null,
        };
      }),
    };
  }

  async markCaseForRefund(
    caseId: string,
    dto: { reason: string },
    user: RequestUser,
  ) {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);

    // Only flag refunds on cases the authority actually rejected. Without
    // this guard a refund could be marked on an active case and confuse the
    // lane / finance hand-off later.
    if (
      processingCase.authorityDecision !== AuthorityDecision.REJECTED &&
      processingCase.stage !== ProcessingCaseStage.REJECTED
    ) {
      throw new BadRequestException(
        'Refund can only be initiated on a REJECTED case',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const note = await tx.processingNote.create({
        data: {
          caseId,
          content: `Refund initiated. Reason: ${dto.reason}`,
          noteType: ProcessingNoteType.GENERAL,
          isPinned: true,
          createdByUserId: user.id,
        },
      });

      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'case_refund_initiated',
          entityType: 'processing_case',
          entityId: caseId,
          newValues: { reason: dto.reason, noteId: note.id },
        },
      });

      const c = await tx.processingCase.update({
        where: { id: caseId },
        data: { updatedByUserId: user.id },
      });

      return { ...c, refundNoteId: note.id };
    });
  }

  /**
   * Stage transition with full gate checks (Rule 2).
   * READY_FOR_SUBMISSION gate is the hardest check — enforced server-side.
   */
  async changeCaseStage(
    caseId: string,
    dto: ChangeCaseStageDto,
    user: RequestUser,
  ) {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);

    const fromStage = processingCase.stage;
    const toStage = dto.toStage;

    // CANCELLED is a special path — manager only, from any active stage
    if (toStage === ProcessingCaseStage.CANCELLED) {
      if (!user.permissions.includes('processing.case.view_all')) {
        throw new ForbiddenException('Only a processing manager can cancel a case');
      }
      if (TERMINAL_STAGES.has(fromStage)) {
        throw new BadRequestException(`Cannot cancel a case that is already ${fromStage}`);
      }
      if (!dto.cancellationReason) {
        throw new BadRequestException('Cancellation reason is required');
      }
    } else {
      // Verify the transition is in the allowed map
      const allowed = ALLOWED_TRANSITIONS[fromStage] ?? [];
      if (!allowed.includes(toStage)) {
        throw new BadRequestException(
          `Transition from ${fromStage} to ${toStage} is not allowed`,
        );
      }
    }

    // ---- Stage-specific guard checks ----

    if (
      toStage === ProcessingCaseStage.READY_FOR_SUBMISSION ||
      toStage === ProcessingCaseStage.DOCUMENTS_COMPLETE ||
      // Re-assert at the actual submission step too — a doc can expire (or its
      // attestation lapse) while the case sits in READY_FOR_SUBMISSION.
      toStage === ProcessingCaseStage.SUBMITTED
    ) {
      await this.assertDocumentsReadyForSubmission(caseId);
    }

    if (toStage === ProcessingCaseStage.SUBMITTED && !dto.submissionReference) {
      throw new BadRequestException('Submission reference is required to mark as Submitted');
    }

    if (toStage === ProcessingCaseStage.UNDER_AUTHORITY_REVIEW && !dto.authorityTrackingRef) {
      throw new BadRequestException('Authority tracking reference is required');
    }

    if (toStage === ProcessingCaseStage.REJECTED && !dto.notes) {
      throw new BadRequestException(
        'Authority rejection reason is required (provide in notes field)',
      );
    }

    if (toStage === ProcessingCaseStage.APPEAL_IN_PROGRESS) {
      if (!user.permissions.includes('processing.case.view_all')) {
        throw new ForbiddenException(
          'Filing an appeal requires manager approval (processing.case.view_all)',
        );
      }
    }

    if (toStage === ProcessingCaseStage.COMPLETED && !dto.completionNotes) {
      throw new BadRequestException('Completion notes are required');
    }

    // ---- Execute the transition ----
    const gateResult = { fromStage, toStage, checkedAt: new Date().toISOString() };

    const updated = await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.ProcessingCaseUncheckedUpdateInput = {
        stage: toStage,
        updatedByUserId: user.id,
      };

      if (toStage === ProcessingCaseStage.SUBMITTED && dto.submissionReference) {
        updateData.actualSubmissionDate = new Date();
        updateData.authorityTrackingRef = dto.submissionReference;
      }
      if (toStage === ProcessingCaseStage.UNDER_AUTHORITY_REVIEW && dto.authorityTrackingRef) {
        updateData.authorityTrackingRef = dto.authorityTrackingRef;
      }
      if (toStage === ProcessingCaseStage.APPROVED) {
        updateData.authorityDecision = AuthorityDecision.APPROVED;
        updateData.authorityDecisionDate = new Date();
      }
      if (toStage === ProcessingCaseStage.REJECTED) {
        updateData.authorityDecision = AuthorityDecision.REJECTED;
        updateData.authorityDecisionDate = new Date();
      }
      if (toStage === ProcessingCaseStage.COMPLETED) {
        updateData.completedAt = new Date();
        updateData.processingNote = dto.completionNotes ?? undefined;
      }
      if (toStage === ProcessingCaseStage.CANCELLED) {
        updateData.cancelledAt = new Date();
        updateData.cancellationReason = dto.cancellationReason ?? undefined;
      }

      const c = await tx.processingCase.update({
        where: { id: caseId },
        data: updateData,
      });

      await tx.processingCaseStageHistory.create({
        data: {
          caseId,
          fromStage,
          toStage,
          changedByUserId: user.id,
          reason: dto.reason ?? undefined,
          notes: dto.notes ?? undefined,
          gateCheckResult: gateResult,
        },
      });

      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'stage_changed',
          entityType: 'processing_case',
          entityId: caseId,
          oldValues: { stage: fromStage },
          newValues: { stage: toStage },
        },
      });

      // Keep Client.status in sync with the case's stage so admin and portal
      // dashboards reflect the summary truth without recomputing on every
      // read. ProcessingCase.stage stays the operational source.
      const mappedStatus = STAGE_TO_CLIENT_STATUS[toStage];
      if (mappedStatus && processingCase.clientId) {
        await tx.client.update({
          where: { id: processingCase.clientId },
          data: { status: mappedStatus as Prisma.ClientUpdateInput['status'] },
        });
      }

      return c;
    });

    // Determine timeline event type from target stage
    const timelineEventType =
      toStage === ProcessingCaseStage.COMPLETED
        ? TimelineEventType.PROCESSING_CASE_COMPLETED
        : toStage === ProcessingCaseStage.APPROVED || toStage === ProcessingCaseStage.REJECTED
        ? TimelineEventType.PROCESSING_DECISION_RECEIVED
        : toStage === ProcessingCaseStage.SUBMITTED
        ? TimelineEventType.PROCESSING_SUBMISSION_FILED
        : TimelineEventType.PROCESSING_STAGE_CHANGED;

    // Non-fatal — timeline failure must never undo the completed stage change.
    this.timeline.record({
      entityType: 'processing_case',
      entityId: caseId,
      leadId: processingCase.leadId ?? undefined,
      clientId: processingCase.clientId ?? undefined,
      eventType: timelineEventType,
      description: `Stage changed: ${fromStage} → ${toStage}`,
      actorUserId: user.id,
      metadata: { fromStage, toStage, reason: dto.reason },
    }).catch(() => { /* non-fatal */ });

    return updated;
  }

  // -------------------------------------------------------------------------
  // DOCUMENTS
  // -------------------------------------------------------------------------

  private static readonly ALLOWED_UPLOAD_MIMES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
  ]);

  /**
   * Officer uploads a document on behalf of a case (e.g. a government form
   * they prepared, a physical document scanned in-office).
   *
   * Permission: processing.document.upload
   * Officers may upload on any non-terminal item status.
   * Sets status → SUBMITTED so the officer can then review it normally.
   */
  async uploadOfficerDocument(
    caseId: string,
    itemId: string,
    file: Express.Multer.File,
    user: RequestUser,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);

    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { id: itemId, caseId },
      select: {
        id: true,
        status: true,
        documentName: true,
        docType: true,
        maxFileSizeMb: true,
        case: { select: { service: true } },
        versions: { select: { id: true }, orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    });
    if (!item) throw new NotFoundException('Document item not found');

    // Waived items are locked
    if (item.status === DocumentItemStatus.WAIVED) {
      throw new BadRequestException('Cannot upload to a waived document item');
    }

    // Validate MIME type
    if (!ProcessingService.ALLOWED_UPLOAD_MIMES.has(file.mimetype)) {
      throw new BadRequestException(
        `File type '${file.mimetype}' is not accepted. Allowed: PDF, JPG, PNG, HEIC.`,
      );
    }

    // Validate size against item-level cap (hard max 25 MB for officer uploads)
    const maxBytes = Math.min(item.maxFileSizeMb * 1024 * 1024, 25 * 1024 * 1024);
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `File too large. Maximum size for this document is ${item.maxFileSizeMb} MB.`,
      );
    }

    const newVersionNumber = item.versions.length + 1;

    const uploadResult = await this.storage.upload(
      file.buffer,
      file.mimetype,
      `processing/cases/${caseId}/documents/${itemId}`,
      file.originalname,
    );

    const newVersionId = await this.prisma.$transaction(async (tx) => {
      const version = await tx.clientDocumentVersion.create({
        data: {
          documentItemId: itemId,
          caseId,
          clientId: processingCase.clientId ?? undefined,
          storageKey: uploadResult.key,
          fileName: file.originalname,
          fileSizeBytes: file.size,
          mimeType: file.mimetype,
          versionNumber: newVersionNumber,
          uploadedByUserId: user.id,
          isCurrent: true,
        },
      });

      // Mark previous versions as not current
      await tx.clientDocumentVersion.updateMany({
        where: { documentItemId: itemId, id: { not: version.id } },
        data: { isCurrent: false },
      });

      await tx.caseDocumentItem.update({
        where: { id: itemId },
        data: {
          latestVersionId: version.id,
          status: DocumentItemStatus.SUBMITTED,
          updatedAt: new Date(),
        },
      });

      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'officer_document_uploaded',
          entityType: 'case_document_item',
          entityId: itemId,
          newValues: {
            fileName: file.originalname,
            fileSizeBytes: file.size,
            versionNumber: newVersionNumber,
            storageKey: '[redacted]',
          },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      return version.id;
    });

    this.timeline.record({
      entityType: 'case_document_item',
      entityId: itemId,
      clientId: processingCase.clientId ?? undefined,
      eventType: TimelineEventType.PROCESSING_DOCUMENT_SUBMITTED,
      description: `Officer uploaded document: ${item.documentName} (v${newVersionNumber})`,
      actorUserId: user.id,
      metadata: { caseId, itemId, versionNumber: newVersionNumber },
    }).catch(() => { /* non-fatal */ });

    // Phase D2 — kick off AI assessment (OCR + validation, possible guarded
    // auto-approve). Fire-and-forget; enqueue swallows its own errors so a
    // queue hiccup never fails the upload.
    void this.documentAi.enqueue(newVersionId);

    // Phase 2 — bundle-split safety net: if the officer scanned several
    // documents into one PDF and filed it under a single slot, surface the
    // extras as triage rows. Best-effort + non-blocking; excludeSlotDocType
    // avoids re-triaging the document they meant for this slot.
    void this.documentIntake.explodeBundleToInbound({
      caseId,
      service: item.case?.service ?? null,
      bytes: file.buffer,
      mime: file.mimetype,
      baseName: file.originalname,
      source: InboundDocumentSource.MANUAL,
      excludeSlotDocType: item.docType ?? null,
    });

    return {
      success: true,
      versionNumber: newVersionNumber,
      fileName: file.originalname,
      status: DocumentItemStatus.SUBMITTED,
    };
  }

  async getDocumentChecklist(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    return this.prisma.caseDocumentItem.findMany({
      where: { caseId },
      include: {
        latestVersion: {
          select: {
            id: true,
            fileName: true,
            fileSizeBytes: true,
            mimeType: true,
            versionNumber: true,
            virusScanStatus: true,
            uploadedAt: true,
          },
        },
        reviewDecisions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { reviewedBy: { select: { id: true, email: true } } },
        },
        // Phase D3 — the latest AI assessment (≈ the current version's, since
        // each upload triggers a fresh one) so the UI can show verdict chips.
        aiAssessments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            detectedDocType: true,
            expectedDocType: true,
            confidence: true,
            checks: true,
            suggestedDecision: true,
            reasonCodes: true,
            detectedAuthorities: true,
            detectedLanguage: true,
            autoApproved: true,
            ocrTier: true,
            errorMessage: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ criticality: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async addDocumentItem(caseId: string, dto: AddDocumentItemDto, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    return this.prisma.caseDocumentItem.create({
      data: {
        caseId,
        documentName: dto.documentName,
        description: dto.description ?? undefined,
        criticality: dto.criticality,
        expectedFormats: dto.expectedFormats ?? ['PDF'],
        maxFileSizeMb: dto.maxFileSizeMb ?? 10,
        validityRule: dto.validityRule,
        validityMonths: dto.validityMonths ?? undefined,
        isAddedManually: true,
      },
    });
  }

  async waiveDocumentItem(
    caseId: string,
    itemId: string,
    dto: WaiveDocumentItemDto,
    user: RequestUser,
  ) {
    await this.assertCaseAccessById(caseId, user);
    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { id: itemId, caseId },
    });
    if (!item) throw new NotFoundException('Document item not found');

    // CRITICAL waivers require manager approval (processing.case.view_all)
    // REQUIRED waivers require explicit waive permission (processing.document.waive)
    if (item.criticality === DocumentCriticality.CRITICAL) {
      if (!user.permissions.includes('processing.case.view_all')) {
        throw new ForbiddenException(
          'Waiving a CRITICAL document requires manager approval (processing.case.view_all)',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.caseDocumentItem.update({
        where: { id: itemId },
        data: {
          status: DocumentItemStatus.WAIVED,
          waivedByUserId: user.id,
          waiveReason: dto.waiveReason,
        },
      });
      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'document_waived',
          entityType: 'case_document_item',
          entityId: itemId,
          oldValues: { status: item.status },
          newValues: { status: DocumentItemStatus.WAIVED, waiveReason: dto.waiveReason },
        },
      });
      return updated;
    });
  }

  async requestDocument(
    caseId: string,
    itemId: string,
    dto: RequestDocumentDto,
    user: RequestUser,
  ) {
    await this.assertCaseAccessById(caseId, user);
    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { id: itemId, caseId },
    });
    if (!item) throw new NotFoundException('Document item not found');

    return this.prisma.caseDocumentItem.update({
      where: { id: itemId },
      data: { lastRequestedAt: new Date() },
    });
  }

  async getDocumentVersions(caseId: string, itemId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    return this.prisma.clientDocumentVersion.findMany({
      where: { documentItemId: itemId, caseId },
      orderBy: { versionNumber: 'desc' },
    });
  }

  /**
   * Rule 3: Signed URLs only. Never return raw storage key in response.
   * Logs access to document_access_logs.
   */
  async getSignedDocumentUrl(
    caseId: string,
    itemId: string,
    user: RequestUser,
    ipAddress?: string,
    userAgent?: string,
  ) {
    await this.assertCaseAccessById(caseId, user);

    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { id: itemId, caseId },
      include: { latestVersion: true },
    });
    if (!item || !item.latestVersion) {
      throw new NotFoundException('No uploaded document found for this item');
    }

    const version = item.latestVersion;
    // AV gate: block only a genuinely INFECTED file. No inline virus scanner is
    // wired yet, so every upload sits at PENDING — gating on `!== CLEAN` would
    // block every document from ever being viewed/reviewed. When a real scanner
    // is added it will mark INFECTED and this gate begins enforcing for real.
    if (version.virusScanStatus === 'INFECTED') {
      throw new BadRequestException(
        'Document failed the virus scan and cannot be opened',
      );
    }

    const signedUrl = await this.storage.getSignedUrl(version.storageKey);

    // Log access (Rule 7: audit everything)
    await this.prisma.documentAccessLog.create({
      data: {
        documentVersionId: version.id,
        accessedByUserId: user.id,
        accessType: 'VIEW',
        ipAddress: ipAddress ?? undefined,
        userAgent: userAgent ?? undefined,
        signedUrlIssuedAt: new Date(),
      },
    });

    return { url: signedUrl, expiresIn: '15 minutes', fileName: version.fileName };
  }

  /**
   * Rule 4: Document review is append-only. Accept/Reject always creates a new row.
   */
  async reviewDocument(
    caseId: string,
    itemId: string,
    dto: ReviewDocumentDto,
    user: RequestUser,
  ) {
    await this.assertCaseAccessById(caseId, user);

    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { id: itemId, caseId },
      include: { latestVersion: true },
    });
    if (!item) throw new NotFoundException('Document item not found');
    if (!item.latestVersion) throw new BadRequestException('No document uploaded to review');
    // Only block a genuinely INFECTED file (see note in getDocumentSignedUrl) —
    // no inline AV scanner is wired yet, so a PENDING scan must not block review.
    if (item.latestVersion.virusScanStatus === 'INFECTED') {
      throw new BadRequestException('Document failed the virus scan — cannot review');
    }

    if (dto.decision === 'REJECTED') {
      // A rejection must carry a reason the client can act on — accept EITHER a
      // structured reason code OR a free-text note (the review UI provides the
      // note). Requiring codes-only made every reject fail since the UI never
      // sent codes.
      const hasCode = !!dto.rejectionReasonCodes && dto.rejectionReasonCodes.length > 0;
      const hasNote = !!dto.rejectionNote && dto.rejectionNote.trim().length > 0;
      if (!hasCode && !hasNote) {
        throw new BadRequestException('A rejection reason or note is required');
      }
    }

    const newStatus =
      dto.decision === 'ACCEPTED'
        ? DocumentItemStatus.ACCEPTED
        : DocumentItemStatus.REJECTED;

    // Phase 4b — on accept, derive the document's expiry from the latest AI
    // assessment's extracted fields + the slot's validity rule, so the
    // submission gate (which blocks on validityExpiryDate < now) actually bites.
    // P4g: also hoist extracted + clientId so the CRM auto-fill can run
    //      after the transaction without a second round-trip.
    let acceptedExpiry: Date | null = null;
    let extracted: Record<string, unknown> | null = null;
    let caseClientId: string | null = null;
    if (dto.decision === 'ACCEPTED') {
      const assess = await this.prisma.documentAiAssessment.findFirst({
        where: { caseId, versionId: item.latestVersionId! },
        orderBy: { createdAt: 'desc' },
        select: { extracted: true },
      });
      extracted =
        assess?.extracted && typeof assess.extracted === 'object' && !Array.isArray(assess.extracted)
          ? (assess.extracted as Record<string, unknown>)
          : null;
      acceptedExpiry = computeValidityExpiry(
        { validityRule: item.validityRule, validityMonths: item.validityMonths },
        extracted,
      );
      // Fetch clientId for the CRM auto-fill that runs post-transaction.
      const pc = await this.prisma.processingCase.findUnique({
        where: { id: caseId },
        select: { clientId: true },
      });
      caseClientId = pc?.clientId ?? null;
    }

    await this.prisma.$transaction(async (tx) => {
      // Append-only decision record
      await tx.documentReviewDecision.create({
        data: {
          documentItemId: itemId,
          versionId: item.latestVersionId!,
          decision: dto.decision,
          rejectionReasonCodes: dto.rejectionReasonCodes ?? [],
          rejectionNote: dto.rejectionNote ?? undefined,
          reviewedByUserId: user.id,
        },
      });

      // Update document item status (+ derived expiry on accept)
      await tx.caseDocumentItem.update({
        where: { id: itemId },
        data: {
          status: newStatus,
          ...(dto.decision === 'ACCEPTED' ? { validityExpiryDate: acceptedExpiry } : {}),
        },
      });

      // Audit
      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: dto.decision === 'ACCEPTED' ? 'document_accepted' : 'document_rejected',
          entityType: 'case_document_item',
          entityId: itemId,
          oldValues: { status: item.status },
          newValues: {
            status: newStatus,
            decision: dto.decision,
            rejectionReasonCodes: dto.rejectionReasonCodes,
          },
        },
      });
    });

    // P4g: CRM auto-fill — non-fatal, best-effort after the transaction lands.
    // Copies extracted identity fields (name, DOB, passport/CNIC) into Client
    // record for empty fields only. Failure here never undoes the doc acceptance.
    if (dto.decision === 'ACCEPTED' && caseClientId && extracted && item.docType) {
      void applyCrmAutoFill(
        this.prisma,
        caseClientId,
        item.docType,
        extracted,
        caseId,
        user.id,
      ).catch((e: Error) => this.logger.warn(`P4g auto-fill failed: ${e.message}`));
    }

    // Non-fatal — timeline failure must never undo the completed document review.
    this.timeline.record({
      entityType: 'case_document_item',
      entityId: itemId,
      clientId: undefined,
      eventType:
        dto.decision === 'ACCEPTED'
          ? TimelineEventType.PROCESSING_DOCUMENT_ACCEPTED
          : TimelineEventType.PROCESSING_DOCUMENT_REJECTED,
      description:
        dto.decision === 'ACCEPTED'
          ? `Document accepted: ${item.documentName}`
          : `Document rejected: ${item.documentName} — ${(dto.rejectionReasonCodes ?? []).join(', ')}`,
      actorUserId: user.id,
      metadata: { caseId, itemId, decision: dto.decision },
    }).catch(() => { /* non-fatal */ });

    // Return the full updated item (same shape as the checklist) so the UI
    // refreshes the row — status, latest version, and AI assessment chips.
    return this.prisma.caseDocumentItem.findUnique({
      where: { id: itemId },
      include: {
        latestVersion: {
          select: {
            id: true,
            fileName: true,
            fileSizeBytes: true,
            mimeType: true,
            versionNumber: true,
            virusScanStatus: true,
            uploadedAt: true,
          },
        },
        reviewDecisions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { reviewedBy: { select: { id: true, email: true } } },
        },
        aiAssessments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            detectedDocType: true,
            expectedDocType: true,
            confidence: true,
            checks: true,
            suggestedDecision: true,
            reasonCodes: true,
            detectedAuthorities: true,
            detectedLanguage: true,
            autoApproved: true,
            ocrTier: true,
            errorMessage: true,
            createdAt: true,
          },
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // INBOUND DOCUMENT INTAKE (Phase E)
  // Documents that arrive via WhatsApp/email/portal land as PENDING
  // InboundDocuments for triage. An associate files one into a checklist slot
  // (creating a ClientDocumentVersion → full AI assessment) or discards it.
  // -------------------------------------------------------------------------

  async listInboundDocuments(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const docs = await this.prisma.inboundDocument.findMany({
      where: { caseId, status: InboundDocumentStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    const itemIds = [
      ...new Set(docs.map((d) => d.suggestedItemId).filter((x): x is string => !!x)),
    ];
    const items = itemIds.length
      ? await this.prisma.caseDocumentItem.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, documentName: true },
        })
      : [];
    const nameById = new Map(items.map((i) => [i.id, i.documentName]));
    return docs.map((d) => ({
      ...d,
      suggestedItemName: d.suggestedItemId ? nameById.get(d.suggestedItemId) ?? null : null,
    }));
  }

  /**
   * Short-lived signed URL to PREVIEW an inbound (un-triaged) document in the
   * Split Reviewer. Inbound docs aren't ClientDocumentVersions yet, so there's
   * no virus-scan gate / access-log row — just the signed URL for its key.
   */
  async getInboundDocumentSignedUrl(caseId: string, inboundId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const inbound = await this.prisma.inboundDocument.findFirst({
      where: { id: inboundId, caseId },
      select: { id: true, storageKey: true, fileName: true, mimeType: true },
    });
    if (!inbound) throw new NotFoundException('Inbound document not found');
    const url = await this.storage.getSignedUrl(inbound.storageKey);
    return {
      url,
      fileName: inbound.fileName,
      mimeType: inbound.mimeType,
      expiresIn: '15 minutes',
    };
  }

  /**
   * Phase 4 — case-level identity reconciliation. Lines up the identity values
   * the parser extracted from every current document against each other AND the
   * CRM client record, surfacing agreement vs conflict per field. Read-only +
   * flag-only: it never mutates a document or rejects anything (per the locked
   * rule, transliteration variance means a human always decides on identity).
   */
  async getIdentityReconciliation(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);

    const c = await this.prisma.processingCase.findUnique({
      where: { id: caseId },
      select: {
        client: {
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            passportNumber: true,
            nationalId: true,
            cnic: true,
          },
        },
      },
    });
    const client = c?.client ?? null;

    const items = await this.prisma.caseDocumentItem.findMany({
      where: { caseId, latestVersionId: { not: null } },
      select: { id: true, documentName: true, docType: true, latestVersionId: true },
    });
    const versionIds = items
      .map((i) => i.latestVersionId)
      .filter((x): x is string => !!x);
    const assessments = versionIds.length
      ? await this.prisma.documentAiAssessment.findMany({
          where: { caseId, versionId: { in: versionIds } },
          orderBy: { createdAt: 'desc' },
          select: { versionId: true, detectedDocType: true, extracted: true },
        })
      : [];

    // Most-recent assessment per version (first wins — ordered desc).
    const byVersion = new Map<string, { extracted: unknown; detectedDocType: string | null }>();
    for (const a of assessments) {
      if (!byVersion.has(a.versionId)) {
        byVersion.set(a.versionId, { extracted: a.extracted, detectedDocType: a.detectedDocType });
      }
    }

    const docs = items
      .filter((i) => i.latestVersionId && byVersion.has(i.latestVersionId))
      .map((i) => {
        const a = byVersion.get(i.latestVersionId as string)!;
        const extracted =
          a.extracted && typeof a.extracted === 'object' && !Array.isArray(a.extracted)
            ? (a.extracted as Record<string, unknown>)
            : null;
        return {
          itemId: i.id,
          documentName: i.documentName,
          docType: i.docType ?? a.detectedDocType ?? null,
          extracted,
        };
      });

    return reconcileIdentity(
      {
        firstName: client?.firstName ?? null,
        lastName: client?.lastName ?? null,
        dateOfBirth: client?.dateOfBirth ?? null,
        passportNumber: client?.passportNumber ?? null,
        nationalId: client?.nationalId ?? null,
        cnic: client?.cnic ?? null,
      },
      docs,
    );
  }

  /**
   * Phase 4c — set/override a document's attestation state for THIS case.
   * Backs the associate "edit this client's attestation needs" controls
   * (mark attested / waive / not-required / pending) and per-client chain
   * adjustment. Per-case override of the program default; audit-logged.
   */
  async updateDocumentAttestation(
    caseId: string,
    itemId: string,
    dto: UpdateAttestationDto,
    user: RequestUser,
  ) {
    await this.assertCaseAccessById(caseId, user);
    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { id: itemId, caseId },
      select: { id: true, attestationStatus: true, attestationChain: true },
    });
    if (!item) throw new NotFoundException('Document item not found');

    await this.prisma.caseDocumentItem.update({
      where: { id: itemId },
      data: {
        attestationStatus: dto.status,
        ...(dto.chain !== undefined ? { attestationChain: dto.chain.trim() || null } : {}),
      },
    });

    await this.prisma.processingAuditLog
      .create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'attestation_updated',
          entityType: 'case_document_item',
          entityId: itemId,
          oldValues: {
            attestationStatus: item.attestationStatus,
            attestationChain: item.attestationChain,
          },
          newValues: {
            attestationStatus: dto.status,
            ...(dto.chain !== undefined ? { attestationChain: dto.chain } : {}),
          },
        },
      })
      .catch(() => {
        /* audit best-effort */
      });

    return { success: true, attestationStatus: dto.status };
  }

  async fileInboundDocument(
    caseId: string,
    inboundId: string,
    itemId: string,
    user: RequestUser,
  ) {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);

    const inbound = await this.prisma.inboundDocument.findFirst({
      where: { id: inboundId, caseId },
    });
    if (!inbound) throw new NotFoundException('Inbound document not found');
    if (inbound.status !== InboundDocumentStatus.PENDING) {
      throw new BadRequestException('Inbound document has already been triaged');
    }

    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { id: itemId, caseId },
      select: {
        id: true,
        status: true,
        versions: { select: { id: true }, orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    });
    if (!item) throw new NotFoundException('Target document item not found');
    if (item.status === DocumentItemStatus.WAIVED) {
      throw new BadRequestException('Cannot file into a waived document item');
    }

    const newVersionNumber = item.versions.length + 1;

    // The inbound file already lives in processing storage (intake stored it),
    // so the new version reuses the same storageKey — no re-upload.
    const newVersionId = await this.prisma.$transaction(async (tx) => {
      const version = await tx.clientDocumentVersion.create({
        data: {
          documentItemId: itemId,
          caseId,
          clientId: processingCase.clientId ?? undefined,
          storageKey: inbound.storageKey,
          fileName: inbound.fileName,
          fileSizeBytes: inbound.fileSizeBytes ?? 0,
          mimeType: inbound.mimeType ?? 'application/octet-stream',
          versionNumber: newVersionNumber,
          uploadedByUserId: user.id,
          isCurrent: true,
        },
      });
      await tx.clientDocumentVersion.updateMany({
        where: { documentItemId: itemId, id: { not: version.id } },
        data: { isCurrent: false },
      });
      await tx.caseDocumentItem.update({
        where: { id: itemId },
        data: {
          latestVersionId: version.id,
          status: DocumentItemStatus.SUBMITTED,
          updatedAt: new Date(),
        },
      });
      await tx.inboundDocument.update({
        where: { id: inboundId },
        data: {
          status: InboundDocumentStatus.FILED,
          filedItemId: itemId,
          filedVersionId: version.id,
          filedByUserId: user.id,
          triagedAt: new Date(),
        },
      });
      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'inbound_document_filed',
          entityType: 'case_document_item',
          entityId: itemId,
          newValues: {
            inboundDocumentId: inboundId,
            source: inbound.source,
            versionNumber: newVersionNumber,
          },
        },
      });
      return version.id;
    });

    // Run the full assessment against the chosen item's requirements.
    void this.documentAi.enqueue(newVersionId);

    return { success: true, versionNumber: newVersionNumber, itemId };
  }

  async discardInboundDocument(caseId: string, inboundId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const inbound = await this.prisma.inboundDocument.findFirst({
      where: { id: inboundId, caseId },
    });
    if (!inbound) throw new NotFoundException('Inbound document not found');
    if (inbound.status !== InboundDocumentStatus.PENDING) {
      throw new BadRequestException('Inbound document has already been triaged');
    }
    await this.prisma.inboundDocument.update({
      where: { id: inboundId },
      data: {
        status: InboundDocumentStatus.DISCARDED,
        filedByUserId: user.id,
        triagedAt: new Date(),
      },
    });
    await this.prisma.processingAuditLog.create({
      data: {
        caseId,
        actorUserId: user.id,
        action: 'inbound_document_discarded',
        entityType: 'inbound_document',
        entityId: inboundId,
        newValues: { source: inbound.source },
      },
    });
    return { success: true };
  }

  /**
   * Compose a "documents needed" message from the still-open checklist items
   * and send it to the client over WhatsApp (reusing the same outbound path
   * as sendCommunication). Returns the list + any delivery warning.
   */
  async requestMissingDocuments(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const pendingStatuses: DocumentItemStatus[] = [
      DocumentItemStatus.NOT_SUBMITTED,
      DocumentItemStatus.REJECTED,
      DocumentItemStatus.EXPIRED,
      DocumentItemStatus.EXPIRING_SOON,
    ];
    const missing = await this.prisma.caseDocumentItem.findMany({
      where: { caseId, status: { in: pendingStatuses } },
      orderBy: { sortOrder: 'asc' },
      select: { documentName: true },
    });
    if (missing.length === 0) {
      return { success: true, missingCount: 0, requested: [], warning: null };
    }

    const lines = missing.map((m, i) => `${i + 1}. ${m.documentName}`).join('\n');
    const body = this.composeWhatsAppBody(
      'Documents needed',
      `To proceed with your application we still need the following document(s):\n\n${lines}\n\nPlease reply here on WhatsApp with a clear photo or PDF of each. Thank you.`,
    );

    const comm = await this.prisma.caseCommunication.create({
      data: {
        caseId,
        direction: 'OFFICER_TO_CLIENT',
        messageType: 'GENERAL_UPDATE',
        subject: 'Documents needed',
        content: body,
        channelsSent: ['WHATSAPP'],
        sentByUserId: user.id,
      },
    });

    let warning: string | null = null;
    const result = await this.enqueueWhatsAppForCase({
      caseId,
      actorUserId: user.id,
      body,
    });
    if (result.ok) {
      await this.prisma.caseCommunication.update({
        where: { id: comm.id },
        data: { whatsappMessageId: result.messageId },
      });
    } else {
      warning = `WhatsApp send skipped: ${result.reason}`;
    }

    await this.prisma.processingAuditLog.create({
      data: {
        caseId,
        actorUserId: user.id,
        action: 'request_missing_documents',
        entityType: 'processing_case',
        entityId: caseId,
        newValues: { missingCount: missing.length },
      },
    });

    return {
      success: true,
      missingCount: missing.length,
      requested: missing.map((m) => m.documentName),
      warning,
    };
  }

  // -------------------------------------------------------------------------
  // CHECKLIST TEMPLATES
  // -------------------------------------------------------------------------

  async listTemplates(service?: string, targetCountry?: string) {
    return this.prisma.documentRequirementTemplate.findMany({
      where: {
        isActive: true,
        ...(service ? { service } : {}),
        ...(targetCountry ? { targetCountry } : {}),
      },
      orderBy: [{ service: 'asc' }, { targetCountry: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async createTemplate(dto: CreateDocumentTemplateDto, user: RequestUser) {
    return this.prisma.documentRequirementTemplate.create({
      data: {
        service: dto.service,
        targetCountry: dto.targetCountry,
        documentName: dto.documentName,
        description: dto.description ?? undefined,
        instructions: dto.instructions ?? undefined,
        criticality: dto.criticality,
        conditionRule: dto.conditionRule as Prisma.InputJsonValue ?? Prisma.JsonNull,
        expectedFormats: dto.expectedFormats ?? ['PDF'],
        maxFileSizeMb: dto.maxFileSizeMb ?? 10,
        validityRule: dto.validityRule,
        validityMonths: dto.validityMonths ?? undefined,
        validityBufferDays: dto.validityBufferDays ?? 30,
        guidanceUrl: dto.guidanceUrl ?? undefined,
        sortOrder: dto.sortOrder ?? 0,
        createdByUserId: user.id,
      },
    });
  }

  async updateTemplate(id: string, dto: UpdateDocumentTemplateDto) {
    return this.prisma.documentRequirementTemplate.update({
      where: { id },
      data: {
        ...(dto.documentName !== undefined ? { documentName: dto.documentName } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.instructions !== undefined ? { instructions: dto.instructions } : {}),
        ...(dto.criticality !== undefined ? { criticality: dto.criticality } : {}),
        ...(dto.conditionRule !== undefined
          ? { conditionRule: dto.conditionRule as Prisma.InputJsonValue }
          : {}),
        ...(dto.expectedFormats !== undefined ? { expectedFormats: dto.expectedFormats } : {}),
        ...(dto.maxFileSizeMb !== undefined ? { maxFileSizeMb: dto.maxFileSizeMb } : {}),
        ...(dto.validityRule !== undefined ? { validityRule: dto.validityRule } : {}),
        ...(dto.validityMonths !== undefined ? { validityMonths: dto.validityMonths } : {}),
        ...(dto.validityBufferDays !== undefined
          ? { validityBufferDays: dto.validityBufferDays }
          : {}),
        ...(dto.guidanceUrl !== undefined ? { guidanceUrl: dto.guidanceUrl } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  async deactivateTemplate(id: string) {
    return this.prisma.documentRequirementTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // -------------------------------------------------------------------------
  // NOTES
  // -------------------------------------------------------------------------

  async getNotes(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const canViewManagerOnly = user.permissions.includes('processing.note.view_all');
    return this.prisma.processingNote.findMany({
      where: {
        caseId,
        ...(!canViewManagerOnly
          ? { noteType: { not: ProcessingNoteType.MANAGER_ONLY } }
          : {}),
      },
      include: {
        createdBy: { select: { id: true, email: true } },
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createNote(caseId: string, dto: CreateProcessingNoteDto, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const note = await this.prisma.processingNote.create({
      data: {
        caseId,
        content: dto.content,
        noteType: dto.noteType ?? ProcessingNoteType.GENERAL,
        mentions: dto.mentions ?? [],
        createdByUserId: user.id,
      },
    });

    await this.prisma.processingAuditLog.create({
      data: {
        caseId,
        actorUserId: user.id,
        action: 'note_added',
        entityType: 'processing_note',
        entityId: note.id,
        newValues: { noteType: note.noteType },
      },
    });

    return note;
  }

  async toggleNotePin(caseId: string, noteId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const note = await this.prisma.processingNote.findFirst({
      where: { id: noteId, caseId },
    });
    if (!note) throw new NotFoundException('Note not found');
    return this.prisma.processingNote.update({
      where: { id: noteId },
      data: { isPinned: !note.isPinned },
    });
  }

  // -------------------------------------------------------------------------
  // CASE MILESTONES
  //
  // Per-case-type progress checklist seeded at acknowledge time. Associate
  // ticks/un-ticks; manager can add ad-hoc milestones. Independent from the
  // gated stage machine.
  // -------------------------------------------------------------------------

  async listCaseMilestones(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    return this.prisma.caseMilestone.findMany({
      where: { caseId },
      include: { completedBy: { select: { id: true, email: true } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createCaseMilestone(
    caseId: string,
    dto: { title: string; description?: string; sortOrder?: number },
    user: RequestUser,
  ) {
    await this.assertCaseAccessById(caseId, user);
    // Default sortOrder = end of list
    const sortOrder = dto.sortOrder
      ?? ((await this.prisma.caseMilestone.count({ where: { caseId } })) + 1);
    const milestone = await this.prisma.caseMilestone.create({
      data: {
        caseId,
        title: dto.title,
        description: dto.description ?? null,
        sortOrder,
      },
    });
    await this.prisma.processingAuditLog.create({
      data: {
        caseId,
        actorUserId: user.id,
        action: 'milestone_added',
        entityType: 'case_milestone',
        entityId: milestone.id,
        newValues: { title: milestone.title },
      },
    });
    return milestone;
  }

  async completeMilestone(caseId: string, milestoneId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const milestone = await this.prisma.caseMilestone.findFirst({
      where: { id: milestoneId, caseId },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');
    if (milestone.completedAt) {
      // Already complete — return as-is. Idempotent.
      return milestone;
    }
    const updated = await this.prisma.caseMilestone.update({
      where: { id: milestoneId },
      data: { completedAt: new Date(), completedByUserId: user.id },
      include: { completedBy: { select: { id: true, email: true } } },
    });
    await this.prisma.processingAuditLog.create({
      data: {
        caseId,
        actorUserId: user.id,
        action: 'milestone_completed',
        entityType: 'case_milestone',
        entityId: milestoneId,
        newValues: { title: milestone.title },
      },
    });
    // Non-fatal timeline record — surface milestone completion alongside
    // stage changes and other case events.
    this.timeline.record({
      entityType: 'processing_case',
      entityId: caseId,
      eventType: TimelineEventType.PROCESSING_STAGE_CHANGED,
      description: `Milestone completed: ${milestone.title}`,
      actorUserId: user.id,
      metadata: { milestoneId, milestoneTitle: milestone.title },
    }).catch(() => { /* non-fatal */ });
    return updated;
  }

  async uncompleteMilestone(caseId: string, milestoneId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const milestone = await this.prisma.caseMilestone.findFirst({
      where: { id: milestoneId, caseId },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');
    if (!milestone.completedAt) {
      return milestone;
    }
    const updated = await this.prisma.caseMilestone.update({
      where: { id: milestoneId },
      data: { completedAt: null, completedByUserId: null },
      include: { completedBy: { select: { id: true, email: true } } },
    });
    await this.prisma.processingAuditLog.create({
      data: {
        caseId,
        actorUserId: user.id,
        action: 'milestone_uncompleted',
        entityType: 'case_milestone',
        entityId: milestoneId,
        oldValues: {
          completedAt: milestone.completedAt,
          completedByUserId: milestone.completedByUserId,
        },
      },
    });
    return updated;
  }

  // -------------------------------------------------------------------------
  // TASKS
  // -------------------------------------------------------------------------

  async getTasks(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    return this.prisma.processingTask.findMany({
      where: { caseId },
      include: {
        assignedTo: { select: { id: true, email: true } },
        createdBy: { select: { id: true, email: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    });
  }

  async createTask(caseId: string, dto: CreateProcessingTaskDto, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    return this.prisma.processingTask.create({
      data: {
        caseId,
        title: dto.title,
        description: dto.description ?? undefined,
        assignedToUserId: dto.assignedToUserId ?? undefined,
        createdByUserId: user.id,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        priority: dto.priority ?? 'NORMAL',
      },
    });
  }

  async updateTask(
    caseId: string,
    taskId: string,
    dto: UpdateProcessingTaskDto,
    user: RequestUser,
  ) {
    await this.assertCaseAccessById(caseId, user);
    const task = await this.prisma.processingTask.findFirst({
      where: { id: taskId, caseId },
    });
    if (!task) throw new NotFoundException('Task not found');

    const completedNow =
      dto.status === ProcessingTaskStatus.DONE && task.status !== ProcessingTaskStatus.DONE;

    return this.prisma.processingTask.update({
      where: { id: taskId },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.assignedToUserId !== undefined
          ? { assignedToUserId: dto.assignedToUserId }
          : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
        ...(completedNow
          ? { completedAt: new Date(), completedByUserId: user.id }
          : {}),
      },
    });
  }

  // -------------------------------------------------------------------------
  // COMMUNICATIONS
  // -------------------------------------------------------------------------

  async getCommunications(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    return this.prisma.caseCommunication.findMany({
      where: { caseId },
      include: { sentBy: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendCommunication(
    caseId: string,
    dto: SendCommunicationDto,
    user: RequestUser,
  ) {
    await this.assertCaseAccessById(caseId, user);

    let comm = await this.prisma.caseCommunication.create({
      data: {
        caseId,
        direction: 'OFFICER_TO_CLIENT',
        messageType: 'GENERAL_UPDATE',
        subject: dto.subject,
        content: dto.content,
        channelsSent: dto.channelsSent,
        sentByUserId: user.id,
      },
    });

    await this.prisma.processingAuditLog.create({
      data: {
        caseId,
        actorUserId: user.id,
        action: 'message_sent',
        entityType: 'case_communication',
        entityId: comm.id,
        newValues: { channels: dto.channelsSent },
      },
    });

    // If the officer ticked WhatsApp, actually put a message on the wire.
    // Best-effort: never throw — if no thread exists or the 24h window has
    // expired we record that as a delivery warning so the UI can surface
    // "WhatsApp send skipped: …" without burying the rest of the channels.
    const deliveryWarnings: string[] = [];
    const channelsUpper = dto.channelsSent.map((c) => c.toUpperCase());
    if (channelsUpper.includes('WHATSAPP')) {
      try {
        const result = await this.enqueueWhatsAppForCase({
          caseId,
          actorUserId: user.id,
          body: this.composeWhatsAppBody(dto.subject, dto.content),
        });
        if (result.ok) {
          comm = await this.prisma.caseCommunication.update({
            where: { id: comm.id },
            data: { whatsappMessageId: result.messageId },
          });
        } else {
          deliveryWarnings.push(`WhatsApp send skipped: ${result.reason}`);
        }
      } catch (err) {
        // We deliberately swallow — the CaseCommunication row already
        // landed and the audit log captured the attempt. Logging keeps
        // the failure visible without breaking the request.
        this.logger.error(
          { err, caseId, commId: comm.id },
          'sendCommunication: WhatsApp enqueue threw',
        );
        deliveryWarnings.push('WhatsApp send skipped: internal error');
      }
    }

    return { ...comm, deliveryWarnings };
  }

  // -------------------------------------------------------------------------
  // CASE WHATSAPP CHAT (Phase E) — the live two-way thread for the case's
  // client, scoped by case access (no WhatsApp-inbox permission needed; the
  // thread lookup is keyed off this case's lead/client).
  // -------------------------------------------------------------------------

  async getCaseWhatsApp(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const processingCase = await this.prisma.processingCase.findUnique({
      where: { id: caseId },
      select: { leadId: true, clientId: true },
    });
    if (!processingCase) throw new NotFoundException('Case not found');

    const thread = await this.prisma.whatsAppThread.findFirst({
      where: {
        OR: [
          ...(processingCase.leadId ? [{ leadId: processingCase.leadId }] : []),
          ...(processingCase.clientId ? [{ clientId: processingCase.clientId }] : []),
        ],
      },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true, windowExpiresAt: true },
    });
    if (!thread) {
      return { threadId: null, windowExpiresAt: null, windowOpen: false, messages: [] };
    }

    const messages = await this.prisma.whatsAppMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        direction: true,
        type: true,
        body: true,
        mediaUrl: true,
        mediaMimeType: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      threadId: thread.id,
      windowExpiresAt: thread.windowExpiresAt,
      windowOpen: !!thread.windowExpiresAt && thread.windowExpiresAt.getTime() > Date.now(),
      messages: messages.reverse(), // oldest-first for chat display
    };
  }

  /**
   * P5-nudges: system-initiated WhatsApp send (no user context).
   * Used by ClientNudgeService for cron-driven reminders.
   * `actorUserId` defaults to the assigned officer; pass '' to send as unattributed.
   * Returns same {ok, reason?} shape as enqueueWhatsAppForCase.
   */
  async sendNudgeWhatsApp(
    caseId: string,
    body: string,
    actorUserId = '',
  ): Promise<{ ok: boolean; messageId?: string; reason?: string }> {
    const text = (body ?? '').trim();
    if (!text) return { ok: false, reason: 'empty body' };
    return this.enqueueWhatsAppForCase({ caseId, actorUserId, body: text });
  }

  async sendCaseWhatsApp(caseId: string, body: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('Message body is required');
    const result = await this.enqueueWhatsAppForCase({
      caseId,
      actorUserId: user.id,
      body: text,
    });
    return result.ok
      ? { success: true, messageId: result.messageId }
      : { success: false, reason: result.reason };
  }

  /**
   * Combine the subject + body into the WhatsApp message text. Subject lives
   * at the top in *asterisks* (WA bold) so the client can scan it like an
   * email subject before reading the body. Empty/whitespace subject is
   * dropped silently.
   */
  private composeWhatsAppBody(subject: string, content: string): string {
    const trimmedSubject = subject.trim();
    const trimmedContent = content.trim();
    if (!trimmedSubject) return trimmedContent;
    return `*${trimmedSubject}*\n\n${trimmedContent}`;
  }

  /**
   * Look up the case's WhatsApp thread (by lead first, then client — they're
   * the same once Lead→Client conversion has happened) and enqueue a real
   * outbound message. Mirrors WhatsAppAppointmentNotifierService so delivery
   * status, retries, and realtime fanout all behave identically.
   *
   * Returns { ok: true, messageId } on enqueue, or { ok: false, reason } if
   * the message can't be sent — the caller decides what to do with the
   * skip reason (typically: record it as a deliveryWarning).
   */
  private async enqueueWhatsAppForCase(input: {
    caseId: string;
    actorUserId: string;
    body: string;
  }): Promise<{ ok: true; messageId: string } | { ok: false; reason: string }> {
    const body = input.body.trim();
    if (!body) return { ok: false, reason: 'empty message body' };

    const processingCase = await this.prisma.processingCase.findUnique({
      where: { id: input.caseId },
      select: {
        id: true,
        leadId: true,
        clientId: true,
        lead: { select: { id: true, phone: true } },
        client: { select: { id: true, phone: true } },
      },
    });
    if (!processingCase) return { ok: false, reason: 'case not found' };

    const phone = processingCase.lead?.phone ?? processingCase.client?.phone ?? null;
    if (!phone) return { ok: false, reason: 'client has no phone on file' };

    const thread = await this.prisma.whatsAppThread.findFirst({
      where: {
        OR: [
          ...(processingCase.leadId ? [{ leadId: processingCase.leadId }] : []),
          ...(processingCase.clientId ? [{ clientId: processingCase.clientId }] : []),
        ],
        status: { in: [WhatsAppThreadStatus.OPEN, WhatsAppThreadStatus.PENDING] },
      },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        channelId: true,
        leadId: true,
        clientId: true,
        windowExpiresAt: true,
      },
    });
    if (!thread) return { ok: false, reason: 'no WhatsApp conversation yet' };

    const now = new Date();
    if (!thread.windowExpiresAt || thread.windowExpiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: '24h customer service window expired — use a template' };
    }

    // Map the processing officer (RequestUser.id is the UserAccount id) to
    // their Employee record so the WhatsApp message is attributed correctly
    // and the AI bot stays silent for the post-send lockout window.
    const employee = await this.prisma.employee.findFirst({
      where: { userId: input.actorUserId, isActive: true, deletedAt: null },
      select: { id: true },
    });

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        threadId: thread.id,
        channelId: thread.channelId,
        leadId: thread.leadId,
        clientId: thread.clientId,
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: WhatsAppMessageType.TEXT,
        status: WhatsAppMessageStatus.QUEUED,
        body,
        sentByEmployeeId: employee?.id ?? null,
        idempotencyKey: randomUUID(),
        payload: {
          source: 'processing_case_communication',
          caseId: input.caseId,
        } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    await this.outboundWhatsAppQueue.add(
      'send',
      { messageId: message.id },
      { jobId: message.id },
    );

    // Mark the thread human-touched so the AI bot stays out of the way.
    // Mirrors what messages.service.ts does on manual agent sends.
    if (employee?.id) {
      await this.prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { aiDisabledAt: new Date() },
      });
    }

    return { ok: true, messageId: message.id };
  }

  // -------------------------------------------------------------------------
  // AUTHORITY SUBMISSIONS
  // -------------------------------------------------------------------------

  async getSubmissions(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    return this.prisma.authoritySubmission.findMany({
      where: { caseId },
      include: { submittedBy: { select: { id: true, email: true } } },
      orderBy: { submissionNumber: 'asc' },
    });
  }

  async createSubmission(
    caseId: string,
    dto: CreateAuthoritySubmissionDto,
    user: RequestUser,
  ) {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);

    const count = await this.prisma.authoritySubmission.count({ where: { caseId } });

    const submission = await this.prisma.$transaction(async (tx) => {
      const created = await tx.authoritySubmission.create({
        data: {
          caseId,
          submissionNumber: count + 1,
          submittedByUserId: user.id,
          submissionDate: new Date(dto.submissionDate),
          submissionReference: dto.submissionReference ?? undefined,
          authority: dto.authority,
          documentsIncluded: dto.documentsIncluded ?? [],
          trackingNumber: dto.trackingNumber ?? undefined,
        },
      });

      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'submission_created',
          entityType: 'authority_submission',
          entityId: created.id,
          newValues: {
            submissionNumber: created.submissionNumber,
            authority: created.authority,
            submissionReference: created.submissionReference,
            trackingNumber: created.trackingNumber,
          },
        },
      });

      return created;
    });

    this.timeline.record({
      entityType: 'authority_submission',
      entityId: submission.id,
      clientId: undefined,
      eventType: TimelineEventType.PROCESSING_SUBMISSION_FILED,
      description: `Submission #${submission.submissionNumber} filed with ${submission.authority}`,
      actorUserId: user.id,
      metadata: { caseId, submissionNumber: submission.submissionNumber, authority: submission.authority },
    }).catch(() => { /* non-fatal */ });

    return submission;
  }

  async updateSubmission(
    caseId: string,
    submissionId: string,
    dto: UpdateAuthoritySubmissionDto,
    user: RequestUser,
  ) {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);

    const existing = await this.prisma.authoritySubmission.findFirst({
      where: { id: submissionId, caseId },
    });
    if (!existing) throw new NotFoundException('Authority submission not found');

    const updateData: Record<string, unknown> = {};
    if (dto.trackingNumber !== undefined)    updateData.trackingNumber    = dto.trackingNumber;
    if (dto.status !== undefined)            updateData.status            = dto.status;
    if (dto.responseType !== undefined)      updateData.responseType      = dto.responseType;
    if (dto.responseNotes !== undefined)     updateData.responseNotes     = dto.responseNotes;
    if (dto.nextAction !== undefined)        updateData.nextAction        = dto.nextAction;
    if (dto.responseReceivedAt !== undefined) {
      updateData.responseReceivedAt = new Date(dto.responseReceivedAt);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.authoritySubmission.update({
        where: { id: submissionId },
        data: updateData,
      });

      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'submission_updated',
          entityType: 'authority_submission',
          entityId: submissionId,
          oldValues: {
            status:            existing.status,
            trackingNumber:    existing.trackingNumber,
            responseType:      existing.responseType,
            responseNotes:     existing.responseNotes,
            nextAction:        existing.nextAction,
          },
          newValues: updateData as Record<string, string>,
        },
      });

      return result;
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // AUDIT
  // -------------------------------------------------------------------------

  async getCaseAudit(caseId: string, user: RequestUser) {
    await this.assertCaseAccessById(caseId, user);
    return this.prisma.processingAuditLog.findMany({
      where: { caseId },
      include: { actor: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -------------------------------------------------------------------------
  // DASHBOARD
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // CORRECTION REQUESTS
  // -------------------------------------------------------------------------

  /**
   * Create a formal correction request and send it to the client.
   *
   * Two types:
   *  - DOCUMENT: linked to a specific CaseDocumentItem (documentItemId required)
   *  - INFORMATION: freeform request for the client to correct/confirm data
   *
   * Sets slaDueAt = now + slaHours (default 120 h = 5 business days).
   * Audits and records a timeline event.
   */
  async createCorrectionRequest(
    caseId: string,
    dto: CreateCorrectionRequestDto,
    user: RequestUser,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);

    if (processingCase.stage === ProcessingCaseStage.COMPLETED ||
        processingCase.stage === ProcessingCaseStage.CANCELLED) {
      throw new BadRequestException('Cannot raise a correction request on a completed or cancelled case');
    }

    // If DOCUMENT type, validate the document item belongs to this case
    if (dto.correctionType === CorrectionType.DOCUMENT) {
      if (!dto.documentItemId) {
        throw new BadRequestException('documentItemId is required for DOCUMENT correction type');
      }
      const item = await this.prisma.caseDocumentItem.findFirst({
        where: { id: dto.documentItemId, caseId },
      });
      if (!item) {
        throw new NotFoundException('Document item not found on this case');
      }
    }

    if (!dto.reasonCodes || dto.reasonCodes.length === 0) {
      throw new BadRequestException('At least one reason code is required');
    }

    const slaHours = dto.slaHours ?? 120;
    const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);

    const correction = await this.prisma.$transaction(async (tx) => {
      const created = await tx.correctionRequest.create({
        data: {
          caseId,
          documentItemId: dto.documentItemId ?? null,
          raisedByOfficerId: user.id,
          correctionType: dto.correctionType,
          subject: dto.subject,
          reasonCodes: dto.reasonCodes,
          officerNote: dto.officerNote ?? null,
          clientMessage: dto.clientMessage,
          requiredAction: dto.requiredAction,
          slaHours,
          slaDueAt,
          status: CorrectionStatus.SENT,
        },
        include: {
          documentItem: { select: { id: true, documentName: true } },
          raisedBy: { select: { id: true, email: true } },
        },
      });

      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'correction_request_created',
          entityType: 'correction_request',
          entityId: created.id,
          newValues: {
            correctionType: dto.correctionType,
            subject: dto.subject,
            requiredAction: dto.requiredAction,
            slaHours,
          },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      return created;
    });

    this.timeline.record({
      entityType: 'correction_request',
      entityId: correction.id,
      clientId: processingCase.clientId ?? undefined,
      eventType: TimelineEventType.PROCESSING_MESSAGE_SENT,
      description: `Correction request sent to client: ${dto.subject}`,
      actorUserId: user.id,
      metadata: { caseId, correctionType: dto.correctionType, requiredAction: dto.requiredAction },
    }).catch(() => { /* non-fatal */ });

    return correction;
  }

  /**
   * List correction requests for a case.
   * Officers see all; filtered by optional status/type query params.
   * The officerNote is included — it is internal, never exposed to the portal.
   */
  async listCorrectionRequests(
    caseId: string,
    query: ListCorrectionRequestsQueryDto,
    user: RequestUser,
  ) {
    await this.assertCaseAccessById(caseId, user);

    return this.prisma.correctionRequest.findMany({
      where: {
        caseId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.correctionType ? { correctionType: query.correctionType } : {}),
      },
      include: {
        documentItem: { select: { id: true, documentName: true, status: true } },
        raisedBy: { select: { id: true, email: true } },
        resolvedBy: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Mark a correction request as RESOLVED.
   * Only the officer assigned to the case (or any view_all user) can resolve.
   * Records who resolved it and when.
   */
  async resolveCorrectionRequest(
    caseId: string,
    correctionId: string,
    dto: ResolveCorrectionRequestDto,
    user: RequestUser,
    ipAddress?: string,
    userAgent?: string,
  ) {
    await this.assertCaseAccessById(caseId, user);

    const correction = await this.prisma.correctionRequest.findFirst({
      where: { id: correctionId, caseId },
    });
    if (!correction) throw new NotFoundException('Correction request not found');

    if (correction.status === CorrectionStatus.RESOLVED) {
      throw new BadRequestException('Correction request is already resolved');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.correctionRequest.update({
        where: { id: correctionId },
        data: {
          status: CorrectionStatus.RESOLVED,
          resolvedAt: new Date(),
          resolvedByUserId: user.id,
          // Append resolution note to officerNote if provided
          ...(dto.resolutionNote
            ? { officerNote: correction.officerNote
                ? `${correction.officerNote}\n\n[Resolved] ${dto.resolutionNote}`
                : `[Resolved] ${dto.resolutionNote}` }
            : {}),
        },
      });

      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'correction_request_resolved',
          entityType: 'correction_request',
          entityId: correctionId,
          oldValues: { status: correction.status },
          newValues: { status: CorrectionStatus.RESOLVED },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      return result;
    });

    return { success: true, correctionId, status: updated.status };
  }

  /**
   * Escalate a correction request to ESCALATED status.
   * Available to any officer with case access — escalation makes it visible
   * to managers in the "stuck cases" dashboard view.
   */
  async escalateCorrectionRequest(
    caseId: string,
    correctionId: string,
    dto: EscalateCorrectionRequestDto,
    user: RequestUser,
    ipAddress?: string,
    userAgent?: string,
  ) {
    await this.assertCaseAccessById(caseId, user);

    const correction = await this.prisma.correctionRequest.findFirst({
      where: { id: correctionId, caseId },
    });
    if (!correction) throw new NotFoundException('Correction request not found');

    if (correction.status === CorrectionStatus.RESOLVED) {
      throw new BadRequestException('Cannot escalate a resolved correction request');
    }
    if (correction.status === CorrectionStatus.ESCALATED) {
      throw new BadRequestException('Correction request is already escalated');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.correctionRequest.update({
        where: { id: correctionId },
        data: {
          status: CorrectionStatus.ESCALATED,
          officerNote: correction.officerNote
            ? `${correction.officerNote}\n\n[Escalated] ${dto.escalationReason}`
            : `[Escalated] ${dto.escalationReason}`,
        },
      });

      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'correction_request_escalated',
          entityType: 'correction_request',
          entityId: correctionId,
          oldValues: { status: correction.status },
          newValues: { status: CorrectionStatus.ESCALATED, escalationReason: dto.escalationReason },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      return result;
    });

    return { success: true, correctionId, status: updated.status };
  }

  // -------------------------------------------------------------------------
  // REPORTS
  // -------------------------------------------------------------------------

  /**
   * Workload report — cases per officer broken down by stage, with avg days open.
   */
  async getWorkloadReport(query: ReportDateRangeQueryDto) {
    const from = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 30 * 86_400_000);
    const to   = query.dateTo   ? new Date(query.dateTo)   : new Date();

    const cases = await this.prisma.processingCase.findMany({
      where: {
        ...(query.officerId ? { assignedOfficerId: query.officerId } : {}),
        createdAt: { gte: from, lte: to },
      },
      include: {
        assignedOfficer: {
          select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    const UNASSIGNED_KEY = 'unassigned';
    const officerMap = new Map<
      string,
      { officerName: string; stageCounts: Record<string, number>; totalDaysOpen: number; caseCount: number }
    >();

    for (const c of cases) {
      const key  = c.assignedOfficerId ?? UNASSIGNED_KEY;
      const name = officerDisplayName(c.assignedOfficer) ?? 'Unassigned';
      if (!officerMap.has(key)) {
        officerMap.set(key, { officerName: name, stageCounts: {}, totalDaysOpen: 0, caseCount: 0 });
      }
      const entry = officerMap.get(key)!;
      entry.stageCounts[c.stage] = (entry.stageCounts[c.stage] ?? 0) + 1;
      entry.caseCount += 1;
      const openMs = (c.completedAt ?? c.cancelledAt ?? new Date()).getTime() - c.createdAt.getTime();
      entry.totalDaysOpen += openMs / 86_400_000;
    }

    const rows = [...officerMap.entries()].map(([officerId, v]) => ({
      officerId: officerId === UNASSIGNED_KEY ? null : officerId,
      officerName: v.officerName,
      caseCount: v.caseCount,
      avgDaysOpen: v.caseCount > 0 ? Math.round(v.totalDaysOpen / v.caseCount) : 0,
      stageCounts: v.stageCounts,
    }));

    rows.sort((a, b) => b.caseCount - a.caseCount);
    return { from: from.toISOString(), to: to.toISOString(), rows };
  }

  /**
   * Throughput report — cases completed/cancelled/rejected per ISO-week within range.
   */
  async getThroughputReport(query: ReportDateRangeQueryDto) {
    const from = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 90 * 86_400_000);
    const to   = query.dateTo   ? new Date(query.dateTo)   : new Date();

    const closed = await this.prisma.processingCase.findMany({
      where: {
        stage: { in: [ProcessingCaseStage.COMPLETED, ProcessingCaseStage.CANCELLED, ProcessingCaseStage.REJECTED] },
        ...(query.officerId ? { assignedOfficerId: query.officerId } : {}),
        OR: [
          { completedAt: { gte: from, lte: to } },
          { cancelledAt: { gte: from, lte: to } },
        ],
      },
      select: { id: true, stage: true, completedAt: true, cancelledAt: true, createdAt: true },
    });

    function isoWeekKey(d: Date) {
      const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
      const year = tmp.getUTCFullYear();
      const week = Math.ceil((((tmp.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1) / 7);
      return `${year}-W${String(week).padStart(2, '0')}`;
    }

    const weekMap = new Map<string, { completed: number; cancelled: number; rejected: number }>();
    for (const c of closed) {
      const key = isoWeekKey(c.completedAt ?? c.cancelledAt ?? c.createdAt);
      if (!weekMap.has(key)) weekMap.set(key, { completed: 0, cancelled: 0, rejected: 0 });
      const e = weekMap.get(key)!;
      if      (c.stage === ProcessingCaseStage.COMPLETED)  e.completed  += 1;
      else if (c.stage === ProcessingCaseStage.CANCELLED)  e.cancelled  += 1;
      else                                                  e.rejected   += 1;
    }

    const weeks = [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, counts]) => ({ week, ...counts, total: counts.completed + counts.cancelled + counts.rejected }));

    return { from: from.toISOString(), to: to.toISOString(), totalClosed: closed.length, weeks };
  }

  /**
   * Document quality report — rejection rates per document name, top reason codes.
   */
  async getDocQualityReport(query: ReportDateRangeQueryDto) {
    const from = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 90 * 86_400_000);
    const to   = query.dateTo   ? new Date(query.dateTo)   : new Date();

    const decisions = await this.prisma.documentReviewDecision.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { documentItem: { select: { documentName: true } } },
    });

    const docMap = new Map<string, { accepted: number; rejected: number; reasonCodeCounts: Record<string, number> }>();
    for (const d of decisions) {
      const name = d.documentItem.documentName;
      if (!docMap.has(name)) docMap.set(name, { accepted: 0, rejected: 0, reasonCodeCounts: {} });
      const e = docMap.get(name)!;
      if (d.decision === 'ACCEPTED') {
        e.accepted += 1;
      } else {
        e.rejected += 1;
        for (const code of d.rejectionReasonCodes) {
          e.reasonCodeCounts[code] = (e.reasonCodeCounts[code] ?? 0) + 1;
        }
      }
    }

    const globalCodes = new Map<string, number>();
    for (const [, e] of docMap) {
      for (const [code, count] of Object.entries(e.reasonCodeCounts)) {
        globalCodes.set(code, (globalCodes.get(code) ?? 0) + count);
      }
    }

    const topReasonCodes = [...globalCodes.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([code, count]) => ({ code, count }));

    const documents = [...docMap.entries()]
      .map(([documentName, e]) => ({
        documentName,
        accepted: e.accepted,
        rejected: e.rejected,
        total: e.accepted + e.rejected,
        rejectionRate: e.accepted + e.rejected > 0
          ? Math.round((e.rejected / (e.accepted + e.rejected)) * 100)
          : 0,
        topReasonCodes: Object.entries(e.reasonCodeCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([code, count]) => ({ code, count })),
      }))
      .sort((a, b) => b.rejectionRate - a.rejectionRate);

    return { from: from.toISOString(), to: to.toISOString(), documents, topReasonCodes };
  }

  /**
   * SLA report — correction requests past due, and open cases older than 30/60/90 days.
   */
  async getSlaReport(query: ReportDateRangeQueryDto) {
    const officerFilter = query.officerId ? { assignedOfficerId: query.officerId } : {};
    const now = new Date();

    const [overdueCorrections, agingCases] = await this.prisma.$transaction([
      this.prisma.correctionRequest.findMany({
        where: {
          status: { in: [CorrectionStatus.SENT, CorrectionStatus.IN_PROGRESS] },
          slaDueAt: { lt: now },
        },
        include: {
          case: { select: { id: true, service: true, targetCountry: true } },
          raisedBy: { select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { slaDueAt: 'asc' },
      }),
      this.prisma.processingCase.findMany({
        where: {
          ...officerFilter,
          stage: {
            notIn: [ProcessingCaseStage.COMPLETED, ProcessingCaseStage.CANCELLED, ProcessingCaseStage.REJECTED],
          },
          createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) },
        },
        select: {
          id: true,
          service: true,
          targetCountry: true,
          stage: true,
          priority: true,
          createdAt: true,
          assignedOfficer: { select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } } },
        },
      }),
    ]);

    const agingRows = agingCases.map((c) => {
      const daysOpen = Math.floor((now.getTime() - c.createdAt.getTime()) / 86_400_000);
      return {
        caseId: c.id,
        service: c.service,
        targetCountry: c.targetCountry,
        stage: c.stage,
        priority: c.priority,
        daysOpen,
        bucket: daysOpen >= 90 ? '90+' : daysOpen >= 60 ? '60-90' : '30-60',
        officerName: officerDisplayName(c.assignedOfficer) ?? 'Unassigned',
      };
    }).sort((a, b) => b.daysOpen - a.daysOpen);

    return {
      overdueCorrections: overdueCorrections.map((cr) => ({
        correctionId: cr.id,
        caseId: cr.caseId,
        subject: cr.subject,
        status: cr.status,
        slaDueAt: cr.slaDueAt,
        hoursOverdue: cr.slaDueAt
          ? Math.floor((now.getTime() - cr.slaDueAt.getTime()) / 3_600_000)
          : null,
        raisedByName: officerDisplayName(cr.raisedBy) ?? cr.raisedBy.email,
      })),
      agingCases: agingRows,
      summary: {
        overdueCount:  overdueCorrections.length,
        aging30to60:   agingRows.filter((r) => r.bucket === '30-60').length,
        aging60to90:   agingRows.filter((r) => r.bucket === '60-90').length,
        aging90plus:   agingRows.filter((r) => r.bucket === '90+').length,
      },
    };
  }

  /**
   * Expiry risk report — document items whose validity expires within 90 days.
   */
  async getExpiryRiskReport(query: ReportDateRangeQueryDto) {
    const officerFilter = query.officerId ? { case: { assignedOfficerId: query.officerId } } : {};
    const now      = new Date();
    const in90Days = new Date(now.getTime() + 90 * 86_400_000);

    const items = await this.prisma.caseDocumentItem.findMany({
      where: {
        ...officerFilter,
        validityExpiryDate: { not: null, lte: in90Days },
        status: { notIn: [DocumentItemStatus.WAIVED, DocumentItemStatus.NOT_APPLICABLE] },
      },
      include: {
        case: {
          select: {
            id: true,
            service: true,
            targetCountry: true,
            priority: true,
            assignedOfficer: { select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
      orderBy: { validityExpiryDate: 'asc' },
    });

    const rows = items.map((item) => {
      const daysUntil = item.validityExpiryDate
        ? Math.floor((item.validityExpiryDate.getTime() - now.getTime()) / 86_400_000)
        : null;
      return {
        documentItemId:    item.id,
        documentName:      item.documentName,
        criticality:       item.criticality,
        status:            item.status,
        validityExpiryDate: item.validityExpiryDate,
        daysUntilExpiry:   daysUntil,
        bucket:            daysUntil == null ? 'unknown'
          : daysUntil < 0   ? 'expired'
          : daysUntil <= 30 ? '0-30'
          : daysUntil <= 60 ? '31-60'
          : '61-90',
        caseId:       item.case.id,
        service:      item.case.service,
        targetCountry: item.case.targetCountry,
        casePriority: item.case.priority,
        officerName:  officerDisplayName(item.case.assignedOfficer) ?? 'Unassigned',
      };
    });

    return {
      generatedAt: now.toISOString(),
      summary: {
        expired:  rows.filter((r) => r.bucket === 'expired').length,
        within30: rows.filter((r) => r.bucket === '0-30').length,
        within60: rows.filter((r) => r.bucket === '31-60').length,
        within90: rows.filter((r) => r.bucket === '61-90').length,
      },
      rows,
    };
  }

  /**
   * Export report as RFC-4180 CSV string.
   * Returns { csv: string, filename: string }.
   */
  async exportReport(query: ReportExportQueryDto): Promise<{ csv: string; filename: string }> {
    const base: ReportDateRangeQueryDto = {
      dateFrom: query.dateFrom,
      dateTo:   query.dateTo,
      officerId: query.officerId,
    };

    const dateTag = new Date().toISOString().slice(0, 10);

    function row(fields: (string | number | null | undefined)[]): string {
      return fields
        .map((f) => {
          if (f == null) return '';
          const s = String(f);
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        })
        .join(',');
    }

    switch (query.reportType) {
      case 'workload': {
        const report = await this.getWorkloadReport(base);
        const header = row(['Officer', 'Cases', 'Avg Days Open', 'Stage Breakdown']);
        const lines = report.rows.map((r) =>
          row([
            r.officerName,
            r.caseCount,
            r.avgDaysOpen,
            Object.entries(r.stageCounts).map(([s, c]) => `${s}:${c}`).join('; '),
          ]),
        );
        return { csv: [header, ...lines].join('\r\n'), filename: `workload-${dateTag}.csv` };
      }

      case 'throughput': {
        const report = await this.getThroughputReport(base);
        const header = row(['Week', 'Completed', 'Cancelled', 'Rejected', 'Total']);
        const lines = report.weeks.map((w) =>
          row([w.week, w.completed, w.cancelled, w.rejected, w.total]),
        );
        return { csv: [header, ...lines].join('\r\n'), filename: `throughput-${dateTag}.csv` };
      }

      case 'doc-quality': {
        const report = await this.getDocQualityReport(base);
        const header = row(['Document Name', 'Accepted', 'Rejected', 'Total', 'Rejection Rate %', 'Top Reason Codes']);
        const lines = report.documents.map((d) =>
          row([
            d.documentName,
            d.accepted,
            d.rejected,
            d.total,
            d.rejectionRate,
            d.topReasonCodes.map((rc) => `${rc.code}(${rc.count})`).join('; '),
          ]),
        );
        return { csv: [header, ...lines].join('\r\n'), filename: `doc-quality-${dateTag}.csv` };
      }

      case 'sla': {
        const report = await this.getSlaReport(base);
        const corrHeader = row(['Type', 'Subject', 'Status', 'SLA Due', 'Hours Overdue', 'Raised By', 'Case ID']);
        const corrLines = report.overdueCorrections.map((cr) =>
          row([
            'Overdue Correction',
            cr.subject,
            cr.status,
            cr.slaDueAt ? new Date(cr.slaDueAt).toISOString().slice(0, 10) : '',
            cr.hoursOverdue ?? '',
            cr.raisedByName,
            cr.caseId,
          ]),
        );
        const agingHeader = row(['Type', 'Case ID', 'Service', 'Country', 'Stage', 'Priority', 'Days Open', 'Bucket', 'Officer']);
        const agingLines = report.agingCases.map((c) =>
          row([
            'Aging Case',
            c.caseId,
            c.service,
            c.targetCountry,
            c.stage,
            c.priority,
            c.daysOpen,
            c.bucket,
            c.officerName,
          ]),
        );
        const csv = [corrHeader, ...corrLines, '', agingHeader, ...agingLines].join('\r\n');
        return { csv, filename: `sla-${dateTag}.csv` };
      }

      case 'expiry-risk': {
        const report = await this.getExpiryRiskReport(base);
        const header = row(['Document Name', 'Criticality', 'Status', 'Expiry Date', 'Days Until Expiry', 'Bucket', 'Case ID', 'Service', 'Country', 'Priority', 'Officer']);
        const lines = report.rows.map((r) =>
          row([
            r.documentName,
            r.criticality,
            r.status,
            r.validityExpiryDate ? new Date(r.validityExpiryDate).toISOString().slice(0, 10) : '',
            r.daysUntilExpiry ?? '',
            r.bucket,
            r.caseId,
            r.service,
            r.targetCountry,
            r.casePriority,
            r.officerName,
          ]),
        );
        return { csv: [header, ...lines].join('\r\n'), filename: `expiry-risk-${dateTag}.csv` };
      }

      default:
        throw new BadRequestException(`Unknown report type: ${query.reportType}`);
    }
  }

  /**
   * Reopen a REJECTED or EXPIRED document item back to NOT_SUBMITTED so the
   * client can be asked to upload a fresh version. Used after an appeal or
   * when the officer decides the original rejection was an error.
   */
  async reopenDocumentItem(
    caseId: string,
    itemId: string,
    user: RequestUser,
  ) {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);

    const item = await this.prisma.caseDocumentItem.findFirst({
      where: { id: itemId, caseId },
    });
    if (!item) throw new NotFoundException('Document item not found');

    const reopenableStatuses: DocumentItemStatus[] = [
      DocumentItemStatus.REJECTED,
      DocumentItemStatus.EXPIRED,
    ];
    if (!reopenableStatuses.includes(item.status)) {
      throw new BadRequestException(
        `Document item cannot be reopened from status: ${item.status}. Only REJECTED or EXPIRED items can be reopened.`,
      );
    }

    const oldStatus = item.status;

    await this.prisma.$transaction(async (tx) => {
      await tx.caseDocumentItem.update({
        where: { id: itemId },
        data: { status: DocumentItemStatus.NOT_SUBMITTED },
      });

      await tx.processingAuditLog.create({
        data: {
          caseId,
          actorUserId: user.id,
          action: 'document_item_reopened',
          entityType: 'case_document_item',
          entityId: itemId,
          oldValues: { status: oldStatus },
          newValues: { status: DocumentItemStatus.NOT_SUBMITTED },
        },
      });
    });

    this.timeline.record({
      entityType: 'case_document_item',
      entityId: itemId,
      clientId: undefined,
      eventType: TimelineEventType.PROCESSING_DOCUMENT_SUBMITTED,
      description: `Document reopened for re-submission: ${item.documentName} (was ${oldStatus})`,
      actorUserId: user.id,
      metadata: { caseId, itemId, previousStatus: oldStatus },
    }).catch(() => { /* non-fatal */ });

    return { success: true, itemId, newStatus: DocumentItemStatus.NOT_SUBMITTED };
  }

  // -------------------------------------------------------------------------
  // DASHBOARD
  // -------------------------------------------------------------------------

  /**
   * Admin-only processing overview — surfaces the manager dashboard inside
   * the admin shell so an admin doesn't have to leave /admin to see the
   * full processing picture. Permission gate (processing.case.view_all)
   * is enforced at the controller.
   *
   * Returns: totals, stage breakdown, per-officer workload, recent intake
   * (last 5), and SLA-breached cases (top 10 oldest).
   */
  async getAdminOverview() {
    const activeStages: ProcessingCaseStage[] = [
      ProcessingCaseStage.INTAKE_PENDING,
      ProcessingCaseStage.DOCUMENTS_COLLECTION,
      ProcessingCaseStage.DOCUMENTS_UNDER_REVIEW,
      ProcessingCaseStage.DOCUMENTS_INCOMPLETE,
      ProcessingCaseStage.DOCUMENTS_COMPLETE,
      ProcessingCaseStage.READY_FOR_SUBMISSION,
      ProcessingCaseStage.SUBMITTED,
      ProcessingCaseStage.UNDER_AUTHORITY_REVIEW,
      ProcessingCaseStage.ADDITIONAL_INFO_REQUESTED,
      ProcessingCaseStage.DECISION_RECEIVED,
    ];

    const [
      activeCount,
      newIntakeCount,
      slaBreachedCount,
      unassignedCount,
      pendingDocumentsCount,
      finalSubmissionPendingCount,
      approvedCount,
      refusedCount,
      casesByTypeRaw,
      stageBreakdownRaw,
      officerWorkloadRaw,
      recentIntake,
      breachedCases,
    ] = await this.prisma.$transaction([
      this.prisma.processingCase.count({
        where: { stage: { in: activeStages }, cancelledAt: null },
      }),
      this.prisma.processingCase.count({
        where: { stage: ProcessingCaseStage.INTAKE_PENDING },
      }),
      this.prisma.processingCase.count({
        where: { slaStatus: 'BREACHED', cancelledAt: null },
      }),
      // Per the spec: "Unassigned cases" KPI. Cases that have moved past
      // INTAKE_PENDING but somehow lost their officer (e.g. officer left
      // and re-assignment is pending). Should normally be 0; non-zero
      // means a manager action is needed.
      this.prisma.processingCase.count({
        where: {
          stage: { in: activeStages },
          assignedOfficerId: null,
          cancelledAt: null,
        },
      }),
      // "Pending documents" — across active cases, how many doc items are
      // sitting at SUBMITTED or UNDER_REVIEW awaiting officer action.
      this.prisma.caseDocumentItem.count({
        where: {
          status: { in: [DocumentItemStatus.SUBMITTED, DocumentItemStatus.UNDER_REVIEW] },
          case: { stage: { in: activeStages }, cancelledAt: null },
        },
      }),
      // "Final submission pending" — cases at READY_FOR_SUBMISSION but not
      // yet SUBMITTED. These are the manager's "ship today" pile.
      this.prisma.processingCase.count({
        where: { stage: ProcessingCaseStage.READY_FOR_SUBMISSION },
      }),
      this.prisma.processingCase.count({
        where: { stage: ProcessingCaseStage.APPROVED },
      }),
      this.prisma.processingCase.count({
        where: { stage: ProcessingCaseStage.REJECTED },
      }),
      // Cases by case type (active only) — spec calls for this on the
      // manager dashboard.
      this.prisma.processingCase.groupBy({
        by: ['service'],
        where: { stage: { in: activeStages }, cancelledAt: null },
        _count: { _all: true },
      }),
      this.prisma.processingCase.groupBy({
        by: ['stage'],
        where: { cancelledAt: null },
        _count: { _all: true },
      }),
      this.prisma.processingCase.groupBy({
        by: ['assignedOfficerId'],
        where: {
          stage: { in: activeStages },
          cancelledAt: null,
          assignedOfficerId: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.processingCase.findMany({
        where: { stage: ProcessingCaseStage.INTAKE_PENDING },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          service: true,
          targetCountry: true,
          createdAt: true,
          priority: true,
          client: { select: { firstName: true, lastName: true, phone: true } },
        },
      }),
      this.prisma.processingCase.findMany({
        where: { slaStatus: 'BREACHED', cancelledAt: null },
        orderBy: { slaDueAt: 'asc' },
        take: 10,
        select: {
          id: true,
          stage: true,
          service: true,
          targetCountry: true,
          slaDueAt: true,
          assignedOfficer: {
            select: { employee: { select: { firstName: true, lastName: true } } },
          },
          client: { select: { firstName: true, lastName: true, phone: true } },
        },
      }),
    ]);

    const officerIds = officerWorkloadRaw.map((r) => r.assignedOfficerId!).filter(Boolean);
    const officers = officerIds.length
      ? await this.prisma.userAccount.findMany({
          where: { id: { in: officerIds } },
          select: {
            id: true,
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
    const officerById = new Map(officers.map((o) => [o.id, o]));

    const officerWorkload = officerWorkloadRaw.map((r) => {
      const u = officerById.get(r.assignedOfficerId!);
      const employee = u?.employee;
      return {
        officerId: r.assignedOfficerId,
        name: employee
          ? `${employee.firstName} ${employee.lastName}`.trim()
          : (u?.email ?? 'Unknown'),
        activeCases: r._count._all,
      };
    }).sort((a, b) => b.activeCases - a.activeCases);

    const stageBreakdown = stageBreakdownRaw
      .map((r) => ({ stage: r.stage, count: r._count._all }))
      .sort((a, b) => b.count - a.count);

    const casesByType = casesByTypeRaw
      .map((r) => ({ service: r.service, count: r._count._all }))
      .sort((a, b) => b.count - a.count);

    return {
      totals: {
        active: activeCount,
        newIntake: newIntakeCount,
        slaBreached: slaBreachedCount,
        unassigned: unassignedCount,
        pendingDocuments: pendingDocumentsCount,
        finalSubmissionPending: finalSubmissionPendingCount,
        approved: approvedCount,
        refused: refusedCount,
      },
      casesByType,
      stageBreakdown,
      officerWorkload,
      recentIntake: recentIntake.map((c) => ({
        id: c.id,
        service: c.service,
        targetCountry: c.targetCountry,
        priority: c.priority,
        createdAt: c.createdAt,
        clientName: c.client ? `${c.client.firstName} ${c.client.lastName}`.trim() : null,
        clientPhone: c.client?.phone ?? null,
      })),
      breachedCases: breachedCases.map((c) => ({
        id: c.id,
        stage: c.stage,
        service: c.service,
        targetCountry: c.targetCountry,
        slaDueAt: c.slaDueAt,
        officerName: c.assignedOfficer?.employee
          ? `${c.assignedOfficer.employee.firstName} ${c.assignedOfficer.employee.lastName}`.trim()
          : null,
        clientName: c.client ? `${c.client.firstName} ${c.client.lastName}`.trim() : null,
      })),
    };
  }

  async getDashboardMetrics(user: RequestUser) {
    const canViewAll = user.permissions.includes('processing.case.view_all');
    const officerFilter = canViewAll ? {} : { assignedOfficerId: user.id };
    const activeStages: ProcessingCaseStage[] = [
      ProcessingCaseStage.DOCUMENTS_COLLECTION,
      ProcessingCaseStage.DOCUMENTS_UNDER_REVIEW,
      ProcessingCaseStage.DOCUMENTS_INCOMPLETE,
      ProcessingCaseStage.DOCUMENTS_COMPLETE,
      ProcessingCaseStage.READY_FOR_SUBMISSION,
      ProcessingCaseStage.SUBMITTED,
      ProcessingCaseStage.UNDER_AUTHORITY_REVIEW,
      ProcessingCaseStage.ADDITIONAL_INFO_REQUESTED,
      ProcessingCaseStage.DECISION_RECEIVED,
    ];
    // Per the workflow spec, the associate dashboard surfaces:
    //   - my assigned cases (= activeCases)
    //   - my pending document cases (cases in DOC_COLLECTION /
    //     DOC_UNDER_REVIEW)
    //   - my cases needing client follow-up (DOCS_INCOMPLETE /
    //     ADDITIONAL_INFO_REQUESTED — client owes us something)
    //   - my final submission pending (READY_FOR_SUBMISSION)
    //   - my approved / refused
    // Manager view keeps the same payload but unfiltered by officer.

    const [
      activeCases,
      awaitingReview,
      readyToSubmit,
      newIntake,
      myPendingDocs,
      myClientFollowUp,
      myApproved,
      myRefused,
    ] = await this.prisma.$transaction([
      this.prisma.processingCase.count({
        where: { ...officerFilter, stage: { in: activeStages } },
      }),
      this.prisma.processingCase.count({
        where: { ...officerFilter, stage: ProcessingCaseStage.DOCUMENTS_UNDER_REVIEW },
      }),
      this.prisma.processingCase.count({
        where: { ...officerFilter, stage: ProcessingCaseStage.READY_FOR_SUBMISSION },
      }),
      this.prisma.processingCase.count({
        where: { stage: ProcessingCaseStage.INTAKE_PENDING },
      }),
      this.prisma.processingCase.count({
        where: {
          ...officerFilter,
          stage: { in: [ProcessingCaseStage.DOCUMENTS_COLLECTION, ProcessingCaseStage.DOCUMENTS_UNDER_REVIEW] },
        },
      }),
      this.prisma.processingCase.count({
        where: {
          ...officerFilter,
          stage: { in: [ProcessingCaseStage.DOCUMENTS_INCOMPLETE, ProcessingCaseStage.ADDITIONAL_INFO_REQUESTED] },
        },
      }),
      this.prisma.processingCase.count({
        where: { ...officerFilter, stage: ProcessingCaseStage.APPROVED },
      }),
      this.prisma.processingCase.count({
        where: { ...officerFilter, stage: ProcessingCaseStage.REJECTED },
      }),
    ]);

    return {
      activeCases,
      awaitingReview,
      readyToSubmit,
      newIntake,
      myPendingDocs,
      myClientFollowUp,
      myApproved,
      myRefused,
    };
  }

  // -------------------------------------------------------------------------
  // PRIVATE HELPERS
  // -------------------------------------------------------------------------

  private async findCaseOrThrow(caseId: string) {
    const c = await this.prisma.processingCase.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Processing case not found');
    return c;
  }

  private assertCaseAccess(
    processingCase: { assignedOfficerId: string | null },
    user: RequestUser,
  ) {
    if (user.permissions.includes('processing.case.view_all')) return;
    if (processingCase.assignedOfficerId !== user.id) {
      throw new ForbiddenException('You are not assigned to this case');
    }
  }

  private async assertCaseAccessById(caseId: string, user: RequestUser) {
    const c = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(c, user);
  }

  /**
   * Rule 2: Hard gate — all CRITICAL and REQUIRED docs must be ACCEPTED
   * (or WAIVED / NOT_APPLICABLE). No EXPIRED docs in blocking criticalities.
   */
  /**
   * Pure submission-readiness check (P4d). Returns the human-readable list of
   * blockers that prevent final submission — empty array means ready. Used both
   * by the hard stage gate (assertDocumentsReadyForSubmission) and surfaced to
   * the UI via getSubmissionReadiness so the associate sees what's outstanding
   * BEFORE attempting the transition. Scoped to CRITICAL + REQUIRED docs.
   */
  private async computeSubmissionBlockers(caseId: string): Promise<string[]> {
    const items = await this.prisma.caseDocumentItem.findMany({
      where: {
        caseId,
        criticality: { in: [DocumentCriticality.CRITICAL, DocumentCriticality.REQUIRED] },
      },
      select: {
        documentName: true,
        status: true,
        validityExpiryDate: true,
        attestationStatus: true,
      },
    });
    const now = new Date();

    const notAccepted = items.filter(
      (i) =>
        i.status !== DocumentItemStatus.ACCEPTED &&
        i.status !== DocumentItemStatus.WAIVED &&
        i.status !== DocumentItemStatus.NOT_APPLICABLE,
    );
    const expired = items.filter(
      (i) =>
        i.status === DocumentItemStatus.EXPIRED ||
        (i.validityExpiryDate != null && i.validityExpiryDate < now),
    );
    // Attestation still pending (P4d): a doc may be ACCEPTED but its required
    // attestation chain isn't done yet — we must not file an un-attested doc.
    const attestationPending = items.filter(
      (i) => i.attestationStatus === 'REQUIRED_PENDING',
    );

    const blockers: string[] = [];
    if (notAccepted.length > 0) {
      blockers.push(
        `${notAccepted.length} required document(s) not yet accepted: ${notAccepted.map((i) => i.documentName).join(', ')}`,
      );
    }
    if (expired.length > 0) {
      blockers.push(
        `${expired.length} document(s) expired — a renewed copy is needed: ${expired.map((i) => i.documentName).join(', ')}`,
      );
    }
    if (attestationPending.length > 0) {
      blockers.push(
        `${attestationPending.length} document(s) still need attestation: ${attestationPending.map((i) => i.documentName).join(', ')}`,
      );
    }
    return blockers;
  }

  /** Public readiness for the UI: { ready, blockers }. Access-checked. */
  async getSubmissionReadiness(
    caseId: string,
    user: RequestUser,
  ): Promise<{ ready: boolean; blockers: string[] }> {
    const processingCase = await this.findCaseOrThrow(caseId);
    this.assertCaseAccess(processingCase, user);
    const blockers = await this.computeSubmissionBlockers(caseId);
    return { ready: blockers.length === 0, blockers };
  }

  private async assertDocumentsReadyForSubmission(caseId: string) {
    const blockers = await this.computeSubmissionBlockers(caseId);
    if (blockers.length > 0) {
      throw new BadRequestException({
        message: 'Case does not meet submission requirements',
        blockers,
      });
    }
  }
}
