import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, DocumentStatus, TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import {
  CreateClientDocumentDto,
  CreateDocumentRequirementDto,
  ListClientDocumentsQueryDto,
  ListDocumentRequirementsQueryDto,
  ReviewClientDocumentDto,
  UpdateDocumentRequirementDto,
} from './documents.dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
  ) {}

  async listRequirements(query: ListDocumentRequirementsQueryDto) {
    return this.prisma.documentRequirement.findMany({
      where: {
        ...(query.serviceType ? { serviceType: query.serviceType } : {}),
        ...(query.targetCountry ? { OR: [{ targetCountry: query.targetCountry }, { targetCountry: null }] } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createRequirement(dto: CreateDocumentRequirementDto, actorUserId: string) {
    const created = await this.prisma.documentRequirement.create({
      data: {
        serviceType: dto.serviceType,
        targetCountry: dto.targetCountry,
        name: dto.name,
        description: dto.description,
        isRequired: dto.isRequired ?? true,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'DocumentRequirement',
      entityId: created.id,
      newValues: dto,
    });

    return created;
  }

  async updateRequirement(id: string, dto: UpdateDocumentRequirementDto, actorUserId: string) {
    const existing = await this.prisma.documentRequirement.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Document requirement not found');
    }

    const updated = await this.prisma.documentRequirement.update({
      where: { id },
      data: dto,
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'DocumentRequirement',
      entityId: id,
      oldValues: {
        name: existing.name,
        serviceType: existing.serviceType,
        targetCountry: existing.targetCountry,
        isRequired: existing.isRequired,
        isActive: existing.isActive,
      },
      newValues: dto,
    });

    return updated;
  }

  async listDocuments(query: ListClientDocumentsQueryDto) {
    return this.prisma.clientDocument.findMany({
      where: {
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.caseId ? { caseId: query.caseId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: {
        client: { select: { id: true, firstName: true, lastName: true, phone: true } },
        case: { select: { id: true, caseNumber: true, status: true } },
        documentRequirement: { select: { id: true, name: true, serviceType: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findDocumentById(id: string) {
    const document = await this.prisma.clientDocument.findUnique({
      where: { id },
      include: {
        client: true,
        case: true,
        documentRequirement: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Client document not found');
    }

    return document;
  }

  async uploadDocument(dto: CreateClientDocumentDto, actorUserId: string) {
    await this.ensureClientExists(dto.clientId);
    if (dto.caseId) {
      await this.ensureCaseExists(dto.caseId);
    }

    const created = await this.prisma.clientDocument.create({
      data: {
        clientId: dto.clientId,
        caseId: dto.caseId,
        documentRequirementId: dto.documentRequirementId,
        uploadedByUserId: actorUserId,
        name: dto.name,
        description: dto.description,
        fileKey: dto.fileKey,
        fileMimeType: dto.fileMimeType,
        fileSizeBytes: dto.fileSizeBytes,
        status: DocumentStatus.UPLOADED,
        isConfidential: dto.isConfidential ?? true,
      },
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        case: { select: { id: true, caseNumber: true } },
        documentRequirement: { select: { id: true, name: true } },
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.DOCUMENT_UPLOADED,
      entityType: 'ClientDocument',
      entityId: created.id,
      newValues: {
        clientId: created.clientId,
        caseId: created.caseId,
        documentRequirementId: created.documentRequirementId,
        name: created.name,
      },
    });

    await this.recordDocumentTimeline(created.clientId, created.caseId, TimelineEventType.DOCUMENT_UPLOADED, `${created.name} uploaded`, actorUserId);

    return created;
  }

  async reviewDocument(id: string, dto: ReviewClientDocumentDto, actorUserId: string) {
    const document = await this.findDocumentById(id);

    if (
      dto.status !== DocumentStatus.VERIFIED
      && dto.status !== DocumentStatus.REJECTED
      && dto.status !== DocumentStatus.REPLACEMENT_REQUIRED
    ) {
      throw new BadRequestException('Documents can only be marked as verified, rejected, or replacement required during review');
    }

    const updated = await this.prisma.clientDocument.update({
      where: { id },
      data: {
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        status: dto.status,
        rejectionReason: dto.status === DocumentStatus.VERIFIED ? null : dto.rejectionReason,
      },
    });

    const action = dto.status === DocumentStatus.VERIFIED
      ? AuditAction.DOCUMENT_VERIFIED
      : dto.status === DocumentStatus.REJECTED
        ? AuditAction.DOCUMENT_REJECTED
        : AuditAction.DOCUMENT_REVIEWED;

    const timelineEvent = dto.status === DocumentStatus.VERIFIED
      ? TimelineEventType.DOCUMENT_VERIFIED
      : TimelineEventType.DOCUMENT_REJECTED;

    await this.auditLog.log({
      actorUserId,
      action,
      entityType: 'ClientDocument',
      entityId: id,
      oldValues: { status: document.status },
      newValues: {
        status: dto.status,
        rejectionReason: dto.rejectionReason,
      },
    });

    await this.recordDocumentTimeline(updated.clientId, updated.caseId, timelineEvent, `${document.name} ${dto.status.toLowerCase().replace(/_/g, ' ')}`, actorUserId);

    return this.findDocumentById(id);
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

  private async ensureCaseExists(caseId: string) {
    const record = await this.prisma.case.findUnique({
      where: { id: caseId, deletedAt: null },
      select: { id: true },
    });

    if (!record) {
      throw new NotFoundException('Case not found');
    }
  }

  private async recordDocumentTimeline(
    clientId: string,
    caseId: string | null,
    eventType: TimelineEventType,
    description: string,
    actorUserId: string,
  ) {
    if (caseId) {
      await this.activityTimeline.record({
        entityType: 'Case',
        entityId: caseId,
        clientId,
        caseId,
        eventType,
        description,
        actorUserId,
      });
    }

    await this.activityTimeline.record({
      entityType: 'Client',
      entityId: clientId,
      clientId,
      caseId: caseId ?? undefined,
      eventType,
      description,
      actorUserId,
    });
  }
}