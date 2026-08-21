'use client';

import { apiFetch, apiFetchBlob } from './api-client';
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
  // Retention / counsel gate (drives MERITS_REVIEW → RETAINED). Present on the
  // raw Prisma row; typed here so the Counsel & retention card reads them cleanly.
  counselOfRecordId: string | null;
  counselRetainerScope: string | null;
  counselRetainerSignedAt: string | null;
  counselFeeQuoted: string | number | null;
  counselFeeCurrency: string | null;
  meritsRecommendation: string | null;
  meritsAssessedByCounselId: string | null;
  expectationsAcknowledgedAt: string | null;
  alternativesSheetSignedAt: string | null;
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

// ---------------------------------------------------------------------------
// Gated stage machine (§6.1 map + §6.2 gates) + route decision tree (§6.4).
// The per-transition GATES live server-side (JudicialReviewService) — the
// console never replicates them; it surfaces the backend's message verbatim on
// a rejected move. `ChangeStagePayload` carries `targetStage` plus every
// optional gate input a specific transition reads (mirrors ChangeStageDto).
// ---------------------------------------------------------------------------

export interface ChangeStagePayload {
  targetStage: JrMatterStage;
  /** Required for any → CLOSED. */
  closeReason?: string;
  // RETAINED → FILED: asserted on the filed Form IR-1.
  decidingOfficeLocation?: string;
  decidingOfficeSourceNote?: string;
  // → REQUIRES_EXTENSION_REQUEST: the four Hennelly narrative fields.
  hennellyIntention?: string;
  hennellyMerit?: string;
  hennellyPrejudice?: string;
  hennellyExplanation?: string;
  // FILED → LEAVE_GRANTED.
  leaveDecidedAt?: string;
  leaveOrderAt?: string;
  leaveGranted?: boolean;
  // REDETERMINATION → CLOSED.
  redeterminationDecidedAt?: string;
  redeterminationApproved?: boolean;
}

export interface DetermineRoutePayload {
  /** IRPA s.72(2)(a) — REQUIRED. Filing where an IAD appeal lies is fatal. */
  appealRightExhausted: boolean;
  sponsorshipRelationship?: string;
  inadmissibilityGround?: string;
  rpdS110Exclusion?: boolean;
  hasS63AppealRight?: boolean;
  /** Citizenship Act refusal — v1 rejects (backend throws BadRequest). */
  isCitizenshipMatter?: boolean;
}

export interface JrHistoryRow {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: string;
  oldValues: unknown;
  newValues: unknown;
}

