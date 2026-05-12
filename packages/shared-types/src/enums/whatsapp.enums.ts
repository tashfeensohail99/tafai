/**
 * @tashfeen/shared-types — enums/whatsapp.enums.ts
 * Matches Prisma schema: WhatsAppMessageType, WhatsAppMessageStatus,
 * WhatsAppThreadStatus, WhatsAppTemplateStatus, WhatsAppCampaignStatus
 */

export enum WhatsAppMessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  DOCUMENT = 'DOCUMENT',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  LOCATION = 'LOCATION',
  TEMPLATE = 'TEMPLATE',
  INTERACTIVE = 'INTERACTIVE',
  SYSTEM = 'SYSTEM',
}

export enum WhatsAppMessageStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  FAILED = 'FAILED',
}

export enum WhatsAppThreadStatus {
  OPEN = 'OPEN',
  BOT = 'BOT',
  HUMAN = 'HUMAN',
  RESOLVED = 'RESOLVED',
  UNASSIGNED = 'UNASSIGNED',
}

export enum WhatsAppTemplateStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PAUSED = 'PAUSED',
  DISABLED = 'DISABLED',
}

export enum WhatsAppCampaignStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}
