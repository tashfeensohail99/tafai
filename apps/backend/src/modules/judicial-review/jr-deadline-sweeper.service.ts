import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import {
  configKeyForDeadline,
  resolveActiveTier,
  type ActiveTier,
} from './jr-alert-tiers';

/**
 * JR deadline sweeper (PR 4b).
 *
 * Chases FATAL Federal-Court deadlines. Every hour it:
 *   1. Loads a bounded batch of PENDING deadlines (soonest first) and, for each,
 *      resolves the single alert tier that should fire NOW (see jr-alert-tiers)
 *      and dispatches tiered bell+email warnings to Head / associate / admin.
 *   2. Flips any overdue deadline to MISSED via an atomic status-gated
 *      updateMany, so overlapping ticks / replicas can't double-act.
 *   3. Re-nudges (daily) on artifacts stuck in counsel review while a fatal
 *      deadline looms within 14 days.
 *
 * Safety:
 *   - SEQUENTIAL per-deadline work — never a Promise.all fan-out (the session
 *     pool is only 15 connections).
 *   - Alert delivery is claim-first: a JrDeadlineAlert row is created under the
 *     unique (deadlineId, tier, channel, recipientUserId) BEFORE we send, so a
 *     P2002 means "already sent" → skip. This makes each (recipient × channel)
 *     tier fire exactly once across ticks/replicas.
 *   - A FAILED alert is NOT auto-retried in v1; the ledger row persists (status
 *     FAILED) for manual follow-up.
 *
 * Kill-switches: JR_DEADLINE_SWEEPER_ENABLED=false disables the whole sweeper;
 * JR_NOTIFY_ENABLED=false keeps the overdue-flip running but silences alerts.
 */

const DAY = 86_400_000;

interface Recipient {
  userId: string;
  email: string;
  name: string;
}

/** Normalised target for the shared dedup+dispatch path (a raw deadline or a
 *  stuck-artifact nudge both reduce to this). */
interface DispatchTarget {
  deadlineId: string;
  matterId: string;
  matterNumber: string;
  styleOfCause: string | null;
  assignedAssociateUserId: string | null;
  milestoneKey: string;
  isFatal: boolean;
  quotableToClient: boolean;
  effectiveDue: Date;
  /** Set only for the stuck-artifact nudge — switches the copy to that message. */
  artifactTitle?: string;
}

interface DispatchCtx {
  heads: Recipient[];
  admins: Recipient[];
  assocCache: Map<string, Recipient | null>;
  now: Date;
}

