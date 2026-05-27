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
}

export interface ListCasesQuery {
  stage?: ProcessingStage;
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

export function acknowledgeIntake(
  caseId: string,
  body: { assignOfficerId?: string } = {},
): Promise<ApiProcessingCaseDetail> {
  return apiFetch<ApiProcessingCaseDetail>(`/processing/intake/${caseId}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export function changeCaseStage(
  caseId: string,
  body: { toStage: ProcessingStage; reason?: string },
): Promise<ApiProcessingCaseDetail> {
  return apiFetch<ApiProcessingCaseDetail>(`/processing/cases/${caseId}/stage`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export function assignProcessingCase(
  caseId: string,
  body: { assignedOfficerId: string },
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

export type ProcessingTaskStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
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
      body: JSON.stringify(body),
      cache: 'no-store',
    },
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

export function fetchCaseCommunications(caseId: string): Promise<ApiCaseCommunication[]> {
  return apiFetch<ApiCaseCommunication[]>(`/processing/cases/${caseId}/communications`, { cache: 'no-store' });
}

export function sendCaseCommunication(
  caseId: string,
  body: { subject: string; content: string; channelsSent: string[] },
): Promise<ApiCaseCommunication> {
  return apiFetch<ApiCaseCommunication>(`/processing/cases/${caseId}/communications`, {
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
