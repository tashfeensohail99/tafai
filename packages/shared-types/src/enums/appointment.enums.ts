/**
 * @tashfeen/shared-types — enums/appointment.enums.ts
 * Matches Prisma schema: AppointmentStatus, AppointmentType
 */

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  RESCHEDULED = 'RESCHEDULED',
}

export enum AppointmentType {
  INITIAL_CONSULTATION = 'INITIAL_CONSULTATION',
  DOCUMENT_SUBMISSION = 'DOCUMENT_SUBMISSION',
  FOLLOW_UP = 'FOLLOW_UP',
  INTERVIEW_PREP = 'INTERVIEW_PREP',
  VISA_PICKUP = 'VISA_PICKUP',
  OTHER = 'OTHER',
}
