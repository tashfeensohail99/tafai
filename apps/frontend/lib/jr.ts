'use client';

import { apiFetch } from './api-client';
import type { BadgeTone } from '@/components/sales-v2/ui';

/**
 * Judicial Review (Federal Court JR desk) API client. Mirrors the shapes
 * returned by the backend controllers under `apps/backend/src/modules/
 * judicial-review/`:
 *   • JudicialReviewController  — `@Controller('jr/matters')`
 *   • JrDeadlinesController     — `@Controller('jr')` (board + per-matter deadlines)
 *   • JrArtifactsController     — `@Controller('jr')` (grouped artifacts + counsel queue)
 *
 * Reads pass `{ cache: 'no-store' }` (same convention as lib/processing.ts) so
 * the console always shows live matter/deadline state.
 */

// ---------------------------------------------------------------------------
// Enums (mirror the Prisma `legal` schema enums)
// ---------------------------------------------------------------------------

export type JrMatterStage =
  | 'INTAKE'
  | 'ROUTE_DETERMINED'
  | 'MERITS_REVIEW'
  | 'COUNSEL_DECLINED'
  | 'RETAINED'
  | 'REQUIRES_EXTENSION_REQUEST'
  | 'FILED'
  | 'LEAVE_GRANTED'
  | 'CLIENT_UNRESPONSIVE'
  | 'REDETERMINATION'
  | 'CLOSED';

export type JrIntakeType = 'INTERNAL' | 'EXTERNAL';

export type JrDeadlineStatusValue =
  | 'PENDING'
  | 'MET'
  | 'MISSED'
  | 'WAIVED'
  | 'SUPERSEDED'
  | string;

export type JrArtifactStatus =
  | 'DRAFT'
  | 'INTERNAL_QA'
  | 'COUNSEL_REVIEW'
  | 'COUNSEL_CHANGES_REQUESTED'
  | 'COUNSEL_APPROVED'
  | 'FILED'
  | 'SERVED'
  | 'SUPERSEDED'
  | string;

// ---------------------------------------------------------------------------
// Matter — GET /jr/matters + /jr/matters/:id return the RAW Prisma JrMatter row.
// The fields the console renders are typed precisely; the rest of the wide row
// is kept loose so the shape stays forward-compatible with schema additions.
// ---------------------------------------------------------------------------

export interface JrMatter {
  id: string;
  matterNumber: string;
  styleOfCause: string | null;
  clientId: string;
  leadId: string;
  branchId: string | null;
  intakeType: JrIntakeType;
  assignedAssociateUserId: string | null;
  stage: JrMatterStage;
  stageEnteredAt: string;
  decisionMaker: string;
  applicationType: string;
  route: string;
  decisionCommunicatedAt: string | null;
  courtFileNumber: string | null;
  createdAt: string;
  updatedAt: string;
  // List enrichment — GET /jr/matters joins the (relation-less) crm.Client so
  // rows can show who each matter is for.
  clientName?: string | null;
  clientPhone?: string | null;
  clientReferenceCode?: string | null;
  // Detail enrichment — GET /jr/matters/:id returns the client record inline.
  client?: {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    referenceCode: string;
  } | null;
  // Wide row — everything else is optional/loose (present but not rendered here).
  [key: string]: unknown;
}

export type JrMatterListItem = JrMatter;

// ---------------------------------------------------------------------------
// Deadline board (cross-matter) + per-matter deadlines
// ---------------------------------------------------------------------------

export interface JrBoardRow {
  id: string;
  matterId: string;
  matterNumber: string;
  styleOfCause: string | null;
  milestoneKey: string;
  label: string;
  computedDueAt: string;
  overriddenDueAt: string | null;
  effectiveDueAt: string;
  isFatal: boolean;
  quotableToClient: boolean;
  status: JrDeadlineStatusValue;
}