@Injectable()
export class JrDeadlineSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(JrDeadlineSweeperService.name);
  private static readonly INTERVAL_MS = 60 * 60 * 1000; // hourly — these are fatal
  private static readonly BATCH = 200;
  /** A PENDING alert claim unconfirmed this long is treated as crash-stranded and
   *  reclaimed (deleted so the next pass re-sends). Well under the hourly cadence,
   *  well over a normal dispatch (seconds). */
  private static readonly STALE_CLAIM_MS = 15 * 60 * 1000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    if (process.env.JR_DEADLINE_SWEEPER_ENABLED === 'false') {
      this.log.log('JR deadline sweeper disabled (JR_DEADLINE_SWEEPER_ENABLED=false).');
      return;
    }
    this.bootTimer = setTimeout(() => void this.tick(), 90_000); // first pass 90s after boot
    this.timer = setInterval(() => void this.tick(), JrDeadlineSweeperService.INTERVAL_MS);
    this.bootTimer.unref?.();
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap a pass
    this.running = true;
    try {
      await this.sweep();
    } catch (e) {
      this.log.warn(`JR deadline sweep skipped: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async sweep(): Promise<void> {
    const now = new Date();
    const notifyEnabled = process.env.JR_NOTIFY_ENABLED !== 'false';

    // Self-heal: a claim left PENDING by a crash/restart mid-dispatch would block
    // its (deadline,tier,channel,recipient) from ever re-sending (the unique makes
    // re-claim a P2002). Drop such rows once they're older than STALE_CLAIM_MS so
    // the normal pass re-claims + re-sends them — critical for a final OVERDUE/T-1
    // tier that has no successor. SENT/FAILED rows are never touched. A row younger
    // than the threshold may be mid-flight right now, so it is left alone.
    if (notifyEnabled) {
      await this.prisma.jrDeadlineAlert.deleteMany({
        where: {
          deliveryStatus: 'PENDING',
          createdAt: { lt: new Date(now.getTime() - JrDeadlineSweeperService.STALE_CLAIM_MS) },
        },
      });
    }

    // Resolve the standing recipient lists ONCE per pass.
    const heads = await this.resolveRole('jr_head');
    const admins = await this.resolveRoleIn(['admin', 'super_admin']);
    if (notifyEnabled && heads.length === 0) {
      this.log.warn(
        'JR sweep: no ACTIVE jr_head user — Head-level deadline alerts will reach nobody. Assign the JR Head role.',
      );
    }
    const assocCache = new Map<string, Recipient | null>();

    const deadlines = await this.prisma.jrDeadline.findMany({
      where: { status: 'PENDING' },
      orderBy: { computedDueAt: 'asc' },
      take: JrDeadlineSweeperService.BATCH,
      include: {
        matter: {
          select: {
            id: true,
            matterNumber: true,
            styleOfCause: true,
            assignedAssociateUserId: true,
          },
        },
      },
    });
    if (deadlines.length === JrDeadlineSweeperService.BATCH) {
      this.log.warn(
        `JR sweep: batch cap (${JrDeadlineSweeperService.BATCH}) hit — furthest-out deadlines deferred to the next pass (soonest are covered first).`,
      );
    }

    const ctx: DispatchCtx = { heads, admins, assocCache, now };

    // SEQUENTIAL — no Promise.all (the session pool is only 15 connections). Each
    // deadline is isolated: a poison row logs and is skipped, never aborting the batch.
    for (const d of deadlines) {
      try {
        const effectiveDue = d.overriddenDueAt ?? d.computedDueAt;
        const daysUntil = Math.round(
          (this.utcMidnight(effectiveDue) - this.utcMidnight(now)) / DAY,
        );

        // ---- alerting (silenced by JR_NOTIFY_ENABLED=false) ----
        if (notifyEnabled) {
          const active = resolveActiveTier(configKeyForDeadline(d), daysUntil);
          if (active) {
            // The batch is a snapshot; a deadline satisfied since load must not be
            // alerted on (don't cry wolf on an already-MET deadline).
            const fresh = await this.prisma.jrDeadline.findUnique({
              where: { id: d.id },
              select: { status: true },
            });
            if (fresh?.status === 'PENDING') {
              await this.dispatchTier(
                {
                  deadlineId: d.id,
                  matterId: d.matterId ?? d.matter.id,
                  matterNumber: d.matter.matterNumber,
                  styleOfCause: d.matter.styleOfCause,
                  assignedAssociateUserId: d.matter.assignedAssociateUserId,
                  milestoneKey: d.milestoneKey,
                  isFatal: d.isFatal,
                  quotableToClient: d.quotableToClient,
                  effectiveDue,
                },
                active,
                ctx,
              );
            }
          }
        }

        // ---- overdue flip (ALWAYS, independent of alerting) ----
        if (daysUntil < 0) {
          // Atomic claim — only the tick/replica that wins the flip records it.
          const res = await this.prisma.jrDeadline.updateMany({
            where: { id: d.id, status: 'PENDING' },
            data: { status: 'MISSED' },
          });
          if (res.count === 1) {
            this.log.warn(
              `JR deadline MISSED: ${d.milestoneKey} on matter ${d.matter.matterNumber} (due ${effectiveDue
                .toISOString()
                .slice(0, 10)})`,
            );
          }
        }
      } catch (e) {
        this.log.warn(
          `JR sweep: deadline ${d.id} (${d.milestoneKey}) skipped: ${(e as Error).message}`,
        );
      }
    }

    // ---- stuck-artifact pass (silenced by JR_NOTIFY_ENABLED=false) ----
    if (notifyEnabled) {
      await this.sweepStuckArtifacts(now, ctx);
    }
  }

  /**
   * Artifacts sitting in COUNSEL_REVIEW while the matter has a fatal PENDING
   * deadline within 14 days. Re-nudges Head + associate ONCE PER DAY (the tier
   * carries the date, so a fresh row is claimable each calendar day).
   */
  private async sweepStuckArtifacts(now: Date, ctx: DispatchCtx): Promise<void> {
    const cutoff = new Date(now.getTime() + 14 * DAY);
    const stuck = await this.prisma.jrArtifact.findMany({
      where: {
        status: 'COUNSEL_REVIEW',
        deletedAt: null,
        matter: {
          deadlines: { some: { isFatal: true, status: 'PENDING', computedDueAt: { lte: cutoff } } },
        },
      },
      take: JrDeadlineSweeperService.BATCH,
      select: {
        id: true,
        title: true,
        matterId: true,
        matter: {
          select: {
            matterNumber: true,
            styleOfCause: true,
            assignedAssociateUserId: true,
            // Fetch ALL fatal PENDING deadlines (not take:1 by computedDueAt) so the
            // "nearest" is chosen by EFFECTIVE due date, override-aware, in JS.
            deadlines: {
              where: { isFatal: true, status: 'PENDING' },
              select: {
                id: true,
                computedDueAt: true,
                overriddenDueAt: true,
                milestoneKey: true,
                quotableToClient: true,
              },
            },
          },
        },
      },
    });

    // Tier carries the calendar day so a fresh row is claimable each day (daily
    // re-nudge). Kept ≤ VarChar(20): "STUCK-2026-08-19" = 16 chars.
    const dayKey = now.toISOString().slice(0, 10);
    for (const a of stuck) {
      try {
        const nearest = a.matter.deadlines
          .map((x) => ({ x, eff: x.overriddenDueAt ?? x.computedDueAt }))
          .sort((p, q) => p.eff.getTime() - q.eff.getTime())[0];
        if (!nearest) continue;
        // An override may have pushed the real (effective) due date past the window.
        if (nearest.eff.getTime() > cutoff.getTime()) continue;

        const active: ActiveTier = {
          tier: `STUCK-${dayKey}`,
          recipients: ['HEAD', 'ASSOCIATE'],
          channels: ['BELL', 'EMAIL'],
        };
        await this.dispatchTier(
          {
            deadlineId: nearest.x.id,
            matterId: a.matterId,
            matterNumber: a.matter.matterNumber,
            styleOfCause: a.matter.styleOfCause,
            assignedAssociateUserId: a.matter.assignedAssociateUserId,
            milestoneKey: nearest.x.milestoneKey,
            isFatal: true,
            quotableToClient: nearest.x.quotableToClient,
            effectiveDue: nearest.eff,
            artifactTitle: a.title,
          },
          active,
          ctx,
        );
      } catch (e) {
        this.log.warn(`JR sweep: stuck-artifact ${a.id} skipped: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Resolve the recipient set for a tier and dispatch per (recipient × channel),
   * claim-first so each fires exactly once. Never fans out with Promise.all.
   */
  private async dispatchTier(target: DispatchTarget, active: ActiveTier, ctx: DispatchCtx): Promise<void> {
    // Resolve recipients (deduped by userId — someone may be both head and admin).
    const resolved = new Map<string, Recipient>();
    for (const role of active.recipients) {
      if (role === 'HEAD') {
        for (const h of ctx.heads) resolved.set(h.userId, h);
      } else if (role === 'ADMIN') {
        for (const a of ctx.admins) resolved.set(a.userId, a);
      } else if (role === 'ASSOCIATE') {
        if (!target.assignedAssociateUserId) {
          if (target.isFatal) {
            this.log.warn(
              `JR FATAL deadline ${target.milestoneKey} on matter ${target.matterNumber} has no assigned associate — associate alert skipped`,
            );
          }
          continue;
        }
        const assoc = await this.resolveAssociate(target.assignedAssociateUserId, ctx.assocCache);
        if (assoc) resolved.set(assoc.userId, assoc);
      }
    }
    if (resolved.size === 0) {
      // A warning that reaches nobody is worse than a loud log — surface it,
      // escalated for a fatal deadline (per the architecture doc).
      this.log.warn(
        `JR ${target.isFatal ? 'FATAL ' : ''}alert ${active.tier} for ${target.milestoneKey} on matter ` +
          `${target.matterNumber} reached NO recipient (empty head/admin/associate set).`,
      );
      return;
    }

    // Copy for the tier + milestone + due date.
    const dueDateLabel = target.effectiveDue.toISOString().slice(0, 10);
    const daysUntil = Math.round((this.utcMidnight(target.effectiveDue) - this.utcMidnight(ctx.now)) / DAY);
    const daysLabel =
      daysUntil < 0
        ? `overdue by ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'}`
        : daysUntil === 0
          ? 'due today'
          : `${daysUntil} day${daysUntil === 1 ? '' : 's'} left`;
    const provisionalMark = target.quotableToClient ? '' : ' [PROVISIONAL — unverified rule]';
    const title = target.artifactTitle
      ? `JR artifact stuck in counsel review — ${target.matterNumber}`
      : `JR deadline ${active.tier} — ${target.milestoneKey} (${target.matterNumber})`;
    const body = target.artifactTitle
      ? `"${target.artifactTitle}" is awaiting counsel review while a fatal deadline (${target.milestoneKey}) is due ${dueDateLabel} (${daysLabel}).${provisionalMark}`
      : `${target.milestoneKey} on matter ${target.matterNumber} is due ${dueDateLabel} (${daysLabel}).${provisionalMark}`;

    for (const recipient of resolved.values()) {
      for (const channel of active.channels) {
        // Claim first — single-fire across ticks/replicas.
        try {
          await this.prisma.jrDeadlineAlert.create({
            data: {
              matterId: target.matterId,
              deadlineId: target.deadlineId,
              tier: active.tier,
              channel,
              recipientUserId: recipient.userId,
              deliveryStatus: 'PENDING',
            },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            continue; // already sent this (recipient × channel × tier) — skip
          }
          throw e;
        }

        // Dispatch. Bell is void/best-effort → treated as SENT.
        let ok = true;
        if (channel === 'BELL') {
          await this.notifications.create({
            userId: recipient.userId,
            type: 'JR_DEADLINE_WARNING',
            title,
            body,
            link: 'https://tashfeengroup.com/jr/deadlines',
          });
        } else {
          ok = await this.email.sendJrDeadlineWarning({
            to: recipient.email,
            recipientName: recipient.name,
            matterNumber: target.matterNumber,
            styleOfCause: target.styleOfCause,
            milestone: target.milestoneKey,
            tier: active.tier,
            dueDateLabel,
            daysLabel,
            isFatal: target.isFatal,
            provisional: !target.quotableToClient,
          });
        }

        // Record the outcome. A FAILED row is NOT auto-retried in v1 — it
        // persists for manual follow-up.
        await this.prisma.jrDeadlineAlert.updateMany({
          where: {
            deadlineId: target.deadlineId,
            tier: active.tier,
            channel,
            recipientUserId: recipient.userId,
          },
          data: {
            deliveryStatus: ok === false ? 'FAILED' : 'SENT',
            sentAt: new Date(),
            errorMessage:
              ok === false ? 'email send returned false (SMTP unconfigured or send failed)' : null,
          },
        });
      }
    }
  }

  private async resolveRole(name: string): Promise<Recipient[]> {
    const users = await this.prisma.userAccount.findMany({
      where: { status: 'ACTIVE', deletedAt: null, userRoles: { some: { role: { name } } } },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return users.map((u) => this.toRecipient(u));
  }

  private async resolveRoleIn(names: string[]): Promise<Recipient[]> {
    const users = await this.prisma.userAccount.findMany({
      where: { status: 'ACTIVE', deletedAt: null, userRoles: { some: { role: { name: { in: names } } } } },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return users.map((u) => this.toRecipient(u));
  }

  private async resolveAssociate(
    userId: string,
    cache: Map<string, Recipient | null>,
  ): Promise<Recipient | null> {
    if (cache.has(userId)) return cache.get(userId) ?? null;
    const u = await this.prisma.userAccount.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    const rec = u && u.status === 'ACTIVE' && !u.deletedAt ? this.toRecipient(u) : null;
    cache.set(userId, rec);
    return rec;
  }

  private toRecipient(u: {
    id: string;
    email: string;
    employee: { firstName: string; lastName: string } | null;
  }): Recipient {
    return {
      userId: u.id,
      email: u.email,
      name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() || u.email : u.email,
    };
  }

  private utcMidnight(d: Date): number {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
}
