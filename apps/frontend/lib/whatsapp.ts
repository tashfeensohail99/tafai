'use client';

import { apiFetch, buildQuery } from './api-client';

// ---- Shared types -------------------------------------------------------

export type WhatsAppThreadStatus = 'OPEN' | 'PENDING' | 'RESOLVED' | 'ARCHIVED';
export type WhatsAppMessageDirection = 'INBOUND' | 'OUTBOUND';
export type WhatsAppMessageStatus =
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'
  | 'RECEIVED';
export type WhatsAppMessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'DOCUMENT'
  | 'STICKER'
  | 'LOCATION'
  | 'CONTACTS'
  | 'INTERACTIVE'
  | 'TEMPLATE'
  | 'REACTION'
  | 'SYSTEM'
  | 'UNSUPPORTED';
export type PresenceStatus = 'ONLINE' | 'AWAY' | 'OFFLINE';
export type LeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'QUALIFIED'
  | 'PROPOSAL_SENT'
  | 'FOLLOW_UP'
  | 'CONVERTED'
  | 'LOST'
  | 'DUPLICATE'
  | 'UNQUALIFIED';

export interface ThreadListItem {
  id: string;
  status: WhatsAppThreadStatus;
  waContactId: string;
  windowExpiresAt: string | null;
  firstInboundAt: string | null;
  firstAgentReplyAt: string | null;
  slaDeadlineAt: string | null;
  slaBreached: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  channel: { id: string; label: string; displayNumber: string };
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    status: LeadStatus;
    assignedEmployeeId: string | null;
    assignedEmployee: { id: string; firstName: string; lastName: string } | null;
  } | null;
  client: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    status: string;
  } | null;
}

export interface ThreadListResponse {
  items: ThreadListItem[];
  nextCursor: string | null;
}

export interface ThreadDetail extends ThreadListItem {
  channelId: string;
  leadId: string | null;
  clientId: string | null;
  lead:
    | (ThreadListItem['lead'] & {
        email: string | null;
        nationality: string | null;
        targetCountry: string | null;
        preferredEmployeeId: string | null;
        convertedClientId: string | null;
      })
    | null;
  client:
    | (ThreadListItem['client'] & {
        email: string | null;
        nationality: string | null;
      })
    | null;
  channel: ThreadListItem['channel'] & { phoneNumberId: string };
}

export interface ChatMessage {
  id: string;
  threadId: string;
  leadId: string | null;
  clientId: string | null;
  direction: WhatsAppMessageDirection;
  type: WhatsAppMessageType;
  status: WhatsAppMessageStatus;
  body: string | null;
  payload: unknown;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  sentByEmployeeId: string | null;
  waMessageId: string | null;
  repliedToWaMessageId: string | null;
  errorCode: string | null;
  errorTitle: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

export interface MyPresence {
  employeeId: string;
  whatsappInboxMember: boolean;
  explicit: PresenceStatus;
  effective: PresenceStatus;
  lastActivityAt: string | null;
  presenceChangedAt: string | null;
}

// ---- Threads + Messages -------------------------------------------------

export function listThreads(opts: {
  status?: WhatsAppThreadStatus;
  assignedToMe?: boolean;
  search?: string;
  cursor?: string;
} = {}): Promise<ThreadListResponse> {
  return apiFetch<ThreadListResponse>(`/whatsapp/threads${buildQuery(opts)}`);
}

export function getThread(threadId: string): Promise<ThreadDetail> {
  return apiFetch<ThreadDetail>(`/whatsapp/threads/${threadId}`);
}

export function markThreadRead(threadId: string): Promise<void> {
  return apiFetch<void>(`/whatsapp/threads/${threadId}/read`, { method: 'POST' });
}

export function listMessages(threadId: string, opts: { before?: Date } = {}): Promise<ChatMessage[]> {
  const q = opts.before ? `?before=${opts.before.toISOString()}` : '';
  return apiFetch<ChatMessage[]>(`/whatsapp/threads/${threadId}/messages${q}`);
}

export function sendText(threadId: string, body: string, opts?: {
  contextWaMessageId?: string;
  idempotencyKey?: string;
}): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/whatsapp/threads/${threadId}/messages/text`, {
    method: 'POST',
    body: JSON.stringify({ body, ...opts }),
  });
}

export function sendTemplate(threadId: string, input: {
  templateName: string;
  language: string;
  components?: Array<Record<string, unknown>>;
  idempotencyKey?: string;
}): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/whatsapp/threads/${threadId}/messages/template`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---- Presence -----------------------------------------------------------

export function getMyPresence(): Promise<MyPresence> {
  return apiFetch<MyPresence>('/whatsapp/presence/me');
}

export function setMyPresence(status: PresenceStatus): Promise<MyPresence> {
  return apiFetch<MyPresence>('/whatsapp/presence/me', {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function heartbeat(): Promise<void> {
  return apiFetch<void>('/whatsapp/presence/heartbeat', { method: 'POST' });
}

// ---- Convert + book (uses existing Tafsheen endpoints) ------------------

export function convertLeadToClient(leadId: string, notes?: string): Promise<unknown> {
  return apiFetch<unknown>(`/leads/${leadId}/convert`, {
    method: 'POST',
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

export interface CreateAppointmentInput {
  leadId?: string;
  clientId?: string;
  assignedEmployeeId?: string;
  title: string;
  appointmentType: string;
  scheduledAt: string; // ISO
  durationMinutes?: number;
  location?: string;
  meetingLink?: string;
  notes?: string;
}

export function createAppointment(input: CreateAppointmentInput): Promise<unknown> {
  return apiFetch<unknown>('/appointments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface CreateFollowUpInput {
  leadId: string;
  assignedEmployeeId?: string;
  title: string;
  description?: string;
  contactMethod?: string;
  dueAt: string; // ISO
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

export function createFollowUp(input: CreateFollowUpInput): Promise<unknown> {
  return apiFetch<unknown>('/follow-ups', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
