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
  | 'CANCELLED';

export type ProcessingPriority = 'LOW' | 'NORMAL' | 'URGENT' | 'CRITICAL';
export type AuthorityDecision = 'PENDING' | 'APPROVED' | 'REJECTED';

/** Slim case shape returned by `GET /processing/cases` (list view). */
export interface ApiProcessingCaseListItem {
  id: string;
  service: string;
  targetCountry: string;
  stage: ProcessingStage;
  priority: ProcessingPriority;
  authorityDecision: AuthorityDecision;
  slaDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lead: { id: string; firstName: string; lastName: string; phone: string };
  client: { id: string; firstName: string; lastName: string; phone: string };
  assignedOfficer: { id: string; email: string } | null;
  _count: { documentItems: number };
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
  createdAt: string;
  updatedAt: string;
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    serviceInterest: string | null;
    targetCountry: string | null;
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

export function fetchIntakeQueue(): Promise<ApiIntakeCaseItem[]> {
  return apiFetch<ApiIntakeCaseItem[]>('/processing/intake', { cache: 'no-store' });
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
  body: { assignOfficerId: string; service?: string },
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
  createdBy?: { id: string; email: string } | null;
}

export function fetchCaseNotes(caseId: string): Promise<ApiProcessingNote[]> {
  return apiFetch<ApiProcessingNote[]>(`/processing/cases/${caseId}/notes`, { cache: 'no-store' });
}

export function createCaseNote(
  caseId: string,
  body: { content: string; noteType?: ProcessingNoteType; mentions?: string[] },
): Promise<ApiProcessingNote> {
  return apiFetch<ApiProcessingNote>(`/processing/cases/${caseId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  | 'NOT_SUBMITTED'
  | 'REQUESTED'
  | 'AWAITING_UPLOAD'
  | 'UPLOADED'
  | 'UNDER_REVIEW'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WAIVED'
  | 'NOT_APPLICABLE'
  | 'EXPIRED';

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
  sortOrder: number;
  isAddedManually: boolean;
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
export type InboundDocumentSource = 'WHATSAPP' | 'EMAIL' | 'PORTAL';

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
  body: { subject: string; content: string; channelsSent: string[] },
): Promise<SendCaseCommunicationResponse> {
  return apiFetch<SendCaseCommunicationResponse>(`/processing/cases/${caseId}/communications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
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
