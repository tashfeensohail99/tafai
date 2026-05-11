import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TimelineEventType, Prisma } from '@prisma/client';
import { ListActivityTimelineQueryDto } from './activity-timeline.dto';

export interface CreateTimelineEventInput {
  entityType: string;
  entityId: string;
  leadId?: string;
  clientId?: string;
  caseId?: string;
  eventType: TimelineEventType;
  description: string;
  actorUserId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ActivityTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: CreateTimelineEventInput): Promise<void> {
    await this.prisma.activityTimeline.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        leadId: input.leadId,
        clientId: input.clientId,
        caseId: input.caseId,
        eventType: input.eventType,
        description: input.description,
        actorUserId: input.actorUserId,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async getForEntity(entityType: string, entityId: string) {
    return this.prisma.activityTimeline.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findMany(query: ListActivityTimelineQueryDto) {
    return this.prisma.activityTimeline.findMany({
      where: {
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.caseId ? { caseId: query.caseId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
