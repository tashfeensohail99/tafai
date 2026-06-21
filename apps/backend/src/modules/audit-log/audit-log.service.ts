import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditAction, AuditCategory, AuditSeverity, Prisma } from '@prisma/client';
import { ListAuditLogsQueryDto } from './audit-log.dto';
import { EmailService } from '../email/email.service';

// Where an audit row came from. The frontend uses this to label rows; CENTRAL
// is the historical AuditLog table, PROCESSING/AGREEMENT are the bridged trails.
type AuditSourceLabel = 'CENTRAL' | 'PROCESSING' | 'AGREEMENT';

// The normalized shape every returned row conforms to, regardless of source —
// this matches what AuditLogPage.tsx already consumes (action, entityType,
// entityId, actor {id,email}, createdAt, + the optional classification fields)
// plus a `source` label and a free-form `description` for the domain trails.
export interface NormalizedAuditRow {
  id: string;
  source: AuditSourceLabel;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actor: { id: string; email: string } | null;
  createdAt: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oldValues?: Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newValues?: Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any> | null;
  description?: string | null;
  severity?: string | null;
  category?: string | null;
  method?: string | null;
  route?: string | null;
  outcome?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
}

// Paginated envelope returned by findAll. `rows` is the current page window;
// `total` is the full count matching the same filters (across the included
// source(s)); `page` is 1-based; `pageSize` is the page window size.
export interface AuditLogPage {
  rows: NormalizedAuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

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

  async findAll(query: ListAuditLogsQueryDto): Promise<AuditLogPage> {
    const source = query.source ?? 'CENTRAL';
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.limit ?? 50, 250);

    // Default / CENTRAL: unchanged historical behavior — central AuditLog only.
    // (Preserved exactly so existing callers and rows are unaffected; rows just
    // gain a `source: 'CENTRAL'` label.) Now windowed with skip/take + count.
    if (source === 'CENTRAL') {
      const { rows, total } = await this.findCentral(query, page, pageSize);
      return { rows, total, page, pageSize };
    }

    if (source === 'PROCESSING') {
      const { rows, total } = await this.findProcessing(query, page, pageSize);
      return { rows, total, page, pageSize };
    }

    if (source === 'AGREEMENT') {
      const { rows, total } = await this.findAgreement(query, page, pageSize);
      return { rows, total, page, pageSize };
    }

    // ALL: merge all three trails into one timeline. These are lower-volume
    // domain trails, so we over-fetch the first `page*pageSize` rows from each
    // source, merge + sort by createdAt desc, then slice the requested window.
    // `total` is the exact sum of the per-source filtered counts.
    const overFetch = page * pageSize;
    const windowQuery: ListAuditLogsQueryDto = { ...query, page: 1, limit: overFetch };
    const [central, processing, agreement] = await Promise.all([
      this.findCentral(windowQuery, 1, overFetch),
      this.findProcessing(windowQuery, 1, overFetch),
      this.findAgreement(windowQuery, 1, overFetch),
    ]);
    const total = central.total + processing.total + agreement.total;
    const merged = [...central.rows, ...processing.rows, ...agreement.rows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const rows = merged.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return { rows, total, page, pageSize };
  }

  // ── Central AuditLog (historical default behavior) ─────────────────────────
  private async findCentral(
    query: ListAuditLogsQueryDto,
    page: number,
    pageSize: number,
  ): Promise<{ rows: NormalizedAuditRow[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
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
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          actor: {
            select: {
              id: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
      id: r.id,
      source: 'CENTRAL' as const,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorUserId: r.actorUserId,
      actor: r.actor,
      createdAt: r.createdAt,
      oldValues: r.oldValues as NormalizedAuditRow['oldValues'],
      newValues: r.newValues as NormalizedAuditRow['newValues'],
      metadata: r.metadata as NormalizedAuditRow['metadata'],
      description: null,
      severity: r.severity,
      category: r.category,
      method: r.method,
      route: r.route,
      outcome: r.outcome,
      statusCode: r.statusCode,
      durationMs: r.durationMs,
      })),
    };
  }

  // ── ProcessingAuditLog trail ───────────────────────────────────────────────
  private async findProcessing(
    query: ListAuditLogsQueryDto,
    page: number,
    pageSize: number,
  ): Promise<{ rows: NormalizedAuditRow[]; total: number }> {
    const where: Prisma.ProcessingAuditLogWhereInput = {
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.processingAuditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.processingAuditLog.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
      id: r.id,
      source: 'PROCESSING' as const,
      action: r.action,
      entityType: 'ProcessingCase',
      entityId: r.caseId,
      actorUserId: r.actorUserId,
      actor: r.actor,
      createdAt: r.createdAt,
      oldValues: r.oldValues as NormalizedAuditRow['oldValues'],
      newValues: r.newValues as NormalizedAuditRow['newValues'],
      metadata: { processingEntityType: r.entityType, processingEntityId: r.entityId },
      description: r.entityId ? `${r.entityType} ${r.entityId}` : r.entityType,
      severity: null,
      category: null,
      method: null,
      route: null,
      outcome: null,
      statusCode: null,
      durationMs: null,
      })),
    };
  }

  // ── AgreementEvent trail ───────────────────────────────────────────────────
  private async findAgreement(
    query: ListAuditLogsQueryDto,
    page: number,
    pageSize: number,
  ): Promise<{ rows: NormalizedAuditRow[]; total: number }> {
    const where: Prisma.AgreementEventWhereInput = {
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.agreementEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.agreementEvent.count({ where }),
    ]);

    // AgreementEvent has no relation to UserAccount — resolve actor emails with
    // a single batched lookup over the distinct actorUserIds in this page.
    const actorMap = await this.resolveActors(rows.map((r) => r.actorUserId));

    return {
      total,
      rows: rows.map((r) => ({
      id: r.id,
      source: 'AGREEMENT' as const,
      action: r.type,
      entityType: 'Agreement',
      entityId: r.agreementId,
      actorUserId: r.actorUserId,
      actor: r.actorUserId ? (actorMap.get(r.actorUserId) ?? null) : null,
      createdAt: r.createdAt,
      oldValues: r.dataBefore as NormalizedAuditRow['oldValues'],
      newValues: r.dataAfter as NormalizedAuditRow['newValues'],
      metadata: { summary: r.summary },
      description: r.summary,
      severity: null,
      category: null,
      method: null,
      route: null,
      outcome: null,
      statusCode: null,
      durationMs: null,
      })),
    };
  }

  /** Batch-resolve actorUserId → { id, email } in one query (skips nulls). */
  private async resolveActors(
    ids: Array<string | null>,
  ): Promise<Map<string, { id: string; email: string }>> {
    const distinct = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (distinct.length === 0) return new Map();
    const users = await this.prisma.userAccount.findMany({
      where: { id: { in: distinct } },
      select: { id: true, email: true },
    });
    return new Map(users.map((u) => [u.id, u]));
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
