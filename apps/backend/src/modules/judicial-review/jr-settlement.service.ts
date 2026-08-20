import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JrMatter, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RequestUser } from '../../common/types/auth.types';
import { JudicialReviewService } from './judicial-review.service';
import { OpenSuccessorDto, RecordSettlementDto } from './judicial-review.dto';
import { CURRENT_DEADLINE_RULE_SET_VERSION, toLegalDateUtc } from './jr-deadline-engine';

/**
 * Settlement recording + the successor-matter chain (PR 6) — the tail of the
 * JR-internal pipeline (§6.2).
 *
 *   - recordSettlement stores the structured DOJ terms. It does NOT move the
 *     stage: it makes the FILED | LEAVE_GRANTED → REDETERMINATION gate (which
 *     changeMatterStage owns) satisfiable, and keeps the ADDITIONAL_SUBMISSIONS
 *     sentinel deadline in sync so the sweeper can alert on the DOJ letter's date.
 *   - openSuccessorMatter opens a fresh-clock INTERNAL matter after a
 *     redetermination was decided and REFUSED, chains it to the source (prior ↔
 *     successor) and closes the source SUCCESSOR_MATTER_OPENED.
 *
 * A private copy of JudicialReviewService.writeMatterAudit (that one is private)
 * so every mutation writes its audit row inside the matter's own $transaction.
 */