export interface JrDeadlineRow {
  id: string;
  matterId: string;
  milestoneKey: string;
  label: string;
  anchorDate: string | null;
  anchorField: string | null;
  computedDueAt: string;
  overriddenDueAt: string | null;
  effectiveDueAt: string;
  overrideReason: string | null;
  isFatal: boolean;
  quotableToClient: boolean;
  status: JrDeadlineStatusValue;
  satisfiedAt: string | null;
  ruleVerificationStatus: string | null;
}

// ---------------------------------------------------------------------------
// Artifacts (grouped by display folder)
// ---------------------------------------------------------------------------

export interface JrArtifactVersion {
  id: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  changeNote: string | null;
  isCurrent: boolean;
  createdAt: string;
}

export interface JrArtifactSummary {
  id: string;
  artifactType: string;
  title: string;
  status: JrArtifactStatus;
  sortOrder: number;
  displayFolder?: string;
  versions?: JrArtifactVersion[];
  currentVersionId?: string | null;
  [key: string]: unknown;
}

export interface JrArtifactsGrouped {
  folders: Array<{ folder: string; artifacts: JrArtifactSummary[] }>;
}

// ---------------------------------------------------------------------------
// Case-workspace notes (text / voice / image)
// ---------------------------------------------------------------------------

export interface JrNoteAttachment {
  id: string;
  kind: 'AUDIO' | 'IMAGE';
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  durationMs: number | null;
  transcript: string | null;
  url: string | null;
}

export interface JrNote {
  id: string;
  content: string;
  noteType: string;
  isPinned: boolean;
  authorUserId: string;
  authorName: string;
  createdAt: string;
  editedAt: string | null;
  attachments: JrNoteAttachment[];
}

export interface JrNotesResponse {
  notes: JrNote[];
}

// ---------------------------------------------------------------------------
// Counsel queue (view_all only)
// ---------------------------------------------------------------------------

export interface JrCounselQueueRow {
  artifactId: string;
  matterId: string;
  matterNumber: string;
  styleOfCause: string | null;
  artifactType: string;
  title: string;
  submittedAt: string;
  nearestFatalDeadline: string | null;
}

// ---------------------------------------------------------------------------
// Associates roster (assign dropdown) — GET /jr/matters/associates
// ---------------------------------------------------------------------------

