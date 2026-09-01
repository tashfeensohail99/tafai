'use client';

import { apiFetch } from './api-client';

/**
 * Processing Department API client. Mirrors the shapes returned by
 * `apps/backend/src/modules/processing/processing.controller.ts`.
 *
 * The frontend pages were previously hard-coded to render MOCK_PROCESSING_CASES;
 * this module replaces that with real backend calls. Where existing UI code
 * still expects the `MockProcessingCase` shape, `adaptCaseToWorkspace()` maps
 * an `ApiProcessingCase` onto it so the workspace + tabs keep rendering.
 */

// ---------------------------------------------------------------------------
// Types (mirror Prisma enums + backend response shapes)
// ---------------------------------------------------------------------------

export type ProcessingStage =
  | 'INTAKE_PENDING'
  | 'DOCUMENTS_COLLECTION'
  | 'DOCUMENTS_UNDER_REVIEW'
  | 'DOCUMENTS_INCOMPLETE'
  | 'DOCUMENTS_COMPLETE'
  | 'READY_FOR_SUBMISSION'
  | 'SUBMITTED'
  | 'UNDER_AUTHORITY_REVIEW'
  | 'ADDITIONAL_INFO_REQUESTED'
  | 'DECISION_RECEIVED'
  | 'APPROVED'
  | 'REJECTED'
  | 'APPEAL_IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'JUNK';

export type ProcessingPriority = 'LOW' | 'NORMAL' | 'URGENT' | 'CRITICAL';
export type AuthorityDecision = 'PENDING' | 'APPROVED' | 'REJECTED';

/** Slim case shape returned by `GET /processing/cases` (list view). */
export interface ApiProcessingCaseListItem {
  id: string;
  service: string;
  targetCountry: string;
  stage: ProcessingStage;
  /** Lightweight per-service tracking label (feedback F3); null until set. */
  subStage: string | null;
  priority: ProcessingPriority;
  authorityDecision: AuthorityDecision;
  slaDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** `assignedEmployee` is the originating SALES rep (distinct from
   *  `assignedOfficer`, who is the processing officer). Null when the lead
   *  was never assigned (e.g. a manually-created processing client). */
  lead: { id: string; referenceCode: string; firstName: string; lastName: string; phone: string; email: string | null; sourceChannel: string | null; assignedEmployee: { id: string; firstName: string; lastName: string } | null };
  client: { id: string; firstName: string; lastName: string; phone: string; email: string | null };
  /** The PROCESSING officer who owns the case. `employee` (the officer's real
   *  name) is only populated by the main cases-list select — other endpoints
   *  that reuse this type may omit it, so it's optional; use
   *  {@link officerDisplayName} which falls back to the email local-part. */
  assignedOfficer: { id: string; email: string; employee?: { firstName: string; lastName: string } | null } | null;
  _count: { documentItems: number };
  /** Per-row checklist progress for the roster view (verified/total, with a
   *  blocking-gap flag). NOT_APPLICABLE items are excluded from `total`. */
  docProgress: { total: number; verified: number; rejected: number; criticalMissing: number };
  /** Per-document status strip for the roster tiles (excludes NOT_APPLICABLE).
   *  status is a DocumentItemStatus value. */
  documents: Array<{ label: string; status: string }>;
  /** Cross-department context hint: whether Sales/Finance notes exist for this
   *  client, and the call count + last-call time. Powers the roster history pill
   *  (which deep-links to the case's History tab). Only the main cases list
   *  populates this — the intake-queue / refund-lane endpoints reuse this type
   *  without it, so it's optional and consumers must guard. */
  history?: {
    hasSalesNotes: boolean;
    hasFinanceNotes: boolean;
    callCount: number;
    lastCallAt: string | null;
  };
}

/** Full case detail returned by `GET /processing/cases/:id`. */
export interface ApiProcessingCaseDetail {
  id: string;
  financeHandoverId: string;
  leadId: string;
  clientId: string;
  branchId: string | null;
  assignedOfficerId: string | null;
  priority: ProcessingPriority;
  stage: ProcessingStage;
  slaStatus: 'ACTIVE' | 'APPROACHING' | 'BREACHED' | 'EXTENDED' | 'COMPLETED';
  slaDueAt: string | null;
  service: string;
  targetCountry: string;
  /** Lightweight per-service tracking label (feedback F3); null until set. */
  subStage: string | null;
  financeHandoverNote: string | null;
  processingNote: string | null;
  estimatedSubmissionDate: string | null;
  actualSubmissionDate: string | null;
  authorityTrackingRef: string | null;
  authorityDecision: AuthorityDecision;
  authorityDecisionDate: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  // P4e — submission package
  submissionPackageKey: string | null;
  submissionPackageAssembledAt: string | null;
  submissionPackageDocCount: number | null;
  createdAt: string;
  updatedAt: string;
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    serviceInterest: string | null;
    targetCountry: string | null;
    /** Originating SALES rep (null when the lead was never assigned). */
    assignedEmployee: { id: string; firstName: string; lastName: string } | null;
  };
  client: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    nationality: string | null;
    dateOfBirth: string | null;
    passportNumber: string | null;
    passportExpiry: string | null;
  };
  assignedOfficer: { id: string; email: string } | null;
  financeHandover: {
    id: string;
    submittedAmount: string | number;
    currency: string;
    receiptFileName: string | null;
    submittedAt: string;
  } | null;
  stageHistory: Array<{
    id: string;
    fromStage: ProcessingStage | null;
    toStage: ProcessingStage;
    changedByUserId: string;
    reason: string | null;
    createdAt: string;
  }>;
  _count: { documentItems: number; tasks: number; notes: number };
}

export interface ProcessingDashboardMetrics {
  activeCases: number;
  awaitingReview: number;
  readyToSubmit: number;
  newIntake: number;
  // Per-associate (or manager-aggregate when canViewAll) breakdowns. Names
  // start "my" because the backend filters by assignedOfficerId for non-
  // managers; for managers these are global counts.
  myPendingDocs: number;
  myClientFollowUp: number;
  myApproved: number;
  myRefused: number;
}

