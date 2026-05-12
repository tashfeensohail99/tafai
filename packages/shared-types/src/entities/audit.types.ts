/**
 * @tashfeen/shared-types — entities/audit.types.ts
 * Audit log and activity timeline shapes as returned by the API.
 */

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export type TimelineEventType =
  | 'LEAD_CREATED'
  | 'LEAD_UPDATED'
  | 'LEAD_ASSIGNED'
  | 'LEAD_CONVERTED'
  | 'LEAD_STATUS_CHANGED'
  | 'FOLLOW_UP_CREATED'
  | 'FOLLOW_UP_COMPLETED'
  | 'CLIENT_CREATED'
  | 'CLIENT_UPDATED'
  | 'CASE_CREATED'
  | 'CASE_ASSIGNED'
  | 'CASE_STATUS_CHANGED'
  | 'STAGE_CHANGE'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_VERIFIED'
  | 'DOCUMENT_REJECTED'
  | 'CORRECTION_REQUESTED'
  | 'CORRECTION_RESOLVED'
  | 'PAYMENT_RECORDED'
  | 'PAYMENT_VERIFIED'
  | 'INVOICE_CREATED'
  | 'APPOINTMENT_CREATED'
  | 'APPOINTMENT_COMPLETED'
  | 'WHATSAPP_MESSAGE_SENT'
  | 'WHATSAPP_MESSAGE_RECEIVED'
  | 'NOTE_ADDED'
  | 'HANDOVER'
  | 'AI_JOB_COMPLETED';

export interface ActivityTimelineEvent {
  id: string;
  entityType: string;
  entityId: string;
  type: TimelineEventType;
  summary: string;
  actorUserId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
