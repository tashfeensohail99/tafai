import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WhatsAppAssignmentReason, type Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

interface ThreadListOptions {
  status?: 'OPEN' | 'PENDING' | 'RESOLVED' | 'ARCHIVED';
  assignedToMe?: boolean;
  unassigned?: boolean;
  /** Admin filter: only threads whose lead is assigned to this employee. */
  employeeId?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

interface CallerContext {
  userId: string;
  employeeId: string | null;
  /** Whether the caller is allowed to see threads not assigned to them. */
  canViewAll: boolean;
  /**
   * Finance closed-loop scope: caller may see threads only for leads
   * where Sales has already sent an agreement (status != DRAFT). Narrower
   * than `canViewAll` — pre-agreement Sales negotiations stay private.
   * Implies the caller is NEVER part of the round-robin assignment pool.
   */
  canViewFinanceScope: boolean;
}

/**
 * Read-side API for WhatsApp threads — what the inbox UI calls.
 *
 * Access rules:
 *   - "agent" (has whatsapp.view_inbox only): only threads whose
 *     Lead.assignedEmployeeId = caller's employee.
 *   - "finance" (has whatsapp.view_finance_scope): only threads whose
 *     lead has a non-DRAFT agreement on file (closed-loop comms).
 *   - "manager/admin" (has whatsapp.view_all_inboxes): every thread in
 *     the org.
 *
 * Lead-rooted and client-rooted threads are both returned; the caller-side
 * filter on "my assigned" walks via Lead.assignedEmployeeId. After a
 * lead→client conversion the thread keeps its leadId, so the same agent
 * keeps seeing the chat history.
 */
@Injectable()
export class WhatsAppThreadsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Distinct lead ids that currently have at least one non-DRAFT agreement
   * on file — i.e. Sales has submitted the agreement to Finance. Used to
   * scope the WhatsApp inbox for finance-role callers (see `canViewFinanceScope`).
   *
   * Agreement.leadId is declared without a Prisma FK relation (kept
   * decoupled per the schema's note), so we pre-resolve the id set here
   * rather than using a nested relation filter on `lead`.
   */
  private async eligibleLeadIdsForFinance(): Promise<string[]> {
    const rows = await this.prisma.agreement.findMany({
      where: { status: { not: 'DRAFT' }, deletedAt: null },
      select: { leadId: true },
      distinct: ['leadId'],
    });
    return rows.map((r) => r.leadId);
  }

  async list(caller: CallerContext, opts: ThreadListOptions = {}) {
    const limit = Math.min(opts.limit ?? 30, 100);

    const where: Prisma.WhatsAppThreadWhereInput = {};
    if (opts.status) where.status = opts.status;

    // Compound conditions are collected in an AND array so they COMPOSE rather
    // than clobber each other. The soft-delete guard and the search filter both
    // want an `OR`; assigning `where.OR` twice silently dropped the first —
    // which let an admin search surface threads of soft-deleted leads. Keeping
    // each as its own AND entry guarantees the delete guard always applies.
    const and: Prisma.WhatsAppThreadWhereInput[] = [];

    // Hide threads whose lead has been soft-deleted (admin deletes a lead
    // or a whole CSV import batch → the lead's row stays in the DB but
    // gets deletedAt stamped, so the inbox should drop the thread). We use
    // `OR` so we don't accidentally hide threads that have a client but no
    // lead — those still show up.
    and.push({ OR: [{ lead: { is: { deletedAt: null } } }, { lead: null }] });

    // Scope to caller's assigned leads unless they're allowed to see all
    // AND haven't explicitly asked for "mine only".
    if ((!caller.canViewAll && !caller.canViewFinanceScope) || opts.assignedToMe) {
      if (!caller.employeeId) {
        // A user with whatsapp.view_inbox but no Employee row — return nothing
        // rather than throw, so the UI doesn't break.
        return { items: [], nextCursor: null };
      }
      where.lead = { assignedEmployeeId: caller.employeeId, deletedAt: null };
    } else if (caller.canViewFinanceScope) {
      // Finance closed-loop scope — only threads whose lead has a
      // non-DRAFT agreement on file (i.e., Sales has sent it to Finance).
      // Pre-agreement Sales conversations stay private to Sales.
      // Note: Agreement.leadId has no Prisma FK relation (decoupled by
      // design), so we pre-resolve the eligible lead-id set instead of
      // using a nested relation filter.
      const eligibleLeadIds = await this.eligibleLeadIdsForFinance();
      if (eligibleLeadIds.length === 0) return { items: [], nextCursor: null };
      where.lead = { id: { in: eligibleLeadIds }, deletedAt: null };
    } else if (opts.unassigned) {
      // Admin-only filter — only meaningful when canViewAll is true.
      where.lead = { assignedEmployeeId: null, deletedAt: null };
    } else if (opts.employeeId) {
      // Admin-only filter — show only one agent's conversations.
      where.lead = { assignedEmployeeId: opts.employeeId, deletedAt: null };
    }

    if (opts.search) {
      const q = opts.search.trim();
      const digits = q.replace(/\D/g, '');
      // Name search (works for partial first/last name, case-insensitive).
      const or: Prisma.WhatsAppThreadWhereInput[] = [
        { lead: { firstName: { contains: q, mode: 'insensitive' } } },
        { lead: { lastName: { contains: q, mode: 'insensitive' } } },
        { client: { firstName: { contains: q, mode: 'insensitive' } } },
        { client: { lastName: { contains: q, mode: 'insensitive' } } },
      ];
      // Number search — ONLY when the query actually contains digits. The old
      // code always added `waContactId contains digitsOf(q)`, which for a NAME
      // query became `contains ''` → matches EVERY row → search returned
      // everything (the "search not working" bug). Require >= 3 digits so a
      // stray digit in a name doesn't broaden the match either.
      if (digits.length >= 3) {
        or.push({ waContactId: { contains: digits } });
        or.push({ lead: { phone: { contains: digits } } });
        or.push({ client: { phone: { contains: digits } } });
      }
      and.push({ OR: or });
    }

    where.AND = and;

    const rows = await this.prisma.whatsAppThread.findMany({
      where,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      include: {
        channel: { select: { id: true, label: true, displayNumber: true } },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            status: true,
            assignedEmployeeId: true,
            assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
            // Most-recent CSV import touch — drives the CSV LEAD badge on
            // the thread row in the WhatsApp inbox. Tooltip uses batch.name.
            importRows: {
              where: { outcome: { in: ['IMPORTED', 'DUPLICATE'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                batch: { select: { id: true, batchNumber: true, name: true } },
              },
            },
          },
        },
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            status: true,
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    return {
      items: rows.slice(0, limit),
      nextCursor: hasMore ? rows[limit - 1]!.id : null,
    };
  }

  /**
   * True inbox counters for the KPI chips. Computed with COUNT queries over
   * the whole table (scoped to the caller) — NOT from the paginated list —
   * so "Active 30" stops being a lie that just reflected the first page size.
   *
   * Returns:
   *   total           — every non-deleted thread the caller can see
   *   active          — status OPEN (the working set)
   *   unassigned      — admin-only: threads whose lead has no assignee yet
   *   slaBreached     — threads flagged slaBreached (legacy first-response)
   *   unread          — threads with unreadCount > 0
   *   awaitingReply   — Response-SLA clock running (agent's turn)
   *   approaching     — within the warn window, not yet overdue
   *   overdue         — Response-SLA deadline already passed, still unanswered
   *   slaScore        — on-time %. For an agent: their own. For an admin /
   *                     manager (canViewAll): the ORG-WIDE aggregate across
   *                     every agent, so the dashboard shows a useful team
   *                     number instead of a meaningless 100.
   *   slaScoreScope   — 'self' | 'org' | null, so the UI can label it right.
   */
  async stats(caller: CallerContext): Promise<{
    total: number;
    active: number;
    unassigned: number;
    slaBreached: number;
    unread: number;
    awaitingReply: number;
    approaching: number;
    overdue: number;
    slaScore: number | null;
    slaScoreScope: 'self' | 'org' | null;
  }> {
    const empty = {
      total: 0, active: 0, unassigned: 0, slaBreached: 0, unread: 0,
      awaitingReply: 0, approaching: 0, overdue: 0,
      slaScore: null as number | null, slaScoreScope: null as 'self' | 'org' | null,
    };
    // Base visibility filter mirrors list(): drop soft-deleted leads, and
    // scope to the caller's own assigned leads when they can't view all.
    const base: Prisma.WhatsAppThreadWhereInput = {
      OR: [{ lead: { is: { deletedAt: null } } }, { lead: null }],
    };
    if (caller.canViewFinanceScope && !caller.canViewAll) {
      // Finance closed-loop scope — only threads whose lead has a
      // non-DRAFT agreement (see list() for rationale).
      const eligibleLeadIds = await this.eligibleLeadIdsForFinance();
      if (eligibleLeadIds.length === 0) return empty;
      base.lead = { id: { in: eligibleLeadIds }, deletedAt: null };
      delete base.OR;
    } else if (!caller.canViewAll) {
      if (!caller.employeeId) return empty;
      base.lead = { assignedEmployeeId: caller.employeeId, deletedAt: null };
      delete base.OR; // the lead filter already excludes deleted leads
    }

    const and = (extra: Prisma.WhatsAppThreadWhereInput): Prisma.WhatsAppThreadWhereInput => ({
      AND: [base, extra],
    });

    const now = new Date();
    // Pull warn window from org config so "approaching" matches the sweeper.
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { slaWarnBeforeSeconds: true },
    });
    const warnCutoff = new Date(now.getTime() + (org?.slaWarnBeforeSeconds ?? 60) * 1000);

    const [total, active, slaBreached, unread, unassigned, awaitingReply, overdue, approaching] =
      await Promise.all([
        this.prisma.whatsAppThread.count({ where: base }),
        this.prisma.whatsAppThread.count({ where: and({ status: 'OPEN' }) }),
        this.prisma.whatsAppThread.count({ where: and({ slaBreached: true }) }),
        this.prisma.whatsAppThread.count({ where: and({ unreadCount: { gt: 0 } }) }),
        caller.canViewAll
          ? this.prisma.whatsAppThread.count({
              where: and({ lead: { assignedEmployeeId: null, deletedAt: null } }),
            })
          : Promise.resolve(0),
        this.prisma.whatsAppThread.count({ where: and({ responseDeadlineAt: { not: null } }) }),
        this.prisma.whatsAppThread.count({ where: and({ responseDeadlineAt: { not: null, lte: now } }) }),
        this.prisma.whatsAppThread.count({
          where: and({ responseDeadlineAt: { gt: now, lte: warnCutoff } }),
        }),
      ]);

    // SLA score. Admins / managers (canViewAll) get the ORG-WIDE aggregate so
    // their dashboard shows a real team number rather than the personal-score
    // fallback of 100. A plain agent gets their own score.
    let slaScore: number | null = null;
    let slaScoreScope: 'self' | 'org' | null = null;
    if (caller.canViewAll) {
      const agg = await this.prisma.employee.aggregate({
        where: { deletedAt: null },
        _sum: { slaResponsesMet: true, slaResponsesBreached: true },
        // Org-wide presence penalty = the average across agents, so the team
        // score dips when people sit Offline during working hours.
        _avg: { slaPenaltyPoints: true },
      });
      const met = agg._sum.slaResponsesMet ?? 0;
      const breached = agg._sum.slaResponsesBreached ?? 0;
      const totalResp = met + breached;
      const base = totalResp === 0 ? 100 : Math.round((met / totalResp) * 100);
      slaScore = Math.max(0, base - Math.round(agg._avg.slaPenaltyPoints ?? 0));
      slaScoreScope = 'org';
    } else if (caller.employeeId) {
      const emp = await this.prisma.employee.findUnique({
        where: { id: caller.employeeId },
        select: { slaResponsesMet: true, slaResponsesBreached: true, slaPenaltyPoints: true },
      });
      if (emp) {
        const totalResp = emp.slaResponsesMet + emp.slaResponsesBreached;
        const base = totalResp === 0 ? 100 : Math.round((emp.slaResponsesMet / totalResp) * 100);
        slaScore = Math.max(0, base - emp.slaPenaltyPoints);
        slaScoreScope = 'self';
      }
    }

    return {
      total, active, unassigned, slaBreached, unread,
      awaitingReply, approaching, overdue, slaScore, slaScoreScope,
    };
  }

  async getOrFail(caller: CallerContext, threadId: string) {
    const t = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      include: {
        channel: { select: { id: true, label: true, displayNumber: true, phoneNumberId: true } },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            nationality: true,
            targetCountry: true,
            status: true,
            assignedEmployeeId: true,
            preferredEmployeeId: true,
            convertedClientId: true,
            assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
            // CSV-origin badge data — shown in the chat header.
            importRows: {
              where: { outcome: { in: ['IMPORTED', 'DUPLICATE'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                batch: { select: { id: true, batchNumber: true, name: true } },
              },
            },
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
            status: true,
          },
        },
      },
    });
    if (!t) throw new NotFoundException('Thread not found');
    if (!caller.canViewAll) {
      if (caller.canViewFinanceScope) {
        // Finance can only open threads whose lead has a non-DRAFT
        // agreement on file (Sales has sent it to Finance). Pre-agreement
        // negotiations stay private to Sales.
        if (!t.lead?.id) throw new ForbiddenException('Thread not visible to Finance');
        const hasAgreement = await this.prisma.agreement.findFirst({
          where: { leadId: t.lead.id, status: { not: 'DRAFT' }, deletedAt: null },
          select: { id: true },
        });
        if (!hasAgreement) {
          throw new ForbiddenException('Thread not visible to Finance until Sales sends an agreement');
        }
      } else if (!caller.employeeId || t.lead?.assignedEmployeeId !== caller.employeeId) {
        throw new ForbiddenException('Thread not assigned to you');
      }
    }
    return t;
  }