export interface ListCasesQuery {
  stage?: ProcessingStage;
  /** Multi-stage filter — wins over `stage` when both passed. */
  stages?: ProcessingStage[];
  priority?: ProcessingPriority;
  assignedOfficerId?: string;
  clientId?: string;
  service?: string;
  targetCountry?: string;
  authorityDecision?: AuthorityDecision;
  /** ISO date (yyyy-mm-dd or ISO datetime) — case intake range. */
  createdFrom?: string;
  createdTo?: string;
  /** ISO date — last activity (any field-write bumps updatedAt). */
  updatedFrom?: string;
  updatedTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ListCasesResponse {
  cases: ApiProcessingCaseListItem[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export function fetchProcessingDashboard(): Promise<ProcessingDashboardMetrics> {
  return apiFetch<ProcessingDashboardMetrics>('/processing/dashboard', { cache: 'no-store' });
}

/**
 * Manager dashboard payload — totals + per-stage + per-officer + recent
 * intake + currently SLA-breached cases. Requires processing.case.view_all.
 */
export interface ApiProcessingAdminOverview {
  totals: {
    active: number;
    newIntake: number;
    slaBreached: number;
    unassigned: number;
    pendingDocuments: number;
    finalSubmissionPending: number;
    approved: number;
    refused: number;
  };
  casesByType: Array<{ service: string; count: number }>;
  stageBreakdown: Array<{ stage: ProcessingStage; count: number }>;
  officerWorkload: Array<{ officerId: string | null; name: string; activeCases: number }>;
  recentIntake: Array<{
    id: string;
    service: string;
    targetCountry: string;
    priority: ProcessingPriority;
    createdAt: string;
    clientName: string | null;
    clientPhone: string | null;
  }>;
  breachedCases: Array<{
    id: string;
    stage: ProcessingStage;
    service: string;
    targetCountry: string;
    slaDueAt: string | null;
    officerName: string | null;
    clientName: string | null;
  }>;
}

export function fetchProcessingAdminOverview(): Promise<ApiProcessingAdminOverview> {
  return apiFetch<ApiProcessingAdminOverview>('/processing/admin-overview', { cache: 'no-store' });
}

// ---------------------------------------------------------------------------
// Reports — 5 endpoints under /processing/reports/*. Each accepts optional
// dateFrom / dateTo (ISO date) + officerId filters. Frontend renders raw
// payloads as tabs — no transformation, server is source of truth.
// ---------------------------------------------------------------------------

export interface ReportDateRangeQuery {
  dateFrom?: string;
  dateTo?: string;
  officerId?: string;
}

function reportQs(q: ReportDateRangeQuery = {}): string {
  const qs = new URLSearchParams();
  if (q.dateFrom) qs.set('dateFrom', q.dateFrom);
  if (q.dateTo) qs.set('dateTo', q.dateTo);
  if (q.officerId) qs.set('officerId', q.officerId);
  return qs.toString() ? `?${qs.toString()}` : '';
}

export interface ApiWorkloadReport {
  from: string;
  to: string;
  rows: Array<{
    officerId: string | null;
    officerName: string;
    caseCount: number;
    avgDaysOpen: number;
    stageCounts: Record<string, number>;
  }>;
}
export function fetchWorkloadReport(q?: ReportDateRangeQuery): Promise<ApiWorkloadReport> {
  return apiFetch<ApiWorkloadReport>(`/processing/reports/workload${reportQs(q)}`, { cache: 'no-store' });
}

export interface ApiThroughputReport {
  from: string;
  to: string;
  totalClosed: number;
  weeks: Array<{ week: string; completed: number; cancelled: number; rejected: number; total: number }>;
}
export function fetchThroughputReport(q?: ReportDateRangeQuery): Promise<ApiThroughputReport> {
  return apiFetch<ApiThroughputReport>(`/processing/reports/throughput${reportQs(q)}`, { cache: 'no-store' });
}

export interface ApiDocQualityReport {
  from: string;
  to: string;
  documents: Array<{
    documentName: string;
    accepted: number;
    rejected: number;
    total: number;
    rejectionRate: number;
    topReasonCodes: Array<{ code: string; count: number }>;
  }>;
  topReasonCodes: Array<{ code: string; count: number }>;
}
export function fetchDocQualityReport(q?: ReportDateRangeQuery): Promise<ApiDocQualityReport> {
  return apiFetch<ApiDocQualityReport>(`/processing/reports/doc-quality${reportQs(q)}`, { cache: 'no-store' });
}

export interface ApiSlaReport {
  overdueCorrections: Array<{
    correctionId: string;
    caseId: string;
    subject: string;
    status: string;
    slaDueAt: string | null;
    hoursOverdue: number | null;
    raisedByName: string;
  }>;
  agingCases: Array<{
    caseId: string;
    service: string;
    targetCountry: string;
    stage: ProcessingStage;
    priority: ProcessingPriority;
    daysOpen: number;
    bucket: '30-60' | '60-90' | '90+';
    officerName: string;
  }>;
  summary: { overdueCount: number; aging30to60: number; aging60to90: number; aging90plus: number };
}
export function fetchSlaReport(q?: ReportDateRangeQuery): Promise<ApiSlaReport> {
  return apiFetch<ApiSlaReport>(`/processing/reports/sla${reportQs(q)}`, { cache: 'no-store' });
}

export interface ApiExpiryRiskReport {
  rows: Array<{
    documentItemId: string;
    documentName: string;
    criticality: string;
    status: string;
    validityExpiryDate: string | null;
    daysUntilExpiry: number | null;
    bucket: 'expired' | '0-30' | '31-60' | '61-90' | 'unknown';
    caseId: string;
    service: string;
    targetCountry: string;
    casePriority: ProcessingPriority;
    officerName: string;
  }>;
}
export function fetchExpiryRiskReport(q?: ReportDateRangeQuery): Promise<ApiExpiryRiskReport> {
  return apiFetch<ApiExpiryRiskReport>(`/processing/reports/expiry-risk${reportQs(q)}`, { cache: 'no-store' });
}

/**
 * Intake queue row — same as a list item but also includes the finance
 * handover snapshot the officer needs to acknowledge intelligently (the
 * paid amount, who handed off, the file name of the receipt).
 */
export interface ApiIntakeCaseItem extends ApiProcessingCaseListItem {
  financeHandover: {
    id: string;
    submittedAmount: string | number;
    currency: string;
    receiptFileName: string | null;
    submittedAt: string;
    createdByUserId: string;
  } | null;
  financeHandoverNote: string | null;
}

export interface IntakeQueueResponse {
  items: ApiIntakeCaseItem[];
  total: number;
  page: number;
  limit: number;
}

export function fetchIntakeQueue(opts?: {
  page?: number;
  limit?: number;
  search?: string;
}): Promise<IntakeQueueResponse> {
  const qs = new URLSearchParams();
  if (opts?.page) qs.set('page', String(opts.page));
  if (opts?.limit) qs.set('limit', String(opts.limit));
  if (opts?.search?.trim()) qs.set('search', opts.search.trim());
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<IntakeQueueResponse>(`/processing/intake${suffix}`, { cache: 'no-store' });
}

export function fetchProcessingCases(query: ListCasesQuery = {}): Promise<ListCasesResponse> {
  const qs = new URLSearchParams();
  if (query.stage) qs.set('stage', query.stage);
  if (query.stages && query.stages.length > 0) qs.set('stages', query.stages.join(','));
  if (query.priority) qs.set('priority', query.priority);
  if (query.assignedOfficerId) qs.set('assignedOfficerId', query.assignedOfficerId);
  if (query.clientId) qs.set('clientId', query.clientId);
  if (query.service) qs.set('service', query.service);
  if (query.targetCountry) qs.set('targetCountry', query.targetCountry);
  if (query.authorityDecision) qs.set('authorityDecision', query.authorityDecision);
  if (query.createdFrom) qs.set('createdFrom', query.createdFrom);
  if (query.createdTo) qs.set('createdTo', query.createdTo);
  if (query.updatedFrom) qs.set('updatedFrom', query.updatedFrom);
  if (query.updatedTo) qs.set('updatedTo', query.updatedTo);
  if (query.search) qs.set('search', query.search);
  if (query.page) qs.set('page', String(query.page));
  if (query.limit) qs.set('limit', String(query.limit));
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<ListCasesResponse>(`/processing/cases${tail}`, { cache: 'no-store' });
}

export function fetchProcessingCase(caseId: string): Promise<ApiProcessingCaseDetail> {
  return apiFetch<ApiProcessingCaseDetail>(`/processing/cases/${caseId}`, { cache: 'no-store' });
}

// ---------------------------------------------------------------------------
// Refund / Escalation lane (workflow doc: when authority REJECTS, processing
// either refunds the client or escalates to APPEAL_IN_PROGRESS — both flows
// surface here).
// ---------------------------------------------------------------------------

export interface ApiRefundLaneCase extends ApiProcessingCaseListItem {
  authorityDecisionDate: string | null;
  refundInitiatedAt: string | null;
  refundInitiatedByUserId: string | null;
}

export interface RefundLaneResponse {
  cases: ApiRefundLaneCase[];
}

export function fetchRefundLane(): Promise<RefundLaneResponse> {
  return apiFetch<RefundLaneResponse>('/processing/refunds', { cache: 'no-store' });
}

/**
 * Records a refund as initiated for a REJECTED case. Creates a pinned note +
 * audit log entry on the case — Finance handles the actual money side
 * out-of-band; this just makes processing's intent observable.
 */
export function markCaseForRefund(
  caseId: string,
  body: { reason: string },
): Promise<unknown> {
  return apiFetch<unknown>(`/processing/cases/${caseId}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export function acknowledgeIntake(
  caseId: string,
  body: { assignOfficerId: string; service?: string; programCode?: string },
): Promise<ApiProcessingCaseDetail> {
  return apiFetch<ApiProcessingCaseDetail>(`/processing/intake/${caseId}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

// Officer roster — used by manager-acknowledge + reassignment pickers.
// Excludes sales / finance / support roles server-side.
export interface ApiProcessingOfficer {
  id: string;
  email: string;
  name: string;
  primaryRole: 'processing' | 'processing_manager' | 'documentation' | 'super_admin' | 'admin' | string;
}

export function fetchProcessingOfficers(): Promise<ApiProcessingOfficer[]> {
  return apiFetch<ApiProcessingOfficer[]>('/processing/officers', { cache: 'no-store' });
}

/** Processing teammates who can be @mentioned in a case note. Same roster as
 *  /officers but reachable by any note-capable user (associates included). */
export function fetchNoteMentionCandidates(): Promise<ApiProcessingOfficer[]> {
  return apiFetch<ApiProcessingOfficer[]>('/processing/note-mention-candidates', { cache: 'no-store' });
}

export function changeCaseStage(
  caseId: string,
  body: {
    toStage: ProcessingStage;
    reason?: string;
    notes?: string;
    submissionReference?: string;
    authorityTrackingRef?: string;
    cancellationReason?: string;
    completionNotes?: string;
  },
): Promise<ApiProcessingCaseDetail> {
  return apiFetch<ApiProcessingCaseDetail>(`/processing/cases/${caseId}/stage`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

/**
 * Manual client creation (Processing Manager). Creates Lead → Client →
 * INTAKE_PENDING case with no Finance handover; returns the created case.
 */
/**
 * Officer/manager uploads a document on the client's behalf into a checklist
 * slot (multipart). Mirrors the portal upload, on the processing side; backend
 * gates with `processing.document.upload`. Returns the updated checklist item.
 */
export async function uploadOfficerDocument(
  caseId: string,
  itemId: string,
  file: File,
): Promise<ApiCaseDocumentItem> {
  const { getAccessToken } = await import('./auth-client');
  const token = getAccessToken();
  const form = new FormData();
  form.append('file', file);
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const res = await fetch(
    `${base}/processing/cases/${caseId}/documents/${itemId}/upload`,
    { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : undefined, body: form },
  );
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const msg =
      errBody && typeof errBody === 'object' && 'message' in errBody
        ? String((errBody as { message?: unknown }).message)
        : `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Officer/team uploads an EXTRA document not tied to a checklist slot
 * ("Additional Documents"). `note` optionally describes it. The server creates
 * an optional ad-hoc item and AI-classifies it.
 */
export async function uploadAdditionalDocument(
  caseId: string,
  file: File,
  note?: string,
): Promise<ApiCaseDocumentItem> {
  const { getAccessToken } = await import('./auth-client');
  const token = getAccessToken();
  const form = new FormData();
  form.append('file', file);
  if (note && note.trim()) form.append('note', note.trim());
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const res = await fetch(`${base}/processing/cases/${caseId}/additional-documents`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const msg =
      errBody && typeof errBody === 'object' && 'message' in errBody
        ? String((errBody as { message?: unknown }).message)
        : `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Manual client creation (Processing Manager). Creates Lead → Client →
 * INTAKE_PENDING case with no Finance handover; returns the created case.
 */
/** Optional finance snapshot entered on the manual-client form. Amounts are
 *  strings (entered in `currency`, default PKR) and converted to the CAD ledger
 *  base server-side. */
export interface ManualClientFinanceInput {
  totalFee: string;
  currency?: string;
  amountReceived?: string;
  paymentMethod?: string;
  paidAt?: string;
  transactionRef?: string;
}

/** Result of POST /processing/clients — the case plus what the create flow
 *  provisioned (portal login + finance records). */
export interface ManualClientCreateResult extends ApiProcessingCaseDetail {
  portalLogin: { provisioned: boolean; alreadyHadLogin: boolean; email: string };
  finance:
    | {
        recorded: boolean;
        currency: string;
        feeAmount: number;
        receivedAmount: number;
        baseCurrency: string;
        invoiceNumber?: string;
        receiptNumber?: string;
        paymentStatus?: string;
        error?: string;
      }
    | null;
}

export function createManualClientCase(body: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  service: string;
  targetCountry: string;
  nationality?: string;
  priority?: ProcessingPriority;
  finance?: ManualClientFinanceInput;
}): Promise<ManualClientCreateResult> {
  return apiFetch<ManualClientCreateResult>('/processing/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Bulk client import (spreadsheet → clients + cases + auto-assign)
// ---------------------------------------------------------------------------

/** Per-row resolution result from the import preview/commit. Mirrors the
 *  backend ImportRowResult. */
export interface ImportRowResult {
  rowNumber: number;
  externalRef: string | null;
  clientName: string;
  phone: string | null;
  email: string | null;
  program: string | null;
  serviceCode: string | null;
  programCode: string | null;
  salesPerson: string | null;
  salesPersonEmail: string | null;
  salesPersonMatched: boolean;
  officer: string | null;
  officerMatched: boolean;
  caseStatus: string | null;
  signupDate: string | null;
  outcome: 'READY' | 'READY_UNASSIGNED' | 'DUPLICATE' | 'BLOCKED';
  warnings: string[];
}

export interface ImportResult {
  totalRows: number;
  sourceFormat: string;
  dryRun: boolean;
  rows: ImportRowResult[];
  counts: { ready: number; unassigned: number; duplicates: number; blocked: number };
  committed?: { created: number; skipped: number; failed: number };
}

/** Multipart upload routed through apiFetch (so it gets 401 token-refresh +
 *  retry; apiFetch leaves Content-Type unset for FormData). */
async function uploadProcessingMultipart<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<T>(path, { method: 'POST', body: form, cache: 'no-store' });
}

/** Dry-run: resolve every row (officer/sales-rep/program/dupe), write nothing. */
export function previewProcessingImport(file: File): Promise<ImportResult> {
  return uploadProcessingMultipart<ImportResult>('/processing/client-imports/preview', file);
}

/** Commit: create + assign each importable row. Idempotent by Case ID. */
export function commitProcessingImport(file: File): Promise<ImportResult> {
  return uploadProcessingMultipart<ImportResult>('/processing/client-imports', file);
}

/**
 * P4d — Submission-quality gate.
 * Returns whether a case is clear to move to READY_FOR_SUBMISSION / SUBMITTED,
 * plus a list of human-readable blocker messages when it is not.
 * The same check runs server-side on the stage-change endpoint — this is for
 * surfacing the blockers proactively in the UI before the user clicks Confirm.
 */
export function getSubmissionReadiness(
  caseId: string,
): Promise<{ ready: boolean; blockers: string[] }> {
  return apiFetch<{ ready: boolean; blockers: string[] }>(
    `/processing/cases/${caseId}/submission-readiness`,
    { cache: 'no-store' },
  );
}

/**
 * P4e — Submission package.
 * Returns the previously assembled package info (signed URL + metadata) if one
 * exists for the case, or { exists: false } if not yet assembled.
 */
export function getSubmissionPackage(caseId: string): Promise<
  | { exists: true; key: string; fileName: string; sizeBytes: number; documentCount: number; assembledAt: string; signedUrl: string }
  | { exists: false }
> {
  return apiFetch(`/processing/cases/${caseId}/submission-package`, {
    cache: 'no-store',
  });
}

/**
 * P4e — Trigger assembly of the merged PDF submission package.
 * Returns the assembled package result including a signed download URL.
 * Throws 400 with { message, blockers } if the quality gate fails.
 */
export function assembleSubmissionPackage(caseId: string): Promise<{
  key: string;
  fileName: string;
  sizeBytes: number;
  documentCount: number;
  assembledAt: string;
  signedUrl: string;
}> {
  return apiFetch(`/processing/cases/${caseId}/submission-package/assemble`, {
    method: 'POST',
    cache: 'no-store',
  });
}

/**
 * Reassign a processing case to a different officer. Manager-only
 * (server-side permission `processing.case.assign`). Server validates the
 * assignee holds a processing-side role; rejects sales/finance/support.
 *
 * Body field name `officerId` matches the backend AssignCaseDto. (Earlier
 * versions of this helper sent `assignedOfficerId` which never matched —
 * fixed in P5.5.)
 */
export function assignProcessingCase(
  caseId: string,
  body: { officerId: string },
): Promise<ApiProcessingCaseDetail> {
  return apiFetch<ApiProcessingCaseDetail>(`/processing/cases/${caseId}/assign`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export function updateCasePriority(
  caseId: string,
  body: { priority: ProcessingPriority },
): Promise<ApiProcessingCaseDetail> {
  return apiFetch<ApiProcessingCaseDetail>(`/processing/cases/${caseId}/priority`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

/** Set (or clear, with null) the case's lightweight sub-stage label (F3). */
export function updateCaseSubStage(
  caseId: string,
  body: { subStage: string | null },
): Promise<ApiProcessingCaseDetail> {
  return apiFetch<ApiProcessingCaseDetail>(`/processing/cases/${caseId}/substage`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export type ProcessingNoteType =
  | 'GENERAL'
  | 'ESCALATION'
  | 'STRATEGY'
  | 'CLIENT_INSIGHT'
  | 'AUTHORITY_NOTE'
  | 'MANAGER_ONLY';

export type NoteAttachmentKind = 'IMAGE' | 'VOICE' | 'FILE';

export interface ApiNoteAttachment {
  id: string;
  kind: NoteAttachmentKind;
  mimeType: string;
  sizeBytes: number;
  originalName?: string | null;
  durationMs?: number | null;
}

export interface ApiProcessingNote {
  id: string;
  caseId: string;
  content: string;
  noteType: ProcessingNoteType;
  isPinned: boolean;
  mentions: string[];
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  editedAt?: string | null;
  createdBy?: { id: string; email: string } | null;
  attachments?: ApiNoteAttachment[];
}

export function fetchCaseNotes(caseId: string): Promise<ApiProcessingNote[]> {
  return apiFetch<ApiProcessingNote[]>(`/processing/cases/${caseId}/notes`, { cache: 'no-store' });
}

/**
 * Create a case note. Sends multipart so text + attachments (voice notes,
 * screenshots, images, files) go in one request. A text-only note simply
 * carries no files.
 */
export function createCaseNote(
  caseId: string,
  body: { content: string; noteType?: ProcessingNoteType; mentions?: string[]; files?: File[] },
): Promise<ApiProcessingNote> {
  const form = new FormData();
  form.append('content', body.content ?? '');
  if (body.noteType) form.append('noteType', body.noteType);
  if (body.mentions?.length) form.append('mentions', JSON.stringify(body.mentions));
  for (const f of body.files ?? []) form.append('files', f, f.name);
  return apiFetch<ApiProcessingNote>(`/processing/cases/${caseId}/notes`, {
    method: 'POST',
    body: form, // apiFetch leaves the multipart boundary to the browser
    cache: 'no-store',
  });
}

/** Short-lived signed URL to display/play/download a note attachment. */
export function fetchNoteAttachmentUrl(
  caseId: string,
  attachmentId: string,
): Promise<{ url: string; mimeType: string; originalName?: string | null }> {
  return apiFetch(`/processing/cases/${caseId}/notes/attachments/${attachmentId}/signed-url`, {
    cache: 'no-store',
  });
}

export function pinCaseNote(
  caseId: string,
  noteId: string,
  body: { isPinned: boolean },
): Promise<ApiProcessingNote> {
  return apiFetch<ApiProcessingNote>(`/processing/cases/${caseId}/notes/${noteId}/pin`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export function updateCaseNote(
  caseId: string,
  noteId: string,
  body: { content?: string; noteType?: ProcessingNoteType; mentions?: string[] },
): Promise<ApiProcessingNote> {
  return apiFetch<ApiProcessingNote>(`/processing/cases/${caseId}/notes/${noteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export function deleteCaseNote(caseId: string, noteId: string): Promise<{ success: boolean }> {
  return apiFetch(`/processing/cases/${caseId}/notes/${noteId}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

// Mirrors the Prisma enum exactly. Note: server uses DONE (not COMPLETED) as
// the terminal-positive state; BLOCKED is a real status used by the lane UI.
export type ProcessingTaskStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
export type ProcessingTaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface ApiProcessingTask {
  id: string;
  caseId: string;
  title: string;
  description: string | null;
  assignedToUserId: string | null;
  createdByUserId: string;
  dueDate: string | null;
  priority: ProcessingTaskPriority;
  status: ProcessingTaskStatus;
  completedAt: string | null;
  completedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  assignedTo?: { id: string; email: string } | null;
  createdBy?: { id: string; email: string } | null;
  completedBy?: { id: string; email: string } | null;
}

export function fetchCaseTasks(caseId: string): Promise<ApiProcessingTask[]> {
  return apiFetch<ApiProcessingTask[]>(`/processing/cases/${caseId}/tasks`, { cache: 'no-store' });
}

// ---------------------------------------------------------------------------
// Case milestones — per-case-type checkable progress (LMIA Submission for
// WORK_PERMIT, Incorporation for E2_VISA, etc.). Auto-seeded at acknowledge.
// ---------------------------------------------------------------------------

export interface ApiCaseMilestone {
  id: string;
  caseId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  completedAt: string | null;
  completedByUserId: string | null;
  completedBy?: { id: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchCaseMilestones(caseId: string): Promise<ApiCaseMilestone[]> {
  return apiFetch<ApiCaseMilestone[]>(`/processing/cases/${caseId}/milestones`, { cache: 'no-store' });
}

export function completeMilestone(caseId: string, milestoneId: string): Promise<ApiCaseMilestone> {
  return apiFetch<ApiCaseMilestone>(`/processing/cases/${caseId}/milestones/${milestoneId}/complete`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
}

export function uncompleteMilestone(caseId: string, milestoneId: string): Promise<ApiCaseMilestone> {
  return apiFetch<ApiCaseMilestone>(`/processing/cases/${caseId}/milestones/${milestoneId}/uncomplete`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
}

export function createCaseMilestone(
  caseId: string,
  body: { title: string; description?: string; sortOrder?: number },
): Promise<ApiCaseMilestone> {
  return apiFetch<ApiCaseMilestone>(`/processing/cases/${caseId}/milestones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

// Cross-case task / document feeds — used by /processing/tasks and
// /processing/documents side pages. Each row carries enough case context
// that the queue can render without a second roundtrip per row.

export interface ApiAggregatedTask extends ApiProcessingTask {
  case: {
    id: string;
    service: string;
    targetCountry: string;
    priority: ProcessingPriority;
    stage: ProcessingStage;
    lead: { firstName: string; lastName: string } | null;
    client: { firstName: string; lastName: string } | null;
  };
}

export function fetchAggregatedTasks(): Promise<{ tasks: ApiAggregatedTask[] }> {
  return apiFetch<{ tasks: ApiAggregatedTask[] }>('/processing/tasks', { cache: 'no-store' });
}

export interface ApiAggregatedDocument {
  id: string;
  caseId: string;
  documentName: string;
  description: string | null;
  criticality: 'CRITICAL' | 'REQUIRED' | 'CONDITIONAL' | 'SUPPORTING' | 'OPTIONAL';
  status: 'NOT_SUBMITTED' | 'SUBMITTED' | 'UNDER_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'EXPIRING_SOON' | 'WAIVED' | 'NOT_APPLICABLE';
  validityExpiryDate: string | null;
  lastRequestedAt: string | null;
  requestDeadline: string | null;
  sortOrder: number;
  updatedAt: string;
  case: {
    id: string;
    service: string;
    targetCountry: string;
    priority: ProcessingPriority;
    stage: ProcessingStage;
    lead: { firstName: string; lastName: string } | null;
    client: { firstName: string; lastName: string } | null;
  };
}

export function fetchAggregatedDocuments(): Promise<{ items: ApiAggregatedDocument[] }> {
  return apiFetch<{ items: ApiAggregatedDocument[] }>('/processing/documents', { cache: 'no-store' });
}

export function createCaseTask(
  caseId: string,
  body: {
    title: string;
    description?: string;
    assignedToUserId?: string;
    dueDate?: string;
    priority?: ProcessingTaskPriority;
  },
): Promise<ApiProcessingTask> {
  return apiFetch<ApiProcessingTask>(`/processing/cases/${caseId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export function updateCaseTask(
  caseId: string,
  taskId: string,
  body: Partial<{
    title: string;
    description: string | null;
    assignedToUserId: string | null;
    dueDate: string | null;
    priority: ProcessingTaskPriority;
    status: ProcessingTaskStatus;
  }>,
): Promise<ApiProcessingTask> {
  return apiFetch<ApiProcessingTask>(`/processing/cases/${caseId}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Documents (list-only here; uploads + reviews land in a later commit)
// ---------------------------------------------------------------------------

export type DocumentCriticality = 'CRITICAL' | 'REQUIRED' | 'CONDITIONAL' | 'SUPPORTING' | 'OPTIONAL';
export type DocumentItemStatus =
  // Backend enum (processing.DocumentItemStatus) — the real values the API emits.
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'        // client/officer uploaded → awaiting review
  | 'UNDER_REVIEW'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXPIRING_SOON'
  | 'WAIVED'
  | 'NOT_APPLICABLE'
  // Legacy/portal-side aliases kept for backward compatibility.
  | 'REQUESTED'
  | 'AWAITING_UPLOAD'
  | 'UPLOADED';

export type AiSuggestedDecision = 'APPROVE' | 'REJECT' | 'NEEDS_REVIEW';

export interface AiCheck {
  code: string;
  pass: boolean;
  detail: string;
}

export interface ApiDocumentAiAssessment {
  id: string;
  detectedDocType: string | null;
  expectedDocType: string | null;
  confidence: number | null;
  checks: AiCheck[] | null;
  suggestedDecision: AiSuggestedDecision;
  reasonCodes: string[];
  /** P4c-2: attestation authorities detected in the OCR text (e.g. ["MOFA","HEC"]).
   *  Suggestion only — shown as a hint next to the manual "Mark attested" control. */
  detectedAuthorities?: string[];
  /** P4f: dominant non-Latin script hint (e.g. "Arabic/Urdu"). null = primarily Latin.
   *  Suggestion only — shown as an amber "translation needed" chip on the checklist. */
  detectedLanguage?: string | null;
  autoApproved: boolean;
  ocrTier: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ApiCaseDocumentItem {
  id: string;
  caseId: string;
  templateId: string | null;
  documentName: string;
  description: string | null;
  criticality: DocumentCriticality;
  expectedFormats: string[];
  maxFileSizeMb: number;
  validityRule: string;
  validityMonths: number | null;
  status: DocumentItemStatus;
  latestVersionId: string | null;
  validityExpiryDate: string | null;
  // Phase 4c — attestation (returned by the checklist `include`; per-case copy).
  attestationStatus?: string | null; // NOT_REQUIRED | REQUIRED_PENDING | DONE | WAIVED
  attestationChain?: string | null; // e.g. "HEC->MOFA"
  whyText?: string | null;
  sortOrder: number;
  isAddedManually: boolean;
  /** Extra doc not part of the template checklist ("Additional Documents"). */
  isAdditional?: boolean;
  createdAt: string;
  updatedAt: string;
  latestVersion?: {
    id: string;
    fileName: string;
    fileSizeBytes: number | null;
    versionNumber: number;
    uploadedAt: string;
  } | null;
  // Phase D3 — latest AI assessment (backend sends at most one).
  aiAssessments?: ApiDocumentAiAssessment[];
}

export function fetchCaseDocuments(caseId: string): Promise<ApiCaseDocumentItem[]> {
  return apiFetch<ApiCaseDocumentItem[]>(`/processing/cases/${caseId}/documents`, { cache: 'no-store' });
}

export interface ApiDocumentVersion {
  id: string;
  documentItemId: string;
  storageKey: string;
  fileName: string;
  fileSizeBytes: number | null;
  mimeType: string | null;
  versionNumber: number;
  uploadedAt: string;
  uploadedByUserId: string;
}

export function fetchDocumentVersions(caseId: string, itemId: string): Promise<ApiDocumentVersion[]> {
  return apiFetch<ApiDocumentVersion[]>(
    `/processing/cases/${caseId}/documents/${itemId}/versions`,
    { cache: 'no-store' },
  );
}

export function getDocumentSignedUrl(caseId: string, itemId: string): Promise<{ url: string; fileName: string }> {
  return apiFetch<{ url: string; fileName: string }>(
    `/processing/cases/${caseId}/documents/${itemId}/signed-url`,
    { cache: 'no-store' },
  );
}

export function waiveDocumentItem(
  caseId: string,
  itemId: string,
  body: { waiveReason: string },
): Promise<ApiCaseDocumentItem> {
  return apiFetch<ApiCaseDocumentItem>(
    `/processing/cases/${caseId}/documents/${itemId}/waive`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );
}

// Rename an additional document (correct a wrong AI label / clarify it).
export function renameAdditionalDocument(
  caseId: string,
  itemId: string,
  name: string,
): Promise<ApiCaseDocumentItem> {
  return apiFetch<ApiCaseDocumentItem>(
    `/processing/cases/${caseId}/documents/${itemId}/name`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      cache: 'no-store',
    },
  );
}

export function requestDocumentFromClient(
  caseId: string,
  itemId: string,
  body: { message?: string } = {},
): Promise<ApiCaseDocumentItem> {
  return apiFetch<ApiCaseDocumentItem>(
    `/processing/cases/${caseId}/documents/${itemId}/request`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );
}

export function reviewDocumentItem(
  caseId: string,
  itemId: string,
  body: {
    decision: 'ACCEPT' | 'REJECT';
    rejectionReasonCodes?: string[];
    rejectionNote?: string;
  },
): Promise<ApiCaseDocumentItem> {
  return apiFetch<ApiCaseDocumentItem>(
    `/processing/cases/${caseId}/documents/${itemId}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Backend enum is ACCEPTED/REJECTED; the UI works in ACCEPT/REJECT.
      body: JSON.stringify({
        decision: body.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
        rejectionReasonCodes: body.rejectionReasonCodes,
        rejectionNote: body.rejectionNote,
      }),
      cache: 'no-store',
    },
  );
}

// ---------------------------------------------------------------------------
// Inbound document intake (Phase E) — WhatsApp/email/portal docs awaiting triage
// ---------------------------------------------------------------------------

export type InboundDocumentStatus = 'PENDING' | 'FILED' | 'DISCARDED';
export type InboundDocumentSource = 'WHATSAPP' | 'EMAIL' | 'PORTAL' | 'MANUAL';

export interface ApiInboundDocument {
  id: string;
  caseId: string;
  source: InboundDocumentSource;
  fileName: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  detectedDocType: string | null;
  classifyConfidence: number | null;
  suggestedItemId: string | null;
  suggestedItemName: string | null;
  status: InboundDocumentStatus;
  createdAt: string;
}

export function fetchInboundDocuments(caseId: string): Promise<ApiInboundDocument[]> {
  return apiFetch<ApiInboundDocument[]>(
    `/processing/cases/${caseId}/inbound-documents`,
    { cache: 'no-store' },
  );
}

export function getInboundDocumentSignedUrl(
  caseId: string,
  inboundId: string,
): Promise<{ url: string; fileName: string; mimeType: string | null; expiresIn: string }> {
  return apiFetch(
    `/processing/cases/${caseId}/inbound-documents/${inboundId}/signed-url`,
    { cache: 'no-store' },
  );
}

export function fileInboundDocument(
  caseId: string,
  inboundId: string,
  itemId: string,
): Promise<{ success: boolean; versionNumber: number; itemId: string }> {
  return apiFetch(`/processing/cases/${caseId}/inbound-documents/${inboundId}/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId }),
    cache: 'no-store',
  });
}

export function discardInboundDocument(
  caseId: string,
  inboundId: string,
): Promise<{ success: boolean }> {
  return apiFetch(`/processing/cases/${caseId}/inbound-documents/${inboundId}/discard`, {
    method: 'POST',
    cache: 'no-store',
  });
}

export interface RequestMissingResult {
  success: boolean;
  missingCount: number;
  requested: string[];
  warning: string | null;
}

export function requestMissingDocuments(caseId: string): Promise<RequestMissingResult> {
  return apiFetch<RequestMissingResult>(
    `/processing/cases/${caseId}/request-missing-documents`,
    { method: 'POST', cache: 'no-store' },
  );
}

// ---------------------------------------------------------------------------
// Identity reconciliation (Phase 4) — cross-document + CRM identity agreement
// ---------------------------------------------------------------------------

export type IdentityFieldStatus = 'agree' | 'conflict' | 'insufficient';
export type IdentityOverallStatus = 'ok' | 'review' | 'insufficient';
export type IdentityReferenceFrom = 'passport' | 'nationalId' | 'crm' | 'documents' | null;

export interface ApiIdentitySource {
  itemId: string;
  documentName: string;
  docType: string | null;
  value: string;
  matchesReference: boolean;
}

export interface ApiIdentityFieldRow {
  key: 'name' | 'dateOfBirth' | 'passportNumber' | 'nationalId';
  label: string;
  crmValue: string | null;
  crmMatches: boolean | null;
  referenceValue: string | null;
  referenceFrom: IdentityReferenceFrom;
  sources: ApiIdentitySource[];
  status: IdentityFieldStatus;
}

export interface ApiIdentityReconciliation {
  client: {
    name: string | null;
    dateOfBirth: string | null;
    passportNumber: string | null;
    nationalId: string | null;
  };
  fields: ApiIdentityFieldRow[];
  overall: IdentityOverallStatus;
  documentCount: number;
  referenceFrom: IdentityReferenceFrom;
  referenceItemId: string | null;
  referenceDocumentName: string | null;
}

export function fetchIdentityReconciliation(
  caseId: string,
): Promise<ApiIdentityReconciliation> {
  return apiFetch<ApiIdentityReconciliation>(
    `/processing/cases/${caseId}/identity-reconciliation`,
    { cache: 'no-store' },
  );
}

// Phase 4c — associate sets/overrides a document's attestation state per case.
export function updateDocumentAttestation(
  caseId: string,
  itemId: string,
  body: { status: string; chain?: string },
): Promise<{ success: boolean; attestationStatus: string }> {
  return apiFetch(`/processing/cases/${caseId}/documents/${itemId}/attestation`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Case WhatsApp chat (Phase E) — live two-way thread, scoped by case access
// ---------------------------------------------------------------------------

export interface ApiCaseWhatsAppMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  body: string | null;
  /** Short-lived signed URL for media re-hosted to our storage (photos / voice
   *  / docs). Null for un-cached media (renders a placeholder). */
  mediaSignedUrl: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  status: string;
  createdAt: string;
}

export interface ApiCaseWhatsApp {
  threadId: string | null;
  windowExpiresAt: string | null;
  windowOpen: boolean;
  messages: ApiCaseWhatsAppMessage[];
  /** True when an older page exists — drives the "Load older messages" button. */
  hasMore?: boolean;
}

export function fetchCaseWhatsApp(caseId: string, before?: string): Promise<ApiCaseWhatsApp> {
  const tail = before ? `?before=${encodeURIComponent(before)}` : '';
  return apiFetch<ApiCaseWhatsApp>(`/processing/cases/${caseId}/whatsapp${tail}`, { cache: 'no-store' });
}

// ---------------------------------------------------------------------------
// Tab activity — per-user "new items" counts for the case-workspace tab badges
// ---------------------------------------------------------------------------

/** Count of unseen items per workspace tab (since this user last opened it). */
export interface CaseTabActivity {
  notes: number;
  communications: number;
  tasks: number;
  corrections: number;
  documents: number;
  whatsapp: number;
}

export function fetchCaseTabActivity(caseId: string): Promise<CaseTabActivity> {
  return apiFetch<CaseTabActivity>(`/processing/cases/${caseId}/tab-activity`, { cache: 'no-store' });
}

/** Mark a workspace tab as seen now for the current user (clears its badge). */
export function markCaseTabSeen(caseId: string, tab: string): Promise<{ success: boolean }> {
  return apiFetch(`/processing/cases/${caseId}/tab-seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tab }),
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Cross-department history — Sales/Finance notes + call history & transcripts
// surfaced read-only on the case-workspace "History" tab.
// ---------------------------------------------------------------------------

/** A note authored in another department (Sales or Finance), shown read-only. */
export interface CrossDeptNote {
  source: string;          // 'lead' | 'agreement' | 'handover'
  label: string;           // e.g. "Sales — lead note", "Finance — review note"
  text: string;
  author: string | null;   // resolved name or email
  at: string | null;       // ISO timestamp
}

/** A phone call on this client's lead/contact, with transcript + recording flag. */
export interface CaseCall {
  id: string;
  direction: string;       // INBOUND | OUTBOUND
  status: string;          // ANSWERED | MISSED | ENDED | FAILED | RINGING
  durationSeconds: number | null;
  at: string;              // ISO
  rep: string | null;      // employee who handled the call
  transcript: string | null;
  transcriptStatus: string | null; // PENDING | DONE | FAILED | null
  hasRecording: boolean;
}

export interface CaseBackground {
  salesNotes: CrossDeptNote[];
  financeNotes: CrossDeptNote[];
  calls: CaseCall[];
}

export function fetchCaseBackground(caseId: string): Promise<CaseBackground> {
  return apiFetch<CaseBackground>(`/processing/cases/${caseId}/background`, { cache: 'no-store' });
}

/** Fetch a short-lived signed URL to play a call recording (scoped to the case). */
export function getCaseCallRecordingUrl(
  caseId: string,
  callId: string,
): Promise<{ url: string; mimeType: string | null }> {
  return apiFetch(`/processing/cases/${caseId}/calls/${callId}/recording`, { cache: 'no-store' });
}

export function sendCaseWhatsApp(
  caseId: string,
  body: string,
): Promise<{ success: boolean; messageId?: string; reason?: string }> {
  return apiFetch(`/processing/cases/${caseId}/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export interface ApiCaseCommunication {
  id: string;
  caseId: string;
  direction: 'OUTBOUND' | 'INBOUND';
  messageType: string;
  subject: string | null;
  content: string;
  channelsSent: string[];
  sentByUserId: string | null;
  readByClientAt: string | null;
  whatsappMessageId: string | null;
  emailMessageId: string | null;
  createdAt: string;
  sentBy?: { id: string; email: string } | null;
}

/**
 * sendCaseCommunication returns the persisted communication plus any
 * per-channel warnings (e.g. WhatsApp window expired, no thread yet). The
 * row was saved either way — warnings just tell the UI which channels
 * silently didn't actually transmit.
 */
export interface SendCaseCommunicationResponse extends ApiCaseCommunication {
  deliveryWarnings: string[];
}

export function fetchCaseCommunications(caseId: string): Promise<ApiCaseCommunication[]> {
  return apiFetch<ApiCaseCommunication[]>(`/processing/cases/${caseId}/communications`, { cache: 'no-store' });
}

export function sendCaseCommunication(
  caseId: string,
  body: {
    subject: string;
    content: string;
    channelsSent: string[];
    // Email composer (feedback #7-11) — all optional.
    toEmail?: string;
    cc?: string[];
    bcc?: string[];
  },
): Promise<SendCaseCommunicationResponse> {
  return apiFetch<SendCaseCommunicationResponse>(`/processing/cases/${caseId}/communications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

// ── Email composer: sent-email history + per-user signature ──────────────────

/** One row in a case's sent-email history (newest first). */
export interface ApiCaseEmail {
  id: string;
  subject: string | null;
  content: string;
  toEmail: string | null;
  ccEmails: string[];
  bccEmails: string[];
  createdAt: string;
  sentByEmail: string | null;
}

export function fetchCaseEmails(caseId: string): Promise<ApiCaseEmail[]> {
  return apiFetch<ApiCaseEmail[]>(`/processing/cases/${caseId}/emails`, { cache: 'no-store' });
}

export function getMyEmailSignature(): Promise<{ signature: string | null }> {
  return apiFetch<{ signature: string | null }>('/processing/me/email-signature', { cache: 'no-store' });
}

export function saveMyEmailSignature(signature: string): Promise<{ signature: string | null }> {
  return apiFetch<{ signature: string | null }>('/processing/me/email-signature', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature }),
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Case finance summary (workspace Finance tab)
// ---------------------------------------------------------------------------

export interface CaseFinanceSummary {
  currency: string;
  totalAgreed: number;
  totalPaid: number;
  balance: number;
  contract: { contractNumber: string; totalAmount: number; currency: string; status: string } | null;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    currency: string;
    totalAmount: number;
    paidAmount: number;
    dueDate: string | null;
    notes: string | null;
    createdAt: string;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    currency: string;
    baseAmount: number;
    status: string;
    paymentMethod: string | null;
    transactionRef: string | null;
    paidAt: string | null;
  }>;
  receipts: Array<{
    id: string;
    receiptNumber: string;
    amount: number;
    currency: string;
    paymentMethod: string | null;
    issuedAt: string;
    voided: boolean;
  }>;
}

export function fetchCaseFinance(caseId: string): Promise<CaseFinanceSummary> {
  return apiFetch<CaseFinanceSummary>(`/processing/cases/${caseId}/finance`, { cache: 'no-store' });
}

// ---------------------------------------------------------------------------
// Authority submissions
// ---------------------------------------------------------------------------

export type AuthoritySubmissionStatus =
  | 'SUBMITTED'
  | 'ACKNOWLEDGED_BY_AUTHORITY'
  | 'UNDER_REVIEW'
  | 'INFO_REQUESTED'
  | 'DECISION_PENDING'
  | 'APPROVED'
  | 'REJECTED';

export interface ApiAuthoritySubmission {
  id: string;
  caseId: string;
  submissionNumber: number;
  submittedByUserId: string;
  authority: string;
  submissionDate: string;
  submissionReference: string | null;
  documentsIncluded: string[];
  trackingNumber: string | null;
  status: AuthoritySubmissionStatus;
  responseType: string | null;
  responseNotes: string | null;
  responseReceivedAt: string | null;
  nextAction: string | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchCaseSubmissions(caseId: string): Promise<ApiAuthoritySubmission[]> {
  return apiFetch<ApiAuthoritySubmission[]>(`/processing/cases/${caseId}/submissions`, { cache: 'no-store' });
}

export function createCaseSubmission(
  caseId: string,
  body: {
    authority: string;
    submissionDate: string;
    submissionReference?: string;
    documentsIncluded?: string[];
    trackingNumber?: string;
  },
): Promise<ApiAuthoritySubmission> {
  return apiFetch<ApiAuthoritySubmission>(`/processing/cases/${caseId}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export function updateCaseSubmission(
  caseId: string,
  submissionId: string,
  body: Partial<{
    trackingNumber: string;
    status: AuthoritySubmissionStatus;
    responseType: string;
    responseNotes: string;
    nextAction: string;
    responseReceivedAt: string;
  }>,
): Promise<ApiAuthoritySubmission> {
  return apiFetch<ApiAuthoritySubmission>(`/processing/cases/${caseId}/submissions/${submissionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export type CorrectionStatus = 'SENT' | 'IN_PROGRESS' | 'RESOLVED' | 'ESCALATED';
export type CorrectionType = 'DOCUMENT' | 'INFORMATION';
export type CorrectionRequiredAction = 'REUPLOAD' | 'CONFIRM' | 'CORRECT' | 'CALL_BACK';

export interface ApiCorrectionRequest {
  id: string;
  caseId: string;
  documentItemId: string | null;
  correctionType: CorrectionType;
  status: CorrectionStatus;
  subject: string;
  reasonCodes: string[];
  officerNote: string | null;
  clientMessage: string;
  requiredAction: CorrectionRequiredAction;
  slaHours: number | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  escalatedAt: string | null;
  escalationReason: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export function fetchCaseCorrections(
  caseId: string,
  query: { status?: CorrectionStatus; correctionType?: CorrectionType } = {},
): Promise<ApiCorrectionRequest[]> {
  const qs = new URLSearchParams();
  if (query.status) qs.set('status', query.status);
  if (query.correctionType) qs.set('correctionType', query.correctionType);
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<ApiCorrectionRequest[]>(`/processing/cases/${caseId}/corrections${tail}`, { cache: 'no-store' });
}

export function createCaseCorrection(
  caseId: string,
  body: {
    correctionType: CorrectionType;
    documentItemId?: string;
    subject: string;
    reasonCodes: string[];
    officerNote?: string;
    clientMessage: string;
    requiredAction: CorrectionRequiredAction;
    slaHours?: number;
  },
): Promise<ApiCorrectionRequest> {
  return apiFetch<ApiCorrectionRequest>(`/processing/cases/${caseId}/corrections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export function resolveCaseCorrection(
  caseId: string,
  correctionId: string,
  body: { resolutionNote?: string } = {},
): Promise<ApiCorrectionRequest> {
  return apiFetch<ApiCorrectionRequest>(
    `/processing/cases/${caseId}/corrections/${correctionId}/resolve`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );
}

export function escalateCaseCorrection(
  caseId: string,
  correctionId: string,
  body: { escalationReason: string },
): Promise<ApiCorrectionRequest> {
  return apiFetch<ApiCorrectionRequest>(
    `/processing/cases/${caseId}/corrections/${correctionId}/escalate`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );
}

// ---------------------------------------------------------------------------
// Audit / Timeline
// ---------------------------------------------------------------------------

export interface ApiProcessingAuditLog {
  id: string;
  caseId: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  fromValue: string | null;
  toValue: string | null;
  context: Record<string, unknown> | null;
  performedByUserId: string;
  createdAt: string;
  performedBy?: { id: string; email: string } | null;
}

export function fetchCaseAudit(caseId: string): Promise<ApiProcessingAuditLog[]> {
  return apiFetch<ApiProcessingAuditLog[]>(`/processing/cases/${caseId}/audit`, { cache: 'no-store' });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Display name pulled from client first, falling back to lead. */
export function casePersonName(c: {
  client?: { firstName: string; lastName: string } | null;
  lead?: { firstName: string; lastName: string } | null;
}): string {
  if (c.client?.firstName || c.client?.lastName) {
    return `${c.client.firstName ?? ''} ${c.client.lastName ?? ''}`.trim();
  }
  if (c.lead) return `${c.lead.firstName} ${c.lead.lastName}`.trim();
  return 'Unknown';
}

/**
 * Display name for a processing officer — prefers the linked employee's real
 * name, falls back to the email local-part (mirrors the backend
 * `officerDisplayName`). Returns null for an unassigned case.
 */
export function officerDisplayName(
  officer:
    | { email: string; employee?: { firstName: string; lastName: string } | null }
    | null
    | undefined,
): string | null {
  if (!officer) return null;
  const name = officer.employee
    ? `${officer.employee.firstName} ${officer.employee.lastName}`.trim()
    : '';
  return name || officer.email.split('@')[0];
}

/** Phone display — client first, lead fallback. */
export function casePersonPhone(c: {
  client?: { phone: string } | null;
  lead?: { phone: string } | null;
}): string {
  return c.client?.phone ?? c.lead?.phone ?? '';
}

/** Days since this case landed in processing. */
export function caseAgeDays(c: { createdAt: string }): number {
  const ms = Date.now() - new Date(c.createdAt).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

// ---------------------------------------------------------------------------
// Checklist templates — admin-side CRUD for document requirements per
// (service, targetCountry). Powers /processing/admin/templates.
// ---------------------------------------------------------------------------

export interface ApiDocumentTemplate {
  id: string;
  service: string;
  targetCountry: string;
  documentName: string;
  description: string | null;
  instructions: string | null;
  criticality: 'CRITICAL' | 'REQUIRED' | 'CONDITIONAL' | 'SUPPORTING' | 'OPTIONAL';
  conditionRule: Record<string, unknown> | null;
  expectedFormats: string[];
  maxFileSizeMb: number;
  validityRule: 'NONE' | 'MUST_NOT_EXPIRE' | 'MUST_BE_VALID_FOR_N_MONTHS';
  validityMonths: number | null;
  validityBufferDays: number;
  guidanceUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentTemplateBody {
  service: string;
  targetCountry: string;
  documentName: string;
  description?: string;
  instructions?: string;
  criticality: 'CRITICAL' | 'REQUIRED' | 'CONDITIONAL' | 'SUPPORTING' | 'OPTIONAL';
  expectedFormats?: string[];
  maxFileSizeMb?: number;
  validityRule: 'NONE' | 'MUST_NOT_EXPIRE' | 'MUST_BE_VALID_FOR_N_MONTHS';
  validityMonths?: number;
  validityBufferDays?: number;
  guidanceUrl?: string;
  sortOrder?: number;
}

export type UpdateDocumentTemplateBody = Partial<Omit<CreateDocumentTemplateBody, 'service' | 'targetCountry'>>;

export function fetchChecklistTemplates(query: { service?: string; targetCountry?: string } = {}): Promise<ApiDocumentTemplate[]> {
  const qs = new URLSearchParams();
  if (query.service) qs.set('service', query.service);
  if (query.targetCountry) qs.set('targetCountry', query.targetCountry);
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<ApiDocumentTemplate[]>(`/processing/checklist-templates${tail}`, { cache: 'no-store' });
}

export function createDocumentTemplate(body: CreateDocumentTemplateBody): Promise<ApiDocumentTemplate> {
  return apiFetch<ApiDocumentTemplate>('/processing/checklist-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export function updateDocumentTemplate(id: string, body: UpdateDocumentTemplateBody): Promise<ApiDocumentTemplate> {
  return apiFetch<ApiDocumentTemplate>(`/processing/checklist-templates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

/** Soft delete — backend sets isActive=false; row stays for audit. */
export function deactivateDocumentTemplate(id: string): Promise<ApiDocumentTemplate> {
  return apiFetch<ApiDocumentTemplate>(`/processing/checklist-templates/${id}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}

// ---------- Client-email templates (manager-editable nudge wording) ----------

export interface ApiEmailTemplate {
  id: string;
  reminderType: string;
  service: string;
  programCode: string;
  subject: string;
  body: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplatesResponse {
  templates: ApiEmailTemplate[];
  /** Built-in fallback wording per reminderType (subject/body with placeholders). */
  defaults: Record<string, { subject: string; body: string }>;
  /** Human labels per reminderType for the UI. */
  typeLabels: Record<string, string>;
  /** The reminderTypes a manager may customise. */
  types: string[];
}

export function fetchEmailTemplates(
  query: { service?: string; reminderType?: string } = {},
): Promise<EmailTemplatesResponse> {
  const qs = new URLSearchParams();
  if (query.service) qs.set('service', query.service);
  if (query.reminderType) qs.set('reminderType', query.reminderType);
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<EmailTemplatesResponse>(`/processing/email-templates${tail}`, { cache: 'no-store' });
}

/** Create-or-update the template for a (reminderType, service, programCode). */
export function saveEmailTemplate(payload: {
  reminderType: string;
  service: string;
  programCode?: string;
  subject: string;
  body: string;
  isActive?: boolean;
}): Promise<ApiEmailTemplate> {
  return apiFetch<ApiEmailTemplate>('/processing/email-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
}

/** Hard delete — reverts that category to the built-in default wording. */
export function deleteEmailTemplate(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/processing/email-templates/${id}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Databank — the per-client document repository (Google Drive replacement).
// Backend: apps/backend/src/modules/processing/databank/*. Access is scoped
// server-side by the processing case permissions; the client just calls.
// ---------------------------------------------------------------------------

export type DatabankFileSource = 'UPLOAD' | 'CLIPBOARD' | 'COPIED' | 'MIGRATED';

export interface ApiDatabankFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiDatabankFile {
  id: string;
  // Present on mutation results; omitted from the tree payload (the tab already
  // knows its client), hence optional.
  clientId?: string;
  folderId: string | null;
  fileName: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  source: DatabankFileSource;
  uploadedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiDatabankTree {
  clientId: string;
  folders: ApiDatabankFolder[];
  files: ApiDatabankFile[];
}

export interface ApiDatabankClientRow {
  id: string;
  referenceCode: string;
  firstName: string;
  lastName: string;
  fileCount: number;
}

export function fetchDatabankTree(clientId: string): Promise<ApiDatabankTree> {
  return apiFetch<ApiDatabankTree>(`/processing/databank/clients/${clientId}/tree`, {
    cache: 'no-store',
  });
}

export function fetchDatabankClients(q?: string): Promise<ApiDatabankClientRow[]> {
  const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return apiFetch<ApiDatabankClientRow[]>(`/processing/databank/clients${qs}`, { cache: 'no-store' });
}

export function createDatabankFolder(
  clientId: string,
  name: string,
  parentFolderId: string | null = null,
): Promise<ApiDatabankFolder> {
  return apiFetch<ApiDatabankFolder>(`/processing/databank/clients/${clientId}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentFolderId }),
    cache: 'no-store',
  });
}

export function renameDatabankFolder(folderId: string, name: string): Promise<ApiDatabankFolder> {
  return apiFetch<ApiDatabankFolder>(`/processing/databank/folders/${folderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
    cache: 'no-store',
  });
}

export function moveDatabankFolder(
  folderId: string,
  parentFolderId: string | null,
): Promise<ApiDatabankFolder> {
  return apiFetch<ApiDatabankFolder>(`/processing/databank/folders/${folderId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentFolderId }),
    cache: 'no-store',
  });
}

export function deleteDatabankFolder(folderId: string): Promise<{ deletedFolders: number }> {
  return apiFetch<{ deletedFolders: number }>(`/processing/databank/folders/${folderId}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}

/** Upload a file into a client's databank (multipart). `source` is CLIPBOARD
 *  for a pasted screenshot, else UPLOAD. Mirrors uploadOfficerDocument. */
export async function uploadDatabankFile(
  clientId: string,
  file: File,
  folderId: string | null = null,
  source: DatabankFileSource = 'UPLOAD',
): Promise<ApiDatabankFile> {
  const { getAccessToken } = await import('./auth-client');
  const token = getAccessToken();
  const form = new FormData();
  form.append('file', file);
  if (folderId) form.append('folderId', folderId);
  form.append('source', source);
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const res = await fetch(`${base}/processing/databank/clients/${clientId}/files`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const msg =
      errBody && typeof errBody === 'object' && 'message' in errBody
        ? String((errBody as { message?: unknown }).message)
        : `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

export function getDatabankFileSignedUrl(
  fileId: string,
): Promise<{ url: string; fileName: string; mimeType: string | null }> {
  return apiFetch(`/processing/databank/files/${fileId}/signed-url`, { cache: 'no-store' });
}

export function renameDatabankFile(fileId: string, fileName: string): Promise<ApiDatabankFile> {
  return apiFetch<ApiDatabankFile>(`/processing/databank/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName }),
    cache: 'no-store',
  });
}

export function moveDatabankFile(fileId: string, folderId: string | null): Promise<ApiDatabankFile> {
  return apiFetch<ApiDatabankFile>(`/processing/databank/files/${fileId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderId }),
    cache: 'no-store',
  });
}

export function copyDatabankFile(
  fileId: string,
  opts: { targetClientId?: string; targetFolderId?: string | null } = {},
): Promise<ApiDatabankFile> {
  return apiFetch<ApiDatabankFile>(`/processing/databank/files/${fileId}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
    cache: 'no-store',
  });
}

export function deleteDatabankFile(fileId: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch<{ id: string; deleted: boolean }>(`/processing/databank/files/${fileId}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}
