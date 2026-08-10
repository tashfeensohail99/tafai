import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  FollowUpStatus,
  LeadStatus,
  Prisma,
  TimelineEventType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { matchAllTokens } from '../../common/search/multi-word-search';
import { RequestUser } from '../../common/types/auth.types';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  CompleteFollowUpDto,
  CreateFollowUpDto,
  ListFollowUpsQueryDto,
  RescheduleFollowUpDto,
  UpdateFollowUpDto,
} from './follow-ups.dto';

@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
  ) {}

  /**
   * List follow-ups with optional due-bucket (overdue/today/upcoming, computed
   * in PKT) and pagination. Returns `{ items, total }`; the controller streams
   * `items` as the JSON body (unchanged shape for existing clients) and exposes
   * `total` via the `X-Total-Count` header for paginating clients (mobile app).
   *
   * When neither `page` nor `limit` is supplied, all matches are returned —
   * preserving the previous unbounded behaviour for the web list.
   */
  async findAllAccessible(query: ListFollowUpsQueryDto, user: RequestUser) {
    const where = this.buildListWhere(query, user);

    const paginate = query.page != null || query.limit != null;
    const take = paginate ? query.limit ?? 50 : undefined;
    const skip = paginate ? ((query.page ?? 1) - 1) * (take ?? 50) : undefined;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.followUp.findMany({
        where,
        include: {
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              status: true,
              serviceInterest: true,
              targetCountry: true,
            },
          },
          assignedEmployee: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        ...(skip != null ? { skip } : {}),
        ...(take != null ? { take } : {}),
      }),
      this.prisma.followUp.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Build the list WHERE. Scope and free-text search are combined under `AND`
   * (each can contribute its own `OR`) so the search clause can never clobber
   * the ownership-scope clause — a view_assigned agent's search stays scoped to
   * their own follow-ups.
   */
  private buildListWhere(
    query: ListFollowUpsQueryDto,
    user: RequestUser,
  ): Prisma.FollowUpWhereInput {
    const and: Prisma.FollowUpWhereInput[] = [this.buildScopeFilter(user)];

    // Multi-word search: each token must hit ONE of the fields. Same fix as
    // #269 in processing — see common/search/multi-word-search.ts.
    const searchAnd = matchAllTokens(query.search, (tok): Prisma.FollowUpWhereInput => ({
      OR: [
        { title: { contains: tok, mode: 'insensitive' } },
        { description: { contains: tok, mode: 'insensitive' } },
        { contactMethod: { contains: tok, mode: 'insensitive' } },
        {
          lead: {
            OR: [
              { firstName: { contains: tok, mode: 'insensitive' } },
              { lastName: { contains: tok, mode: 'insensitive' } },
              { phone: { contains: tok, mode: 'insensitive' } },
            ],
          },
        },
      ],
    }));
    // Splice each token's OR into the outer AND (rep scope + tokens must all
    // hold). Empty / whitespace-only search contributes nothing.
    if (searchAnd) and.push(...searchAnd.AND);

    const where: Prisma.FollowUpWhereInput = {
      AND: and,
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
    };

    if (query.bucket) {
      // Buckets describe pending work, so they imply OPEN unless a status is
      // explicitly requested. dueAt window is computed in PKT.
      const { startOfToday, startOfTomorrow } = this.pktDayBoundsUtc(new Date());
      where.status = query.status ?? FollowUpStatus.OPEN;
      where.dueAt =
        query.bucket === 'overdue'
          ? { lt: startOfToday }
          : query.bucket === 'today'
            ? { gte: startOfToday, lt: startOfTomorrow }
            : { gte: startOfTomorrow };
    } else {
      if (query.status) where.status = query.status;
      if (query.dueFrom || query.dueTo) {
        where.dueAt = {
          ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
          ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
        };
      }
    }

    return where;
  }

  /**
   * Start of today and start of tomorrow as UTC instants, for the PKT calendar
   * day that `now` falls in. PKT is a fixed UTC+5 offset (no DST since 2009).
   */
  private pktDayBoundsUtc(now: Date): { startOfToday: Date; startOfTomorrow: Date } {
    const OFFSET_MS = 5 * 60 * 60_000;
    const shifted = new Date(now.getTime() + OFFSET_MS);
    shifted.setUTCHours(0, 0, 0, 0);
    const startOfToday = new Date(shifted.getTime() - OFFSET_MS);
    const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60_000);
    return { startOfToday, startOfTomorrow };
  }

  async findByIdAccessible(id: string, user: RequestUser) {
    const followUp = await this.prisma.followUp.findFirst({
      where: {
        id,
        ...this.buildScopeFilter(user),
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            status: true,
            serviceInterest: true,
            targetCountry: true,
          },
        },
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!followUp) {
      throw new NotFoundException('Follow-up not found');
    }

    return followUp;
  }

  async create(dto: CreateFollowUpDto, user: RequestUser) {
    const lead = await this.ensureLeadAccessible(dto.leadId, user);
    const ownEmployeeId = await this.findEmployeeIdByUserId(user.id);
    const canViewAll = user.permissions.includes('follow_ups.view_all');

    if (!canViewAll && dto.assignedEmployeeId && dto.assignedEmployeeId !== ownEmployeeId) {
      throw new ForbiddenException('You can only assign follow-ups to your own employee profile');
    }

    const assignedEmployeeId = dto.assignedEmployeeId ?? lead.assignedEmployeeId ?? ownEmployeeId;

    const created = await this.prisma.followUp.create({
      data: {
        leadId: dto.leadId,
        assignedEmployeeId,
        createdByUserId: user.id,
        title: dto.title,
        description: dto.description,
        contactMethod: dto.contactMethod,
        dueAt: new Date(dto.dueAt),
        priority: dto.priority,
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            status: true,
            serviceInterest: true,
            targetCountry: true,
          },
        },
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (this.shouldMoveLeadToFollowUp(lead.status)) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { status: LeadStatus.FOLLOW_UP },
      });
    }

    await this.auditLog.log({
      actorUserId: user.id,
      action: AuditAction.FOLLOW_UP_CREATED,
      entityType: 'FollowUp',
      entityId: created.id,
      newValues: {
        leadId: created.leadId,
        assignedEmployeeId: created.assignedEmployeeId,
        title: created.title,
        dueAt: created.dueAt,
        priority: created.priority,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: created.leadId,
      leadId: created.leadId,
      eventType: TimelineEventType.FOLLOW_UP_CREATED,
      description: `Follow-up scheduled: ${created.title}`,
      actorUserId: user.id,
      metadata: {
        followUpId: created.id,
        dueAt: created.dueAt.toISOString(),
        priority: created.priority,
      },
    });

    return created;
  }

  async update(id: string, dto: UpdateFollowUpDto, user: RequestUser) {
    const existing = await this.findByIdAccessible(id, user);
    const ownEmployeeId = await this.findEmployeeIdByUserId(user.id);
    const canViewAll = user.permissions.includes('follow_ups.view_all');

    if (!canViewAll && dto.assignedEmployeeId && dto.assignedEmployeeId !== ownEmployeeId) {
      throw new ForbiddenException('You can only assign follow-ups to your own employee profile');
    }

    if (existing.status === FollowUpStatus.COMPLETED) {
      throw new BadRequestException('Completed follow-ups cannot be edited');
    }

    const updated = await this.prisma.followUp.update({
      where: { id },
      data: {
        assignedEmployeeId: dto.assignedEmployeeId,
        title: dto.title,
        description: dto.description,
        contactMethod: dto.contactMethod,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        priority: dto.priority,
        status: dto.status,
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            status: true,
            serviceInterest: true,
            targetCountry: true,
          },
        },
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    await this.auditLog.log({
      actorUserId: user.id,
      action: AuditAction.FOLLOW_UP_UPDATED,
      entityType: 'FollowUp',
      entityId: id,
      oldValues: {
        assignedEmployeeId: existing.assignedEmployeeId,
        dueAt: existing.dueAt,
        priority: existing.priority,
        status: existing.status,
      },
      newValues: dto,
    });

    // If only the due date moved, log it as a reschedule with the old/new
    // timestamps for context; otherwise fall back to a generic update event.
    const dueAtChanged =
      dto.dueAt &&
      new Date(dto.dueAt).getTime() !== new Date(existing.dueAt).getTime();
    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: updated.leadId,
      leadId: updated.leadId,
      eventType: dueAtChanged
        ? TimelineEventType.FOLLOW_UP_RESCHEDULED
        : TimelineEventType.NOTE_ADDED,
      description: dueAtChanged
        ? `Follow-up rescheduled: ${updated.title} → ${new Date(dto.dueAt!).toLocaleString()}`
        : `Follow-up updated: ${updated.title}`,
      actorUserId: user.id,
      metadata: {
        followUpId: updated.id,
        ...(dueAtChanged
          ? { from: existing.dueAt?.toISOString(), to: new Date(dto.dueAt!).toISOString() }
          : {}),
      },
    });

    return updated;
  }

  /**
   * Move a follow-up's due date. Reuses update() (access check + COMPLETED guard
   * + audit + the RESCHEDULED timeline event) and then drops the stale pending
   * due-reminder so the reminder dispatcher re-materialises it at the new dueAt.
   */
  async reschedule(id: string, dto: RescheduleFollowUpDto, user: RequestUser) {
    const updated = await this.update(id, { dueAt: dto.dueAt }, user);
    await this.prisma.reminderJob
      .deleteMany({ where: { followUpId: id, status: 'PENDING', kind: 'FOLLOWUP_DUE' } })
      .catch(() => undefined);
    return updated;
  }

  async complete(id: string, dto: CompleteFollowUpDto, user: RequestUser) {
    const existing = await this.findByIdAccessible(id, user);

    if (existing.status === FollowUpStatus.COMPLETED) {
      throw new BadRequestException('Follow-up is already completed');
    }

    const completed = await this.prisma.followUp.update({
      where: { id },
      data: {
        status: FollowUpStatus.COMPLETED,
        completedAt: new Date(),
        completedByUserId: user.id,
        outcomeNotes: dto.outcomeNotes,
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            status: true,
            serviceInterest: true,
            targetCountry: true,
          },
        },
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    await this.auditLog.log({
      actorUserId: user.id,
      action: AuditAction.FOLLOW_UP_COMPLETED,
      entityType: 'FollowUp',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: completed.status,
        completedAt: completed.completedAt,
        outcomeNotes: completed.outcomeNotes,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: completed.leadId,
      leadId: completed.leadId,
      eventType: TimelineEventType.FOLLOW_UP_COMPLETED,
      description: `Follow-up completed: ${completed.title}`,
      actorUserId: user.id,
      metadata: {
        followUpId: completed.id,
        outcomeNotes: completed.outcomeNotes,
      },
    });

    return completed;
  }

  private buildScopeFilter(user: RequestUser): Prisma.FollowUpWhereInput {
    if (user.permissions.includes('follow_ups.view_all')) {
      return {};
    }

    if (!user.permissions.includes('follow_ups.view_assigned')) {
      throw new ForbiddenException('You do not have access to follow-ups');
    }

    return {
      OR: [
        { createdByUserId: user.id },
        { assignedEmployee: { userId: user.id } },
      ],
    };
  }

  private async ensureLeadAccessible(leadId: string, user: RequestUser) {
    const canViewAll = user.permissions.includes('leads.view_all');

    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        deletedAt: null,
        ...(!canViewAll
          ? {
              OR: [
                { assignedEmployee: { userId: user.id } },
                { createdByUserId: user.id },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        status: true,
        assignedEmployeeId: true,
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return lead;
  }

  private async findEmployeeIdByUserId(userId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true },
    });

    return employee?.id ?? null;
  }

  private shouldMoveLeadToFollowUp(status: LeadStatus) {
    return !([
      LeadStatus.CONVERTED,
      LeadStatus.LOST,
      LeadStatus.DUPLICATE,
      LeadStatus.UNQUALIFIED,
      LeadStatus.FOLLOW_UP,
    ] as LeadStatus[]).includes(status);
  }
}