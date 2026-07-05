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
  /** SLA clock on the agent — set while a customer message awaits a reply,
   *  cleared once the agent replies. Drives the SLA warn/breach timers. */
  responseDeadlineAt: string | null;
  /** "Pending" = the customer has messaged more recently than the last MANUAL
   *  human reply (bot replies / auto-ack / templates do NOT count). This is the
   *  real-WhatsApp pending flag the inbox "Pending" tab filters on; the backend
   *  returns it as a scalar so the realtime patch can evaluate membership
   *  client-side. Derived from message events, so it can't get stuck. */
  awaitingReply: boolean;
  /** Last MANUAL human reply (null = no human has ever replied — the bot's
   *  greeting doesn't count). The "Uncontacted" tab is awaitingReply && this null. */
  lastHumanReplyAt: string | null;
  lastMessageAt: string | null;
  /** Latest real activity — newest inbound customer msg or manual rep reply
   *  (never the bot). The inbox sorts by this so new msgs surface but bot
   *  nudges don't bump. */
  lastHumanActivityAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  /** True when the CALLING agent has pinned this chat (personal, WhatsApp-style,
   *  max 6). Pinned rows are returned first and rendered in a "Pinned" section
   *  at the top of the inbox. Optional so older cached rows without it still
   *  parse (treated as false). */
  isPinnedByMe?: boolean;
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
  /**
   * Meta WhatsApp call-permission state — a business may only place an outbound
   * call once the customer has opted in. Drives the chip beside the Call button.
   * GRANTED is valid until callPermissionExpiresAt (Meta's ~7-day grant, or
   * permanent when no expiry). Updated live via the `whatsapp.call.permission`
   * realtime event.
   */
  callPermissionStatus?: 'PENDING' | 'GRANTED' | 'REJECTED' | string | null;
  callPermissionExpiresAt?: string | null;
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
  /** "Pending" tab — threads awaiting a human reply (awaitingReply=true: the
   *  customer messaged more recently than the last manual sales reply). */
  needsReply?: boolean;
  /** "Uncontacted" tab — chats where NO human has ever replied
   *  (lastHumanReplyAt IS NULL; bot greeting only). */
  uncontacted?: boolean;
  /** "Open" tab — the complement: chats where a human HAS replied at least once
   *  (lastHumanReplyAt IS NOT NULL). Open + Uncontacted partition every chat. */
  contacted?: boolean;
  /** "Unread" chip — literal WhatsApp unread (unreadCount>0): the rep hasn't
   *  opened the chat since the last inbound. Opening it clears the count. */
  unread?: boolean;
  /** "Due (N)" chip — only chats whose lead has an OPEN follow-up due/overdue now. */
  followUpDue?: boolean;
  /** "Archived" tab — show ONLY archived threads (status=ARCHIVED). When this
   *  and `blocked` are both unset, the default list EXCLUDES archived/blocked. */
  archived?: boolean;
  /** "Blocked" tab — show ONLY threads whose contact (Lead/Client) is blocked. */
  blocked?: boolean;
  /** Admin: filter to one agent's assigned conversations. */
  employeeId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
} = {}): Promise<ThreadListResponse> {
  // no-store: the inbox is live data. The shared apiFetch in-memory cache (10s
  // TTL) would otherwise let a reload/reconcile return a STALE list — e.g. a
  // chat that just got a human reply would linger in the "Uncontacted" tab
  // because the cached page still has awaitingReply=true. Always hit the DB.
  return apiFetch<ThreadListResponse>(`/whatsapp/threads${buildQuery(opts)}`, {
    cache: 'no-store',
  });
}

/**
 * Resolve a single lead's WhatsApp thread directly (by lead id, with a
 * server-side phone fallback) — regardless of how old it is. Backs the
 * lead/client-profile WhatsApp tab, which previously scanned only the most
 * recent inbox page and missed older conversations.
 */
export async function getThreadForLead(leadId: string): Promise<ThreadListItem | null> {
  const res = await apiFetch<{ item: ThreadListItem | null }>(`/whatsapp/threads/by-lead/${leadId}`, {
    cache: 'no-store',
  });
  return res.item ?? null;
}

