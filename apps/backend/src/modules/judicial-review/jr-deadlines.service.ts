import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JrMatter, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { AUTO_COMPUTED_MILESTONE_KEYS, computeDeadlinesDetailed } from './jr-deadline-engine';

/**
 * The deadline engine's persistence + read surface (PR 4). Recompute is called
 * from JudicialReviewService inside the SAME transaction as any anchor/route/stage
 * change (so it must NOT import JudicialReviewService — that would be a cycle);
 * it therefore keeps its own copy of the matter-access guard, identical in logic
 * to JudicialReviewService.assertMatterAccess.
 *
 * Recompute NEVER clobbers human decisions: on an existing JrDeadline it rewrites
 * only the computed fields and leaves status / satisfiedAt / override* untouched.
 */
@Injectable()
export class JrDeadlinesService {
  private readonly log = new Logger(JrDeadlinesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Recompute (called in-transaction from JudicialReviewService, or standalone)
  // ---------------------------------------------------------------------------

  /**
   * Access-checked standalone recompute for the manual POST endpoint. Runs in its
   * own transaction and — because this endpoint takes no serializing write on the
   * matter the way updateMatter/changeMatterStage/determineRoute do — first locks
   * the matter row (a trivial update) so two concurrent recomputes, or a recompute
   * racing a matter edit, can't each miss the other's rows and insert duplicates
   * (the @@unique treats a null `label` as distinct, so it will not dedupe them).
   */
  async recomputeForUser(matterId: string, user: RequestUser): Promise<void> {
    await this.assertMatterAccess(matterId, user);
    await this.prisma.$transaction(async (tx) => {
      await tx.jrMatter.update({ where: { id: matterId }, data: { updatedByUserId: user.id } });
      await this.recomputeWithin(tx, matterId, user.id);
    });
  }

  /**
   * Recompute every applicable deadline for a matter from its active rule set.
   * Called in-transaction from JudicialReviewService, which has already
   * access-checked and holds the matter row lock from its own update — so `tx` is
   * always supplied on that path. On an existing row only computed fields are
   * rewritten (status / satisfiedAt / override* preserved), except a row that had
   * been retired to NOT_APPLICABLE returns to PENDING when its milestone applies
   * again.
   */
  async recomputeDeadlines(
    matterId: string,
    actorUserId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (tx) {
      await this.recomputeWithin(tx, matterId, actorUserId);
      return;
    }
    await this.prisma.$transaction((t) => this.recomputeWithin(t, matterId, actorUserId));
  }

  private async recomputeWithin(
    db: Prisma.TransactionClient,
    matterId: string,
    actorUserId: string,
  ): Promise<void> {
    const matter = await db.jrMatter.findFirst({ where: { id: matterId } });
    if (!matter) throw new NotFoundException('Matter not found');

    const rules = await db.jrDeadlineRule.findMany({
      where: { ruleSetVersion: matter.deadlineRuleSetVersion },
    });
    const { deadlines: computed, unmatchedFatal } = computeDeadlinesDetailed(matter, rules);

    // Load the matter's existing AUTO-computed deadlines in one round-trip (not a
    // findFirst per milestone). Endpoint-created UNDERLYING_DOC_EXPIRY rows are
    // excluded from this set, so a recompute can never retire or duplicate them.
    const existing = await db.jrDeadline.findMany({
      where: { matterId, milestoneKey: { in: [...AUTO_COMPUTED_MILESTONE_KEYS] } },
    });
    const keyOf = (milestoneKey: string, label: string | null): string =>
      `${milestoneKey}::${label ?? ''}`;
    const byKey = new Map(existing.map((e) => [keyOf(e.milestoneKey, e.label), e]));

    const computedKeys = new Set<string>();
    for (const cd of computed) {
      const k = keyOf(cd.milestoneKey, cd.label);
      computedKeys.add(k);
      const ex = byKey.get(k);
      const computedFields = {
        anchorDate: cd.anchorDate,
        anchorField: cd.anchorField,
        computedDueAt: cd.computedDueAt,
        ruleId: cd.ruleId,
        ruleSetVersion: cd.ruleSetVersion,
        isFatal: cd.isFatal,
        quotableToClient: cd.quotableToClient,
      };
      if (ex) {
        await db.jrDeadline.update({
          where: { id: ex.id },
          // A retired milestone that applies again returns to PENDING; a
          // satisfied / missed / waived record and any override are preserved.
          data:
            ex.status === 'NOT_APPLICABLE'
              ? { ...computedFields, status: 'PENDING' }
              : computedFields,
        });
      } else {
        await db.jrDeadline.create({
          data: { matterId, milestoneKey: cd.milestoneKey, label: cd.label, ...computedFields, status: 'PENDING' },
        });
      }
    }

    // Retire auto-computed deadlines that no longer apply (route flipped to an
    // IAD/RAD referral, an anchor was cleared, …) so a stale — possibly FATAL — row
    // stops surfacing on the board. Only PENDING, non-overridden rows are retired;
    // a satisfied/missed/waived record or a human override is never touched.
    const toRetire = existing.filter(
      (e) =>
        e.status === 'PENDING' &&
        e.overriddenDueAt == null &&
        !computedKeys.has(keyOf(e.milestoneKey, e.label)),
    );
    if (toRetire.length) {
      await db.jrDeadline.updateMany({
        where: { id: { in: toRetire.map((e) => e.id) } },
        data: { status: 'NOT_APPLICABLE' },
      });
    }

    // A FATAL milestone that applied with an anchor but matched no rule must never
    // be silent (a seed / effectiveFrom misconfiguration) — surface it loudly.
    if (unmatchedFatal.length) {
      this.log.error(
        `Matter ${matterId}: FATAL milestone(s) applied with an anchor but NO rule matched — ` +
          `deadline NOT computed: ${unmatchedFatal.join(', ')}. Check ` +
          `scripts/seed-jr-deadline-rules.ts and the rule effectiveFrom windows.`,
      );
    }

    await this.writeMatterAudit(db, {
      matterId,
      actorUserId,
      action: 'matter_deadlines_recomputed',
      entityId: matterId,
      newValues: { computed: computed.length, retired: toRetire.length, unmatchedFatal },
    });
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** All deadlines on a matter, fatal-first then soonest, with rule verification. */
  async listMatterDeadlines(matterId: string, user: RequestUser) {
    await this.assertMatterAccess(matterId, user);
    const deadlines = await this.prisma.jrDeadline.findMany({
      where: { matterId },
      orderBy: [{ isFatal: 'desc' }, { computedDueAt: 'asc' }],
    });
    const ruleIds = [...new Set(deadlines.map((dl) => dl.ruleId))];
    const rules = ruleIds.length
      ? await this.prisma.jrDeadlineRule.findMany({
          where: { id: { in: ruleIds } },
          select: { id: true, verificationStatus: true },
        })
      : [];
    const statusByRule = new Map(rules.map((r) => [r.id, r.verificationStatus]));

    return deadlines.map((dl) => ({
      id: dl.id,
      matterId: dl.matterId,
      milestoneKey: dl.milestoneKey,
      label: dl.label,
      anchorDate: dl.anchorDate,
      anchorField: dl.anchorField,
      computedDueAt: dl.computedDueAt,
      overriddenDueAt: dl.overriddenDueAt,
      effectiveDueAt: dl.overriddenDueAt ?? dl.computedDueAt,
      overrideReason: dl.overrideReason,
      ruleId: dl.ruleId,
      ruleSetVersion: dl.ruleSetVersion,
      isFatal: dl.isFatal,
      quotableToClient: dl.quotableToClient,
      status: dl.status,
      satisfiedAt: dl.satisfiedAt,
      ruleVerificationStatus: statusByRule.get(dl.ruleId) ?? null,
    }));
  }

  /**
   * The pending-deadline board across every matter the caller can see. view_all
   * sees all; otherwise scoped to matters assigned to the caller — the scope
   * filter is ANDed in (never a bare double-OR spread, #253).
   */
  async listBoard(user: RequestUser, opts: { fatalOnly?: boolean; take?: number }) {
    const filters: Prisma.JrDeadlineWhereInput[] = [{ status: 'PENDING' }];
    if (opts.fatalOnly) filters.push({ isFatal: true });
    if (!user.permissions.includes('jr.matter.view_all')) {
      filters.push({ matter: { assignedAssociateUserId: user.id } });
    }

    const deadlines = await this.prisma.jrDeadline.findMany({
      where: { AND: filters },
      orderBy: [{ isFatal: 'desc' }, { computedDueAt: 'asc' }],
      take: opts.take ?? 200,
      include: { matter: { select: { matterNumber: true, styleOfCause: true } } },
    });

    return deadlines.map((dl) => ({
      id: dl.id,
      matterId: dl.matterId,
      matterNumber: dl.matter.matterNumber,
      styleOfCause: dl.matter.styleOfCause,
      milestoneKey: dl.milestoneKey,
      label: dl.label,
      computedDueAt: dl.computedDueAt,
      overriddenDueAt: dl.overriddenDueAt,
      effectiveDueAt: dl.overriddenDueAt ?? dl.computedDueAt,
      isFatal: dl.isFatal,
      quotableToClient: dl.quotableToClient,
      status: dl.status,
    }));
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /** Manually override a deadline's due date (reason mandatory). */
  async overrideDeadline(
    deadlineId: string,
    dto: { overriddenDueAt: string; reason: string },
    user: RequestUser,
  ) {
    const deadline = await this.prisma.jrDeadline.findFirst({ where: { id: deadlineId } });
    if (!deadline) throw new NotFoundException('Deadline not found');
    await this.assertMatterAccess(deadline.matterId, user);

    return this.prisma.$transaction(async (tx) => {
      const next = await tx.jrDeadline.update({
        where: { id: deadlineId },
        data: {
          overriddenDueAt: new Date(dto.overriddenDueAt),
          overrideReason: dto.reason,
          overriddenByUserId: user.id,
        },
      });
      await this.writeMatterAudit(tx, {
        matterId: deadline.matterId,
        actorUserId: user.id,
        action: 'deadline_overridden',
        entityId: deadlineId,
        entityType: 'JrDeadline',
        oldValues: { computedDueAt: deadline.computedDueAt.toISOString() },
        newValues: { overriddenDueAt: dto.overriddenDueAt, reason: dto.reason },
      });
      return next;
    });
  }

  /** Mark a deadline satisfied. Atomic PENDING → MET claim to avoid a double-mark. */
  async satisfyDeadline(deadlineId: string, user: RequestUser) {
    const deadline = await this.prisma.jrDeadline.findFirst({ where: { id: deadlineId } });
    if (!deadline) throw new NotFoundException('Deadline not found');
    await this.assertMatterAccess(deadline.matterId, user);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.jrDeadline.updateMany({
        where: { id: deadlineId, status: 'PENDING' },
        data: { status: 'MET', satisfiedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Deadline already satisfied or not pending');
      }
      await this.writeMatterAudit(tx, {
        matterId: deadline.matterId,
        actorUserId: user.id,
        action: 'deadline_satisfied',
        entityId: deadlineId,
        entityType: 'JrDeadline',
      });
      return tx.jrDeadline.findFirstOrThrow({ where: { id: deadlineId } });
    });
  }

  /**
   * Add an underlying-document expiry watch — a non-fatal, quotable JrDeadline
   * against the seeded UNDERLYING_DOC_EXPIRY sentinel rule (base 0). Distinct
   * label per document, so a matter can carry several.
   */
  async addUnderlyingDocWatch(
    matterId: string,
    dto: { label: string; expiryDate: string },
    user: RequestUser,
  ) {
    const matter = await this.assertMatterAccess(matterId, user);
    const rule = await this.prisma.jrDeadlineRule.findFirst({
      where: {
        ruleSetVersion: matter.deadlineRuleSetVersion,
        milestoneKey: 'UNDERLYING_DOC_EXPIRY',
      },
    });
    if (!rule) {
      throw new UnprocessableEntityException(
        `No UNDERLYING_DOC_EXPIRY rule is seeded for rule-set version ${matter.deadlineRuleSetVersion}. ` +
          'Run scripts/seed-jr-deadline-rules.ts.',
      );
    }
    const expiry = new Date(dto.expiryDate);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.jrDeadline.create({
          data: {
            matterId,
            milestoneKey: 'UNDERLYING_DOC_EXPIRY',
            label: dto.label,
            anchorDate: expiry,
            anchorField: 'expiryDate',
            computedDueAt: expiry,
            ruleId: rule.id,
            ruleSetVersion: rule.ruleSetVersion,
            isFatal: false,
            quotableToClient: true,
            status: 'PENDING',
          },
        });
        await this.writeMatterAudit(tx, {
          matterId,
          actorUserId: user.id,
          action: 'underlying_doc_watch_added',
          entityId: created.id,
          entityType: 'JrDeadline',
          newValues: { label: dto.label, expiryDate: dto.expiryDate },
        });
        return created;
      });
    } catch (e) {
      // @@unique([matterId, milestoneKey, label]) — a duplicate label is a clean 409.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          `An expiry watch labelled "${dto.label}" already exists on this matter.`,
        );
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Rules (the Head's verification view)
  // ---------------------------------------------------------------------------

  /** All deadline rules, ordered for the verification view. */
  async listRules(_user: RequestUser) {
    return this.prisma.jrDeadlineRule.findMany({
      orderBy: [{ milestoneKey: 'asc' }, { variantKey: 'asc' }],
    });
  }

  /**
   * Mark a rule VERIFIED and, in the same transaction, flip every already-computed
   * deadline from that rule to quotable — then record a durable audit row. This is
   * the gate that lets a fatal date reach a client, so the cross-matter flip is
   * captured explicitly: a JrAuditLog with a NULL matterId (the column is nullable)
   * noting how many deadlines just became client-quotable. (The global @Audit
   * interceptor only logs the HTTP hit, not this side effect.)
   */
  async verifyRule(ruleId: string, dto: { sourceUrl?: string; notes?: string }, user: RequestUser) {
    const rule = await this.prisma.jrDeadlineRule.findFirst({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException('Rule not found');

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.JrDeadlineRuleUpdateInput = {
        verificationStatus: 'VERIFIED',
        verifiedByUserId: user.id,
        verifiedAt: new Date(),
      };
      if (dto.sourceUrl !== undefined) data.sourceUrl = dto.sourceUrl;
      if (dto.notes !== undefined) data.notes = dto.notes;
      const updated = await tx.jrDeadlineRule.update({ where: { id: ruleId }, data });
      const flipped = await tx.jrDeadline.updateMany({
        where: { ruleId },
        data: { quotableToClient: true },
      });
      await tx.jrAuditLog.create({
        data: {
          matterId: null, // rule-scoped, not tied to one matter
          actorUserId: user.id,
          action: 'deadline_rule_verified',
          entityType: 'JrDeadlineRule',
          entityId: ruleId,
          oldValues: { verificationStatus: rule.verificationStatus },
          newValues: {
            verificationStatus: 'VERIFIED',
            milestoneKey: rule.milestoneKey,
            variantKey: rule.variantKey,
            sourceUrl: dto.sourceUrl ?? rule.sourceUrl,
            deadlinesMadeQuotable: flipped.count,
          },
        },
      });
      return updated;
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Per-matter access guard — a private copy of JudicialReviewService's (imported
   * here would be a cycle). view_all bypasses; otherwise the caller must be the
   * assigned associate.
   */
  private async assertMatterAccess(matterId: string, user: RequestUser): Promise<JrMatter> {
    const matter = await this.prisma.jrMatter.findFirst({ where: { id: matterId } });
    if (!matter) throw new NotFoundException('Matter not found');
    if (user.permissions.includes('jr.matter.view_all')) return matter;
    if (matter.assignedAssociateUserId !== user.id) {
      throw new ForbiddenException('You are not assigned to this matter');
    }
    return matter;
  }

  /** Write a matter-anchored audit row inside the caller's transaction. */
  private async writeMatterAudit(
    tx: Prisma.TransactionClient,
    input: {
      matterId: string;
      actorUserId: string;
      action: string;
      entityId: string;
      entityType?: string;
      oldValues?: Prisma.InputJsonValue;
      newValues?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.jrAuditLog.create({
      data: {
        matterId: input.matterId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType ?? 'JrMatter',
        entityId: input.entityId,
        oldValues: input.oldValues,
        newValues: input.newValues,
      },
    });
  }
}
