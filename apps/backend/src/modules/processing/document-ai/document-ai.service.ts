import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  AiSuggestedDecision,
  AuditAction,
  AuditCategory,
  AuditSeverity,
  DocReviewDecisionType,
  DocumentCriticality,
  DocumentItemStatus,
  Prisma,
  TimelineEventType,
  VirusScanStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { ActivityTimelineService } from '../../activity-timeline/activity-timeline.service';
import { DocumentParserClient } from './document-parser.client';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { computeValidityExpiry } from '../expiry';
import { applyCrmAutoFill } from '../crm-auto-fill.helper';
import { humanizeDocType } from './document-doctype-map';
import {
  DOC_AI_QUEUE,
  type DocAiJob,
  type ParserRequest,
  type ParserResponse,
} from './document-ai.contracts';

/**
 * Orchestrates the document-AI pipeline (Phase D2).
 *
 *   upload -> enqueue(versionId) -> [queue] -> assess(versionId)
 *
 * assess() builds the parser contract from the CaseDocumentItem + case, calls
 * the parser, and ALWAYS stores a DocumentAiAssessment (shadow record). It then
 * applies AUTO-APPROVE only behind hard guardrails (see shouldAutoApprove):
 * very high confidence, every check passed, doc NOT critical, no vision-LLM
 * fallback, not infected, still the current version + still awaiting review.
 * Everything else is left for a human — false-approves are the dangerous
 * failure mode in immigration, so the bias is heavily toward NEEDS_REVIEW.
 */
@Injectable()
export class DocumentAiService {
  private readonly log = new Logger(DocumentAiService.name);

