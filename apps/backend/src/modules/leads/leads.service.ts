import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, ClientStatus, LeadStatus, Prisma, TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../common/types/auth.types';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import { StorageService } from '../storage/storage.service';
import { AssignLeadDto, CreateLeadDto, ListLeadsQueryDto, UpdateLeadDto } from './leads.dto';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
    private readonly storage: StorageService,
  ) {}

  async findAllAccessible(query: ListLeadsQueryDto, user: RequestUser) {
    const canViewAll = user.permissions.includes('leads.view_all');

    return this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.sourceChannel ? { sourceChannel: query.sourceChannel } : {}),
        ...(!canViewAll
          ? {
              OR: [
                { assignedEmployee: { userId: user.id } },
                { createdByUserId: user.id },
              ],
            }
          : {}),
        ...(query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
        branch: { select: { id: true, name: true } },
        referralPartner: {
          select: { id: true, companyName: true, referralCode: true },
        },
        // _count dropped on list endpoints — three extra subqueries per row
        // that nothing was rendering. Detail endpoint still returns them.
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdAccessible(id: string, user: RequestUser) {
    const canViewAll = user.permissions.includes('leads.view_all');

    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
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
      include: {
        assignedEmployee: true,
        branch: true,
        referralPartner: true,
        appointments: { orderBy: { scheduledAt: 'desc' }, take: 10 },
        invoices: { orderBy: { createdAt: 'desc' }, take: 10 },
        timelineEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!lead) throw new NotFoundException('Lead not found');

    return lead;
  }

  async findAll(query: ListLeadsQueryDto) {
    return this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.sourceChannel ? { sourceChannel: query.sourceChannel } : {}),
        ...(query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
        branch: { select: { id: true, name: true } },
        referralPartner: {
          select: { id: true, companyName: true, referralCode: true },
        },
        // _count dropped on list endpoints — three extra subqueries per row
        // that nothing was rendering. Detail endpoint still returns them.
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id, deletedAt: null },
      include: {
        assignedEmployee: true,
        branch: true,
        referralPartner: true,
        appointments: { orderBy: { scheduledAt: 'desc' }, take: 10 },
        invoices: { orderBy: { createdAt: 'desc' }, take: 10 },
        timelineEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async create(dto: CreateLeadDto, actorUserId: string) {
    await this.ensureUniqueLead(dto.phone, dto.email);
    const fallbackAssignedEmployeeId = dto.assignedEmployeeId ?? await this.findEmployeeIdByUserId(actorUserId);

    const lead = await this.prisma.lead.create({
      data: {
        branchId: dto.branchId,
        assignedEmployeeId: fallbackAssignedEmployeeId,
        createdByUserId: actorUserId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        alternatePhone: dto.alternatePhone,
        nationality: dto.nationality,
        targetCountry: dto.targetCountry,
        serviceInterest: dto.serviceInterest,
        sourceChannel: dto.sourceChannel,
        referralPartnerId: dto.referralPartnerId,
        status: dto.status ?? LeadStatus.NEW,
        priority: dto.priority,
        notes: dto.notes,
      },
      include: {
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
        branch: { select: { id: true, name: true } },
        referralPartner: {
          select: { id: true, companyName: true, referralCode: true },
        },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.LEAD_CREATED,
      entityType: 'Lead',
      entityId: lead.id,
      newValues: {
        firstName: lead.firstName,
        lastName: lead.lastName,
        phone: lead.phone,
        serviceInterest: lead.serviceInterest,
        targetCountry: lead.targetCountry,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: lead.id,
      leadId: lead.id,
      eventType: TimelineEventType.LEAD_CREATED,
      description: `${lead.firstName} ${lead.lastName} created`,
      actorUserId,
      metadata: {
        sourceChannel: lead.sourceChannel,
        serviceInterest: lead.serviceInterest,
        targetCountry: lead.targetCountry,
      },
    });

    // Inbox "Convert to Lead" flow: if a raw WhatsApp thread was the
    // source, link it to the new Lead so the chat history continues
    // against the same thread. Best-effort — if the thread is already
    // linked to a different lead/client we leave it alone.
    if (dto.whatsAppThreadId) {
      try {
        await this.prisma.whatsAppThread.updateMany({
          where: {
            id: dto.whatsAppThreadId,
            leadId: null,
            clientId: null,
          },
          data: { leadId: lead.id },
        });
      } catch {
        // Don't fail the whole create if the link step errors out.
      }
    }

    return lead;
  }

  async update(id: string, dto: UpdateLeadDto, actorUserId: string) {
    const existing = await this.findById(id);

    if (dto.phone || dto.email) {
      await this.ensureUniqueLead(dto.phone, dto.email, id);
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        ...dto,
        convertedAt: dto.status === LeadStatus.CONVERTED ? new Date() : undefined,
      },
      include: {
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
        branch: { select: { id: true, name: true } },
        referralPartner: {
          select: { id: true, companyName: true, referralCode: true },
        },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.LEAD_UPDATED,
      entityType: 'Lead',
      entityId: id,
      oldValues: {
        status: existing.status,
        assignedEmployeeId: existing.assignedEmployeeId,
        phone: existing.phone,
        email: existing.email,
      },
      newValues: dto,
    });

    if (dto.status && dto.status !== existing.status) {
      await this.activityTimeline.record({
        entityType: 'Lead',
        entityId: updated.id,
        leadId: updated.id,
        clientId: updated.convertedClientId ?? undefined,
        eventType: dto.status === LeadStatus.CONVERTED ? TimelineEventType.LEAD_CONVERTED : TimelineEventType.NOTE_ADDED,
        description: dto.status === LeadStatus.CONVERTED
          ? 'Lead marked as converted'
          : `Lead status changed from ${existing.status} to ${dto.status}`,
        actorUserId,
      });
    }

    return updated;
  }

  async assign(id: string, dto: AssignLeadDto, actorUserId: string) {
    const existing = await this.findById(id);

    const updated = await this.prisma.lead.update({
      where: { id },
      data: { assignedEmployeeId: dto.assignedEmployeeId },
      include: {
        assignedEmployee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    const action = existing.assignedEmployeeId ? AuditAction.LEAD_REASSIGNED : AuditAction.LEAD_ASSIGNED;
    await this.auditLog.log({
      actorUserId,
      action,
      entityType: 'Lead',
      entityId: id,
      oldValues: { assignedEmployeeId: existing.assignedEmployeeId },
      newValues: { assignedEmployeeId: dto.assignedEmployeeId },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: id,
      leadId: id,
      eventType: TimelineEventType.LEAD_ASSIGNED,
      description: existing.assignedEmployeeId ? 'Lead reassigned to another employee' : 'Lead assigned to an employee',
      actorUserId,
      metadata: {
        assignedEmployeeId: dto.assignedEmployeeId,
        assignedEmployeeName: updated.assignedEmployee ? `${updated.assignedEmployee.firstName} ${updated.assignedEmployee.lastName}` : null,
      },
    });

    return this.findById(id);
  }

  async convertToClient(id: string, actorUserId: string, notes?: string, tx?: Prisma.TransactionClient) {
    const prisma = tx ?? this.prisma;
    const lead = await prisma.lead.findUnique({
      where: { id, deletedAt: null },
      include: {
        branch: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (lead.convertedClientId) {
      const existingClient = await prisma.client.findUnique({ where: { id: lead.convertedClientId } });
      if (!existingClient) {
        throw new NotFoundException('Converted client not found');
      }

      return { lead, client: existingClient, wasExistingClient: false };
    }

    let client = await prisma.client.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { phone: lead.phone },
          ...(lead.email ? [{ email: lead.email }] : []),
        ],
      },
    });

    const wasExistingClient = Boolean(client);
    if (!client) {
      client = await prisma.client.create({
        data: {
          branchId: lead.branchId,
          createdByUserId: actorUserId,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          alternatePhone: lead.alternatePhone,
          nationality: lead.nationality,
          // Provenance — preserves where this client came from so admin views,
          // processing officers, and the original sales rep stay linked.
          sourceLeadId: lead.id,
          assignedEmployeeId: lead.assignedEmployeeId,
          serviceType: lead.serviceInterest,
          targetCountry: lead.targetCountry,
          status: ClientStatus.NEW_CLIENT,
          portalAccessEnabled: true,
        },
      });

      await this.auditLog.log({
        actorUserId,
        action: AuditAction.CLIENT_CREATED,
        entityType: 'Client',
        entityId: client.id,
        newValues: {
          firstName: client.firstName,
          lastName: client.lastName,
          phone: client.phone,
          email: client.email,
          sourceLeadId: lead.id,
        },
      });
    }

    const updatedLead = await prisma.lead.update({
      where: { id },
      data: {
        status: LeadStatus.CONVERTED,
        convertedAt: new Date(),
        convertedClientId: client.id,
        notes: notes ? [lead.notes, notes].filter(Boolean).join('\n\n') : lead.notes,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.LEAD_CONVERTED,
      entityType: 'Lead',
      entityId: lead.id,
      oldValues: {
        status: lead.status,
        convertedClientId: lead.convertedClientId,
      },
      newValues: {
        status: LeadStatus.CONVERTED,
        convertedClientId: client.id,
        notes,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Lead',
      entityId: lead.id,
      leadId: lead.id,
      clientId: client.id,
      eventType: TimelineEventType.LEAD_CONVERTED,
      description: `${lead.firstName} ${lead.lastName} converted to client`,
      actorUserId,
      metadata: {
        clientId: client.id,
        clientExisted: wasExistingClient,
      },
    });

    await this.activityTimeline.record({
      entityType: 'Client',
      entityId: client.id,
      leadId: lead.id,
      clientId: client.id,
      eventType: TimelineEventType.LEAD_CONVERTED,
      description: `Client record created from lead ${lead.firstName} ${lead.lastName}`,
      actorUserId,
      metadata: {
        leadId: lead.id,
        sourceChannel: lead.sourceChannel,
        serviceInterest: lead.serviceInterest,
        targetCountry: lead.targetCountry,
      },
    });

    return { lead: updatedLead, client, wasExistingClient };
  }

  private async ensureUniqueLead(phone?: string, email?: string, excludeId?: string) {
    if (!phone && !email) return;

    const duplicateLead = await this.prisma.lead.findFirst({
      where: {
        deletedAt: null,
        AND: [excludeId ? { id: { not: excludeId } } : {}],
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
      select: { id: true },
    });

    if (duplicateLead) {
      throw new ConflictException('A lead with the same phone or email already exists');
    }
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

  // ---------------------------------------------------------------------------
  // Lead file attachments
  // ---------------------------------------------------------------------------

  private async assertLeadAccess(leadId: string, user: RequestUser): Promise<void> {
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
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead not found or access denied');
  }

  async uploadLeadFile(
    leadId: string,
    file: Express.Multer.File,
    user: RequestUser,
  ) {
    await this.assertLeadAccess(leadId, user);

    const { key } = await this.storage.upload(
      file.buffer,
      file.mimetype,
      `leads/${leadId}/attachments`,
      file.originalname,
    );

    const employee = await this.findEmployeeIdByUserId(user.id);
    void employee; // employee id not stored in lead_files, use userId directly

    return this.prisma.leadFile.create({
      data: {
        leadId,
        uploadedByUserId: user.id,
        fileName: file.originalname,
        fileKey: key,
        fileMimeType: file.mimetype,
        fileSizeBytes: file.size,
      },
      select: {
        id: true,
        leadId: true,
        fileName: true,
        fileMimeType: true,
        fileSizeBytes: true,
        createdAt: true,
      },
    });
  }

  async listLeadFiles(leadId: string, user: RequestUser) {
    await this.assertLeadAccess(leadId, user);

    return this.prisma.leadFile.findMany({
      where: { leadId },
      select: {
        id: true,
        leadId: true,
        fileName: true,
        fileMimeType: true,
        fileSizeBytes: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLeadFileSignedUrl(leadId: string, fileId: string, user: RequestUser) {
    await this.assertLeadAccess(leadId, user);

    const record = await this.prisma.leadFile.findFirst({
      where: { id: fileId, leadId },
      select: { fileKey: true, fileName: true },
    });
    if (!record) throw new NotFoundException('File not found');

    const url = await this.storage.getSignedUrl(record.fileKey);
    return { url, fileName: record.fileName };
  }

  async deleteLeadFile(leadId: string, fileId: string, user: RequestUser) {
    await this.assertLeadAccess(leadId, user);

    const record = await this.prisma.leadFile.findFirst({
      where: { id: fileId, leadId },
      select: { id: true, fileKey: true, uploadedByUserId: true },
    });
    if (!record) throw new NotFoundException('File not found');

    // Only uploader or someone with leads.view_all can delete
    const canDeleteAny = user.permissions.includes('leads.view_all');
    if (!canDeleteAny && record.uploadedByUserId !== user.id) {
      throw new ForbiddenException('You can only delete files you uploaded');
    }

    await this.storage.delete(record.fileKey);
    await this.prisma.leadFile.delete({ where: { id: fileId } });
    return { deleted: true };
  }
}