/** PATCH /jr/matters/:matterId/stage — the gated stage machine. */
export function changeJrStage(
  matterId: string,
  payload: ChangeStagePayload,
): Promise<JrMatter> {
  return apiFetch<JrMatter>(`/jr/matters/${matterId}/stage`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
}

/** POST /jr/matters/:matterId/route — the §6.4 route decision tree. */
export function determineJrRoute(
  matterId: string,
  payload: DetermineRoutePayload,
): Promise<JrMatter> {
  return apiFetch<JrMatter>(`/jr/matters/${matterId}/route`, {
    method: 'POST',
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
}

/** GET /jr/matters/:matterId/history — the matter's activity timeline. */
export function fetchJrMatterHistory(matterId: string): Promise<JrHistoryRow[]> {
  return apiFetch<JrHistoryRow[]>(`/jr/matters/${matterId}/history`, {
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

// ---------------------------------------------------------------------------
// Counsel directory + retention (jr.counsel.manage). A JrCounsel can be set as a
// matter's counsel of record or record its merits view — both of which the
// MERITS_REVIEW → RETAINED gate reads. GET/POST /jr/counsel are the directory;
// POST /jr/matters/:id/counsel + /merits are the matter-side setters.
// ---------------------------------------------------------------------------

/** A JrCounsel directory row (mirrors the Prisma `legal.jr_counsel` model). */
export interface JrCounsel {
  id: string;
  legalName: string;
  firmName: string;
  lawSocietyProvince: string;
  licenceNumber: string;
  directoryUrl: string | null;
  email: string;
  phone: string | null;
  addressForServiceCanada: string;
  goodStandingVerifiedAt: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJrCounselInput {
  legalName: string;
  firmName: string;
  lawSocietyProvince: string;
  licenceNumber: string;
  email: string;
  addressForServiceCanada: string;
  directoryUrl?: string;
  phone?: string;
  notes?: string;
}

export interface UpdateJrCounselInput {
  legalName?: string;
  firmName?: string;
  lawSocietyProvince?: string;
  licenceNumber?: string;
  email?: string;
  addressForServiceCanada?: string;
  directoryUrl?: string;
  phone?: string;
  notes?: string;
  isActive?: boolean;
  goodStandingVerifiedAt?: string;
}

/** GET /jr/counsel — the counsel directory (optionally active-only). */
export function fetchJrCounsel(activeOnly = false): Promise<JrCounsel[]> {
  const tail = activeOnly ? '?activeOnly=true' : '';
  return apiFetch<JrCounsel[]>(`/jr/counsel${tail}`, { cache: 'no-store' });
}

/** POST /jr/counsel — create a counsel directory entry. */
export function createJrCounsel(input: CreateJrCounselInput): Promise<JrCounsel> {
  return apiFetch<JrCounsel>('/jr/counsel', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** PATCH /jr/counsel/:id — edit a counsel entry (deactivate / mark good-standing / edit). */
export function updateJrCounsel(
  id: string,
  patch: UpdateJrCounselInput,
): Promise<JrCounsel> {
  return apiFetch<JrCounsel>(`/jr/counsel/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export interface SetCounselOfRecordPayload {
  counselOfRecordId: string;
  counselRetainerScope: string;
  counselFeeQuoted?: number;
  counselFeeCurrency?: string;
  counselRetainerSignedAt?: string;
}

/** POST /jr/matters/:matterId/counsel — set counsel of record + retainer scope. */
export function setCounselOfRecord(
  matterId: string,
  payload: SetCounselOfRecordPayload,
): Promise<JrMatter> {
  return apiFetch<JrMatter>(`/jr/matters/${matterId}/counsel`, {
    method: 'POST',
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
}

export interface RecordMeritsPayload {
  meritsRecommendation: string;
  meritsAssessedByCounselId: string;
}

/** POST /jr/matters/:matterId/merits — record counsel's merits recommendation. */
export function recordMerits(
  matterId: string,
  payload: RecordMeritsPayload,
): Promise<JrMatter> {
  return apiFetch<JrMatter>(`/jr/matters/${matterId}/merits`, {
    method: 'POST',
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
}

/** JrCounselRetainerScope enum values. */
export const JR_RETAINER_SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'LEAVE_ONLY', label: 'Leave only' },
  { value: 'FULL', label: 'Full (leave + application)' },
];

/** JrMeritsRecommendation enum values. */
export const JR_MERITS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'FILE_JR', label: 'File JR' },
  { value: 'REAPPLY', label: 'Reapply' },
  { value: 'RECONSIDER', label: 'Request reconsideration' },
  { value: 'APPEAL_IAD', label: 'Appeal to IAD' },
  { value: 'APPEAL_RAD', label: 'Appeal to RAD' },
  { value: 'DECLINE', label: 'Decline' },
];

/** Humanise a JrMeritsRecommendation value (falls back to the raw key). */
export function jrMeritsLabel(value: string | null | undefined): string {
  if (!value) return '';
  return JR_MERITS_OPTIONS.find((o) => o.value === value)?.label ?? jrHumanize(value);
}

/** Humanise a JrCounselRetainerScope value (falls back to the raw key). */
export function jrRetainerScopeLabel(value: string | null | undefined): string {
  if (!value) return '';
  return JR_RETAINER_SCOPE_OPTIONS.find((o) => o.value === value)?.label ?? jrHumanize(value);
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

/**
 * The frozen §6.1 forward-transition map, mirrored VERBATIM from the backend's
 * `JR_ALLOWED_TRANSITIONS` (apps/backend/.../jr-stage-machine.ts). The console
 * offers ONLY these targets; the backend re-checks the map and enforces the
 * §6.2 gates. CLIENT_UNRESPONSIVE / CLOSED carry no forward targets here (the
 * former is handled by mark-unresponsive/resume, the latter is terminal).
 */
export const JR_STAGE_TRANSITIONS: Record<string, string[]> = {
  INTAKE: ['ROUTE_DETERMINED', 'CLOSED'],
  ROUTE_DETERMINED: ['MERITS_REVIEW', 'CLOSED'],
  MERITS_REVIEW: ['RETAINED', 'COUNSEL_DECLINED', 'CLOSED'],
  COUNSEL_DECLINED: ['MERITS_REVIEW', 'CLOSED'],
  RETAINED: ['FILED', 'REQUIRES_EXTENSION_REQUEST', 'CLOSED'],
  REQUIRES_EXTENSION_REQUEST: ['FILED', 'CLOSED'],
  FILED: ['LEAVE_GRANTED', 'REDETERMINATION', 'CLOSED'],
  LEAVE_GRANTED: ['REDETERMINATION', 'CLOSED'],
  REDETERMINATION: ['CLOSED'],
  CLIENT_UNRESPONSIVE: [],
  CLOSED: [],
};

/** JrCloseReason enum values (backend schema.prisma `legal` schema). */
export const JR_CLOSE_REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'REFERRED_IAD', label: 'Referred to IAD' },
  { value: 'REFERRED_RAD', label: 'Referred to RAD' },
  { value: 'REFERRED_REAPPLICATION', label: 'Referred to reapplication' },
  { value: 'NO_RECOURSE', label: 'No recourse' },
  { value: 'COUNSEL_DECLINED_NO_ALTERNATIVE', label: 'Counsel declined — no alternative' },
  { value: 'CLIENT_DECLINED_AFTER_REVIEW', label: 'Client declined after review' },
  { value: 'WITHDRAWN_ON_INSTRUCTIONS', label: 'Withdrawn on instructions' },
  { value: 'CLIENT_UNRESPONSIVE_ABANDONED', label: 'Client unresponsive — abandoned' },
  { value: 'DEADLINE_MISSED_NOT_FILED', label: 'Deadline missed — not filed' },
  { value: 'EXTENSION_REFUSED', label: 'Extension refused' },
  { value: 'LEAVE_REFUSED', label: 'Leave refused' },
  { value: 'SETTLED_REDETERMINATION', label: 'Settled — redetermination (win)' },
  { value: 'ALLOWED_AT_HEARING', label: 'Allowed at hearing (win)' },
  { value: 'DISMISSED_AT_HEARING', label: 'Dismissed at hearing' },
  { value: 'REDETERMINATION_APPROVED', label: 'Redetermination approved' },
  { value: 'REDETERMINATION_REFUSED', label: 'Redetermination refused' },
  { value: 'SUCCESSOR_MATTER_OPENED', label: 'Successor matter opened' },
];

/** JrSponsorshipRelationship enum values (optional; NONE is the empty choice). */
export const JR_SPONSORSHIP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'NONE', label: 'None' },
  { value: 'SPOUSE_OR_PARTNER', label: 'Spouse or partner' },
  { value: 'CHILD', label: 'Child' },
  { value: 'PARENT_OR_GRANDPARENT', label: 'Parent or grandparent' },
  { value: 'OTHER_FAMILY', label: 'Other family' },
];

/** JrInadmissibilityGround enum values (optional; NONE is the empty choice). */
export const JR_INADMISSIBILITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'NONE', label: 'None' },
  { value: 'MISREPRESENTATION', label: 'Misrepresentation' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'HUMAN_RIGHTS', label: 'Human or international rights violations' },
  { value: 'SANCTIONS', label: 'Sanctions' },
  { value: 'SERIOUS_CRIMINALITY', label: 'Serious criminality' },
  { value: 'ORGANIZED_CRIMINALITY', label: 'Organized criminality' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'FINANCIAL', label: 'Financial' },
  { value: 'OTHER', label: 'Other' },
];

/** Humanise a JrCloseReason value (falls back to the raw key). */
export function jrCloseReasonLabel(value: string | null | undefined): string {
  if (!value) return '';
  return (
    JR_CLOSE_REASON_OPTIONS.find((o) => o.value === value)?.label ?? jrHumanize(value)
  );
}

/** Humanise a JrRoute value (falls back to the raw key). */
export function jrRouteLabel(value: string | null | undefined): string {
  if (!value) return '';
  return jrHumanize(value);
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

// ---------------------------------------------------------------------------
// Associate work-report subsystem (§11.7, PR 10) — `@Controller('jr/reports')`.
// The body is NEVER stored: the backend recompiles it live on every read from
// the JR audit log; only params + enrichments + (at finalize) a frozen PDF
// persist. DRAFT = body live + enrichments editable; FINALIZED = read-only.
// ---------------------------------------------------------------------------

export type WorkReportStatus = 'DRAFT' | 'FINALIZED';

/** Row shape from GET /jr/reports (the list). */
export interface WorkReportListItem {
  id: string;
  subjectAssociateUserId: string;
  periodFrom: string;
  periodTo: string;
  status: WorkReportStatus;
  createdByUserId: string;
  createdAt: string;
}

/** A pickable report subject (GET /jr/reports/subjects). */
export interface WorkReportSubject {
  id: string;
  email: string;
  name: string;
}

export interface WorkReportMatter {
  matterId: string;
  matterNumber: string | null;
  styleOfCause: string | null;
  stage: string | null;
  clientId: string | null;
  clientName: string | null;
  clientReferenceCode: string | null;
  isWin: boolean;
  draftVersions: number;
  actions: Array<{ action: string; entityId: string | null; createdAt: string }>;
}

export interface WorkReportBody {
  subjectAssociateUserId: string;
  period: { from: string; to: string };
  generatedAt: string;
  hasActivity: boolean;
  summary: {
    matterCount: number;
    draftVersions: number;
    submittedForReview: number;
    approvals: number;
    changesRequested: number;
    filings: number;
    caseNotes: number;
    wins: number;
  };
  matters: WorkReportMatter[];
  caseNotes: Array<{
    id: string;
    matterId: string;
    noteType: string;
    content: string;
    createdAt: string;
  }>;
  deadlines: {
    scope: 'matter-level';
    onTime: number;
    missed: number;
    pending: number;
    total: number;
    items: Array<{
      matterId: string;
      milestoneKey: string;
      label: string | null;
      computedDueAt: string;
      status: string;
      isFatal: boolean;
    }>;
  };
}

export interface WorkReportNote {
  id: string;
  authorUserId: string;
  content: string;
  createdAt: string;
}

export interface WorkReportAttachment {
  id: string;
  kind: 'IMAGE' | 'VOICE_NOTE' | string;
  mimeType: string | null;
  durationMs: number | null;
  transcript: string | null;
  transcriptStatus: 'PENDING' | 'DONE' | 'FAILED' | string;
  createdAt: string;
}

/** The hydrated report returned by create / GET /jr/reports/:id. */
export interface HydratedWorkReport {
  report: {
    id: string;
    subjectAssociateUserId: string;
    subjectName: string | null;
    periodFrom: string;
    periodTo: string;
    status: WorkReportStatus;
    canViewAllAtCompile: boolean;
    createdByUserId: string;
    createdAt: string;
    updatedAt: string;
    frozenPdfKey: string | null;
    frozenPdfSha256: string | null;
  };
  body: WorkReportBody;
  notes: WorkReportNote[];
  attachments: WorkReportAttachment[];
}

/** POST /jr/reports — compile (or return the existing DRAFT for) a period. */
export function createWorkReport(input: {
  subjectAssociateId?: string;
  periodFrom: string;
  periodTo: string;
}): Promise<HydratedWorkReport> {
  return apiFetch<HydratedWorkReport>('/jr/reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** GET /jr/reports — list reports visible to the caller. */
export function listWorkReports(
  q: { status?: WorkReportStatus; take?: number } = {},
): Promise<WorkReportListItem[]> {
  const qs = new URLSearchParams();
  if (q.status) qs.set('status', q.status);
  if (q.take) qs.set('take', String(q.take));
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<WorkReportListItem[]>(`/jr/reports${tail}`, { cache: 'no-store' });
}

/** GET /jr/reports/subjects — the pickable-subject list. */
export function fetchReportSubjects(): Promise<WorkReportSubject[]> {
  return apiFetch<WorkReportSubject[]>('/jr/reports/subjects', { cache: 'no-store' });
}

/** GET /jr/reports/:id — hydrated report (live body + enrichments). */
export function fetchWorkReport(id: string): Promise<HydratedWorkReport> {
  return apiFetch<HydratedWorkReport>(`/jr/reports/${id}`, { cache: 'no-store' });
}

/** POST /jr/reports/:id/notes — a report-level narrative note (DRAFT-only). */
export function addReportNote(id: string, content: string): Promise<HydratedWorkReport> {
  return apiFetch<HydratedWorkReport>(`/jr/reports/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

/** DELETE /jr/reports/:id/notes/:noteId — soft-delete a report note (DRAFT-only). */
export function deleteReportNote(id: string, noteId: string): Promise<HydratedWorkReport> {
  return apiFetch<HydratedWorkReport>(`/jr/reports/${id}/notes/${noteId}`, {
    method: 'DELETE',
  });
}

/** POST /jr/reports/:id/attachments/image — multipart image upload (DRAFT-only). */
export function uploadReportImage(id: string, file: File | Blob, fileName?: string): Promise<HydratedWorkReport> {
  const fd = new FormData();
  fd.append('file', file, fileName ?? (file as File).name ?? 'image.png');
  return apiFetch<HydratedWorkReport>(`/jr/reports/${id}/attachments/image`, {
    method: 'POST',
    body: fd,
  });
}

/** POST /jr/reports/:id/attachments/voice — multipart voice upload (DRAFT-only). */
export function uploadReportVoice(id: string, file: File | Blob, fileName?: string): Promise<HydratedWorkReport> {
  const fd = new FormData();
  fd.append('file', file, fileName ?? (file as File).name ?? 'voice-note.webm');
  return apiFetch<HydratedWorkReport>(`/jr/reports/${id}/attachments/voice`, {
    method: 'POST',
    body: fd,
  });
}

/** DELETE /jr/reports/:id/attachments/:attId — soft-delete an attachment (DRAFT-only). */
export function deleteReportAttachment(id: string, attId: string): Promise<HydratedWorkReport> {
  return apiFetch<HydratedWorkReport>(`/jr/reports/${id}/attachments/${attId}`, {
    method: 'DELETE',
  });
}

/** GET /jr/reports/:id/attachments/:attId/signed-url — a short-lived signed URL. */
export function reportAttachmentSignedUrl(id: string, attId: string): Promise<{ url: string }> {
  return apiFetch<{ url: string }>(`/jr/reports/${id}/attachments/${attId}/signed-url`, {
    cache: 'no-store',
  });
}

/** POST /jr/reports/:id/finalize — freeze the report into an immutable PDF. */
export function finalizeWorkReport(id: string): Promise<HydratedWorkReport> {
  return apiFetch<HydratedWorkReport>(`/jr/reports/${id}/finalize`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** POST /jr/reports/:id/email — email the report PDF outbound (Head only). */
export function emailWorkReport(
  id: string,
  payload: { emails?: string[]; note?: string } = {},
): Promise<{ sent: boolean; recipients: string[] }> {
  return apiFetch<{ sent: boolean; recipients: string[] }>(`/jr/reports/${id}/email`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Fetch the report PDF (authed) and open it in a new tab (mirrors openPayslipPdf). */
export async function openWorkReportPdf(id: string): Promise<void> {
  const blob = await apiFetchBlob(`/jr/reports/${id}/pdf`);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Tone for a work-report status badge. */
export function workReportStatusTone(status: string): BadgeTone {
  return status === 'FINALIZED' ? 'success' : 'warning';
}