/**
 * Send the CRM welcome/outreach TEMPLATE to a lead by lead id, from the
 * business number. The backend resolves-or-creates the WhatsApp thread for the
 * lead, sends the approved template, and returns the thread id — so the caller
 * can open the in-CRM chat. Use this for FIRST contact (no personal WhatsApp).
 */
export async function sendTemplateToLead(
  leadId: string,
  input?: { templateName?: string; language?: string; idempotencyKey?: string },
): Promise<{ threadId: string; message: ChatMessage | null }> {
  return apiFetch<{ threadId: string; message: ChatMessage | null }>(
    `/whatsapp/leads/${leadId}/send-template`,
    { method: 'POST', body: JSON.stringify(input ?? {}) },
  );
}

/**
 * Fetch a single thread in the exact list-row shape — used by the realtime
 * patch path to refresh just one row on a socket event instead of refetching
 * the whole list. Resolves to null when the thread no longer exists or is no
 * longer visible to the caller (the caller should then drop it from the list).
 */
export function getThreadListItem(threadId: string): Promise<ThreadListItem | null> {
  // no-store: this backs the realtime "patch one row" path. A cached row would
  // re-apply STALE state (e.g. awaitingReply=true after a reply already cleared
  // it), which is exactly what kept replied chats stuck in the Uncontacted tab.
  return apiFetch<{ item: ThreadListItem | null }>(
    `/whatsapp/threads/${threadId}/list-item`,
    { cache: 'no-store' },
  ).then((r) => r.item);
}

/**
 * Client-side mirror of the backend thread search (name / phone / waContactId,
 * case-insensitive; digit search needs ≥3 digits). Used by the realtime patch
 * path to decide whether a freshly-fetched row still belongs in the current
 * search results. Not authoritative — the periodic reconcile corrects any
 * edge case — but close enough to avoid a flash of an off-search row.
 */
export function threadMatchesSearch(item: ThreadListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const text = [
    item.lead?.firstName,
    item.lead?.lastName,
    item.client?.firstName,
    item.client?.lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (text.includes(q)) return true;
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3) {
    const phones = [item.lead?.phone, item.client?.phone, item.waContactId]
      .filter(Boolean)
      .join(' ')
      .replace(/\D/g, '');
    if (phones.includes(digits)) return true;
  }
  return false;
}

