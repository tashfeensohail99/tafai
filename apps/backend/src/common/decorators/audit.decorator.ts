import { SetMetadata } from '@nestjs/common';

export const AUDIT_META = 'audit:meta';
export const AUDIT_SKIP = 'audit:skip';

export type AuditCategoryName =
  | 'MUTATION'
  | 'READ'
  | 'AUTH'
  | 'EXPORT'
  | 'FILE_ACCESS'
  | 'WEBHOOK'
  | 'CRON'
  | 'CONFIG';

export type AuditSeverityName = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AuditMeta {
  /**
   * A specific AuditAction enum value name (e.g. 'PAYMENT_REFUNDED'). Optional —
   * when omitted the global AuditInterceptor derives a generic action
   * (RECORD_CREATED/UPDATED/DELETED / DATA_EXPORTED / SENSITIVE_READ) from the
   * HTTP method + category. An unrecognised value is ignored (falls back to the
   * generic action) so a typo can never break a request.
   */
  action?: string;
  /** Logical entity type, e.g. 'Payment', 'ApiKey'. Defaults to the route's first segment. */
  entityType?: string;
  category?: AuditCategoryName;
  severity?: AuditSeverityName;
  /** Route param holding the entity id (defaults to a best-guess: id/caseId/leadId/…). */
  idParam?: string;
  /** Whether to store the (redacted) request body. Defaults to true for mutations. */
  captureBody?: boolean;
}

/**
 * Classify a route for the audit trail. Use it to (a) refine how a MUTATION is
 * recorded, or (b) opt a READ/EXPORT/FILE_ACCESS route into the audit log
 * (reads are not auto-captured). The global AuditInterceptor reads this.
 *
 * @example
 *   @Audit({ action: 'PAYMENT_REFUNDED', entityType: 'Payment', category: 'MUTATION', severity: 'CRITICAL', idParam: 'id' })
 *   @Audit({ entityType: 'Lead', category: 'EXPORT', severity: 'HIGH' }) // a CSV export GET
 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_META, meta);

/**
 * Exclude a route from the global audit interceptor entirely — for genuinely
 * noisy, non-security-relevant writes (presence pings, tab-seen, device-token
 * refresh) that would otherwise bury the signal.
 */
export const NoAudit = () => SetMetadata(AUDIT_SKIP, true);
