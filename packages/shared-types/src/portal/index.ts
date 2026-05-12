/**
 * @tashfeen/shared-types — portal/index.ts
 * All types used by the client-facing portal and the backend portal module.
 * These mirror the backend /portal/* API responses exactly.
 */

import {
  ProcessingCaseStage,
  DocumentItemStatus,
  DocumentCriticality,
  CommunicationDirection,
} from '../enums';

// ─── Case ─────────────────────────────────────────────────────────────────────

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

// ─── Documents ────────────────────────────────────────────────────────────────

export interface PortalDocumentVersion {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  versionNumber: number;
  uploadedAt: string;
}

export interface FriendlyRejection {
  /** Internal code — for audit only, never display to clients verbatim. */
  code: string;
  /** Short internal label — admin/officer view only. */
  internalLabel: string;
  /** Plain-English message for the client. Render this. */
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
  /** Raw rejection codes — audit only, do not display. */
  latestRejectionReasonCodes: string[];
  /** Backend-translated friendly messages — render these. */
  latestRejectionMessages: FriendlyRejection[];
}

// ─── Messages ─────────────────────────────────────────────────────────────────

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

// ─── Timeline ────────────────────────────────────────────────────────────────

export type PortalTimelineEvent =
  | {
      id: string;
      type: 'STAGE_CHANGE';
      createdAt: string;
      stage: ProcessingCaseStage;
      note: string | null;
      actorName: string | null;
    }
  | {
      id: string;
      type: 'DOCUMENT_ACTION';
      createdAt: string;
      documentName: string;
      action: 'UPLOADED' | 'ACCEPTED' | 'REJECTED' | 'CORRECTION_REQUESTED';
      actorName: string | null;
    }
  | {
      id: string;
      type: 'MESSAGE';
      createdAt: string;
      subject: string | null;
      direction: CommunicationDirection;
      senderName: string | null;
    }
  | {
      id: string;
      type: 'NOTE';
      createdAt: string;
      content: string;
      actorName: string | null;
    };

// ─── Appointments ─────────────────────────────────────────────────────────────

export interface PortalAppointmentSummary {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number | null;
  type: string;
  status: string;
  location: string | null;
  notes: string | null;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface PortalDashboard {
  client: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string;
  };
  cases: PortalCaseSummary[];
  upcomingAppointments: PortalAppointmentSummary[];
  unreadMessageCount: number;
  pendingDocumentCount: number;
}
