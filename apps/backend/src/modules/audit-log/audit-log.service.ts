import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditAction, AuditCategory, AuditSeverity, Prisma } from '@prisma/client';
import { ListAuditLogsQueryDto } from './audit-log.dto';
import { EmailService } from '../email/email.service';

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
  private readonly logger = new Logger(AuditLogService.name);

  // In-memory throttle: last time we dispatched an out-of-band alert per action.
  // Bounds alert storms — the DB row + logger.warn still always happen, only the
  // email/Slack dispatch is rate-limited. Reset on process restart (acceptable
  // for a best-effort alert; the greppable log line remains the source of truth).
  private readonly lastAlertAt = new Map<string, number>();
  private static readonly ALERT_THROTTLE_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async findAll(query: ListAuditLogsQueryDto) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(query.action ? { action: query.action } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.outcome ? { outcome: query.outcome } : {}),
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

    // Real-time signal for CRITICAL events (api-key/channel changes, deletes,
    // bulk PII exports, permission changes). A structured, greppable line so a
    // Railway log-alert can fire on it. Never throws.
    if (input.severity === AuditSeverity.CRITICAL) {
      this.logger.warn(
        `[AUDIT-CRITICAL] ${input.action} ${input.route ?? input.entityType} ` +
          `actor=${input.actorUserId ?? 'system'} entity=${input.entityId ?? '-'} ` +
          `outcome=${input.outcome ?? '-'}`,
      );
      // Out-of-band alert (email/Slack). Fire-and-forget — never blocks or
      // throws in log(); the DB row + logger.warn above are the source of truth.
      void this.dispatchCriticalAlert(input).catch(() => undefined);
    }
  }

  /**
   * Best-effort out-of-band alert for CRITICAL audit events. Env-gated (a no-op
   * unless AUDIT_ALERT_EMAIL and/or AUDIT_ALERT_SLACK_WEBHOOK are set) and
   * throttled per-action to avoid alert storms. Swallows all errors so it can
   * never affect the audit write path.
   */
  private async dispatchCriticalAlert(input: CreateAuditLogInput): Promise<void> {
    const alertEmail = process.env.AUDIT_ALERT_EMAIL;
    const slackWebhook = process.env.AUDIT_ALERT_SLACK_WEBHOOK;
    if (!alertEmail && !slackWebhook) return; // not configured — no-op

    // Throttle: skip dispatch if we already alerted for this action recently.
    const now = Date.now();
    const last = this.lastAlertAt.get(input.action);
    if (last !== undefined && now - last < AuditLogService.ALERT_THROTTLE_MS) {
      return;
    }
    this.lastAlertAt.set(input.action, now);

    const actor = input.actorUserId ?? 'system';
    const when = new Date().toISOString();
    const lines = [
      `Action:     ${input.action}`,
      `Entity:     ${input.entityType}${input.entityId ? ` (${input.entityId})` : ''}`,
      `Route:      ${input.route ?? '-'}`,
      `Outcome:    ${input.outcome ?? '-'}`,
      `Actor:      ${actor}`,
      `Time:       ${when}`,
    ];

    if (alertEmail) {
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;color:#1f2937">
          <h2 style="color:#b91c1c;margin-bottom:8px">[CRITICAL audit] ${input.action} ${input.entityType}</h2>
          <table style="border-collapse:collapse;font-size:13px">
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Action</td><td>${input.action}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Entity type</td><td>${input.entityType}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Entity ID</td><td>${input.entityId ?? '-'}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Route</td><td>${input.route ?? '-'}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Outcome</td><td>${input.outcome ?? '-'}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Actor</td><td>${actor}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Created at</td><td>${when}</td></tr>
          </table>
        </div>`;
      void this.email
        .sendMail({
          to: alertEmail,
          subject: `[CRITICAL audit] ${input.action} ${input.entityType}`,
          html,
        })
        .catch(() => undefined);
    }

    if (slackWebhook) {
      const text =
        `:rotating_light: *[CRITICAL audit]* ${input.action} ${input.entityType}\n` +
        lines.join('\n');
      void axios.post(slackWebhook, { text }).catch(() => undefined);
    }
  }
}
