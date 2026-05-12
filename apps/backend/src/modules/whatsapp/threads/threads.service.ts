import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

interface ThreadListOptions {
  status?: 'OPEN' | 'PENDING' | 'RESOLVED' | 'ARCHIVED';
  assignedToMe?: boolean;
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

    // Scope to caller's assigned leads unless they're allowed to see all
    // AND haven't explicitly asked for "mine only".
    if (!caller.canViewAll || opts.assignedToMe) {
      if (!caller.employeeId) {
        // A user with whatsapp.view_inbox but no Employee row — return nothing
        // rather than throw, so the UI doesn't break.
        return { items: [], nextCursor: null };
      }
      where.lead = { assignedEmployeeId: caller.employeeId };
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
}
