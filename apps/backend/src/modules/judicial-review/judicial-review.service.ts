import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JrArtifactType, JrMatter, JrMatterStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import {
  AssignMatterDto,
  ChangeStageDto,
  ClearConflictReviewDto,
  DetermineRouteDto,
  ListMattersQueryDto,
  RecordMeritsDto,
  SetCounselOfRecordDto,
  UpdateMatterDto,
} from './judicial-review.dto';
import { JR_ALLOWED_TRANSITIONS, JR_TERMINAL_STAGES } from './jr-stage-machine';
import { CitizenshipMatterError, determineRoute as computeRoute } from './jr-route-tree';
import { JrDeadlinesService } from './jr-deadlines.service';
import { toLegalDateUtc } from './jr-deadline-engine';

/**
 * Core Judicial Review service (PR 1 foundation). Holds the matter-access guard
 * and a read surface for matters. The stage machine, route tree and deadline
 * engine land in later PRs.
 */
@Injectable()
export class JudicialReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deadlines: JrDeadlinesService,
  ) {}

  /**
   * List JR matters visible to the caller. `jr.matter.view_all` sees every
   * matter; everyone else is scoped to the matters assigned to them. The scope
   * constraint is ALWAYS ANDed in via an AND: [] array so an added filter can
   * never silently drop it (the double-OR-spread leak, #253).
   */
  async listMatters(
    query: ListMattersQueryDto,
    user: RequestUser,
  ): Promise<
    Array<
      JrMatter & {
        clientName: string | null;
        clientPhone: string | null;
        clientReferenceCode: string | null;
      }
    >
  > {
    const scopeConstraint: Prisma.JrMatterWhereInput = user.permissions.includes(
      'jr.matter.view_all',
    )
      ? {}
      : { assignedAssociateUserId: user.id };

    const filters: Prisma.JrMatterWhereInput[] = [];
    if (query.stage) filters.push({ stage: query.stage });
    if (query.intakeType) filters.push({ intakeType: query.intakeType });
    if (query.search) {
      filters.push({
        OR: [
          { matterNumber: { contains: query.search, mode: 'insensitive' } },
          { styleOfCause: { contains: query.search, mode: 'insensitive' } },
          { courtFileNumber: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.JrMatterWhereInput = {
      AND: [scopeConstraint, ...filters],
    };

    const matters = await this.prisma.jrMatter.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 50,
    });

    // clientId is a bare crm.Client id (no Prisma relation) — enrich the rows
    // with a name/phone/reference in ONE batched query so the console can show
    // who each matter is for (never a per-row lookup).
    const clientIds = [...new Set(matters.map((m) => m.clientId).filter(Boolean))];
    const clients = clientIds.length
      ? await this.prisma.client.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, firstName: true, lastName: true, phone: true, referenceCode: true },
        })
      : [];
    const clientById = new Map(clients.map((c) => [c.id, c]));

    return matters.map((m) => {
      const c = clientById.get(m.clientId);
      return {
        ...m,
        clientName: c ? `${c.firstName} ${c.lastName}`.trim() : null,
        clientPhone: c?.phone ?? null,
        clientReferenceCode: c?.referenceCode ?? null,
      };
    });
  }

  /** Load a single matter, enforcing per-matter access. */
  async getMatter(matterId: string, user: RequestUser): Promise<JrMatter> {
    return this.assertMatterAccess(matterId, user);
  }

  /**
   * Load a single matter together with its (relation-less) crm.Client for the
   * console detail view. clientId is a bare Client id, so the client is fetched
   * separately — returns null if the client row is gone.
   */
  async getMatterDetail(
    matterId: string,
    user: RequestUser,
  ): Promise<
    JrMatter & {
      client: {
        firstName: string;
        lastName: string;
        phone: string | null;
        email: string | null;
        referenceCode: string;
      } | null;
    }
  > {
    const matter = await this.assertMatterAccess(matterId, user);
    const client = await this.prisma.client.findFirst({
      where: { id: matter.clientId },
      select: {
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        referenceCode: true,
      },
    });
    return { ...matter, client: client ?? null };
  }

  /**
   * Enforce per-matter access and return the matter. Public so the artifact
   * lifecycle service can gate every artifact mutation on the owning matter
   * (never relies on list scoping alone — #253/#255).
   */
  async assertMatterAccess(matterId: string, user: RequestUser): Promise<JrMatter> {
    const matter = await this.prisma.jrMatter.findFirst({ where: { id: matterId } });
    if (!matter) throw new NotFoundException('Matter not found');
    if (user.permissions.includes('jr.matter.view_all')) return matter;
    if (matter.assignedAssociateUserId !== user.id) {
      throw new ForbiddenException('You are not assigned to this matter');
    }
    return matter;
  }

  // ---------------------------------------------------------------------------
  // The stage machine (§6.1 map + §6.2 gates)
  // ---------------------------------------------------------------------------

  /**
   * The gated stage machine. Access-checks the matter, refuses a move out of a
   * terminal stage, refuses an illegal transition (naming both stages), runs the
   * §6.2 gate for the specific transition, and — for any → CLOSED — requires a
   * closeReason. The new stage, any transition-stamped fields and a JrAuditLog
   * row are written in ONE transaction.
   */
  async changeMatterStage(
    matterId: string,
    dto: ChangeStageDto,
    user: RequestUser,
  ): Promise<JrMatter> {
    const matter = await this.assertMatterAccess(matterId, user);
    const current = matter.stage;
    const target = dto.targetStage;

    // 2. A terminal stage (CLOSED) admits no further transitions.
    if (JR_TERMINAL_STAGES.has(current)) {
      throw new UnprocessableEntityException(
        `Matter is in a terminal stage (${current}); no further transitions are allowed.`,
      );
    }

    // 3. The transition must be in the frozen map.
    const allowed = JR_ALLOWED_TRANSITIONS[current] ?? [];
    if (!allowed.includes(target)) {
      throw new UnprocessableEntityException(
        `Illegal transition ${current} → ${target}. Allowed from ${current}: ${
          allowed.length ? allowed.join(', ') : '(none)'
        }.`,
      );
    }

    // 5. Closing a matter requires a reason.
    if (target === 'CLOSED' && !dto.closeReason) {
      throw new UnprocessableEntityException('Closing a matter requires a closeReason.');
    }

    // 4. The per-transition gate (§6.2). Returns any transition-stamped fields.
    const stamped = await this.assertTransitionGate(matter, target, dto, user);

    // 6. Persist stage + stamped fields + the audit row in one transaction.
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const data: Prisma.JrMatterUpdateInput = {
        stage: target,
        stageEnteredAt: now,
        updatedByUserId: user.id,
        ...stamped,
      };
      if (target === 'CLOSED') {
        data.closeReason = dto.closeReason!;
        data.closedAt = now;
      }
      const newValues: Prisma.InputJsonObject =
        target === 'CLOSED'
          ? { stage: target, closeReason: dto.closeReason! }
          : { stage: target };
      // Optimistic-concurrency guard: the WHERE stage=current is evaluated
      // atomically with the write, so two concurrent transitions from the same
      // stage can't both land — the loser matches 0 rows and is rejected.
      const applied = await tx.jrMatter.updateMany({
        where: { id: matterId, stage: current },
        data: data as Prisma.JrMatterUpdateManyMutationInput,
      });
      if (applied.count === 0) {
        throw new ConflictException(
          `This matter is no longer in ${current} (its stage changed while you were working). Reload and try again.`,
        );
      }
      const next = await tx.jrMatter.findFirstOrThrow({ where: { id: matterId } });
      await this.writeMatterAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'stage_changed',
        entityId: matterId,
        oldValues: { stage: current },
        newValues,
      });
      // Stage (and any stamped anchors) can change which deadlines apply — recompute
      // inside the same transaction so the ledger never lags the matter.
      await this.deadlines.recomputeDeadlines(matterId, user.id, tx);
      return next;
    });
  }

  /**
   * The §6.2 gate table, as `if` statements per specific transition. Throws an
   * UnprocessableEntityException naming the missing precondition. Returns the
   * fields the transition stamps onto the matter (so they are written atomically
   * with the stage change).
   */
  private async assertTransitionGate(
    matter: JrMatter,
    target: JrMatterStage,
    dto: ChangeStageDto,
    user: RequestUser,
  ): Promise<Prisma.JrMatterUpdateInput> {
    const stamped: Prisma.JrMatterUpdateInput = {};

    // INTAKE → ROUTE_DETERMINED
    if (matter.stage === 'INTAKE' && target === 'ROUTE_DETERMINED') {
      if (!user.permissions.includes('jr.route.determine')) {
        throw new ForbiddenException(
          'Advancing to ROUTE_DETERMINED requires the jr.route.determine permission.',
        );
      }
      if (!matter.decisionMaker) {
        throw new UnprocessableEntityException(
          'Cannot advance to ROUTE_DETERMINED: decisionMaker is not set.',
        );
      }
      if (!matter.decisionCommunicatedAt) {
        throw new UnprocessableEntityException(
          'Cannot advance to ROUTE_DETERMINED: decisionCommunicatedAt (the clock anchor) is not set.',
        );
      }
      await this.assertArtifactExists(matter.id, 'REFUSAL_LETTER', 'ROUTE_DETERMINED');
      return stamped;
    }

    // ROUTE_DETERMINED → MERITS_REVIEW
    if (matter.stage === 'ROUTE_DETERMINED' && target === 'MERITS_REVIEW') {
      if (matter.route !== 'FEDERAL_COURT') {
        throw new UnprocessableEntityException(
          `Cannot advance to MERITS_REVIEW: route must be FEDERAL_COURT (it is ${matter.route}). ` +
            'IAD / RAD / NO_RECOURSE routes are terminal referrals, not Federal Court matters.',
        );
      }
      if (matter.appealRightExhausted !== true) {
        throw new UnprocessableEntityException(
          'Cannot advance to MERITS_REVIEW: appealRightExhausted must be true ' +
            '(IRPA s.72(2)(a) — filing where an IAD appeal lies is fatal).',
        );
      }
      if (matter.intakeType === 'INTERNAL' && !matter.conflictReviewClearedAt) {
        throw new UnprocessableEntityException(
          'Cannot advance to MERITS_REVIEW: an INTERNAL matter requires conflict review to be cleared first.',
        );
      }
      return stamped;
    }

    // MERITS_REVIEW → RETAINED
    if (matter.stage === 'MERITS_REVIEW' && target === 'RETAINED') {
      if (matter.meritsRecommendation !== 'FILE_JR') {
        throw new UnprocessableEntityException(
          'Cannot RETAIN: meritsRecommendation must be FILE_JR.',
        );
      }
      if (
        !matter.meritsAssessedByCounselId ||
        !(await this.isLiveCounsel(matter.meritsAssessedByCounselId))
      ) {
        throw new UnprocessableEntityException(
          'Cannot RETAIN: meritsAssessedByCounselId must resolve to a live counsel.',
        );
      }
      if (!matter.counselOfRecordId) {
        throw new UnprocessableEntityException('Cannot RETAIN: counselOfRecordId is not set.');
      }
      if (!matter.counselRetainerSignedAt) {
        throw new UnprocessableEntityException(
          'Cannot RETAIN: counselRetainerSignedAt is not set.',
        );
      }
      await this.assertArtifactExists(matter.id, 'ENGAGEMENT_LETTER', 'RETAINED');
      if (!matter.expectationsAcknowledgedAt) {
        throw new UnprocessableEntityException(
          'Cannot RETAIN: expectationsAcknowledgedAt is not set.',
        );
      }
      if (!matter.alternativesSheetSignedAt) {
        throw new UnprocessableEntityException(
          'Cannot RETAIN: alternativesSheetSignedAt is not set.',
        );
      }
      return stamped;
    }

    // MERITS_REVIEW → COUNSEL_DECLINED — allowed (loops back to MERITS_REVIEW
    // with a different counsel later). No extra gate.
    if (matter.stage === 'MERITS_REVIEW' && target === 'COUNSEL_DECLINED') {
      return stamped;
    }

    // RETAINED | REQUIRES_EXTENSION_REQUEST → FILED
    if (
      (matter.stage === 'RETAINED' || matter.stage === 'REQUIRES_EXTENSION_REQUEST') &&
      target === 'FILED'
    ) {
      await this.assertAljrFiled(matter.id);
      if (!matter.courtFileNumber) {
        throw new UnprocessableEntityException(
          'Cannot mark FILED: courtFileNumber is not set (set it via PATCH /jr/matters/:matterId first).',
        );
      }
      if (matter.reasonsPleadedAsReceived === null || matter.reasonsPleadedAsReceived === undefined) {
        throw new UnprocessableEntityException(
          'Cannot mark FILED: reasonsPleadedAsReceived must be supplied (the IR-1 field that forks Rule 9).',
        );
      }
      const decidingOfficeLocation = dto.decidingOfficeLocation ?? matter.decidingOfficeLocation;
      const decidingOfficeSourceNote = dto.decidingOfficeSourceNote ?? matter.decidingOfficeSourceNote;
      if (!decidingOfficeLocation || decidingOfficeLocation === 'UNKNOWN') {
        throw new UnprocessableEntityException(
          'Cannot mark FILED: decidingOfficeLocation must be asserted (IN_CANADA or OUTSIDE_CANADA), ' +
            'not UNKNOWN — it is asserted on the filed Form IR-1.',
        );
      }
      if (!decidingOfficeSourceNote) {
        throw new UnprocessableEntityException(
          'Cannot mark FILED: decidingOfficeSourceNote is required when decidingOfficeLocation is asserted.',
        );
      }
      // TODO(PR4): if the ALJR_FILING deadline has passed, force REQUIRES_EXTENSION_REQUEST.
      stamped.decidingOfficeLocation = decidingOfficeLocation;
      stamped.decidingOfficeSourceNote = decidingOfficeSourceNote;
      return stamped;
    }

    // RETAINED → REQUIRES_EXTENSION_REQUEST (the four Hennelly narrative fields)
    if (target === 'REQUIRES_EXTENSION_REQUEST') {
      const { hennellyIntention, hennellyMerit, hennellyPrejudice, hennellyExplanation } = dto;
      if (
        !this.isNonEmpty(hennellyIntention) ||
        !this.isNonEmpty(hennellyMerit) ||
        !this.isNonEmpty(hennellyPrejudice) ||
        !this.isNonEmpty(hennellyExplanation)
      ) {
        throw new UnprocessableEntityException(
          'Cannot request an extension: all four Hennelly narrative fields ' +
            '(intention, merit, prejudice, explanation) are required and must be non-empty.',
        );
      }
      stamped.hennellyIntention = hennellyIntention!.trim();
      stamped.hennellyMerit = hennellyMerit!.trim();
      stamped.hennellyPrejudice = hennellyPrejudice!.trim();
      stamped.hennellyExplanation = hennellyExplanation!.trim();
      stamped.extensionRequested = true;
      return stamped;
    }

    // FILED → LEAVE_GRANTED
    if (matter.stage === 'FILED' && target === 'LEAVE_GRANTED') {
      if (!dto.leaveDecidedAt) {
        throw new UnprocessableEntityException('Cannot mark LEAVE_GRANTED: leaveDecidedAt is required.');
      }
      if (!dto.leaveOrderAt) {
        throw new UnprocessableEntityException('Cannot mark LEAVE_GRANTED: leaveOrderAt is required.');
      }
      if (dto.leaveGranted !== true) {
        throw new UnprocessableEntityException('Cannot mark LEAVE_GRANTED: leaveGranted must be true.');
      }
      stamped.leaveDecidedAt = new Date(dto.leaveDecidedAt);
      // leaveOrderAt is the POST_LEAVE_SETTLEMENT deadline anchor — normalize to the
      // stated UTC calendar day (toLegalDateUtc) so a time-of-day can't drift it.
      stamped.leaveOrderAt = toLegalDateUtc(dto.leaveOrderAt);
      stamped.leaveGranted = true;
      return stamped;
    }

    // FILED | LEAVE_GRANTED → REDETERMINATION
    if (
      (matter.stage === 'FILED' || matter.stage === 'LEAVE_GRANTED') &&
      target === 'REDETERMINATION'
    ) {
      const settled = matter.settlementAgreedAt !== null;
      const allowedAtHearing = matter.applicationAllowed === true;
      if (!settled && !allowedAtHearing) {
        throw new UnprocessableEntityException(
          'Cannot advance to REDETERMINATION: the matter must be settled (settlementAgreedAt) ' +
            'or allowed (applicationAllowed).',
        );
      }
      if (settled) {
        if (!matter.settlementArtifact) {
          throw new UnprocessableEntityException(
            'Cannot advance to REDETERMINATION: a settled matter requires settlementArtifact to be set.',
          );
        }
        const requiredType: JrArtifactType =
          matter.settlementArtifact === 'CONSENT_JUDGMENT'
            ? 'CONSENT_JUDGMENT'
            : 'NOTICE_OF_DISCONTINUANCE';
        await this.assertArtifactServed(matter.id, requiredType);
      }
      stamped.redeterminationStartedAt = new Date();
      return stamped;
    }

    // REDETERMINATION → CLOSED
    if (matter.stage === 'REDETERMINATION' && target === 'CLOSED') {
      if (!dto.redeterminationDecidedAt) {
        throw new UnprocessableEntityException(
          'Cannot close from REDETERMINATION: redeterminationDecidedAt is required.',
        );
      }
      if (dto.redeterminationApproved === undefined || dto.redeterminationApproved === null) {
        throw new UnprocessableEntityException(
          'Cannot close from REDETERMINATION: redeterminationApproved is required.',
        );
      }
      stamped.redeterminationDecidedAt = new Date(dto.redeterminationDecidedAt);
      stamped.redeterminationApproved = dto.redeterminationApproved;
      return stamped;
    }

    // Any other → CLOSED needs only closeReason (already enforced in the caller).
    return stamped;
  }

  /**
   * Enter CLIENT_UNRESPONSIVE. NOT via the map: stamps previousStage + the aging
   * counter (unresponsiveSinceAt). Only from a non-terminal, non-unresponsive
   * stage.
   */
  async markUnresponsive(matterId: string, user: RequestUser): Promise<JrMatter> {
    const matter = await this.assertMatterAccess(matterId, user);
    if (matter.stage === 'CLIENT_UNRESPONSIVE') {
      throw new UnprocessableEntityException('Matter is already CLIENT_UNRESPONSIVE.');
    }
    if (JR_TERMINAL_STAGES.has(matter.stage)) {
      throw new UnprocessableEntityException(
        `Cannot mark unresponsive from a terminal stage (${matter.stage}).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const next = await tx.jrMatter.update({
        where: { id: matterId },
        data: {
          previousStage: matter.stage,
          unresponsiveSinceAt: now,
          stage: 'CLIENT_UNRESPONSIVE',
          stageEnteredAt: now,
          updatedByUserId: user.id,
        },
      });
      await this.writeMatterAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'marked_unresponsive',
        entityId: matterId,
        oldValues: { stage: matter.stage },
        newValues: { stage: 'CLIENT_UNRESPONSIVE', previousStage: matter.stage },
      });
      return next;
    });
  }

  /** Leave CLIENT_UNRESPONSIVE — restore previousStage and clear the aging counter. */
  async resumeFromUnresponsive(matterId: string, user: RequestUser): Promise<JrMatter> {
    const matter = await this.assertMatterAccess(matterId, user);
    if (matter.stage !== 'CLIENT_UNRESPONSIVE') {
      throw new UnprocessableEntityException('Matter is not CLIENT_UNRESPONSIVE.');
    }
    if (!matter.previousStage) {
      throw new UnprocessableEntityException('Cannot resume: no previousStage was recorded.');
    }
    const restore = matter.previousStage;

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const next = await tx.jrMatter.update({
        where: { id: matterId },
        data: {
          stage: restore,
          stageEnteredAt: now,
          previousStage: null,
          unresponsiveSinceAt: null,
          updatedByUserId: user.id,
        },
      });
      await this.writeMatterAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'resumed_from_unresponsive',
        entityId: matterId,
        oldValues: { stage: 'CLIENT_UNRESPONSIVE' },
        newValues: { stage: restore },
      });
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Route determination (§6.4)
  // ---------------------------------------------------------------------------

  /**
   * Run the §6.4 route decision tree and persist the result. A citizenship
   * refusal is rejected (BadRequestException) — v1 does NOT silently apply
   * 15/60. For a terminal referral (IAD/RAD) the route is recorded; the
   * IAD_APPEAL JrDeadline + auto-close land in PR 4.
   */
  async determineRoute(
    matterId: string,
    dto: DetermineRouteDto,
    user: RequestUser,
  ): Promise<JrMatter> {
    const matter = await this.assertMatterAccess(matterId, user);

    let result;
    try {
      result = computeRoute({
        decisionMaker: matter.decisionMaker,
        applicationType: matter.applicationType,
        sponsorshipRelationship: dto.sponsorshipRelationship ?? null,
        inadmissibilityGround: dto.inadmissibilityGround ?? null,
        rpdS110Exclusion: dto.rpdS110Exclusion,
        hasS63AppealRight: dto.hasS63AppealRight,
        isCitizenshipMatter: dto.isCitizenshipMatter,
      });
    } catch (err) {
      if (err instanceof CitizenshipMatterError) throw new BadRequestException(err.message);
      throw err;
    }

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrMatter.update({
        where: { id: matterId },
        data: {
          route: result.route,
          routeReasoning: result.reasoning,
          routeDeterminedByUserId: user.id,
          routeDeterminedAt: new Date(),
          sponsorshipRelationship: dto.sponsorshipRelationship ?? null,
          inadmissibilityGround: dto.inadmissibilityGround ?? null,
          appealRightExhausted: dto.appealRightExhausted,
          updatedByUserId: user.id,
        },
      });
      // TODO(PR4): for a terminal referral (IAD/RAD), create the IAD_APPEAL
      // JrDeadline (30 days) and close the matter REFERRED_IAD / REFERRED_RAD.
      // The intended close reason is recorded on the audit row below.
      await this.writeMatterAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'route_determined',
        entityId: matterId,
        oldValues: { route: matter.route },
        newValues: {
          route: result.route,
          reasoning: result.reasoning,
          terminalReferralCloseReason: result.terminalReferralCloseReason ?? null,
        },
      });
      // Route decides the milestone set (Federal Court vs IAD/RAD referral clock) —
      // recompute inside the same transaction.
      await this.deadlines.recomputeDeadlines(matterId, user.id, tx);
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Non-gated edits + assignment + counsel + conflict review
  // ---------------------------------------------------------------------------

  /**
   * Edit ONLY non-gated fields (court file number, DOJ counsel + LEX number,
   * hearing details, procedural dates). Never touches stage / route /
   * counselOfRecordId / decidingOfficeLocation — the whitelisted DTO cannot
   * carry those, and this mapping never sets them.
   */
  async updateMatter(matterId: string, dto: UpdateMatterDto, user: RequestUser): Promise<JrMatter> {
    await this.assertMatterAccess(matterId, user);

    const data: Prisma.JrMatterUpdateInput = { updatedByUserId: user.id };
    // Case-identity fields editable from the console detail form.
    if (dto.styleOfCause !== undefined) data.styleOfCause = dto.styleOfCause;
    if (dto.decisionMaker !== undefined) data.decisionMaker = dto.decisionMaker;
    if (dto.applicationType !== undefined) data.applicationType = dto.applicationType;
    if (dto.decisionLetterDate !== undefined)
      data.decisionLetterDate = new Date(dto.decisionLetterDate);
    if (dto.courtFileNumber !== undefined) data.courtFileNumber = dto.courtFileNumber;
    if (dto.registryOffice !== undefined) data.registryOffice = dto.registryOffice;
    if (dto.neutralCitation !== undefined) data.neutralCitation = dto.neutralCitation;
    if (dto.presidingJudge !== undefined) data.presidingJudge = dto.presidingJudge;
    if (dto.hearingCity !== undefined) data.hearingCity = dto.hearingCity;
    if (dto.hearingLanguage !== undefined) data.hearingLanguage = dto.hearingLanguage;
    if (dto.dojCounselName !== undefined) data.dojCounselName = dto.dojCounselName;
    if (dto.dojCounselEmail !== undefined) data.dojCounselEmail = dto.dojCounselEmail;
    if (dto.dojRegionalOffice !== undefined) data.dojRegionalOffice = dto.dojRegionalOffice;
    if (dto.dojFileNumber !== undefined) data.dojFileNumber = dto.dojFileNumber;
    if (dto.reasonsPleadedAsReceived !== undefined)
      data.reasonsPleadedAsReceived = dto.reasonsPleadedAsReceived;
    if (dto.rule9ResponseType !== undefined) data.rule9ResponseType = dto.rule9ResponseType;
    if (dto.rule9RespondingOffice !== undefined)
      data.rule9RespondingOffice = dto.rule9RespondingOffice;
    // Deadline ANCHORS (the fields the engine keys off) are normalized to the UTC
    // calendar day the client stated, so a zoned time-of-day can never drift a
    // fatal date (toLegalDateUtc). Non-anchor timestamps keep their raw instant.
    if (dto.aljrFiledAt !== undefined) data.aljrFiledAt = toLegalDateUtc(dto.aljrFiledAt);
    if (dto.aljrServedAt !== undefined) data.aljrServedAt = toLegalDateUtc(dto.aljrServedAt);
    if (dto.noaReceivedAt !== undefined) data.noaReceivedAt = new Date(dto.noaReceivedAt);
    if (dto.rule9RequestedAt !== undefined) data.rule9RequestedAt = new Date(dto.rule9RequestedAt);
    if (dto.rule9ResponseAt !== undefined) data.rule9ResponseAt = toLegalDateUtc(dto.rule9ResponseAt);
    if (dto.anonymityOrderRequestedAt !== undefined)
      data.anonymityOrderRequestedAt = new Date(dto.anonymityOrderRequestedAt);
    if (dto.affidavitDraftSentAt !== undefined)
      data.affidavitDraftSentAt = new Date(dto.affidavitDraftSentAt);
    if (dto.affidavitSwornAt !== undefined) data.affidavitSwornAt = new Date(dto.affidavitSwornAt);
    if (dto.affidavitReceivedAt !== undefined)
      data.affidavitReceivedAt = new Date(dto.affidavitReceivedAt);
    if (dto.perfectedAt !== undefined) data.perfectedAt = new Date(dto.perfectedAt);
    if (dto.applicantRecordServedAt !== undefined)
      data.applicantRecordServedAt = toLegalDateUtc(dto.applicantRecordServedAt);
    if (dto.respondentMemoServedAt !== undefined)
      data.respondentMemoServedAt = toLegalDateUtc(dto.respondentMemoServedAt);
    if (dto.replyFiledAt !== undefined) data.replyFiledAt = new Date(dto.replyFiledAt);
    if (dto.ctrDueAt !== undefined) data.ctrDueAt = new Date(dto.ctrDueAt);
    if (dto.ctrReceivedAt !== undefined) data.ctrReceivedAt = new Date(dto.ctrReceivedAt);
    if (dto.hearingAt !== undefined) data.hearingAt = toLegalDateUtc(dto.hearingAt);
    if (dto.judgmentAt !== undefined) data.judgmentAt = toLegalDateUtc(dto.judgmentAt);
    if (dto.reconsiderationRequestedAt !== undefined)
      data.reconsiderationRequestedAt = new Date(dto.reconsiderationRequestedAt);
    if (dto.reconsiderationOutcomeAt !== undefined)
      data.reconsiderationOutcomeAt = new Date(dto.reconsiderationOutcomeAt);
    // Determination / outcome fields the stage-machine gates read (so the
    // pipeline is actually reachable past MERITS_REVIEW).
    if (dto.decidingOfficeLocation !== undefined)
      data.decidingOfficeLocation = dto.decidingOfficeLocation;
    if (dto.decidingOfficeSourceNote !== undefined)
      data.decidingOfficeSourceNote = dto.decidingOfficeSourceNote;
    // The ALJR anchor — normalized to its legal calendar day (the recompute at the
    // end of this method re-drives the fatal clock off the corrected value).
    if (dto.decisionCommunicatedAt !== undefined)
      data.decisionCommunicatedAt = toLegalDateUtc(dto.decisionCommunicatedAt);
    if (dto.decisionCommunicatedNote !== undefined)
      data.decisionCommunicatedNote = dto.decisionCommunicatedNote;
    if (dto.expectationsAcknowledgedAt !== undefined)
      data.expectationsAcknowledgedAt = new Date(dto.expectationsAcknowledgedAt);
    if (dto.alternativesSheetSignedAt !== undefined)
      data.alternativesSheetSignedAt = new Date(dto.alternativesSheetSignedAt);
    if (dto.hennellyIntention !== undefined) data.hennellyIntention = dto.hennellyIntention;
    if (dto.hennellyMerit !== undefined) data.hennellyMerit = dto.hennellyMerit;
    if (dto.hennellyPrejudice !== undefined) data.hennellyPrejudice = dto.hennellyPrejudice;
    if (dto.hennellyExplanation !== undefined) data.hennellyExplanation = dto.hennellyExplanation;
    if (dto.extensionOutcome !== undefined) data.extensionOutcome = dto.extensionOutcome;
    if (dto.leaveDecidedAt !== undefined) data.leaveDecidedAt = new Date(dto.leaveDecidedAt);
    if (dto.leaveOrderAt !== undefined) data.leaveOrderAt = toLegalDateUtc(dto.leaveOrderAt);
    if (dto.leaveGranted !== undefined) data.leaveGranted = dto.leaveGranted;
    if (dto.applicationAllowed !== undefined) data.applicationAllowed = dto.applicationAllowed;
    if (dto.redeterminationDecidedAt !== undefined)
      data.redeterminationDecidedAt = new Date(dto.redeterminationDecidedAt);
    if (dto.redeterminationApproved !== undefined)
      data.redeterminationApproved = dto.redeterminationApproved;

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrMatter.update({ where: { id: matterId }, data });
      await this.writeMatterAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'matter_updated',
        entityId: matterId,
        newValues: { updatedFields: Object.keys(dto) },
      });
      // Most edited fields are deadline anchors (aljrFiledAt, rule9ResponseAt,
      // decidingOfficeLocation, …) — recompute inside the same transaction.
      await this.deadlines.recomputeDeadlines(matterId, user.id, tx);
      return next;
    });
  }

  /** Keep (assign to self) or delegate the matter to another associate. */
  async assignMatter(matterId: string, dto: AssignMatterDto, user: RequestUser): Promise<JrMatter> {
    const matter = await this.assertMatterAccess(matterId, user);

    // The assignee must be a LIVE JR caseworker (associate or head). Without this,
    // a stale dropdown value (a since-deactivated user) or a hand-crafted PATCH
    // would orphan the matter — only jr.matter.view_all could then see it.
    const assignee = await this.prisma.userAccount.findFirst({
      where: {
        id: dto.assignedAssociateUserId,
        status: 'ACTIVE',
        deletedAt: null,
        userRoles: { some: { role: { name: { in: ['jr_associate', 'jr_head'] } } } },
      },
      select: { id: true },
    });
    if (!assignee) {
      throw new BadRequestException(
        'The assignee must be an active user holding a JR Associate or JR Head role.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrMatter.update({
        where: { id: matterId },
        data: { assignedAssociateUserId: dto.assignedAssociateUserId, updatedByUserId: user.id },
      });
      await this.writeMatterAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'matter_assigned',
        entityId: matterId,
        oldValues: { assignedAssociateUserId: matter.assignedAssociateUserId },
        newValues: { assignedAssociateUserId: dto.assignedAssociateUserId },
      });
      return next;
    });
  }

  /**
   * Assignable JR roster — every active user account holding a JR role
   * (associate or head). Powers the Head console's assign dropdown. Mirrors
   * ProcessingService.listProcessingOfficers: UserAccount has no name column,
   * so the human name lives on the Employee relation (falls back to the email
   * handle for accounts with no employee record).
   */
  async listAssociates(): Promise<
    Array<{ id: string; email: string; name: string; primaryRole: string }>
  > {
    const users = await this.prisma.userAccount.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        userRoles: {
          some: { role: { name: { in: ['jr_associate', 'jr_head'] } } },
        },
      },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true } },
        userRoles: { select: { role: { select: { name: true } } } },
      },
    });

    return users
      .map((u) => {
        const employeeName = u.employee
          ? `${u.employee.firstName} ${u.employee.lastName}`.trim()
          : '';
        const name = employeeName || u.email;
        const roles = u.userRoles.map((r) => r.role.name);
        const primaryRole =
          roles.find((r) => r.startsWith('jr_')) ?? 'jr_associate';
        return { id: u.id, email: u.email, name, primaryRole };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Record counsel's merits view + recommendation (counsel must be live). */
  async recordMerits(matterId: string, dto: RecordMeritsDto, user: RequestUser): Promise<JrMatter> {
    const matter = await this.assertMatterAccess(matterId, user);
    if (!(await this.isLiveCounsel(dto.meritsAssessedByCounselId))) {
      throw new BadRequestException('Counsel not found or not active');
    }

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrMatter.update({
        where: { id: matterId },
        data: {
          meritsRecommendation: dto.meritsRecommendation,
          meritsAssessedByCounselId: dto.meritsAssessedByCounselId,
          meritsAssessedAt: new Date(),
          updatedByUserId: user.id,
        },
      });
      await this.writeMatterAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'merits_recorded',
        entityId: matterId,
        oldValues: { meritsRecommendation: matter.meritsRecommendation },
        newValues: {
          meritsRecommendation: dto.meritsRecommendation,
          meritsAssessedByCounselId: dto.meritsAssessedByCounselId,
        },
      });
      return next;
    });
  }

  /**
   * Clear conflict review on an INTERNAL escalation. The independence rule: the
   * person clearing it may be NEITHER the original filer NOR the assigned
   * associate — a genuine second set of eyes.
   */
  async clearConflictReview(
    matterId: string,
    dto: ClearConflictReviewDto,
    user: RequestUser,
  ): Promise<JrMatter> {
    const matter = await this.assertMatterAccess(matterId, user);
    // Independence can only be verified when we know who the original filer was.
    // For an INTERNAL escalation (the only kind that needs conflict review) the
    // original filer is recorded at intake; if it's missing, refuse to clear
    // rather than let the check pass vacuously (a null originalFilerUserId would
    // otherwise make `user.id === null` always false → the filer half inert).
    if (matter.intakeType === 'INTERNAL' && !matter.originalFilerUserId) {
      throw new UnprocessableEntityException(
        'Conflict review cannot be cleared: the original filer is not recorded on this matter, so ' +
          'independence cannot be verified. (It is set at internal-escalation intake.)',
      );
    }
    if (
      user.id === matter.originalFilerUserId ||
      user.id === matter.assignedAssociateUserId
    ) {
      throw new ForbiddenException(
        'Conflict review must be cleared by someone other than the original filer and the assigned ' +
          'associate (the independence rule).',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrMatter.update({
        where: { id: matterId },
        data: {
          conflictReviewClearedAt: new Date(),
          conflictReviewClearedByUserId: user.id,
          conflictReviewNote: dto.note,
          updatedByUserId: user.id,
        },
      });
      await this.writeMatterAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'conflict_review_cleared',
        entityId: matterId,
        newValues: { conflictReviewClearedByUserId: user.id, note: dto.note },
      });
      return next;
    });
  }

  /** Set counsel of record + retainer scope + fee (counsel must be live). */
  async setCounselOfRecord(
    matterId: string,
    dto: SetCounselOfRecordDto,
    user: RequestUser,
  ): Promise<JrMatter> {
    const matter = await this.assertMatterAccess(matterId, user);
    if (!(await this.isLiveCounsel(dto.counselOfRecordId))) {
      throw new BadRequestException('Counsel not found or not active');
    }

    const data: Prisma.JrMatterUpdateInput = {
      counselOfRecordId: dto.counselOfRecordId,
      counselRetainerScope: dto.counselRetainerScope,
      updatedByUserId: user.id,
    };
    if (dto.counselFeeQuoted !== undefined) data.counselFeeQuoted = dto.counselFeeQuoted;
    if (dto.counselFeeCurrency !== undefined) data.counselFeeCurrency = dto.counselFeeCurrency;
    if (dto.counselRetainerSignedAt !== undefined)
      data.counselRetainerSignedAt = new Date(dto.counselRetainerSignedAt);

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrMatter.update({ where: { id: matterId }, data });
      await this.writeMatterAudit(tx, {
        matterId,
        actorUserId: user.id,
        action: 'counsel_of_record_set',
        entityId: matterId,
        oldValues: { counselOfRecordId: matter.counselOfRecordId },
        newValues: {
          counselOfRecordId: dto.counselOfRecordId,
          counselRetainerScope: dto.counselRetainerScope,
        },
      });
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isNonEmpty(v?: string | null): boolean {
    return typeof v === 'string' && v.trim().length > 0;
  }

  private async isLiveCounsel(counselId: string): Promise<boolean> {
    const counsel = await this.prisma.jrCounsel.findFirst({
      where: { id: counselId, isActive: true },
    });
    return !!counsel;
  }

  /** A non-deleted artifact of the given type must exist on the matter. */
  private async assertArtifactExists(
    matterId: string,
    artifactType: JrArtifactType,
    targetStage: string,
  ): Promise<void> {
    const artifact = await this.prisma.jrArtifact.findFirst({
      where: { matterId, artifactType, deletedAt: null },
    });
    if (!artifact) {
      throw new UnprocessableEntityException(
        `Cannot advance to ${targetStage}: a ${artifactType} artifact must exist on the matter.`,
      );
    }
  }

  /** The matter's ALJR_FORM_IR1 artifact must itself be FILED (§5.2 gate). */
  private async assertAljrFiled(matterId: string): Promise<void> {
    const artifact = await this.prisma.jrArtifact.findFirst({
      where: { matterId, artifactType: 'ALJR_FORM_IR1', status: 'FILED', deletedAt: null },
    });
    if (!artifact) {
      throw new UnprocessableEntityException(
        'Cannot mark FILED: the ALJR_FORM_IR1 artifact must itself be FILED ' +
          '(which required counsel approval — §5.2).',
      );
    }
  }

  /** The named artifact type must be SERVED on the matter. */
  private async assertArtifactServed(
    matterId: string,
    artifactType: JrArtifactType,
  ): Promise<void> {
    const artifact = await this.prisma.jrArtifact.findFirst({
      where: { matterId, artifactType, status: 'SERVED', deletedAt: null },
    });
    if (!artifact) {
      throw new UnprocessableEntityException(
        `Cannot advance to REDETERMINATION: the ${artifactType} artifact must be SERVED.`,
      );
    }
  }

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
