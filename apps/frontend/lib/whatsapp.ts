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
  /** Click-to-WhatsApp ad attribution — populated when the contact engaged
   *  via a Facebook / Instagram WhatsApp ad. Drives the "AD" chip on the
   *  thread list row so admin can spot ad-driven conversations at a glance. */
  adReferral?: AdReferral | null;
  adReferralAt?: string | null;
  channel: { id: string; label: string; displayNumber: string };
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    status: LeadStatus;
    assignedEmployeeId: string | null;
    assignedEmployee: { id: string; firstName: string; lastName: string } | null;
    /** Most-recent CSV import touch — present when the lead was first
     *  added through a bulk spreadsheet upload. Drives the CSV LEAD
     *  badge on the thread row. */
    importRows?: Array<{
      id: string;
      batch: { id: string; batchNumber: string; name: string };
    }>;
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

/**
 * Click-to-WhatsApp ad attribution. Meta sends this on the first inbound
 * message after a customer clicks a Facebook / Instagram WhatsApp ad —
 * we persist it on the thread (so the inbox UI can keep showing "replied
 * from <ad>" on subsequent messages) and on the specific message that
 * carried the click. All fields are optional because Meta's payload
 * varies by ad creative.
 */
export interface AdReferral {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  media_type?: 'image' | 'video' | string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ctwa_clid?: string;
}

export interface ThreadDetail extends ThreadListItem {
  channelId: string;
  leadId: string | null;
  clientId: string | null;
  /** Most recent ad the contact engaged via — see AdReferral. */
  adReferral?: AdReferral | null;
  adReferralAt?: string | null;
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
  /** Present when this specific message was triggered by a click-to-WhatsApp
   *  ad click — the inbox renders an ad-context card above the bubble. */
  adReferral?: AdReferral | null;
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
  unassigned?: boolean;
  search?: string;
  cursor?: string;
  limit?: number;
} = {}): Promise<ThreadListResponse> {
  return apiFetch<ThreadListResponse>(`/whatsapp/threads${buildQuery(opts)}`);
}

export interface ThreadStats {
  total: number;
  active: number;
  unassigned: number;
  slaBreached: number;
  unread: number;
  /** Response-SLA: conversations where it's currently the agent's turn. */
  awaitingReply: number;
  /** Within the warn window (about to breach), not yet overdue. */
  approaching: number;
  /** Response-SLA deadline already passed, still unanswered. */
  overdue: number;
  /** On-time score (0–100). For an agent: their own. For an admin/manager:
   *  the org-wide aggregate. null only when there's no employee context. */
  slaScore: number | null;
  /** 'self' = the score is the agent's own; 'org' = org-wide aggregate (admin). */
  slaScoreScope?: 'self' | 'org' | null;
}

/**
 * True inbox counters for the KPI chips — counted server-side over the whole
 * table, NOT derived from the (paginated) thread list. Use this instead of
 * `items.length`, which only ever reflects the loaded page.
 */
export function getThreadStats(): Promise<ThreadStats> {
  return apiFetch<ThreadStats>('/whatsapp/threads/stats');
}

export function reassignThread(
  threadId: string,
  employeeId: string,
): Promise<{
  threadId: string;
  leadId: string;
  assignedEmployeeId: string;
  assignedEmployeeName: string;
  previousAssignee: string | null;
}> {
  return apiFetch(`/whatsapp/threads/${threadId}/reassign`, {
    method: 'POST',
    body: JSON.stringify({ employeeId }),
  });
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

/**
 * Upload and send a media message (voice note, image, video, document).
 * Uses multipart/form-data; `apiFetch` is bypassed because we need raw FormData.
 */
export async function sendMediaMessage(
  threadId: string,
  file: Blob,
  filename: string,
  caption?: string,
  idempotencyKey?: string,
): Promise<ChatMessage> {
  const form = new FormData();
  form.append('file', file, filename);
  if (caption) form.append('caption', caption);
  if (idempotencyKey) form.append('idempotencyKey', idempotencyKey);

  // Use apiFetch without Content-Type header (browser sets multipart boundary automatically)
  return apiFetch<ChatMessage>(`/whatsapp/threads/${threadId}/messages/media`, {
    method: 'POST',
    body: form,
  });
}

// ---- Templates catalog --------------------------------------------------

export type WhatsAppTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

/**
 * Component as it comes from Meta. Each template's `components` field is an
 * array of these — typically a HEADER, BODY, FOOTER, and optional BUTTONS.
 */
export interface WhatsAppTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
  text?: string;
  buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  example?: { header_text?: string[]; body_text?: string[][] };
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  components: WhatsAppTemplateComponent[];
  qualityRating: string | null;
}

export function listTemplates(channelId: string): Promise<WhatsAppTemplate[]> {
  return apiFetch<WhatsAppTemplate[]>(`/whatsapp/channels/${channelId}/templates`);
}

/**
 * Extract `{{1}}, {{2}}, …` placeholders from a template body. Returns the
 * highest index (1-based count) so the picker can render that many inputs.
 * Meta templates can use placeholders in HEADER and BODY components; for
 * MVP we render parameters for BODY only (most common).
 */
export function countTemplateBodyParams(template: WhatsAppTemplate): number {
  const body = template.components.find((c) => c.type === 'BODY');
  if (!body?.text) return 0;
  const matches = body.text.match(/\{\{(\d+)\}\}/g);
  if (!matches) return 0;
  return matches.reduce((max, m) => {
    const n = Number(m.replace(/[^\d]/g, ''));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
}

/**
 * Compose the Meta `components` payload for a template send given the agent's
 * parameter inputs. Only emits the BODY component when params exist.
 */
export function buildTemplateComponents(
  template: WhatsAppTemplate,
  bodyParams: string[],
): Array<Record<string, unknown>> | undefined {
  const expected = countTemplateBodyParams(template);
  if (expected === 0) return undefined;
  return [
    {
      type: 'body',
      parameters: bodyParams.slice(0, expected).map((text) => ({ type: 'text', text })),
    },
  ];
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
  /** Send a free-form WhatsApp confirmation to the linked lead/client. */
  sendWhatsAppConfirmation?: boolean;
}

export type AppointmentConfirmationOutcome =
  | { sent: true; messageId: string; threadId: string }
  | { sent: false; reason: 'no_thread' | 'window_expired' | 'no_phone' | 'no_channel' };

export interface CreateAppointmentResult {
  id: string;
  whatsappConfirmation: AppointmentConfirmationOutcome | null;
  [key: string]: unknown;
}

export function createAppointment(input: CreateAppointmentInput): Promise<CreateAppointmentResult> {
  return apiFetch<CreateAppointmentResult>('/appointments', {
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
