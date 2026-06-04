import { Injectable, Logger } from '@nestjs/common';
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
  private readonly log = new Logger(ActivityTimelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a timeline event. Fire-and-forget by design: timeline rows are
   * best-effort activity logs (no caller uses the result, it's never inside a
   * caller's transaction), and the INSERT is the single busiest write in the DB
   * (~28ms each). Awaiting it added that latency to every lead create/update on
   * the request path. Detaching it keeps user actions snappy; the insert still
   * happens, and failures are logged rather than thrown. Resolves immediately
   * (kept as Promise<void> so existing `await …record()` call sites are unchanged).
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async record(input: CreateTimelineEventInput): Promise<void> {
    this.prisma.activityTimeline
      .create({
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
      })
      .catch((e: unknown) =>
        this.log.warn(
          `timeline record failed (${input.entityType}/${input.eventType}): ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
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
