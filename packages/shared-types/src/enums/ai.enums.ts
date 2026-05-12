/**
 * @tashfeen/shared-types — enums/ai.enums.ts
 * Matches Prisma schema: AiJobType, AiJobStatus
 */

export enum AiJobType {
  OCR = 'OCR',
  DOCUMENT_CLASSIFICATION = 'DOCUMENT_CLASSIFICATION',
  TRANSCRIPTION = 'TRANSCRIPTION',
  SUMMARY = 'SUMMARY',
  LEAD_SCORING = 'LEAD_SCORING',
  TRANSLATION = 'TRANSLATION',
}

export enum AiJobStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum AiReviewStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  OVERRIDDEN = 'OVERRIDDEN',
}
