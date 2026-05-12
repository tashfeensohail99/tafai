/**
 * @tashfeen/shared-types — enums/lead.enums.ts
 * Matches Prisma schema: LeadStatus
 */

export enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  QUALIFIED = 'QUALIFIED',
  PROPOSAL_SENT = 'PROPOSAL_SENT',
  FOLLOW_UP = 'FOLLOW_UP',
  CONVERTED = 'CONVERTED',
  LOST = 'LOST',
  DUPLICATE = 'DUPLICATE',
  UNQUALIFIED = 'UNQUALIFIED',
}

export enum SourceChannel {
  WALK_IN = 'WALK_IN',
  REFERRAL = 'REFERRAL',
  WHATSAPP = 'WHATSAPP',
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  WEBSITE = 'WEBSITE',
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  OTHER = 'OTHER',
}
