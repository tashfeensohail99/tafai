import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, AuditAction, LeadStatus, TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import {
  WhatsAppAppointmentNotifierService,
  type AppointmentConfirmationResult,
} from '../whatsapp/notifications/appointment-notifier.service';
import {
  CancelAppointmentDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  UpdateAppointmentDto,
} from './appointments.dto';
import { RequestUser } from '../../common/types/auth.types';

@Injectable()
export class AppointmentsService {
  private readonly log = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
    private readonly whatsappNotifier: WhatsAppAppointmentNotifierService,
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

    let whatsappConfirmation: AppointmentConfirmationResult | null = null;
    if (dto.sendWhatsAppConfirmation) {
      try {
        whatsappConfirmation = await this.whatsappNotifier.sendConfirmationFor(
          created.id,
          actorUserId,
        );
      } catch (err) {
        // Notifier is best-effort — appointment creation must never fail
        // because of WhatsApp send issues.
        this.log.warn(
          { appointmentId: created.id, err: (err as Error).message },
          'whatsapp confirmation send failed',
        );
        whatsappConfirmation = { sent: false, reason: 'no_thread' };
      }
    }

    return { ...created, whatsappConfirmation };
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

    // Timeline events for every appointment-status transition so the lead
    // profile reflects the lifecycle, not just completions.
    if (dto.status && dto.status !== existing.status) {
      if (dto.status === AppointmentStatus.COMPLETED) {
        await this.recordTimeline(updated.leadId, updated.clientId, updated.caseId, TimelineEventType.APPOINTMENT_COMPLETED, `Appointment completed: ${updated.title}`, actorUserId);
      } else if (dto.status === AppointmentStatus.CANCELLED) {
        await this.recordTimeline(updated.leadId, updated.clientId, updated.caseId, TimelineEventType.APPOINTMENT_CANCELLED, `Appointment cancelled: ${updated.title}`, actorUserId);
      } else if (dto.status === AppointmentStatus.NO_SHOW) {
        await this.recordTimeline(updated.leadId, updated.clientId, updated.caseId, TimelineEventType.APPOINTMENT_NO_SHOW, `Customer no-show: ${updated.title}`, actorUserId);
      }
    }

    // Reschedule — scheduledAt moved without a status change to CANCELLED.
    // Compare timestamps via getTime() so a Date and an ISO string with the
    // same instant don't false-positive as "rescheduled".
    if (
      dto.scheduledAt &&
      new Date(dto.scheduledAt).getTime() !== new Date(existing.scheduledAt).getTime() &&
      dto.status !== AppointmentStatus.CANCELLED
    ) {
      await this.recordTimeline(
        updated.leadId,
        updated.clientId,
        updated.caseId,
        TimelineEventType.APPOINTMENT_RESCHEDULED,
        `Appointment rescheduled: ${updated.title} → ${new Date(dto.scheduledAt).toLocaleString()}`,
        actorUserId,
      );
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

    await this.recordTimeline(
      appointment.leadId,
      appointment.clientId,
      appointment.caseId,
      TimelineEventType.APPOINTMENT_CANCELLED,
      `Appointment cancelled: ${appointment.title}${dto.cancellationReason ? ` (${dto.cancellationReason})` : ''}`,
      actorUserId,
    );

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

  async generateIcs(user: RequestUser): Promise<string> {
    const canViewAll = user.permissions.includes('appointments.view_all');
    const assignedEmployeeId = canViewAll
      ? undefined
      : await this.findEmployeeIdByUserId(user.id);

    if (!canViewAll && !assignedEmployeeId) {
      return this.buildIcs([]);
    }

    const rows = await this.prisma.appointment.findMany({
      where: {
        ...(!canViewAll ? { assignedEmployeeId } : {}),
        status: { notIn: ['CANCELLED'] as any },
      },
      include: {
        lead: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    return this.buildIcs(rows);
  }

  private buildIcs(
    rows: Array<{
      id: string;
      title: string;
      scheduledAt: Date;
      durationMinutes: number;
      location?: string | null;
      meetingLink?: string | null;
      notes?: string | null;
      status: string;
      lead?: { firstName: string; lastName: string } | null;
      client?: { firstName: string; lastName: string } | null;
    }>,
  ): string {
    const escape = (s: string) =>
      s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

    const fmtDt = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const foldLine = (line: string): string => {
      const chunks: string[] = [];
      while (line.length > 75) {
        chunks.push(line.slice(0, 75));
        line = ' ' + line.slice(75);
      }
      chunks.push(line);
      return chunks.join('\r\n');
    };

    const now = fmtDt(new Date());

    const events = rows.map((r) => {
      const start = new Date(r.scheduledAt);
      const end = new Date(start.getTime() + r.durationMinutes * 60_000);
      const contact = r.client ?? r.lead;
      const summary = contact
        ? `${contact.firstName} ${contact.lastName} — ${r.title}`
        : r.title;
      const descParts: string[] = [];
      if (r.meetingLink) descParts.push(`Meeting link: ${r.meetingLink}`);
      if (r.notes) descParts.push(r.notes);
      const desc = descParts.join('\\n');

      const lines = [
        'BEGIN:VEVENT',
        foldLine(`UID:${r.id}@tafsheen.app`),
        `DTSTAMP:${now}`,
        `DTSTART:${fmtDt(start)}`,
        `DTEND:${fmtDt(end)}`,
        foldLine(`SUMMARY:${escape(summary)}`),
      ];
      if (r.location) lines.push(foldLine(`LOCATION:${escape(r.location)}`));
      if (r.meetingLink) lines.push(foldLine(`URL:${escape(r.meetingLink)}`));
      if (desc) lines.push(foldLine(`DESCRIPTION:${escape(desc)}`));
      lines.push(`STATUS:${r.status === 'COMPLETED' ? 'COMPLETED' : 'CONFIRMED'}`);
      lines.push('END:VEVENT');
      return lines.join('\r\n');
    });

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Tafsheen//Appointments//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Tafsheen Appointments',
      'X-WR-TIMEZONE:Asia/Karachi',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n');
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