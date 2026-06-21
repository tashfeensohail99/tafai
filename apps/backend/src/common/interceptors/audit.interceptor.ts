import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditAction, AuditCategory, AuditSeverity } from '@prisma/client';
import { AuditLogService } from '../../modules/audit-log/audit-log.service';
import { AUDIT_META, AUDIT_SKIP, type AuditMeta } from '../decorators/audit.decorator';
import { redactForAudit } from '../audit/redact.util';

type AuditedRequest = Request & {
  user?: { id?: string };
  route?: { path?: string };
};

/** Route params we treat as "the entity id", most-specific first. */
const ID_PARAM_PRIORITY = [
  'id', 'caseId', 'leadId', 'clientId', 'agreementId', 'paymentId',
  'handoverId', 'invoiceId', 'itemId', 'inboundId', 'threadId', 'callId',
  'noteId', 'taskId', 'milestoneId', 'submissionId', 'correctionId',
  'templateId', 'expenseId', 'channelId', 'employeeId', 'userId', 'token',
];

/**
 * Global audit interceptor — the "capture by default" layer of the audit
 * system. It records an AuditLog row for:
 *   • EVERY state-changing request (POST/PUT/PATCH/DELETE), automatically; and
 *   • any route explicitly tagged with @Audit() (e.g. a CSV export or a
 *     sensitive read), with the classification that tag specifies.
 * Plain reads are ignored unless tagged, and @NoAudit() opts a route out.
 *
 * It captures WHO (JWT user), WHAT (action + redacted body), WHERE (IP + UA),
 * the matched route, outcome (SUCCESS / DENIED / FAILED), status + latency.
 * The write is wrapped in try/catch AND fire-and-forget, so auditing can never
 * delay, alter, or break the request it observes.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean>(AUDIT_SKIP, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const meta = this.reflector.getAllAndOverride<AuditMeta | undefined>(
      AUDIT_META,
      [context.getHandler(), context.getClass()],
    );
    const req = context.switchToHttp().getRequest<AuditedRequest>();
    const method = (req.method ?? '').toUpperCase();
    const isMutation =
      method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH' ||
      method === 'DELETE';

    // Auto-capture every mutation; reads are recorded only when tagged @Audit.
    if (!meta && !isMutation) return next.handle();

    const start = Date.now();
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap({
        next: () => this.record(req, res, meta, method, isMutation, start, undefined),
        error: (err: unknown) =>
          this.record(req, res, meta, method, isMutation, start, err),
      }),
    );
  }

  private record(
    req: AuditedRequest,
    res: Response,
    meta: AuditMeta | undefined,
    method: string,
    isMutation: boolean,
    start: number,
    err: unknown,
  ): void {
    try {
      const status = err ? this.errStatus(err) : res?.statusCode ?? 200;
      const outcome = !err
        ? 'SUCCESS'
        : status === 401 || status === 403
          ? 'DENIED'
          : 'FAILED';
      const category = this.category(meta, isMutation);
      const severity = this.severity(meta, category, method, outcome);
      const action = this.action(meta, category, method, outcome);
      const params = (req.params ?? {}) as Record<string, string>;
      const entityId =
        (meta?.idParam ? params[meta.idParam] : undefined) ??
        this.guessEntityId(params);
      const ua = req.headers['user-agent'];
      const captureBody = meta?.captureBody !== false && isMutation;
      const body = captureBody ? redactForAudit(req.body) : undefined;
      const query = redactForAudit(req.query);

      void this.audit
        .log({
          actorUserId: req.user?.id,
          action,
          entityType: meta?.entityType ?? this.entityType(req),
          entityId,
          category,
          severity,
          method,
          route: `${method} ${req.route?.path ?? req.originalUrl ?? ''}`.trim(),
          outcome,
          statusCode: typeof status === 'number' ? status : undefined,
          durationMs: Date.now() - start,
          ipAddress: this.clientIp(req),
          userAgent: typeof ua === 'string' ? ua : undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          newValues: body as Record<string, any> | undefined,
          metadata: query ? { query } : undefined,
        })
        .catch(() => undefined);
    } catch {
      // Auditing must NEVER affect the request lifecycle.
    }
  }

  private category(meta: AuditMeta | undefined, isMutation: boolean): AuditCategory {
    if (meta?.category && meta.category in AuditCategory) {
      return meta.category as AuditCategory;
    }
    return isMutation ? AuditCategory.MUTATION : AuditCategory.READ;
  }

  private severity(
    meta: AuditMeta | undefined,
    category: AuditCategory,
    method: string,
    outcome: string,
  ): AuditSeverity {
    if (meta?.severity && meta.severity in AuditSeverity) {
      return meta.severity as AuditSeverity;
    }
    if (outcome === 'DENIED') return AuditSeverity.HIGH;
    if (method === 'DELETE') return AuditSeverity.HIGH;
    if (category === AuditCategory.EXPORT || category === AuditCategory.CONFIG) {
      return AuditSeverity.HIGH;
    }
    if (category === AuditCategory.FILE_ACCESS || category === AuditCategory.AUTH) {
      return AuditSeverity.HIGH;
    }
    if (category === AuditCategory.MUTATION) return AuditSeverity.MEDIUM;
    return AuditSeverity.LOW;
  }

  private action(
    meta: AuditMeta | undefined,
    category: AuditCategory,
    method: string,
    outcome: string,
  ): AuditAction {
    if (meta?.action && meta.action in AuditAction) {
      return meta.action as AuditAction;
    }
    if (outcome === 'DENIED') return AuditAction.ACCESS_DENIED;
    if (category === AuditCategory.EXPORT) return AuditAction.DATA_EXPORTED;
    if (category === AuditCategory.READ || category === AuditCategory.FILE_ACCESS) {
      return AuditAction.SENSITIVE_READ;
    }
    if (method === 'POST') return AuditAction.RECORD_CREATED;
    if (method === 'DELETE') return AuditAction.RECORD_DELETED;
    return AuditAction.RECORD_UPDATED; // PUT / PATCH
  }

  /** Logical entity type from the route's first path segment, e.g. 'finance'. */
  private entityType(req: AuditedRequest): string {
    const path = req.route?.path ?? req.originalUrl ?? '';
    const seg = path.split('?')[0].split('/').filter(Boolean)[0];
    return seg ?? 'http';
  }

  private guessEntityId(params: Record<string, string>): string | undefined {
    for (const key of ID_PARAM_PRIORITY) {
      const v = params[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
  }

  private errStatus(err: unknown): number {
    if (err && typeof err === 'object') {
      const e = err as { status?: unknown; statusCode?: unknown };
      if (typeof e.status === 'number') return e.status;
      if (typeof e.statusCode === 'number') return e.statusCode;
    }
    return 500;
  }

  /** Real client IP behind Railway's proxy (X-Forwarded-For), else socket IP. */
  private clientIp(req: AuditedRequest): string | undefined {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
    if (Array.isArray(xff) && xff.length > 0) return xff[0];
    return req.ip ?? undefined;
  }
}
