import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WhatsAppAssignmentReason, type Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

interface ThreadListOptions {
  status?: 'OPEN' | 'PENDING' | 'RESOLVED' | 'ARCHIVED';
  assignedToMe?: boolean;
  unassigned?: boolean;
  search?: string;
  limit?: number;
  cursor?: string;
}

interface CallerContext {
  userId: string;
  employeeId: string | null;
  /** Whether the caller is allowed to see threads not assigned to them. */
  canViewAll: boolean;
}

/**
 * Read-side API for WhatsApp threads — what the inbox UI calls.
 *
 * Access rules:
 *   - "agent" (has whatsapp.view_inbox but not whatsapp.view_all_inboxes):
 *     only threads whose Lead.assignedEmployeeId = caller's employee.
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

  async list(caller: CallerContext, opts: ThreadListOptions = {}) {
    const limit = Math.min(opts.limit ?? 30, 100);

    const where: Prisma.WhatsAppThreadWhereInput = {};
    if (opts.status) where.status = opts.status;

    // Hide threads whose lead has been soft-deleted (admin deletes a lead
    // or a whole CSV import batch → the lead's row stays in the DB but
    // gets deletedAt stamped, so the inbox should drop the thread). We use
    // `OR` so we don't accidentally hide threads that have a client but no
    // lead — those still show up.
    where.OR = [
      { lead: { is: { deletedAt: null } } },
      { lead: null },
    ];

    // Scope to caller's assigned leads unless they're allowed to see all
    // AND haven't explicitly asked for "mine only".
    if (!caller.canViewAll || opts.assignedToMe) {
      if (!caller.employeeId) {
        // A user with whatsapp.view_inbox but no Employee row — return nothing
        // rather than throw, so the UI doesn't break.
        return { items: [], nextCursor: null };
      }
      where.lead = { assignedEmployeeId: caller.employeeId, deletedAt: null };
    } else if (opts.unassigned) {
      // Admin-only filter — only meaningful when canViewAll is true.
      where.lead = { assignedEmployeeId: null, deletedAt: null };
    }

    if (opts.search) {
      const q = opts.search.trim();
      where.OR = [
        { waContactId: { contains: q.replace(/\D/g, '') } },
        { lead: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } },
        { client: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } },
      ];
    }

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
   *   total        — every non-deleted thread the caller can see
   *   active       — status OPEN (the working set)
   *   unassigned   — admin-only: threads whose lead has no assignee yet
   *   slaBreached  — threads flagged slaBreached
   *   unread       — threads with unreadCount > 0
   */
  async stats(caller: CallerContext): Promise<{
    total: number;
    active: number;
    unassigned: number;
    slaBreached: number;
    unread: number;
  }> {
    // Base visibility filter mirrors list(): drop soft-deleted leads, and
    // scope to the caller's own assigned leads when they can't view all.
    const base: Prisma.WhatsAppThreadWhereInput = {
      OR: [{ lead: { is: { deletedAt: null } } }, { lead: null }],
    };
    if (!caller.canViewAll) {
      if (!caller.employeeId) {
        return { total: 0, active: 0, unassigned: 0, slaBreached: 0, unread: 0 };
      }
      base.lead = { assignedEmployeeId: caller.employeeId, deletedAt: null };
      delete base.OR; // the lead filter already excludes deleted leads
    }

    const and = (extra: Prisma.WhatsAppThreadWhereInput): Prisma.WhatsAppThreadWhereInput => ({
      AND: [base, extra],
    });

    const [total, active, slaBreached, unread, unassigned] = await Promise.all([
      this.prisma.whatsAppThread.count({ where: base }),
      this.prisma.whatsAppThread.count({ where: and({ status: 'OPEN' }) }),
      this.prisma.whatsAppThread.count({ where: and({ slaBreached: true }) }),
      this.prisma.whatsAppThread.count({ where: and({ unreadCount: { gt: 0 } }) }),
      // Unassigned only makes sense for admins who can view all threads.
      caller.canViewAll
        ? this.prisma.whatsAppThread.count({
            where: and({ lead: { assignedEmployeeId: null, deletedAt: null } }),
          })
        : Promise.resolve(0),
    ]);

    return { total, active, unassigned, slaBreached, unread };
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
      if (!caller.employeeId || t.lead?.assignedEmployeeId !== caller.employeeId) {
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
