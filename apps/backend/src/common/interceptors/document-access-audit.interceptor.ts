import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditAction } from '@prisma/client';
import { AuditLogService } from '../../modules/audit-log/audit-log.service';
import {
  AUDIT_DOCUMENT_ACCESS,
  type AuditDocumentAccessMeta,
} from '../decorators/audit-document-access.decorator';

type AuditedRequest = Request & {
  user?: { id?: string };
  route?: { path?: string };
};

/**
 * Records a DOCUMENT_VIEWED audit entry whenever a route decorated with
 * @AuditDocumentAccess() serves a document successfully. Captures WHO
 * (actorUserId from the JWT), FROM WHERE (client IP + user-agent) and WHICH
 * document (route params + filename). Registered globally but a cheap no-op on
 * every undecorated route. The audit write is fire-and-forget so it can never
 * break or delay the actual download.
 */
@Injectable()
export class DocumentAccessAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditDocumentAccessMeta | undefined>(
      AUDIT_DOCUMENT_ACCESS,
      context.getHandler(),
    );
    if (!meta || context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<AuditedRequest>();

    // tap() runs only when the handler resolves successfully, so a denied /
    // not-found request (which throws first) is never recorded as a view.
    return next.handle().pipe(
      tap((body: unknown) => {
        const params = (req.params ?? {}) as Record<string, string>;
        const entityId = meta.idParam ? params[meta.idParam] : params.id;
        const ua = req.headers['user-agent'];
        const fileName =
          body && typeof body === 'object' && 'fileName' in body
            ? (body as { fileName?: unknown }).fileName
            : undefined;

        void this.audit
          .log({
            actorUserId: req.user?.id,
            action: AuditAction.DOCUMENT_VIEWED,
            entityType: meta.entityType,
            entityId,
            ipAddress: this.clientIp(req),
            userAgent: typeof ua === 'string' ? ua : undefined,
            metadata: {
              route: `${req.method} ${req.route?.path ?? req.originalUrl}`,
              params,
              ...(typeof fileName === 'string' ? { fileName } : {}),
            },
          })
          .catch(() => undefined);
      }),
    );
  }

  /** Real client IP behind Railway's proxy (X-Forwarded-For), else socket IP. */
  private clientIp(req: AuditedRequest): string | undefined {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
    if (Array.isArray(xff) && xff.length > 0) return xff[0];
    return req.ip ?? undefined;
  }
}
