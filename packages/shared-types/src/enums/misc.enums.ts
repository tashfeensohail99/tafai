/**
 * @tashfeen/shared-types — enums/attendance.enums.ts
 * Matches Prisma schema: AttendanceStatus, PresenceStatus, ReminderType,
 * ReminderChannel, ReminderDeliveryStatus, FollowUpStatus, PartnerStatus
 */

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  LATE = 'LATE',
  HALF_DAY = 'HALF_DAY',
  ON_LEAVE = 'ON_LEAVE',
  REMOTE = 'REMOTE',
}

export enum PresenceStatus {
  ONLINE = 'ONLINE',
  AWAY = 'AWAY',
  BUSY = 'BUSY',
  OFFLINE = 'OFFLINE',
}

export enum ReminderType {
  FOLLOW_UP = 'FOLLOW_UP',
  APPOINTMENT = 'APPOINTMENT',
  DOCUMENT_DUE = 'DOCUMENT_DUE',
  PAYMENT_DUE = 'PAYMENT_DUE',
  VISA_EXPIRY = 'VISA_EXPIRY',
  CUSTOM = 'CUSTOM',
}

export enum ReminderChannel {
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  IN_APP = 'IN_APP',
}

export enum ReminderDeliveryStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum FollowUpStatus {
  OPEN = 'OPEN',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum PartnerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}