  /** Mark a thread as read by the calling agent (resets unreadCount). */
  async markRead(caller: CallerContext, threadId: string): Promise<void> {
    const t = await this.getOrFail(caller, threadId);
    if (t.unreadCount === 0) return;
    await this.prisma.whatsAppThread.update({
      where: { id: threadId },
      data: { unreadCount: 0 },
    });
  }

  /**
   * Admin override — route this thread's Lead to a specific employee.
   * Updates both `Lead.assignedEmployeeId` (current) and
   * `Lead.preferredEmployeeId` (sticky) so any future inbound on the same
   * lead returns to the same agent. Bypasses the round-robin engine, but
   * the engine still applies when the next NEW lead arrives.
   *
   * Caller must have whatsapp.reassign (PermissionGuard already enforces).
   */
  async reassign(caller: CallerContext, threadId: string, employeeId: string) {
    const t = await this.prisma.whatsAppThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        leadId: true,
        lead: { select: { id: true, assignedEmployeeId: true } },
      },
    });
    if (!t || !t.leadId || !t.lead) throw new NotFoundException('Thread not found');

    const target = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        isActive: true,
        whatsappInboxMember: true,
        deletedAt: null,
        // Same rule as the auto-assignment engine — never reassign to a
        // user whose account is deactivated/suspended.
        user: { status: 'ACTIVE' },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!target) {
      throw new BadRequestException(
        'Target employee is not eligible (must be active, in the WhatsApp inbox pool, and have an active user account).',
      );
    }

    const previousAssignee = t.lead.assignedEmployeeId;

    await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id: t.leadId },
        data: {
          assignedEmployeeId: employeeId,
          preferredEmployeeId: employeeId,
        },
      }),
      this.prisma.whatsAppThread.update({
        where: { id: threadId },
        data: { lastAssignmentReason: WhatsAppAssignmentReason.REASSIGN },
      }),
      this.prisma.activityTimeline.create({
        data: {
          entityType: 'Lead',
          entityId: t.leadId,
          leadId: t.leadId,
          // Existing WHATSAPP_ASSIGNED enum covers both initial assignment
          // and admin overrides; metadata.via='admin_override' is how we
          // tell them apart in audit views.
          eventType: 'WHATSAPP_ASSIGNED',
          description: `WhatsApp thread manually reassigned to ${target.firstName} ${target.lastName}`.trim(),
          actorUserId: caller.userId,
          metadata: {
            threadId,
            employeeId,
            previousAssignee,
            via: 'admin_override',
          },
        },
      }),
    ]);

    return {
      threadId,
      leadId: t.leadId,
      assignedEmployeeId: employeeId,
      assignedEmployeeName: `${target.firstName} ${target.lastName}`.trim(),
      previousAssignee,
    };
  }
}
