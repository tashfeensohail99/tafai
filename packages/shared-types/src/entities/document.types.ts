/**
 * @tashfeen/shared-types — entities/document.types.ts
 * Document entity shapes as returned by the API.
 */

import {
  DocumentStatus,
  DocumentCriticality,
  DocumentItemStatus,
  VirusScanStatus,
  CorrectionStatus,
  CorrectionType,
} from '../enums/document.enums';

export interface ClientDocumentSummary {
  id: string;
  clientId: string;
  documentRequirementId: string | null;
  documentName: string;
  description: string | null;
  status: DocumentStatus;
  criticality: DocumentCriticality;
  uploadedAt: string | null;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  rejectionReason: string | null;
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientDocumentVersion {
  id: string;
  clientDocumentId: string;
  fileName: string;
  originalFileName: string;
  fileSizeBytes: number;
  mimeType: string;
  storageKey: string;
  versionNumber: number;
  virusScanStatus: VirusScanStatus;
  uploadedByUserId: string;
  uploadedAt: string;
}

export interface CaseDocumentItem {
  id: string;
  processingCaseId: string;
  documentRequirementId: string | null;
  documentName: string;
  criticality: DocumentCriticality;
  status: DocumentItemStatus;
  expectedFormats: string[];
  maxFileSizeMb: number;
  validityExpiryDate: string | null;
  requestDeadline: string | null;
  latestVersion: ClientDocumentVersion | null;
  canUpload: boolean;
  rejectionReasonCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CorrectionRequest {
  id: string;
  processingCaseId: string;
  clientDocumentId: string | null;
  type: CorrectionType;
  status: CorrectionStatus;
  description: string;
  requestedByUserId: string;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