  private readonly pipelineEnabled: boolean;
  private readonly autoApproveEnabled: boolean;
  private readonly minConfidence: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly timeline: ActivityTimelineService,
    private readonly parser: DocumentParserClient,
    private readonly apiKeys: ApiKeysService,
    // Central audit: AI auto-approve is an unattended state-change off the
    // queue (no HTTP request), so the global AuditInterceptor never sees it.
    private readonly audit: AuditLogService,
    @InjectQueue(DOC_AI_QUEUE) private readonly queue: Queue<DocAiJob>,
  ) {
    this.pipelineEnabled =
      this.parser.configured && process.env.DOC_AI_ENABLED !== 'false';
    // Master kill switch — flip DOC_AUTO_APPROVE_ENABLED=false to drop the
    // whole thing to shadow mode (AI suggests, humans always decide).
    this.autoApproveEnabled =
      this.pipelineEnabled && process.env.DOC_AUTO_APPROVE_ENABLED !== 'false';
    this.minConfidence = Number(process.env.DOC_AUTO_APPROVE_MIN_CONFIDENCE ?? '0.97');
  }

  /** The admin-managed OpenAI key (single source of truth). Null if none set. */
  private async resolveOpenAiKey(): Promise<string | null> {
    try {
      return await this.apiKeys.getActiveKey('openai');
    } catch {
      return null;
    }
  }

  /** Producer — fire-and-forget from the upload path. Never throws. */
  async enqueue(versionId: string): Promise<void> {
    if (!this.pipelineEnabled) return;
    try {
      await this.queue.add(
        'assess',
        { versionId },
        { jobId: versionId, attempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
      );
    } catch (e) {
      this.log.warn(`Failed to enqueue AI assessment for version ${versionId}: ${String(e)}`);
    }
  }

  /** Consumer — invoked by DocAiProcessor for one document version. */
  async assess(versionId: string): Promise<void> {
    if (!this.parser.configured) return;

    const version = await this.prisma.clientDocumentVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        storageKey: true,
        fileName: true,
        mimeType: true,
        isCurrent: true,
        virusScanStatus: true,
        documentItemId: true,
        caseId: true,
        documentItem: {
          select: {
            id: true,
            documentName: true,
            criticality: true,
            docType: true,
            documentKind: true,
            photoSpec: true,
            validityRule: true,
            validityMonths: true,
            validityBufferDays: true,
            status: true,
            isAdditional: true,
          },
        },
      },
    });
    if (!version || !version.documentItem) {
      this.log.warn(`assess: version ${versionId} or its item not found — skipping`);
      return;
    }
    const item = version.documentItem;

    const processingCase = await this.prisma.processingCase.findUnique({
      where: { id: version.caseId },
      select: {
        service: true,
        targetCountry: true,
        clientId: true,
        // The Client record is the identity source of truth (richer than the
        // Lead) — name, DOB, passport / national-ID for ownership matching.
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

    const client = processingCase?.client ?? null;
    const clientName = client ? `${client.firstName} ${client.lastName}`.trim() : null;

    let signedUrl: string;
    try {
      signedUrl = await this.storage.getSignedUrl(version.storageKey);
    } catch (e) {
      this.log.warn(`assess: could not sign URL for version ${versionId}: ${String(e)}`);
      await this.storeAssessment(version, item, null, `Could not access stored file: ${String(e)}`);
      return;
    }

    const req: ParserRequest = {
      caseId: version.caseId,
      documentItemId: version.documentItemId,
      versionId: version.id,
      expected: {
        docType: item.docType ?? null,
        documentKind: item.documentKind,
        documentName: item.documentName,
        validityRule: item.validityRule,
        validityMonths: item.validityMonths ?? null,
        validityBufferDays: item.validityBufferDays,
        photoSpec: (item.photoSpec ?? null) as unknown as Record<string, unknown> | null,
        clientName,
        clientDob: client?.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
        clientPassportNumber: client?.passportNumber ?? null,
        clientNationalId: client?.nationalId ?? client?.cnic ?? null,
        service: processingCase?.service ?? null,
        targetCountry: processingCase?.targetCountry ?? null,
      },
      file: {
        url: signedUrl,
        mimeType: version.mimeType ?? 'application/octet-stream',
        fileName: version.fileName,
      },
      openaiApiKey: await this.resolveOpenAiKey(),
    };

    let resp: ParserResponse | null = null;
    let errorMessage: string | null = null;
    try {
      resp = await this.parser.validate(req);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      this.log.warn(`assess: parser failed for version ${versionId}: ${errorMessage}`);
    }

    // Additional documents are catch-all extras with no expected slot to
    // validate against — the AI's role here is to *identify* the file, not to
    // pass/fail it. The slot-style ownership/completeness checks (name / DOB /
    // front+back) don't apply and would wrongly "reject" legitimate family or
    // third-party documents (e.g. an FRC that lists several people, or a
    // spouse's statement). Keep the detected type for labeling; the team makes
    // the accept/reject call.
    if (resp && item.isAdditional) {
      resp = { ...resp, suggestedDecision: 'NEEDS_REVIEW', checks: [], reasonCodes: [] };
    }

    const assessment = await this.storeAssessment(version, item, resp, errorMessage);

    // Give ad-hoc "Additional document" items a real identity from what the AI
    // detected — so the team sees *what the file is* right after upload, not a
    // generic placeholder. Suggestion only: the file still goes through normal
    // review, and we never overwrite a name the uploader actually typed. Only
    // the display name changes (not docType), to avoid touching classification-
    // dependent logic (CRM auto-fill, identity reconciliation).
    if (item.isAdditional && item.documentName === 'Additional document' && resp?.detectedDocType) {
      const detected = resp.detectedDocType.trim().toUpperCase();
      if (detected && detected !== 'OTHER' && detected !== 'UNKNOWN') {
        const label = humanizeDocType(detected);
        if (label) {
          item.documentName = label; // keep in-memory copy in sync for the auto-approve timeline line
          await this.prisma.caseDocumentItem
            .update({ where: { id: item.id }, data: { documentName: label } })
            .catch((e) => this.log.warn(`assess: could not label additional doc ${item.id}: ${String(e)}`));
        }
      }
    }

    if (resp && this.shouldAutoApprove(resp, item, version)) {
      await this.autoApprove(version, item, resp, assessment.id, processingCase?.clientId ?? null);
    }
  }

  // ---------------------------------------------------------------------------

  private async storeAssessment(
    version: { id: string; documentItemId: string; caseId: string },
    item: { docType: string | null },
    resp: ParserResponse | null,
    errorMessage: string | null,
  ) {
    return this.prisma.documentAiAssessment.create({
      data: {
        documentItemId: version.documentItemId,
        versionId: version.id,
        caseId: version.caseId,
        detectedDocType: resp?.detectedDocType ?? null,
        expectedDocType: item.docType ?? null,
        confidence: resp?.confidence ?? null,
        extracted: (resp?.extracted ?? {}) as unknown as Prisma.InputJsonValue,
        checks: (resp?.checks ?? []) as unknown as Prisma.InputJsonValue,
        suggestedDecision: (resp?.suggestedDecision ?? 'NEEDS_REVIEW') as AiSuggestedDecision,
        reasonCodes: resp?.reasonCodes ?? [],
        detectedAuthorities: resp?.detectedAuthorities ?? [],
        detectedLanguage: resp?.detectedLanguage ?? null,
        ocrTier: resp?.ocrTier ?? null,
        costCents: resp?.costCents ?? 0,
        cacheHit: resp?.cacheHit ?? false,
        autoApproved: false,
        modelVersion: resp?.modelVersion ?? null,
        errorMessage,
      },
    });
  }

  /** All guardrails for an automated ACCEPT. Conservative by design. */
  private shouldAutoApprove(
    resp: ParserResponse,
    item: { criticality: DocumentCriticality; status: DocumentItemStatus },
    version: { isCurrent: boolean; virusScanStatus: VirusScanStatus },
  ): boolean {
    return (
      this.autoApproveEnabled &&
      resp.suggestedDecision === 'APPROVE' &&
      resp.confidence >= this.minConfidence &&
      resp.checks.length > 0 &&
      resp.checks.every((c) => c.pass) &&
      // Hard exclusions:
      item.criticality !== DocumentCriticality.CRITICAL && // passports etc. always human
      item.status === DocumentItemStatus.SUBMITTED && // don't override a human/earlier decision
      version.isCurrent && // a newer version may have superseded this one
      version.virusScanStatus !== VirusScanStatus.INFECTED &&
      resp.ocrTier !== 'gpt4o_mini_vision' // never trust the desperate vision fallback
    );
  }

  private async autoApprove(
    version: { id: string; documentItemId: string; caseId: string },
    item: { documentName: string; validityRule: string | null; validityMonths: number | null; docType?: string | null },
    resp: ParserResponse,
    aiAssessmentId: string,
    clientId: string | null,
  ): Promise<void> {
    // Phase 4b — derive when this (now-accepted) document lapses so the
    // submission gate can block on it later.
    const validityExpiryDate = computeValidityExpiry(
      { validityRule: item.validityRule, validityMonths: item.validityMonths },
      resp.extracted,
    );
    await this.prisma.$transaction(async (tx) => {
      // Guard inside the tx against a race with a human review.
      const fresh = await tx.caseDocumentItem.findUnique({
        where: { id: version.documentItemId },
        select: { status: true },
      });
      if (fresh?.status !== DocumentItemStatus.SUBMITTED) return;

      await tx.documentReviewDecision.create({
        data: {
          documentItemId: version.documentItemId,
          versionId: version.id,
          decision: DocReviewDecisionType.ACCEPTED,
          rejectionReasonCodes: [],
          reviewedByUserId: null, // automated — no human reviewer
          isAutomated: true,
          aiAssessmentId,
        },
      });
      await tx.caseDocumentItem.update({
        where: { id: version.documentItemId },
        data: { status: DocumentItemStatus.ACCEPTED, validityExpiryDate },
      });
      await tx.documentAiAssessment.update({
        where: { id: aiAssessmentId },
        data: { autoApproved: true },
      });
      await tx.processingAuditLog.create({
        data: {
          caseId: version.caseId,
          actorUserId: null, // system action
          action: 'document_auto_approved',
          entityType: 'case_document_item',
          entityId: version.documentItemId,
          newValues: {
            decision: 'ACCEPTED',
            automated: true,
            detectedDocType: resp.detectedDocType,
            confidence: resp.confidence,
            reasonCodes: resp.reasonCodes,
            aiAssessmentId,
          },
        },
      });
    });

    // P4g: CRM auto-fill — best-effort, non-fatal.
    if (clientId && item.docType && resp.extracted && typeof resp.extracted === 'object') {
      void applyCrmAutoFill(
        this.prisma,
        clientId,
        item.docType,
        resp.extracted as Record<string, unknown>,
        version.caseId,
        null, // system action
      ).catch(() => {});
    }

    this.timeline
      .record({
        entityType: 'case_document_item',
        entityId: version.documentItemId,
        clientId: clientId ?? undefined,
        eventType: TimelineEventType.PROCESSING_DOCUMENT_ACCEPTED,
        description: `Document auto-approved by AI: ${item.documentName} (confidence ${(resp.confidence * 100).toFixed(0)}%)`,
        actorUserId: undefined,
        metadata: { caseId: version.caseId, itemId: version.documentItemId, automated: true },
      })
      .catch(() => {
        /* non-fatal */
      });

    // Central audit: surface the unattended AI auto-approve decision in the
    // who/what/when audit trail (the ProcessingAuditLog row above is the
    // processing-module feed; this is the central log our reports query).
    // actorUserId omitted = system. Fire-and-forget — never break the job.
    void this.audit
      .log({
        action: AuditAction.DOCUMENT_VERIFIED,
        entityType: 'CaseDocumentItem',
        entityId: version.documentItemId,
        category: AuditCategory.MUTATION,
        severity: AuditSeverity.HIGH,
        metadata: {
          caseId: version.caseId,
          autoApprovedBy: 'ai',
          verdict: resp.suggestedDecision,
          confidence: resp.confidence,
        },
      })
      .catch(() => undefined);

    this.log.log(`Auto-approved document item ${version.documentItemId} (case ${version.caseId})`);
  }
}
