/**
 * @tashfeen/shared-types — api/index.ts
 * Standard API response shapes, pagination, and error contracts
 * used across every endpoint in the Tashfeen backend.
 */

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

// ─── Standard API Response ────────────────────────────────────────────────────

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

// ─── List Query Params ────────────────────────────────────────────────────────

export interface BaseListQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface LeadListQuery extends BaseListQuery {
  status?: string;
  assignedEmployeeId?: string;
  sourceChannel?: string;
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ClientListQuery extends BaseListQuery {
  status?: string;
  assignedEmployeeId?: string;
  serviceType?: string;
  targetCountry?: string;
  branchId?: string;
}

export interface CaseListQuery extends BaseListQuery {
  status?: string;
  stage?: string;
  assignedEmployeeId?: string;
  clientId?: string;
  branchId?: string;
  departmentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface DocumentListQuery extends BaseListQuery {
  status?: string;
  clientId?: string;
  caseId?: string;
  criticality?: string;
}

export interface FinanceListQuery extends BaseListQuery {
  status?: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface AppointmentListQuery extends BaseListQuery {
  status?: string;
  assignedEmployeeId?: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface AuditLogQuery extends BaseListQuery {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ─── Signed URL Response ──────────────────────────────────────────────────────

export interface SignedUrlResponse {
  url: string;
  expiresAt: string;
}

// ─── Upload Response ──────────────────────────────────────────────────────────

export interface UploadResponse {
  storageKey: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

// ─── ID Response ─────────────────────────────────────────────────────────────

export interface IdResponse {
  id: string;
}
