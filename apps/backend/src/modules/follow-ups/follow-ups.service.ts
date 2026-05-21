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
import { RequestUser } from '../../common/types/auth.types';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  CompleteFollowUpDto,
  CreateFollowUpDto,
  ListFollowUpsQueryDto,
  UpdateFollowUpDto,
} from './follow-ups.dto';

@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
  ) {}

  async findAllAccessible(query: ListFollowUpsQueryDto, user: RequestUser) {
    return this.prisma.followUp.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
        ...(query.dueFrom || query.dueTo
          ? {
              dueAt: {
                ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
                ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
              },
            }
          : {}),
        ...this.buildScopeFilter(user),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { description: { contains: query.search, mode: 'insensitive' } },
                { contactMethod: { contains: query.search, mode: 'insensitive' } },
                {
                  lead: {
                    OR: [
                      { firstName: { contains: query.search, mode: 'insensitive' } },
                      { lastName: { contains: query.search, mode: 'insensitive' } },
                      { phone: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
              ],
            }
          : {}),
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
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    });
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