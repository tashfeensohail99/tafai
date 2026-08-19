import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JrMatter, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RequestUser } from '../../common/types/auth.types';
import { LeadsService } from '../leads/leads.service';
import { CreateExternalMatterDto, EscalateCaseDto } from './judicial-review.dto';
import { CURRENT_DEADLINE_RULE_SET_VERSION, toLegalDateUtc } from './jr-deadline-engine';

/**
 * JR intake (§11.1) — the ONLY writers of new JrMatter rows. Two paths:
 *
 *   - EXTERNAL: a decision the client brings in from outside our processing.
 *     Identity is reused, never duplicated — attach to an existing client/lead,
 *     or create a new lead+client (which HARD-blocks on a duplicate phone/email,
 *     letting the caller retry with attachTo*).
 *   - INTERNAL: escalate one of our own REFUSED ProcessingCases. Conflict review
 *     is required and the original filer is recorded so §6.5 can enforce a
 *     genuine second set of eyes.
 *
 * Identity resolution (leads.create / convertToClient) runs OUTSIDE the matter
 * transaction — those helpers write audit + timeline on a separate connection,
 * and wrapping them in an interactive $transaction 500s. The matter + its audit
 * (and, for INTERNAL, the seeded rejection note) are written atomically in one
 * $transaction.
 */