export interface JrAssociate {
  id: string;
  email: string;
  name: string;
  primaryRole: string;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export interface ListMattersQuery {
  stage?: JrMatterStage | '';
  intakeType?: JrIntakeType | '';
  search?: string;
  take?: number;
}

export function fetchJrMatters(q: ListMattersQuery = {}): Promise<JrMatter[]> {
  const qs = new URLSearchParams();
  if (q.stage) qs.set('stage', q.stage);
  if (q.intakeType) qs.set('intakeType', q.intakeType);
  if (q.search) qs.set('search', q.search);
  if (q.take) qs.set('take', String(q.take));
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<JrMatter[]>(`/jr/matters${tail}`, { cache: 'no-store' });
}

export function fetchJrMatter(id: string): Promise<JrMatter> {
  return apiFetch<JrMatter>(`/jr/matters/${id}`, { cache: 'no-store' });
}

/**
 * Edit a matter's non-gated case details (style of cause, decision maker,
 * refusal-notification date, court file number, …). PATCH /jr/matters/:id —
 * requires `jr.matter.update_stage`. The backend recomputes deadlines in-tx, so
 * setting decisionCommunicatedAt makes the ALJR deadline appear on refetch.
 */
export function updateJrMatter(
  id: string,
  patch: Record<string, unknown>,
): Promise<JrMatter> {
  return apiFetch<JrMatter>(`/jr/matters/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    cache: 'no-store',
  });
}

export function assignJrMatter(
  matterId: string,
  assignedAssociateUserId: string,
): Promise<JrMatter> {
  return apiFetch<JrMatter>(`/jr/matters/${matterId}/assign`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignedAssociateUserId }),
    cache: 'no-store',
  });
}

export function fetchJrBoard(
  q: { fatalOnly?: boolean; take?: number } = {},
): Promise<JrBoardRow[]> {
  const qs = new URLSearchParams();
  if (q.fatalOnly) qs.set('fatalOnly', 'true');
  if (q.take) qs.set('take', String(q.take));
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<JrBoardRow[]>(`/jr/board${tail}`, { cache: 'no-store' });
}

export function fetchJrMatterDeadlines(matterId: string): Promise<JrDeadlineRow[]> {
  return apiFetch<JrDeadlineRow[]>(`/jr/matters/${matterId}/deadlines`, {
    cache: 'no-store',
  });
}

export function fetchJrArtifacts(matterId: string): Promise<JrArtifactsGrouped> {
  return apiFetch<JrArtifactsGrouped>(`/jr/matters/${matterId}/artifacts`, {
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Artifact authoring — create a DRAFT, upload versions, download, lifecycle
// ---------------------------------------------------------------------------

/** POST /jr/matters/:matterId/artifacts — creates a DRAFT artifact. */
export function createJrArtifact(
  matterId: string,
  body: { artifactType: string; folder: string; title: string; sortOrder?: number },
): Promise<JrArtifactSummary> {
  return apiFetch<JrArtifactSummary>(`/jr/matters/${matterId}/artifacts`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * POST /jr/artifacts/:artifactId/versions — multipart upload of a new version.
 * apiFetch passes FormData through untouched (no Content-Type header, no JSON body).
 */
export function uploadJrArtifactVersion(
  artifactId: string,
  file: File | Blob,
  changeNote?: string,
  fileName?: string,
): Promise<{ artifact: JrArtifactSummary; version: JrArtifactVersion }> {
  const fd = new FormData();
  fd.append('file', file, fileName ?? (file as File).name ?? 'document');
  if (changeNote) fd.append('changeNote', changeNote);
  return apiFetch<{ artifact: JrArtifactSummary; version: JrArtifactVersion }>(
    `/jr/artifacts/${artifactId}/versions`,
    { method: 'POST', body: fd },
  );
}

/** GET /jr/artifacts/:artifactId/versions/:versionId/url — a short-lived signed URL. */
export function fetchJrArtifactVersionUrl(
  artifactId: string,
  versionId: string,
): Promise<{ url: string; fileName: string; mimeType: string }> {
  return apiFetch<{ url: string; fileName: string; mimeType: string }>(
    `/jr/artifacts/${artifactId}/versions/${versionId}/url`,
    { cache: 'no-store' },
  );
}

/** POST /jr/artifacts/:artifactId/internal-qa — DRAFT → INTERNAL_QA. */
export function jrArtifactInternalQa(artifactId: string): Promise<JrArtifactSummary> {
  return apiFetch<JrArtifactSummary>(`/jr/artifacts/${artifactId}/internal-qa`, {
    method: 'POST',
  });
}

/** POST /jr/artifacts/:artifactId/submit — INTERNAL_QA → COUNSEL_REVIEW. */
export function jrSubmitArtifactToCounsel(artifactId: string): Promise<JrArtifactSummary> {
  return apiFetch<JrArtifactSummary>(`/jr/artifacts/${artifactId}/submit`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Case-workspace notes — read + create (text/voice/image) + edit + delete
// ---------------------------------------------------------------------------

export function fetchJrNotes(matterId: string): Promise<JrNotesResponse> {
  return apiFetch<JrNotesResponse>(`/jr/matters/${matterId}/notes`, {
    cache: 'no-store',
  });
}

/** POST /jr/matters/:matterId/notes — a text note. */
export function createJrTextNote(
  matterId: string,
  body: { content: string; noteType?: string; isPinned?: boolean },
): Promise<JrNote> {
  return apiFetch<JrNote>(`/jr/matters/${matterId}/notes`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** POST /jr/matters/:matterId/notes/voice — multipart voice note (+ optional caption). */
export function createJrVoiceNote(
  matterId: string,
  blob: Blob,
  opts: { fileName: string; durationMs?: number; content?: string },
): Promise<JrNote> {
  const fd = new FormData();
  fd.append('file', blob, opts.fileName);
  if (opts.content) fd.append('content', opts.content);
  if (opts.durationMs != null) fd.append('durationMs', String(opts.durationMs));
  return apiFetch<JrNote>(`/jr/matters/${matterId}/notes/voice`, {
    method: 'POST',
    body: fd,
  });
}

/** POST /jr/matters/:matterId/notes/image — multipart image note (+ optional caption). */
export function createJrImageNote(
  matterId: string,
  file: File | Blob,
  opts: { fileName: string; content?: string },
): Promise<JrNote> {
  const fd = new FormData();
  fd.append('file', file, opts.fileName);
  if (opts.content) fd.append('content', opts.content);
  return apiFetch<JrNote>(`/jr/matters/${matterId}/notes/image`, {
    method: 'POST',
    body: fd,
  });
}

/** PATCH /jr/notes/:noteId — edit body and/or pin state. */
export function updateJrNote(
  noteId: string,
  patch: { content?: string; isPinned?: boolean },
): Promise<JrNote> {
  return apiFetch<JrNote>(`/jr/notes/${noteId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** DELETE /jr/notes/:noteId. */
export function deleteJrNote(noteId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/jr/notes/${noteId}`, { method: 'DELETE' });
}

export function fetchJrCounselQueue(): Promise<JrCounselQueueRow[]> {
  return apiFetch<JrCounselQueueRow[]>('/jr/counsel-queue', { cache: 'no-store' });
}

export function fetchJrAssociates(): Promise<JrAssociate[]> {
  return apiFetch<JrAssociate[]>('/jr/matters/associates', { cache: 'no-store' });
}

// ---------------------------------------------------------------------------
// Create a new (EXTERNAL) matter — POST /jr/matters (createExternalMatter).
// Identity: exactly one of the new-client trio (firstName+lastName+phone),
// attachToLeadId, or attachToClientId. A new-client create THROWS 409
// DUPLICATE_PHONE/EMAIL on a collision (caller retries with attachTo*).
// Requires the `jr.matter.create` permission.
// ---------------------------------------------------------------------------

export interface CreateJrMatterInput {
  // identity (new client)
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  // or attach
  attachToLeadId?: string;
  attachToClientId?: string;
  // matter
  decisionMaker: string;
  applicationType: string;
  decisionCommunicatedAt: string;
  decisionCommunicatedNote: string;
  decisionLetterDate?: string;
  decidingOfficeLocation?: string;
  styleOfCause?: string;
  branchId?: string;
}

export function createJrMatter(input: CreateJrMatterInput): Promise<JrMatter> {
  return apiFetch<JrMatter>('/jr/matters', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const JR_STAGE_LABEL: Record<JrMatterStage, string> = {
  INTAKE: 'Intake',
  ROUTE_DETERMINED: 'Route determined',
  MERITS_REVIEW: 'Merits review',
  COUNSEL_DECLINED: 'Counsel declined',
  RETAINED: 'Retained',
  REQUIRES_EXTENSION_REQUEST: 'Extension required',
  FILED: 'Filed',
  LEAVE_GRANTED: 'Leave granted',
  CLIENT_UNRESPONSIVE: 'Client unresponsive',
  REDETERMINATION: 'Redetermination',
  CLOSED: 'Closed',
};

export function jrStageLabel(stage: string): string {
  return (JR_STAGE_LABEL as Record<string, string>)[stage] ?? stage;
}

export function jrStageTone(stage: string): BadgeTone {
  switch (stage) {
    case 'INTAKE':
      return 'neutral';
    case 'ROUTE_DETERMINED':
    case 'MERITS_REVIEW':
      return 'info';
    case 'RETAINED':
    case 'FILED':
      return 'accent';
    case 'LEAVE_GRANTED':
    case 'REDETERMINATION':
      return 'success';
    case 'COUNSEL_DECLINED':
    case 'REQUIRES_EXTENSION_REQUEST':
    case 'CLIENT_UNRESPONSIVE':
      return 'warning';
    case 'CLOSED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** Humanise a milestone/deadline label helper — falls back to the raw key. */
export function jrHumanize(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Format an ISO date for the console (short, locale-stable). */
export function jrFmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Relative "due in Nd / overdue Nd" chip info for a deadline's effective date. */
export function jrDueInfo(
  effectiveDueAt: string | null | undefined,
): { label: string; tone: BadgeTone } {
  if (!effectiveDueAt) return { label: 'No date', tone: 'neutral' };
  const ms = new Date(effectiveDueAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return { label: 'No date', tone: 'neutral' };
  const days = Math.round(ms / 86_400_000);
  if (ms < 0) {
    const od = Math.abs(days);
    return { label: od <= 0 ? 'Overdue' : `Overdue ${od}d`, tone: 'danger' };
  }
  if (days <= 0) return { label: 'Due today', tone: 'danger' };
  if (days <= 3) return { label: `Due in ${days}d`, tone: 'warning' };
  return { label: `Due in ${days}d`, tone: 'neutral' };
}

// ---------------------------------------------------------------------------
// Add-document form option lists (mirror the Prisma JrArtifactFolder /
// JrArtifactType enums). Folder labels are hand-written (the enum values don't
// humanise cleanly); artifact-type labels reuse jrHumanize for consistency.
// ---------------------------------------------------------------------------

export const JR_ARTIFACT_FOLDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'CLIENT_APPLICATION_DOCUMENTS', label: 'Client application documents' },
  { value: 'JUDICIAL_REVIEW_FILES', label: 'Judicial review files' },
  { value: 'JUDICIAL_REVIEW_RAW', label: 'Judicial review — raw/working' },
  { value: 'SETTLEMENT', label: 'Settlement' },
  { value: 'REDETERMINATION', label: 'Redetermination' },
  { value: 'ENGAGEMENT', label: 'Engagement' },
];

const JR_ARTIFACT_TYPE_VALUES: string[] = [
  'ORIGINAL_APPLICATION_FORM',
  'PASSPORT',
  'PROOF_OF_FUNDS',
  'ORIGINAL_COVER_LETTER',
  'SUPPORTING_EVIDENCE',
  'REFUSAL_LETTER',
  'GCMS_NOTES',
  'ALJR_FORM_IR1',
  'ALJR_STAMPED_FILED',
  'CERTIFICATE_OF_SERVICE',
  'PROOF_OF_SERVICE',
  'RULE_9_RESPONSE',
  'AR_AFFIDAVIT',
  'MEMORANDUM_OF_ARGUMENT',
  'APPLICANTS_RECORD',
  'APPLICANTS_RECORD_TOC',
  'APPLICANTS_RECORD_BACKPAGE',
  'ANONYMITY_REQUEST',
  'REPLY_MEMORANDUM',
  'LEAVE_ORDER',
  'CERTIFIED_TRIBUNAL_RECORD',
  'DOJ_SETTLEMENT_OFFER',
  'NOTICE_OF_DISCONTINUANCE',
  'CONSENT_JUDGMENT',
  'JUDGMENT_AND_REASONS',
  'ADDITIONAL_SUBMISSIONS',
  'REDETERMINATION_DECISION',
  'ENGAGEMENT_LETTER',
  'MERITS_ASSESSMENT',
  'ALTERNATIVES_SHEET',
  'OTHER',
];

export const JR_ARTIFACT_TYPE_OPTIONS: Array<{ value: string; label: string }> =
  JR_ARTIFACT_TYPE_VALUES.map((value) => ({ value, label: jrHumanize(value) }));
