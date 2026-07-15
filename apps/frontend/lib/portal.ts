'use client';

import { apiFetch } from './api-client';

// ---------- Shared types mirroring backend /portal/* responses --------------

export type ProcessingCaseStage =
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

export type DocumentItemStatus =
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WAIVED'
  | 'EXPIRED'
  | 'REPLACEMENT_REQUIRED'
  | 'CONDITIONAL_ACCEPT';

export type DocumentCriticality =
  | 'CRITICAL'
  | 'REQUIRED'
  | 'CONDITIONAL'
  | 'SUPPORTING'
  | 'OPTIONAL';

export type CommunicationDirection =
  | 'OFFICER_TO_CLIENT'
  | 'CLIENT_TO_OFFICER'
  | 'SYSTEM_TO_CLIENT'
  | 'INTERNAL';

export interface PortalCaseSummary {
  id: string;
  stage: ProcessingCaseStage;
  service: string;
  targetCountry: string | null;
  createdAt: string;
  slaDueAt: string | null;
  assignedOfficerName: string | null;
  docsTotal: number;
  docsAccepted: number;
  docsActionRequired: number;
  unreadMessages: number;
}

export interface PortalCaseDetail {
  id: string;
  stage: ProcessingCaseStage;
  service: string;
  targetCountry: string | null;
  createdAt: string;
  slaDueAt: string | null;
  assignedOfficerName: string | null;
  docCounts: Partial<Record<DocumentItemStatus, number>>;
  unreadMessages: number;
}

export interface PortalDocumentVersion {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  versionNumber: number;
  uploadedAt: string;
}

export interface FriendlyRejection {
  /** Internal code (audit only — don't render). */
  code: string;
  /** Short internal label — admin/officer view. */
  internalLabel: string;
  /** Plain-English message for the client. */
  clientMessage: string;
}

export interface PortalDocumentItem {
  id: string;
  documentName: string;
  description: string | null;
  criticality: DocumentCriticality;
  status: DocumentItemStatus;
  expectedFormats: string[];
  maxFileSizeMb: number;
  validityExpiryDate: string | null;
  requestDeadline: string | null;
  latestVersion: PortalDocumentVersion | null;
  canUpload: boolean;
  /** Extra doc the client added that isn't part of the checklist ("Additional Documents"). */
  isAdditional?: boolean;
  /** Raw codes — kept for audit, never displayed verbatim. */
  latestRejectionReasonCodes: string[];
  /** Backend-translated friendly messages. Render these. */
  latestRejectionMessages: FriendlyRejection[];
  // Phase F — program-aware staging + attestation + client guidance.
  stageGroup?: 'PROVIDE_FIRST' | 'NEXT' | 'LATER';
  attestation?: { required: boolean; status: string; chain: string | null };
  translation?: { required: boolean; status: string };
  guidance?: { whyText: string | null; exampleGoodUrl: string | null; exampleBadUrl: string | null };
}

export interface PortalMessage {
  id: string;
  direction: CommunicationDirection;
  messageType: string;
  subject: string | null;
  content: string;
  channelsSent: string[];
  createdAt: string;
  readByClientAt: string | null;
  senderName: string | null;
}

export type PortalTimelineEvent =
  | {
      id: string;
      type: 'STAGE_CHANGE';
      createdAt: string;
      description: string;
      actor: string | null;
    }
  | {
      id: string;
      type: 'DOCUMENT_REVIEW';
      createdAt: string;
      description: string;
      actor: string | null;
      decision: 'ACCEPTED' | 'REJECTED';
      rejectionReasonCodes: string[];
    }
  | {
      id: string;
      type: 'COMMUNICATION';
      createdAt: string;
      description: string;
      actor: string | null;
    };

// ---------- API calls -----------------------------------------------------

export function getMyCases(): Promise<PortalCaseSummary[]> {
  return apiFetch<PortalCaseSummary[]>('/portal/cases/mine');
}

export function getCaseDetail(caseId: string): Promise<PortalCaseDetail> {
  return apiFetch<PortalCaseDetail>(`/portal/cases/${caseId}`);
}

export function getDocumentChecklist(caseId: string): Promise<PortalDocumentItem[]> {
  return apiFetch<PortalDocumentItem[]>(`/portal/cases/${caseId}/documents`);
}

export function getCommunications(caseId: string): Promise<PortalMessage[]> {
  return apiFetch<PortalMessage[]>(`/portal/cases/${caseId}/communications`);
}

