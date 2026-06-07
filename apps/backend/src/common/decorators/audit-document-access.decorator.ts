import { SetMetadata } from '@nestjs/common';

export const AUDIT_DOCUMENT_ACCESS = 'audit:document-access';

export interface AuditDocumentAccessMeta {
  /** What kind of document was served, e.g. 'ClientDocument', 'Receipt'. */
  entityType: string;
  /** Route param that holds the document id. Defaults to 'id'. */
  idParam?: string;
}

/**
 * Mark a document-serving route so the DocumentAccessAuditInterceptor writes a
 * DOCUMENT_VIEWED audit entry (who / client IP / which document) on every
 * SUCCESSFUL response — the "who-saw-what" trail for sensitive client files.
 *
 * @example
 *   @AuditDocumentAccess('ClientDocument', 'itemId')
 *   @Get('cases/:caseId/documents/:itemId/signed-url')
 *
 * See common/interceptors/document-access-audit.interceptor.ts.
 */
export const AuditDocumentAccess = (entityType: string, idParam?: string) =>
  SetMetadata(AUDIT_DOCUMENT_ACCESS, { entityType, idParam } as AuditDocumentAccessMeta);
