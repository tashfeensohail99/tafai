import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditAction, AuditCategory, AuditSeverity, Prisma } from '@prisma/client';
import { ListAuditLogsQueryDto } from './audit-log.dto';

export interface CreateAuditLogInput {
  actorUserId?: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oldValues?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
  // Structured classification (set by the global AuditInterceptor; optional so
  // existing hand-written .log() call sites keep compiling unchanged).
  severity?: AuditSeverity;
  category?: AuditCategory;
  method?: string;
  route?: string;
  outcome?: string;
  statusCode?: number;
  durationMs?: number;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListAuditLogsQueryDto) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.search
          ? {
              OR: [
                { entityType: { contains: query.search, mode: 'insensitive' } },
                { entityId: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.createdFrom || query.createdTo
          ? {
              createdAt: {
                ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
                ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
              },
            }
          : {}),
      },
      include: {
        actor: {
          select: {
            id: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit ?? 100, 250),
    });
  }

  async log(input: CreateAuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValues: input.oldValues as Prisma.InputJsonValue | undefined,
        newValues: input.newValues as Prisma.InputJsonValue | undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        severity: input.severity,
        category: input.category,
        method: input.method,
        route: input.route,
        outcome: input.outcome,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
      },
    });
  }
}