export function sendMessage(
  caseId: string,
  input: { subject?: string; content: string },
): Promise<PortalMessage> {
  return apiFetch<PortalMessage>(`/portal/cases/${caseId}/communications`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getTimeline(caseId: string): Promise<PortalTimelineEvent[]> {
  return apiFetch<PortalTimelineEvent[]>(`/portal/cases/${caseId}/timeline`);
}

export async function uploadDocument(
  caseId: string,
  itemId: string,
  file: File,
): Promise<{
  id: string;
  documentItemId: string;
  versionNumber: number;
  fileName: string;
  fileSizeBytes: number;
  uploadedAt: string;
  status: DocumentItemStatus;
}> {
  const { getAccessToken } = await import('./auth-client');
  const token = getAccessToken();
  const form = new FormData();
  form.append('file', file);
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const res = await fetch(
    `${base}/portal/cases/${caseId}/documents/${itemId}/upload`,
    {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message?: unknown }).message)
        : `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Upload an EXTRA document not tied to a checklist slot ("Additional Documents").
 * `note` is the client's optional description. The server creates an optional
 * ad-hoc item, AI-classifies it, and the team confirms it.
 */
export async function uploadAdditionalDocument(
  caseId: string,
  file: File,
  note?: string,
): Promise<{ id: string; documentItemId: string; status: DocumentItemStatus }> {
  const { getAccessToken } = await import('./auth-client');
  const token = getAccessToken();
  const form = new FormData();
  form.append('file', file);
  if (note && note.trim()) form.append('note', note.trim());
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const res = await fetch(`${base}/portal/cases/${caseId}/additional-documents`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message?: unknown }).message)
        : `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

export function getDocumentSignedUrl(
  caseId: string,
  itemId: string,
): Promise<{ url: string; fileName: string }> {
  return apiFetch<{ url: string; fileName: string }>(
    `/portal/cases/${caseId}/documents/${itemId}/signed-url`,
  );
}

// ---------- Appointments --------------------------------------------------

export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RESCHEDULED';

export interface PortalAppointment {
  id: string;
  title: string;
  appointmentType: string;
  scheduledAt: string;
  durationMinutes: number;
  location: string | null;
  meetingLink: string | null;
  instructions: string | null;
  status: AppointmentStatus;
  reminderSent: boolean;
  completedAt: string | null;
  cancellationReason: string | null;
}

export function getAppointments(): Promise<PortalAppointment[]> {
  return apiFetch<PortalAppointment[]>('/portal/appointments');
}

// ---------- Notifications -------------------------------------------------

export type NotificationKind =
  | 'UNREAD_MESSAGE'
  | 'MISSING_DOCUMENT'
  | 'REJECTED_DOCUMENT'
  | 'EXPIRING_DOCUMENT'
  | 'UPCOMING_APPOINTMENT'
  | 'STAGE_CHANGE';

export interface PortalNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  caseId: string | null;
  severity: 'info' | 'warning' | 'danger' | 'success';
  href: string;
}

export function getNotifications(): Promise<PortalNotification[]> {
  return apiFetch<PortalNotification[]>('/portal/notifications');
}

// ---------- Profile -------------------------------------------------------

export interface PortalProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  alternatePhone: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  passportNumberMasked: string | null;
  cnicMasked: string | null;
  address: string | null;
  status: string;
  serviceType: string | null;
  targetCountry: string | null;
  assignedSalesPersonName: string | null;
}

export function getProfile(): Promise<PortalProfile> {
  return apiFetch<PortalProfile>('/portal/profile');
}

