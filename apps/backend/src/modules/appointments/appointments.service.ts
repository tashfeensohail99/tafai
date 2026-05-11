import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, AuditAction, LeadStatus, TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import {
  CancelAppointmentDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  UpdateAppointmentDto,
} from './appointments.dto';
import { RequestUser } from '../../common/types/auth.types';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
  ) {}

  async findAllAccessible(query: ListAppointmentsQueryDto, user: RequestUser) {
    const canViewAll = user.permissions.includes('appointments.view_all');
    const assignedEmployeeId = canViewAll
      ? undefined
      : await this.findEmployeeIdByUserId(user.id);

    if (!canViewAll && !assignedEmployeeId) {
      return [];
    }

    return this.prisma.appointment.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.caseId ? { caseId: query.caseId } : {}),
        ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
        ...(!canViewAll ? { assignedEmployeeId } : {}),
        ...(query.scheduledFrom || query.scheduledTo
          ? {
              scheduledAt: {
                ...(query.scheduledFrom ? { gte: new Date(query.scheduledFrom) } : {}),
                ...(query.scheduledTo ? { lte: new Date(query.scheduledTo) } : {}),
              },
            }
          : {}),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { appointmentType: { contains: query.search, mode: 'insensitive' } },
                { location: { contains: query.search, mode: 'insensitive' } },
                {
                  lead: {
                    OR: [
                      { firstName: { contains: query.search, mode: 'insensitive' } },
                      { lastName: { contains: query.search, mode: 'insensitive' } },
                      { phone: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
                {
                  client: {
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
        lead: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        client: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        case: { select: { id: true, caseNumber: true, status: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async findByIdAccessible(id: string, user: RequestUser) {
    const canViewAll = user.permissions.includes('appointments.view_all');
    const assignedEmployeeId = canViewAll
      ? undefined
      : await this.findEmployeeIdByUserId(user.id);

    if (!canViewAll && !assignedEmployeeId) {
      throw new NotFoundException('Appointment not found');
    }

    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id,
        ...(!canViewAll ? { assignedEmployeeId } : {}),
      },
      include: {
        lead: true,
        client: true,
        case: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return appointment;
  }

  async findAll(query: ListAppointmentsQueryDto) {
    return this.prisma.appointment.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.caseId ? { caseId: query.caseId } : {}),
        ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
        ...(query.scheduledFrom || query.scheduledTo
          ? {
              scheduledAt: {
                ...(query.scheduledFrom ? { gte: new Date(query.scheduledFrom) } : {}),
                ...(query.scheduledTo ? { lte: new Date(query.scheduledTo) } : {}),
              },
            }
          : {}),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { appointmentType: { contains: query.search, mode: 'insensitive' } },
                { location: { contains: query.search, mode: 'insensitive' } },
                {
                  lead: {
                    OR: [
                      { firstName: { contains: query.search, mode: 'insensitive' } },
                      { lastName: { contains: query.search, mode: 'insensitive' } },
                      { phone: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
                {
                  client: {
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
        lead: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        client: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        case: { select: { id: true, caseNumber: true, status: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async findById(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        lead: true,
        client: true,
        case: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return appointment;
  }

  async create(dto: CreateAppointmentDto, actorUserId: string) {
    const owner = await this.resolveOwner(dto.leadId, dto.clientId, dto.caseId);

    const created = await this.prisma.appointment.create({
      data: {
        leadId: owner.leadId,
        clientId: owner.clientId,
        caseId: owner.caseId,
        assignedEmployeeId: dto.assignedEmployeeId ?? owner.assignedEmployeeId,
        createdByUserId: actorUserId,
        title: dto.title,
        appointmentType: dto.appointmentType,
        scheduledAt: new Date(dto.scheduledAt),
        durationMinutes: dto.durationMinutes ?? 30,
        location: dto.location,
        meetingLink: dto.meetingLink,
        notes: dto.notes,
      },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, phone: true } },
        client: { select: { id: true, firstName: true, lastName: true, phone: true } },
        case: { select: { id: true, caseNumber: true } },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.APPOINTMENT_CREATED,
      entityType: 'Appointment',
      entityId: created.id,
      newValues: {
        leadId: created.leadId,
        clientId: created.clientId,
        caseId: created.caseId,
        title: created.title,
        appointmentType: created.appointmentType,
        scheduledAt: created.scheduledAt,
      },
    });

    await this.recordTimeline(
      created.leadId,
      created.clientId,
      created.caseId,
      TimelineEventType.APPOINTMENT_SCHEDULED,
      `Appointment scheduled: ${created.title}`,
      actorUserId,
    );

    return created;
  }

  async update(id: string, dto: UpdateAppointmentDto, actorUserId: string) {
    const existing = await this.findById(id);

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        assignedEmployeeId: dto.assignedEmployeeId,
        title: dto.title,
        appointmentType: dto.appointmentType,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        durationMinutes: dto.durationMinutes,
        location: dto.location,
        meetingLink: dto.meetingLink,
        notes: dto.notes,
        status: dto.status,
        completedAt: dto.status === AppointmentStatus.COMPLETED ? new Date() : undefined,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: dto.status === AppointmentStatus.CANCELLED ? AuditAction.APPOINTMENT_CANCELLED : AuditAction.APPOINTMENT_UPDATED,
      entityType: 'Appointment',
      entityId: updated.id,
      oldValues: {
        status: existing.status,
        scheduledAt: existing.scheduledAt,
        assignedEmployeeId: existing.assignedEmployeeId,
      },
      newValues: dto,
    });

    if (dto.status === AppointmentStatus.COMPLETED && existing.status !== AppointmentStatus.COMPLETED) {
      await this.recordTimeline(updated.leadId, updated.clientId, updated.caseId, TimelineEventType.APPOINTMENT_COMPLETED, `Appointment completed: ${updated.title}`, actorUserId);
    }

    return this.findById(id);
  }

  async cancel(id: string, dto: CancelAppointmentDto, actorUserId: string) {
    const appointment = await this.findById(id);

    await this.prisma.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: dto.cancellationReason,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.APPOINTMENT_CANCELLED,
      entityType: 'Appointment',
      entityId: id,
      oldValues: { status: appointment.status },
      newValues: { status: AppointmentStatus.CANCELLED, cancellationReason: dto.cancellationReason },
    });

    return this.findById(id);
  }

  private async resolveOwner(leadId?: string, clientId?: string, caseId?: string) {
    if (!leadId && !clientId && !caseId) {
      throw new BadRequestException('A lead, client, or case must be selected for the appointment');
    }

    if (leadId && clientId) {
      throw new BadRequestException('Appointments must target either a lead or a client, not both');
    }

    if (leadId) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId, deletedAt: null },
        select: { id: true, status: true, convertedClientId: true, assignedEmployeeId: true },
      });

      if (!lead) {
        throw new NotFoundException('Lead not found');
      }

      if (lead.convertedClientId || lead.status === LeadStatus.CONVERTED) {
        throw new BadRequestException('Converted leads should be handled from the client workflow');
      }

      return {
        leadId: lead.id,
        clientId: undefined,
        caseId: undefined,
        assignedEmployeeId: lead.assignedEmployeeId,
      };
    }

    if (caseId) {
      const record = await this.prisma.case.findUnique({
        where: { id: caseId, deletedAt: null },
        select: { id: true, clientId: true, assignedEmployeeId: true },
      });

      if (!record) {
        throw new NotFoundException('Case not found');
      }

      return {
        leadId: undefined,
        clientId: clientId ?? record.clientId,
        caseId: record.id,
        assignedEmployeeId: record.assignedEmployeeId,
      };
    }

    const client = await this.prisma.client.findUnique({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return {
      leadId: undefined,
      clientId: client.id,
      caseId: undefined,
      assignedEmployeeId: undefined,
    };
  }

  private async findEmployeeIdByUserId(userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        userId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    return employee?.id ?? null;
  }

  private async recordTimeline(
    leadId: string | null,
    clientId: string | null,
    caseId: string | null,
    eventType: TimelineEventType,
    description: string,
    actorUserId: string,
  ) {
    if (leadId) {
      await this.activityTimeline.record({
        entityType: 'Lead',
        entityId: leadId,
        leadId,
        eventType,
        description,
        actorUserId,
      });
    }

    if (clientId) {
      await this.activityTimeline.record({
        entityType: caseId ? 'Case' : 'Client',
        entityId: caseId ?? clientId,
        clientId,
        caseId: caseId ?? undefined,
        eventType,
        description,
        actorUserId,
      });
    }
  }
}