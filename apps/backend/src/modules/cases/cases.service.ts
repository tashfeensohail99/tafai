import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, CaseStatus, TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import {
  ChangeCaseStatusDto,
  CreateCaseDto,
  HandoverCaseDto,
  ListCasesQueryDto,
  UpdateCaseDto,
} from './cases.dto';

interface CreateCaseFromVerifiedPaymentInput {
  clientId: string;
  actorUserId: string;
  serviceType: string;
  targetCountry: string;
  assignedEmployeeId?: string | null;
  notes?: string;
}

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
  ) {}

  async findAll(query: ListCasesQueryDto) {
    return this.prisma.case.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.search
          ? {
              OR: [
                { caseNumber: { contains: query.search, mode: 'insensitive' } },
                { serviceType: { contains: query.search, mode: 'insensitive' } },
                { targetCountry: { contains: query.search, mode: 'insensitive' } },
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
        client: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        department: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { documents: true, appointments: true, timelineEvents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const record = await this.prisma.case.findUnique({
      where: { id, deletedAt: null },
      include: {
        client: true,
        department: true,
        assignedEmployee: true,
        documents: { orderBy: { createdAt: 'desc' }, take: 20 },
        appointments: { orderBy: { scheduledAt: 'desc' }, take: 20 },
        timelineEvents: { orderBy: { createdAt: 'desc' }, take: 30 },
      },
    });

    if (!record) {
      throw new NotFoundException('Case not found');
    }

    return record;
  }

  async create(dto: CreateCaseDto, actorUserId: string) {
    await this.ensureClientExists(dto.clientId);

    const caseNumber = await this.generateCaseNumber();
    const created = await this.prisma.case.create({
      data: {
        clientId: dto.clientId,
        departmentId: dto.departmentId,
        assignedEmployeeId: dto.assignedEmployeeId,
        caseNumber,
        serviceType: dto.serviceType,
        targetCountry: dto.targetCountry,
        status: dto.status ?? CaseStatus.OPEN,
        priority: dto.priority,
        notes: dto.notes,
        submissionDeadline: dto.submissionDeadline ? new Date(dto.submissionDeadline) : undefined,
        createdByUserId: actorUserId,
      },
      include: {
        client: { select: { id: true, firstName: true, lastName: true, phone: true } },
        department: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.CASE_CREATED,
      entityType: 'Case',
      entityId: created.id,
      newValues: {
        caseNumber: created.caseNumber,
        clientId: created.clientId,
        serviceType: created.serviceType,
        targetCountry: created.targetCountry,
        status: created.status,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Case',
      entityId: created.id,
      clientId: created.clientId,
      caseId: created.id,
      eventType: TimelineEventType.CASE_OPENED,
      description: `Case ${created.caseNumber} opened`,
      actorUserId,
      metadata: {
        serviceType: created.serviceType,
        targetCountry: created.targetCountry,
      },
    });

    return created;
  }

  async update(id: string, dto: UpdateCaseDto, actorUserId: string) {
    const existing = await this.findById(id);

    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        departmentId: dto.departmentId,
        assignedEmployeeId: dto.assignedEmployeeId,
        serviceType: dto.serviceType,
        targetCountry: dto.targetCountry,
        status: dto.status,
        priority: dto.priority,
        notes: dto.notes,
        submissionDeadline: dto.submissionDeadline ? new Date(dto.submissionDeadline) : undefined,
      },
      include: {
        client: { select: { id: true, firstName: true, lastName: true, phone: true } },
        department: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.CASE_UPDATED,
      entityType: 'Case',
      entityId: updated.id,
      oldValues: {
        departmentId: existing.departmentId,
        assignedEmployeeId: existing.assignedEmployeeId,
        serviceType: existing.serviceType,
        targetCountry: existing.targetCountry,
        status: existing.status,
      },
      newValues: dto,
    });

    if (dto.status && dto.status !== existing.status) {
      await this.activityTimeline.record({
        entityType: 'Case',
        entityId: updated.id,
        clientId: updated.clientId,
        caseId: updated.id,
        eventType: TimelineEventType.CASE_STATUS_CHANGED,
        description: `Case status changed from ${existing.status} to ${dto.status}`,
        actorUserId,
      });
    }

    return updated;
  }

  async changeStatus(id: string, dto: ChangeCaseStatusDto, actorUserId: string) {
    const existing = await this.findById(id);

    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        status: dto.status,
        notes: dto.notes ?? existing.notes,
        submittedAt: dto.status === CaseStatus.SUBMITTED ? new Date() : undefined,
        decidedAt: dto.status === CaseStatus.APPROVED
          || dto.status === CaseStatus.REJECTED
          || dto.status === CaseStatus.WITHDRAWN
          || dto.status === CaseStatus.COMPLETED
          ? new Date()
          : undefined,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.CASE_STATUS_CHANGED,
      entityType: 'Case',
      entityId: updated.id,
      oldValues: { status: existing.status },
      newValues: { status: dto.status, notes: dto.notes },
    });

    await this.activityTimeline.record({
      entityType: 'Case',
      entityId: updated.id,
      clientId: updated.clientId,
      caseId: updated.id,
      eventType: TimelineEventType.CASE_STATUS_CHANGED,
      description: `Case status changed from ${existing.status} to ${dto.status}`,
      actorUserId,
      metadata: { notes: dto.notes },
    });

    return this.findById(id);
  }

  async handover(id: string, dto: HandoverCaseDto, actorUserId: string) {
    const existing = await this.findById(id);

    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        departmentId: dto.departmentId,
        assignedEmployeeId: dto.assignedEmployeeId,
        status: dto.status ?? existing.status,
        notes: dto.notes ? [existing.notes, dto.notes].filter(Boolean).join('\n\n') : existing.notes,
      },
      include: {
        department: { select: { id: true, name: true } },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.CASE_HANDOVER,
      entityType: 'Case',
      entityId: updated.id,
      oldValues: {
        departmentId: existing.departmentId,
        assignedEmployeeId: existing.assignedEmployeeId,
        status: existing.status,
      },
      newValues: {
        departmentId: dto.departmentId,
        assignedEmployeeId: dto.assignedEmployeeId,
        status: dto.status ?? existing.status,
        notes: dto.notes,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Case',
      entityId: updated.id,
      clientId: existing.clientId,
      caseId: updated.id,
      eventType: TimelineEventType.CASE_HANDOVER,
      description: `Case handed over to ${updated.department?.name ?? 'another department'}`,
      actorUserId,
      metadata: {
        departmentId: dto.departmentId,
        assignedEmployeeId: dto.assignedEmployeeId,
        status: dto.status,
        notes: dto.notes,
      },
    });

    return this.findById(id);
  }

  async createFromVerifiedPayment(input: CreateCaseFromVerifiedPaymentInput) {
    const existing = await this.prisma.case.findFirst({
      where: {
        clientId: input.clientId,
        deletedAt: null,
        serviceType: input.serviceType,
        targetCountry: input.targetCountry,
        status: {
          in: [
            CaseStatus.OPEN,
            CaseStatus.IN_PROGRESS,
            CaseStatus.DOCUMENTATION,
            CaseStatus.PROCESSING,
            CaseStatus.SUBMITTED,
            CaseStatus.ON_HOLD,
          ],
        },
      },
    });

    if (existing) {
      return existing;
    }

    const processingDepartment = await this.prisma.department.findFirst({
      where: {
        isActive: true,
        name: { equals: 'Processing', mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });

    const created = await this.create(
      {
        clientId: input.clientId,
        departmentId: processingDepartment?.id,
        assignedEmployeeId: input.assignedEmployeeId ?? undefined,
        serviceType: input.serviceType,
        targetCountry: input.targetCountry,
        status: CaseStatus.DOCUMENTATION,
        notes: input.notes,
      },
      input.actorUserId,
    );

    if (processingDepartment) {
      await this.activityTimeline.record({
        entityType: 'Case',
        entityId: created.id,
        clientId: created.clientId,
        caseId: created.id,
        eventType: TimelineEventType.CASE_HANDOVER,
        description: `Case automatically handed over to ${processingDepartment.name}`,
        actorUserId: input.actorUserId,
      });
    }

    return created;
  }

  private async ensureClientExists(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }
  }

  private async generateCaseNumber() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
      const suffix = Math.random().toString().slice(2, 6);
      const caseNumber = `CASE-${timestamp}-${suffix}`;
      const existing = await this.prisma.case.findUnique({
        where: { caseNumber },
        select: { id: true },
      });

      if (!existing) {
        return caseNumber;
      }
    }

    throw new Error('Unable to generate a unique case number');
  }
}