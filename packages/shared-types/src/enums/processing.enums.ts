/**
 * @tashfeen/shared-types — enums/processing.enums.ts
 * Matches Prisma schema: ProcessingTaskStatus, ProcessingTaskPriority,
 * AuthoritySubmissionStatus, CommunicationDirection
 */

export enum ProcessingTaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  BLOCKED = 'BLOCKED',
  CANCELLED = 'CANCELLED',
}

export enum ProcessingTaskPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum AuthoritySubmissionStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ADDITIONAL_INFO_REQUESTED = 'ADDITIONAL_INFO_REQUESTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum CommunicationDirection {
  OFFICER_TO_CLIENT = 'OFFICER_TO_CLIENT',
  CLIENT_TO_OFFICER = 'CLIENT_TO_OFFICER',
  SYSTEM_TO_CLIENT = 'SYSTEM_TO_CLIENT',
  INTERNAL = 'INTERNAL',
}
