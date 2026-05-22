import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WhatsAppRealtimePublisher } from '../realtime/publisher.service';
import { WhatsAppAssignmentService } from './assignment.service';
import { WHATSAPP_WS_EVENTS } from '../queues/queue-contracts';

/**
 * Response-SLA sweeper.
 *
 * The rolling Response-SLA clock (thread.responseDeadlineAt) is event-driven
 * on both ends — set when a customer message arrives, cleared when the agent
 * replies. But the *miss* of a deadline is a non-event: if nobody replies,
 * nothing fires. This sweeper is what notices.
 *
 * Every 60s it scans threads that are awaiting an agent reply and:
 *   - fires an "approaching" warning once, when within slaWarnBeforeSeconds
 *     of the deadline (responseWarned guard);
 *   - fires a "breach" once, when the deadline has passed (responseBreached
 *     guard) AND atomically credits the assigned agent's breach tally.
 *
 * Race-safety: the breach flag flip is an updateMany gated on
 * responseBreached:false, so even if two sweeps overlapped only one would
 * win the flip and count the breach. We run a single backend instance, but
 * this keeps it correct regardless.
 *
 * We deliberately do NOT auto-reassign — per product decision, the warning
 * just tells the agent "leads are reassigned after N breaches". Flipping on
 * real reassignment later is a localized change here.
 */
@Injectable()
export class WhatsAppSlaSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhatsAppSlaSweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private static readonly INTERVAL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: WhatsAppRealtimePublisher,
    private readonly assignment: WhatsAppAssignmentService,
  ) {}

  onModuleInit(): void {
    // Stagger the first run a few seconds after boot so it doesn't collide
    // with migration/startup work.
    this.timer = setInterval(() => {
      void this.sweep().catch((err) =>
        this.log.error(`SLA sweep failed: ${(err as Error).message}`),
      );
    }, WhatsAppSlaSweeperService.INTERVAL_MS);
    this.log.log('Response-SLA sweeper started (60s interval)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<void> {
    if (this.running) return; // never overlap a slow sweep with the next tick
    this.running = true;
    try {
      // Safety net: recover any open thread the webhook left unassigned. Runs
      // first and unconditionally so an assignment stall self-heals in <=60s.
      await this.recoverUnassignedThreads();

      const org = await this.prisma.organization.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true, slaWarnBeforeSeconds: true, slaReassignThreshold: true },
      });
      if (!org) return;

      const now = new Date();
      const warnCutoff = new Date(now.getTime() + org.slaWarnBeforeSeconds * 1000);

      // Pull the (bounded) set of threads currently awaiting an agent reply
      // whose deadline is either already past or within the warn window.
      //
      // CRITICAL: exclude already-breached threads. A breach sets
      // responseBreached=true but does NOT clear responseDeadlineAt (only an
      // agent reply clears it), so a breached-but-unanswered thread would
      // otherwise stay in this window forever, doing nothing — the breach path
      // needs !responseBreached and the warn path needs !isPast, and a breached
      // thread satisfies neither. With `take: 500` and no ORDER BY, those inert
      // rows accumulate and can starve genuinely-new threads out of the page,
      // so warnings/breaches silently stop firing. Filtering them here keeps the
      // working set to threads that still need action. (Does not affect the
      // "overdue" KPI, which keys off responseDeadlineAt, not this query.)
      const pending = await this.prisma.whatsAppThread.findMany({
        where: {
          responseDeadlineAt: { not: null, lte: warnCutoff },
          responseBreached: false,
        },
        select: {
          id: true,
          responseDeadlineAt: true,
          responseWarned: true,
          responseBreached: true,
          leadId: true,
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              assignedEmployeeId: true,
            },
          },
        },
        take: 500,
      });
      if (pending.length === 0) return;

      let breaches = 0;
      let warnings = 0;

      for (const t of pending) {
        if (!t.responseDeadlineAt) continue;
        const isPast = now >= t.responseDeadlineAt;

        if (isPast && !t.responseBreached) {
          // Atomically claim the breach so concurrent sweeps can't double-count.
          const flipped = await this.prisma.whatsAppThread.updateMany({
            where: { id: t.id, responseBreached: false },
            data: { responseBreached: true },
          });
          if (flipped.count === 1) {
            breaches++;
            if (t.lead?.assignedEmployeeId) {
              await this.prisma.employee.update({
                where: { id: t.lead.assignedEmployeeId },
                data: { slaResponsesBreached: { increment: 1 } },
              });
            }
            await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.SLA_BREACH, {
              threadId: t.id,
              leadId: t.leadId,
              assignedEmployeeId: t.lead?.assignedEmployeeId ?? null,
              leadName: t.lead ? `${t.lead.firstName} ${t.lead.lastName}`.trim() : null,
              reassignThreshold: org.slaReassignThreshold,
            });
          }
        } else if (!isPast && !t.responseWarned) {
          // Approaching — fire the pre-breach nudge once.
          const flipped = await this.prisma.whatsAppThread.updateMany({
            where: { id: t.id, responseWarned: false },
            data: { responseWarned: true },
          });
          if (flipped.count === 1) {
            warnings++;
            await this.publisher.publishToOrg(org.id, WHATSAPP_WS_EVENTS.SLA_WARNING, {
              threadId: t.id,
              leadId: t.leadId,
              assignedEmployeeId: t.lead?.assignedEmployeeId ?? null,
              leadName: t.lead ? `${t.lead.firstName} ${t.lead.lastName}`.trim() : null,
              deadlineAt: t.responseDeadlineAt,
              reassignThreshold: org.slaReassignThreshold,
            });
          }
        }
      }

      if (breaches > 0 || warnings > 0) {
        this.log.log(`SLA sweep: ${warnings} warning(s), ${breaches} breach(es)`);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Self-healing assignment recovery.
   *
   * Every inbound is assigned inline by the webhook worker, but that call is
   * wrapped in a non-fatal try/catch (a failure there must never drop the
   * message we already saved). The downside: a transient DB blip, a race, or a
   * bug in the engine leaves the lead unassigned and SILENT — which is exactly
   * how a stall once ran for hours before anyone noticed.
   *
   * This gives every still-unassigned open thread a second chance on every
   * 60s tick. ensureAssigned is idempotent (no-ops on an already-assigned
   * lead), so once the webhook path is healthy this is just one cheap COUNT-ish
   * query returning nothing. Bounded to 50/tick so a large backlog drains over
   * a few minutes instead of hammering the DB in one burst.
   */
  private async recoverUnassignedThreads(): Promise<void> {
    const stuck = await this.prisma.whatsAppThread.findMany({
      where: {
        status: { not: 'ARCHIVED' },
        lead: { is: { assignedEmployeeId: null, deletedAt: null } },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    if (stuck.length === 0) return;

    let recovered = 0;
    for (const t of stuck) {
      try {
        const outcome = await this.assignment.ensureAssigned(t.id);
        if (outcome.assignedEmployeeId) recovered++;
      } catch (err) {
        // Surface loudly — if recovery itself fails the engine is broken and
        // we WANT it in the logs, not swallowed like the webhook path.
        this.log.error(
          `assignment recovery failed for thread ${t.id}: ${(err as Error).message}`,
        );
      }
    }
    if (recovered > 0) {
      this.log.warn(
        `assignment recovery: re-assigned ${recovered} thread(s) the webhook left unassigned`,
      );
    }
  }
}