@Injectable()
export class JrIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * Open a new EXTERNAL matter. Resolves `{ clientId, leadId }` first (outside
   * the tx), then mints the matter number and writes the matter + audit in one
   * transaction.
   */
  async createExternalMatter(dto: CreateExternalMatterDto, user: RequestUser): Promise<JrMatter> {
    // 0. Exactly one identity mode — reject an ambiguous mix so a stale
    //    attachTo* + fresh new-client details can't silently attach to the wrong
    //    person and drop the typed-in one.
    const hasNewClient = Boolean(dto.firstName || dto.lastName || dto.phone || dto.email);
    const modeCount =
      (dto.attachToClientId ? 1 : 0) + (dto.attachToLeadId ? 1 : 0) + (hasNewClient ? 1 : 0);
    if (modeCount > 1) {
      throw new BadRequestException(
        'Provide exactly one identity: attachToClientId, attachToLeadId, or new-client details — not several.',
      );
    }

    // 1. Resolve identity BEFORE any tx (convertToClient / leads.create must not
    //    run inside an interactive $transaction).
    let clientId: string;
    let leadId: string;

    if (dto.attachToClientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: dto.attachToClientId, deletedAt: null },
      });
      if (!client) throw new NotFoundException('Client not found.');
      const lead = await this.prisma.lead.findFirst({
        where: { convertedClientId: dto.attachToClientId, deletedAt: null },
      });
      if (!lead) {
        throw new BadRequestException(
          'This client has no source lead; JR requires a lead. Use attachToLeadId or new-client intake.',
        );
      }
      clientId = dto.attachToClientId;
      leadId = lead.id;
    } else if (dto.attachToLeadId) {
      const { client } = await this.leads.convertToClient(dto.attachToLeadId, user.id);
      clientId = client.id;
      leadId = dto.attachToLeadId;
    } else {
      if (!(dto.firstName && dto.lastName && dto.phone)) {
        throw new BadRequestException(
          'New-client intake requires firstName, lastName, phone — or pass attachToLeadId/attachToClientId.',
        );
      }
      // leads.create THROWS ConflictException (409 with the matching lead/client)
      // on a duplicate phone/email — do NOT catch it; the caller retries with
      // attachTo* against the returned match.
      const lead = await this.leads.create(
        {
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          email: dto.email,
          branchId: dto.branchId,
        },
        user.id,
      );
      const { client } = await this.leads.convertToClient(lead.id, user.id);
      clientId = client.id;
      leadId = lead.id;
    }

    // 2. Mint the matter number (NumberingService is not tx-aware — call before).
    const matterNumber = await this.numbering.next('JR');

    // 3. Write the matter + audit atomically.
    return this.prisma.$transaction(async (tx) => {
      const matter = await tx.jrMatter.create({
        data: {
          matterNumber,
          clientId,
          leadId,
          branchId: dto.branchId ?? null,
          intakeType: 'EXTERNAL',
          decisionMaker: dto.decisionMaker,
          applicationType: dto.applicationType,
          deadlineRuleSetVersion: CURRENT_DEADLINE_RULE_SET_VERSION,
          createdByUserId: user.id,
          styleOfCause: dto.styleOfCause ?? null,
          // ALJR anchor — normalized to its legal calendar day.
          decisionCommunicatedAt: toLegalDateUtc(dto.decisionCommunicatedAt),
          decisionCommunicatedNote: dto.decisionCommunicatedNote,
          decisionLetterDate: dto.decisionLetterDate
            ? toLegalDateUtc(dto.decisionLetterDate)
            : null,
          decidingOfficeLocation: dto.decidingOfficeLocation ?? undefined, // default UNKNOWN
        },
      });
      await this.writeMatterAudit(tx, {
        matterId: matter.id,
        actorUserId: user.id,
        action: 'matter_created',
        entityId: matter.id,
        newValues: { intakeType: 'EXTERNAL', matterNumber },
      });
      return matter;
    });
  }

  /**
   * Escalate a REFUSED ProcessingCase to an INTERNAL JR matter. Client + lead are
   * reused from the case, conflict review is required, and the case's assigned
   * officer is recorded as the original filer (§6.5 reads this to bar them from
   * clearing the review). The refusal reason is seeded as a JrNote.
   */
  async escalateFromCase(
    caseId: string,
    dto: EscalateCaseDto,
    user: RequestUser,
  ): Promise<JrMatter> {
    // 1. The case must exist.
    const kase = await this.prisma.processingCase.findFirst({ where: { id: caseId } });
    if (!kase) throw new NotFoundException('Processing case not found.');

    // 2. It must be refused — checked BOTH ways (mirrors listRefundLane): a case
    //    is refused if either the stage or the authority decision says REJECTED.
    if (kase.stage !== 'REJECTED' && kase.authorityDecision !== 'REJECTED') {
      throw new UnprocessableEntityException(
        'This case is not refused (needs stage REJECTED or authorityDecision REJECTED) — cannot escalate to JR.',
      );
    }

    // 3. The original filer must be knowable. conflictReviewRequired is always
    //    true for an INTERNAL matter, and §6.5 clearConflictReview FAILS CLOSED
    //    when originalFilerUserId is null — so escalating a case with no assigned
    //    officer would create a matter that can never clear review nor advance
    //    past ROUTE_DETERMINED. Reject here rather than manufacture a dead file.
    if (!kase.assignedOfficerId) {
      throw new UnprocessableEntityException(
        'Cannot escalate: this case has no assigned officer, so the original filer cannot be recorded ' +
          'for the conflict-review independence check. Assign an officer to the case first.',
      );
    }

    // 4. One JR matter per case. Check-then-create — a residual race exists for two
    //    simultaneous escalations of the same case (there is no DB unique index on
    //    originCaseId; that would be a migration). Deliberate for v1.
    if (await this.prisma.jrMatter.findFirst({ where: { originCaseId: caseId } })) {
      throw new ConflictException('This case has already been escalated to a JR matter.');
    }

    // 4. Pull the recorded rejection reason (most recent REJECTED history row).
    const hist = await this.prisma.processingCaseStageHistory.findFirst({
      where: { caseId, toStage: 'REJECTED' },
      orderBy: { createdAt: 'desc' },
    });
    const reasonText = hist?.notes ?? hist?.reason ?? null;

    // 5. Mint the matter number (not tx-aware — before the tx).
    const matterNumber = await this.numbering.next('JR');

    // NOTE: auto-copying the case's application documents into JrArtifact rows
    // (§11.1 step 7) is DEFERRED to a later PR — it needs a StorageService
    // byte-copy, and StorageService silently fakes success in LOCAL mode (a
    // fake copy would leave the artifacts unreadable). For now the associate
    // links/uploads them via the artifact endpoints.

    // 6. Write the matter, the seeded note, and the audit atomically.
    return this.prisma.$transaction(async (tx) => {
      const matter = await tx.jrMatter.create({
        data: {
          matterNumber,
          clientId: kase.clientId,
          leadId: kase.leadId,
          branchId: kase.branchId ?? null,
          intakeType: 'INTERNAL',
          originCaseId: kase.id,
          conflictReviewRequired: true,
          // ⚠ the field PR3 conflict-review reads to enforce independence.
          originalFilerUserId: kase.assignedOfficerId ?? null,
          decisionMaker: dto.decisionMaker,
          applicationType: dto.applicationType,
          deadlineRuleSetVersion: CURRENT_DEADLINE_RULE_SET_VERSION,
          createdByUserId: user.id,
          // The ALJR clock anchor: prefer the caller's real notification date;
          // otherwise seed a DRAFT from the case's authority-decision date (a
          // @db.Date — feed its ISO day to the normalizer). If neither exists the
          // anchor stays null and is set later via updateMatter (the INTAKE→
          // ROUTE_DETERMINED gate blocks the matter until it is supplied).
          decisionCommunicatedAt: dto.decisionCommunicatedAt
            ? toLegalDateUtc(dto.decisionCommunicatedAt)
            : kase.authorityDecisionDate
              ? toLegalDateUtc(kase.authorityDecisionDate.toISOString())
              : null,
          decisionCommunicatedNote:
            dto.decisionCommunicatedNote ??
            (dto.decisionCommunicatedAt
              ? null
              : 'DRAFT — seeded from ProcessingCase.authorityDecisionDate; VERIFY against the refusal email (the authority decision date is when the officer decided, not when the client was notified).'),
        },
      });
      if (reasonText) {
        await tx.jrNote.create({
          data: {
            matterId: matter.id,
            authorUserId: user.id,
            content: `Escalated from processing case ${kase.id}. Recorded rejection reason: ${reasonText}`,
          },
        });
      }
      await this.writeMatterAudit(tx, {
        matterId: matter.id,
        actorUserId: user.id,
        action: 'matter_created',
        entityId: matter.id,
        newValues: {
          intakeType: 'INTERNAL',
          originCaseId: kase.id,
          originalFilerUserId: kase.assignedOfficerId ?? null,
        },
      });
      return matter;
    });
  }

  /**
   * Write a JrMatter audit row inside the caller's transaction. A private copy of
   * JudicialReviewService's helper (that one is private) so intake never touches
   * the audit table outside the matter's own $transaction.
   */
  private async writeMatterAudit(
    tx: Prisma.TransactionClient,
    input: {
      matterId: string;
      actorUserId: string;
      action: string;
      entityId: string;
      oldValues?: Prisma.InputJsonValue;
      newValues?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.jrAuditLog.create({
      data: {
        matterId: input.matterId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: 'JrMatter',
        entityId: input.entityId,
        oldValues: input.oldValues,
        newValues: input.newValues,
      },
    });
  }
}
