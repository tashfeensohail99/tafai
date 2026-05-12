/**
 * @tashfeen/shared-types — enums/client.enums.ts
 * Matches Prisma schema: ClientStatus
 */

export enum ClientStatus {
  NEW_CLIENT = 'NEW_CLIENT',
  DOCUMENTS_PENDING = 'DOCUMENTS_PENDING',
  UNDER_PROCESSING = 'UNDER_PROCESSING',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  BLOCKED = 'BLOCKED',
  INACTIVE = 'INACTIVE',
  COMPLETED = 'COMPLETED',
}