export function requestProfileUpdate(input: {
  subject?: string;
  content: string;
}): Promise<unknown> {
  return apiFetch<unknown>('/portal/profile/update-request', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---------- Presentation helpers (client-friendly labels) ------------------

export const CLIENT_STAGE_LABEL: Record<ProcessingCaseStage, string> = {
  INTAKE_PENDING: 'Case Received',
  DOCUMENTS_COLLECTION: 'Please Upload Documents',
  DOCUMENTS_UNDER_REVIEW: 'Documents Under Review',
  DOCUMENTS_INCOMPLETE: 'Action Required — Documents Incomplete',
  DOCUMENTS_COMPLETE: 'Documents Complete',
  READY_FOR_SUBMISSION: 'Being Prepared for Submission',
  SUBMITTED: 'Application Submitted',
  UNDER_AUTHORITY_REVIEW: 'With Immigration Authority',
  ADDITIONAL_INFO_REQUESTED: 'Additional Information Required',
  DECISION_RECEIVED: 'Decision Received',
  APPROVED: 'Approved',
  REJECTED: 'Application Rejected',
  APPEAL_IN_PROGRESS: 'Appeal In Progress',
  COMPLETED: 'Case Complete',
  CANCELLED: 'Case Cancelled',
  // Client-facing: a junked case reads as closed, never "junk".
  JUNK: 'Case Closed',
};

export const CLIENT_STAGE_TONE: Record<ProcessingCaseStage, string> = {
  INTAKE_PENDING: 'neutral',
  DOCUMENTS_COLLECTION: 'info',
  DOCUMENTS_UNDER_REVIEW: 'accent',
  DOCUMENTS_INCOMPLETE: 'warning',
  DOCUMENTS_COMPLETE: 'success',
  READY_FOR_SUBMISSION: 'violet',
  SUBMITTED: 'cyan',
  UNDER_AUTHORITY_REVIEW: 'info',
  ADDITIONAL_INFO_REQUESTED: 'warning',
  DECISION_RECEIVED: 'accent',
  APPROVED: 'success',
  REJECTED: 'danger',
  APPEAL_IN_PROGRESS: 'warm',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  JUNK: 'neutral',
};

export const CLIENT_NEXT_ACTION: Record<ProcessingCaseStage, string | null> = {
  INTAKE_PENDING: 'Your application has been received. We will be in touch shortly.',
  DOCUMENTS_COLLECTION: 'Please upload all required documents via the Documents tab.',
  DOCUMENTS_UNDER_REVIEW: 'Your documents are being reviewed. No action needed at this time.',
  DOCUMENTS_INCOMPLETE: 'Some documents require attention. Please check the Documents tab.',
  DOCUMENTS_COMPLETE: 'All documents are complete. We are preparing your application.',
  READY_FOR_SUBMISSION: 'Your application is ready. We will submit it soon.',
  SUBMITTED:
    'Your application has been submitted. We will notify you when there is an update.',
  UNDER_AUTHORITY_REVIEW:
    'Your application is with the authority. This process takes time — we will keep you informed.',
  ADDITIONAL_INFO_REQUESTED:
    'The authority has requested additional information. Please check your messages.',
  DECISION_RECEIVED: 'A decision has been received. Your consultant will contact you shortly.',
  APPROVED:
    'Congratulations — your application has been approved! Your consultant will explain the next steps.',
  REJECTED:
    'Your application has been rejected. Please check your messages for details and options.',
  APPEAL_IN_PROGRESS: 'An appeal has been filed on your behalf. We will keep you informed.',
  COMPLETED: 'Your case is complete. Thank you for trusting Tafsheen Immigration.',
  CANCELLED: null,
  JUNK: null,
};

// High-level journey the client sees as a 5-step progress stepper. The 15
// internal stages collapse into these phases so the client always knows where
// they are and what's coming next.
export const CLIENT_JOURNEY_PHASES: { key: string; label: string }[] = [
  { key: 'DOCUMENTS', label: 'Documents' },
  { key: 'PREPARING', label: 'Preparing' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'REVIEW', label: 'Authority review' },
  { key: 'DECISION', label: 'Decision' },
];

const CLIENT_PHASE_BY_STAGE: Record<ProcessingCaseStage, number> = {
  INTAKE_PENDING: 0,
  DOCUMENTS_COLLECTION: 0,
  DOCUMENTS_UNDER_REVIEW: 0,
  DOCUMENTS_INCOMPLETE: 0,
  DOCUMENTS_COMPLETE: 0,
  READY_FOR_SUBMISSION: 1,
  SUBMITTED: 2,
  UNDER_AUTHORITY_REVIEW: 3,
  ADDITIONAL_INFO_REQUESTED: 3,
  DECISION_RECEIVED: 3,
  APPEAL_IN_PROGRESS: 3,
  APPROVED: 4,
  REJECTED: 4,
  COMPLETED: 4,
  CANCELLED: -1,
  JUNK: -1,
};

/** Index (0–4) of the client's current journey phase, or -1 if cancelled. */
export function clientJourneyPhase(stage: ProcessingCaseStage): number {
  return CLIENT_PHASE_BY_STAGE[stage] ?? 0;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return fmtDate(iso);
}