export interface ThreadStats {
  total: number;
  active: number;
  /** RESOLVED status — closed conversations. */
  resolved: number;
  unassigned: number;
  slaBreached: number;
  unread: number;
  /** "Unread" chip (funnel) — unread AND a human has replied (engaged only). A
   *  never-contacted lead stays in Uncontacted, not here. */
  unreadEngaged: number;
  /** "Pending" — conversations awaiting a human reply (bot replies don't count). */
  awaitingReply: number;
  /** "Uncontacted" — pending conversations where no human has ever replied. */
  uncontacted: number;
  /** "Due (N)" — chats whose lead has an OPEN follow-up due/overdue right now. */
  followUpDue: number;
  /** "Archived" — threads whose status is ARCHIVED. */
  archived: number;
  /** "Blocked" — threads whose contact (Lead/Client) is blocked. */
  blocked: number;
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
  // no-store: the tab-count badges (All / Open / Pending / Resolved) must
  // reflect the live DB. Without this they ride apiFetch's 10s GET cache, so
  // the count a realtime refresh fetches right after an agent replies can be
  // the stale pre-reply value — making "Pending" look stuck even though the
  // replied chat already left the queue. Counts are cheap; always fetch fresh.
  return apiFetch<ThreadStats>('/whatsapp/threads/stats', { cache: 'no-store' });
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

// ---- Block + Archive ----------------------------------------------------

/**
 * Block the thread's contact (Lead + Client) AND archive the thread in one
 * shot. Stamps blockedAt/blockedReason/blockedByUserId on BOTH the Lead and
 * Client behind the thread (whichever exist) and flips the thread to ARCHIVED.
 * Permission: whatsapp.block. Sales can block their OWN leads; admin any.
 */
export function blockContact(
  threadId: string,
  reason?: string,
): Promise<{ threadId: string; leadId: string | null; clientId: string | null; blocked: true }> {
  return apiFetch(`/whatsapp/threads/${threadId}/block`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

/**
 * Unblock the thread's contact — clears blockedAt/blockedReason/blockedByUserId
 * on the Lead + Client. Does NOT auto-unarchive the thread (use unarchiveThread
 * for that). Permission: whatsapp.block.
 */
export function unblockContact(
  threadId: string,
): Promise<{ threadId: string; blocked: false }> {
  return apiFetch(`/whatsapp/threads/${threadId}/unblock`, { method: 'POST' });
}

/** Archive a single thread (status=ARCHIVED). Permission: whatsapp.send_message. */
export function archiveThread(
  threadId: string,
): Promise<{ threadId: string; status: 'ARCHIVED' }> {
  return apiFetch(`/whatsapp/threads/${threadId}/archive`, { method: 'POST' });
}

/** Unarchive a thread back to OPEN. Permission: whatsapp.send_message. */
export function unarchiveThread(
  threadId: string,
): Promise<{ threadId: string; status: 'OPEN' }> {
  return apiFetch(`/whatsapp/threads/${threadId}/unarchive`, { method: 'POST' });
}

/**
 * Pin this chat to the top of MY inbox (personal, WhatsApp-style, capped at 6).
 * Idempotent. Any inbox member may pin their own chats.
 */
export function pinThread(
  threadId: string,
): Promise<{ threadId: string; pinned: true }> {
  return apiFetch(`/whatsapp/threads/${threadId}/pin`, { method: 'POST' });
}

/** Unpin this chat from MY inbox. Idempotent. */
export function unpinThread(
  threadId: string,
): Promise<{ threadId: string; pinned: false }> {
  return apiFetch(`/whatsapp/threads/${threadId}/pin`, { method: 'DELETE' });
}

/** A content-search hit: a thread row + the matched message snippet. */
export type MessageSearchResult = ThreadListItem & { searchSnippet: string };

/**
 * Content search — find chats by what was SAID (message text), not just the
 * contact name/phone. Returns matching threads with a snippet of the matched
 * message. Query must be >= 2 chars (server enforces; short queries return []).
 */
export function searchThreadMessages(
  q: string,
  limit = 30,
): Promise<{ items: MessageSearchResult[] }> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch(`/whatsapp/threads/search/messages?${params.toString()}`, { cache: 'no-store' });
}

export interface BlockedNumber {
  contactType: 'lead' | 'client';
  contactId: string;
  name: string;
  phone: string;
  blockedAt: string;
  blockedReason: string | null;
  blockedByName: string | null;
  /** The thread that backs this contact, so the admin screen can call
   *  unblockContact(threadId). Present when a thread exists for the number. */
  threadId?: string | null;
}

/**
 * Admin: list every currently-blocked contact (Lead + Client). Backs the
 * "Blocked numbers" admin screen. Permission: whatsapp.view_all_inboxes.
 */
export function listBlockedNumbers(): Promise<BlockedNumber[]> {
  // no-store: the list must reflect live block/unblock actions immediately,
  // not a cached snapshot from a prior visit.
  return apiFetch<BlockedNumber[]>('/whatsapp/blocked-numbers', { cache: 'no-store' });
}

export function getThread(threadId: string): Promise<ThreadDetail> {
  return apiFetch<ThreadDetail>(`/whatsapp/threads/${threadId}`);
}

export function markThreadRead(threadId: string): Promise<void> {
  return apiFetch<void>(`/whatsapp/threads/${threadId}/read`, { method: 'POST' });
}

export function listMessages(
  threadId: string,
  opts: { before?: Date; after?: Date } = {},
): Promise<ChatMessage[]> {
  // `before` → older page (history scroll-up). `after` → tail fetch of just
  // the messages newer than the cursor (used to append new arrivals to the
  // open chat without refetching the whole window).
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before.toISOString());
  if (opts.after) params.set('after', opts.after.toISOString());
  const q = params.toString();
  return apiFetch<ChatMessage[]>(`/whatsapp/threads/${threadId}/messages${q ? `?${q}` : ''}`);
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

/** React to a customer message with an emoji. `targetWaMessageId` is the Meta
 *  wa_message_id of the message being reacted to. */
export function sendReaction(
  threadId: string,
  targetWaMessageId: string,
  emoji: string,
  opts?: { idempotencyKey?: string },
): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/whatsapp/threads/${threadId}/messages/reaction`, {
    method: 'POST',
    body: JSON.stringify({ targetWaMessageId, emoji, ...opts }),
  });
}

/** Send a pin-drop location (name/address optional labels). */
export function sendLocation(
  threadId: string,
  input: { latitude: number; longitude: number; name?: string; address?: string; idempotencyKey?: string },
): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/whatsapp/threads/${threadId}/messages/location`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Send one or more contact cards ({name, phone}). */
export function sendContact(
  threadId: string,
  contacts: Array<{ name: string; phone: string }>,
  opts?: { idempotencyKey?: string },
): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/whatsapp/threads/${threadId}/messages/contact`, {
    method: 'POST',
    body: JSON.stringify({ contacts, ...opts }),
  });
}

/**
 * Proactively ask the customer to allow WhatsApp calls (Meta's call-permission
 * opt-in). Requires the 24-hour window to be open. On success the thread's
 * callPermissionStatus becomes PENDING and updates live via the
 * `whatsapp.call.permission` realtime event when the customer responds.
 */
export function requestCallPermission(threadId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/whatsapp/calls/permission`, {
    method: 'POST',
    body: JSON.stringify({ threadId }),
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

// ─── AI bot per-thread controls ─────────────────────────────────────────

export interface ThreadAiState {
  id: string;
  aiEnabled: boolean;
  aiDisabledAt: string | null;
  aiState: string;
}

/**
 * Flip the WhatsApp AI bot ON / OFF for a single thread. Off = the bot
 * stays silent on this thread regardless of the global bot mode. Useful
 * for sensitive conversations where the agent wants full control.
 */
export function toggleThreadAi(threadId: string, aiEnabled: boolean): Promise<ThreadAiState> {
  return apiFetch<ThreadAiState>(`/whatsapp/threads/${threadId}/ai-toggle`, {
    method: 'POST',
    body: JSON.stringify({ aiEnabled }),
  });
}

export interface PendingAppointmentRequest {
  id: string;
  leadId: string;
  threadId: string | null;
  rawText: string;
  preferredDay: string | null;
  preferredTime: string | null;
  modality: string | null;
  status: string;
  createdAt: string;
}

/** Bot-captured appointment intent waiting for sales to confirm on this thread. */
export function getThreadAppointmentRequests(threadId: string): Promise<PendingAppointmentRequest[]> {
  return apiFetch<PendingAppointmentRequest[]>(
    `/whatsapp/threads/${threadId}/appointment-requests`,
    { cache: 'no-store' },
  );
}

/**
 * One-click "Take over": disables AI on the thread, parks it in HANDED_OFF,
 * and reassigns the underlying Lead to the calling agent. Useful when a bot
 * conversation has gone sideways and the agent wants full ownership.
 */
export function takeOverThread(threadId: string): Promise<ThreadAiState> {
  return apiFetch<ThreadAiState>(`/whatsapp/threads/${threadId}/take-over`, {
    method: 'POST',
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
  // no-store: template approvals change server-side (Meta review + sync), so the
  // picker must always fetch the live list — never a cached one that could still
  // show only the old set (e.g. just hello_world before newer approvals synced).
  return apiFetch<WhatsAppTemplate[]>(`/whatsapp/channels/${channelId}/templates`, {
    cache: 'no-store',
  });
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
  /**
   * If set, the backend flips the linked AppointmentRequest row to
   * CONFIRMED and stores this appointment id on it — so the chat-panel
   * banner clears automatically. Passed through when booking from a
   * bot-captured request.
   */
  appointmentRequestId?: string;
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