@Injectable()
export class JrSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly jr: JudicialReviewService,
  ) {}

  /**
   * Record the structured settlement terms on a matter (§6.2). Every field is
   * optional (a settlement is recorded incrementally). An additional-submissions
   * settlement is refused without the DOJ letter's deadline — that date is what
   * the sweeper alerts on. Does NOT change the stage.
   */
  async recordSettlement(
    matterId: string,
    dto: RecordSettlementDto,
    user: RequestUser,
  ): Promise<JrMatter> {
    const matter = await this.jr.assertMatterAccess(matterId, user);

    // An additional-submissions settlement is worthless without the DOJ letter's
    // deadline — require it (unless one is already on the matter from an earlier
    // partial record).
    if (
      dto.termAdditionalSubmissions === true &&
      !dto.additionalSubmissionsDueAt &&
      !matter.additionalSubmissionsDueAt
    ) {
      throw new BadRequestException(
        'Additional-submissions settlements require additionalSubmissionsDueAt (the deadline from the DOJ letter).',
      );
    }

    const data: Prisma.JrMatterUpdateInput = { updatedByUserId: user.id };
    if (dto.settlementOfferedAt !== undefined)
      data.settlementOfferedAt = toLegalDateUtc(dto.settlementOfferedAt);
    if (dto.settlementAgreedAt !== undefined)
      data.settlementAgreedAt = toLegalDateUtc(dto.settlementAgreedAt);
    if (dto.settlementStage !== undefined) data.settlementStage = dto.settlementStage;
    if (dto.settlementArtifact !== undefined) data.settlementArtifact = dto.settlementArtifact;
    if (dto.termDiscontinuanceByApplicant !== undefined)
      data.termDiscontinuanceByApplicant = dto.termDiscontinuanceByApplicant;
    if (dto.termDecisionSetAside !== undefined)
      data.termDecisionSetAside = dto.termDecisionSetAside;
    if (dto.termDifferentOfficer !== undefined)
      data.termDifferentOfficer = dto.termDifferentOfficer;
    if (dto.termAdditionalSubmissions !== undefined)
      data.termAdditionalSubmissions = dto.termAdditionalSubmissions;
    if (dto.termNoCosts !== undefined) data.termNoCosts = dto.termNoCosts;
    // additionalSubmissionsDueAt is a @db.Date — normalize to its legal calendar day.
    if (dto.additionalSubmissionsDueAt !== undefined)
      data.additionalSubmissionsDueAt = toLegalDateUtc(dto.additionalSubmissionsDueAt);
    if (dto.additionalSubmissionsOffice !== undefined)
      data.additionalSubmissionsOffice = dto.additionalSubmissionsOffice;
    if (dto.settlementTermsOther !== undefined)
      data.settlementTermsOther = dto.settlementTermsOther;
    if (dto.dojCounselName !== undefined) data.dojCounselName = dto.dojCounselName;
    if (dto.dojCounselEmail !== undefined) data.dojCounselEmail = dto.dojCounselEmail;
    if (dto.dojRegionalOffice !== undefined) data.dojRegionalOffice = dto.dojRegionalOffice;
    if (dto.dojFileNumber !== undefined) data.dojFileNumber = dto.dojFileNumber;

    // The additional-submissions deadline after this write: the value just
    // supplied, else whatever was already on the matter.
    const effectiveDue = dto.additionalSubmissionsDueAt
      ? toLegalDateUtc(dto.additionalSubmissionsDueAt)
      : matter.additionalSubmissionsDueAt;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.jrMatter.update({ where: { id: matterId }, data });

      // Keep a matching sentinel JrDeadline in sync so the sweeper
      // (jr-alert-tiers ADDITIONAL_SUBMISSIONS) surfaces the DOJ letter's date.
      // Mirrors addUnderlyingDocWatch's non-computed sentinel pattern.
      if (effectiveDue) {
        const rule = await tx.jrDeadlineRule.findFirst({
          where: {
            ruleSetVersion: matter.deadlineRuleSetVersion,
            milestoneKey: 'ADDITIONAL_SUBMISSIONS',
          },
        });
        if (!rule) {
          throw new UnprocessableEntityException(
            'No ADDITIONAL_SUBMISSIONS rule seeded — run scripts/seed-jr-deadline-rules.ts.',
          );
        }
        const existing = await tx.jrDeadline.findFirst({
          where: { matterId, milestoneKey: 'ADDITIONAL_SUBMISSIONS', label: null },
        });
        if (existing) {
          await tx.jrDeadline.update({
            where: { id: existing.id },
            data: { anchorDate: effectiveDue, computedDueAt: effectiveDue },
          });
        } else {
          await tx.jrDeadline.create({
            data: {
              matterId,
              milestoneKey: 'ADDITIONAL_SUBMISSIONS',
              label: null,
              anchorDate: effectiveDue,
              anchorField: 'additionalSubmissionsDueAt',
              computedDueAt: effectiveDue,
              ruleId: rule.id,
              ruleSetVersion: rule.ruleSetVersion,
              isFatal: false,
              quotableToClient: true,
              status: 'PENDING',
            },
          });
        }
      }

      await this.writeMatterAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'settlement_recorded',
        entityId: matterId,
        newValues: {
          settlementArtifact: dto.settlementArtifact ?? null,
          termAdditionalSubmissions: dto.termAdditionalSubmissions ?? null,
          additionalSubmissionsDueAt: effectiveDue ? effectiveDue.toISOString() : null,
        },
      });
      return updated;
    });
  }

  /**
   * Open a fresh-clock successor matter after a redetermination was decided and
   * REFUSED (§6.2). The successor is an INTERNAL matter chained to the source
   * (priorMatterId), conflict-review required; the source is closed
   * SUCCESSOR_MATTER_OPENED. The fresh 15/60 clock runs from the refusal
   * notification date.
   */
  async openSuccessorMatter(
    matterId: string,
    dto: OpenSuccessorDto,
    user: RequestUser,
  ): Promise<JrMatter> {
    const source = await this.jr.assertMatterAccess(matterId, user);

    if (
      source.stage !== 'REDETERMINATION' ||
      source.redeterminationDecidedAt == null ||
      source.redeterminationApproved !== false
    ) {
      throw new UnprocessableEntityException(
        'Open a successor only after the redetermination has been decided and REFUSED ' +
          '(stage REDETERMINATION, redeterminationApproved=false).',
      );
    }
    if (source.successorMatterId) {
      throw new ConflictException('A successor matter has already been opened for this matter.');
    }

    // Mint the matter number BEFORE the tx (NumberingService is not tx-aware).
    const matterNumber = await this.numbering.next('JR');

    return this.prisma.$transaction(async (tx) => {
      const successor = await tx.jrMatter.create({
        data: {
          matterNumber,
          clientId: source.clientId,
          leadId: source.leadId,
          branchId: source.branchId,
          intakeType: 'INTERNAL',
          priorMatterId: source.id,
          decisionMaker: dto.decisionMaker ?? source.decisionMaker,
          applicationType: dto.applicationType ?? source.applicationType,
          deadlineRuleSetVersion: CURRENT_DEADLINE_RULE_SET_VERSION,
          createdByUserId: user.id,
          styleOfCause: dto.styleOfCause ?? source.styleOfCause,
          conflictReviewRequired: true,
          // Falls back to createdByUserId so the successor is never
          // conflict-review-deadlocked (§6.5 fails closed on a null filer — PR5).
          originalFilerUserId: source.assignedAssociateUserId ?? source.createdByUserId,
          // The fresh 15/60 clock anchor: prefer the caller's real refusal-
          // notification date; otherwise seed a DRAFT from the source's
          // redetermination-decided date (VERIFY against the refusal).
          decisionCommunicatedAt: dto.decisionCommunicatedAt
            ? toLegalDateUtc(dto.decisionCommunicatedAt)
            : source.redeterminationDecidedAt
              ? toLegalDateUtc(source.redeterminationDecidedAt.toISOString())
              : null,
          decisionCommunicatedNote:
            dto.decisionCommunicatedNote ??
            `DRAFT — successor to ${source.matterNumber}; the fresh 15/60 clock runs from the ` +
              'redetermination-refusal notification date. VERIFY against the refusal.',
        },
      });
      await this.writeMatterAudit(tx, {
        matterId: successor.id,
        actorUserId: user.id,
        action: 'matter_created',
        entityId: successor.id,
        newValues: { intakeType: 'INTERNAL', priorMatterId: source.id },
      });

      await tx.jrMatter.update({
        where: { id: source.id },
        data: {
          successorMatterId: successor.id,
          previousStage: 'REDETERMINATION',
          stage: 'CLOSED',
          closeReason: 'SUCCESSOR_MATTER_OPENED',
          closedAt: new Date(),
          updatedByUserId: user.id,
        },
      });
      await this.writeMatterAudit(tx, {
        matterId: source.id,
        actorUserId: user.id,
        action: 'successor_opened',
        entityId: source.id,
        oldValues: { stage: 'REDETERMINATION' },
        newValues: {
          successorMatterId: successor.id,
          closeReason: 'SUCCESSOR_MATTER_OPENED',
        },
      });

      // NOTE: auto-copying the source's carriedToRedetermination artifacts into
      // the successor (§11.2) is DEFERRED — it needs a StorageService byte-copy;
      // the associate re-links them via the artifact endpoints. The §11.2 money
      // resubmission engagement (new Agreement / invoice / Processing) is OUT OF
      // SCOPE for this PR.
      return successor;
    });
  }

  /**
   * Write a JrMatter audit row inside the caller's transaction. A private copy of
   * JudicialReviewService's helper (that one is private) so this service never
   * touches the audit table outside the matter's own $transaction.
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
