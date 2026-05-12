/**
 * @tashfeen/shared-types — enums/document.enums.ts
 * Matches Prisma schema: DocumentStatus, DocumentCriticality, DocumentItemStatus,
 * DocumentValidityRule, VirusScanStatus, CorrectionType, CorrectionStatus
 */

export enum DocumentStatus {
  PENDING = 'PENDING',
  UPLOADED = 'UPLOADED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  REPLACEMENT_REQUIRED = 'REPLACEMENT_REQUIRED',
}

export enum DocumentCriticality {
  CRITICAL = 'CRITICAL',
  REQUIRED = 'REQUIRED',
  CONDITIONAL = 'CONDITIONAL',
  SUPPORTING = 'SUPPORTING',
  OPTIONAL = 'OPTIONAL',
}

export enum DocumentItemStatus {
  NOT_SUBMITTED = 'NOT_SUBMITTED',
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  WAIVED = 'WAIVED',
  EXPIRED = 'EXPIRED',
  REPLACEMENT_REQUIRED = 'REPLACEMENT_REQUIRED',
  CONDITIONAL_ACCEPT = 'CONDITIONAL_ACCEPT',
}

export enum DocumentValidityRule {
  NONE = 'NONE',
  MONTHS_6 = 'MONTHS_6',
  MONTHS_12 = 'MONTHS_12',
  MONTHS_24 = 'MONTHS_24',
  CUSTOM = 'CUSTOM',
}

export enum VirusScanStatus {
  PENDING = 'PENDING',
  CLEAN = 'CLEAN',
  INFECTED = 'INFECTED',
  FAILED = 'FAILED',
}

export enum CorrectionType {
  DOCUMENT_REPLACEMENT = 'DOCUMENT_REPLACEMENT',
  INFORMATION_UPDATE = 'INFORMATION_UPDATE',
  ADDITIONAL_DOCUMENT = 'ADDITIONAL_DOCUMENT',
  OTHER = 'OTHER',
}

export enum CorrectionStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CANCELLED = 'CANCELLED',
}
