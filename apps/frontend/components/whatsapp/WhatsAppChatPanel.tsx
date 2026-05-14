'use client';

/**
 * The WhatsApp chat panel — the single piece of UI that powers both:
 *   1. The "WhatsApp Chat" tab on the lead/client detail page.
 *   2. The standalone /sales/inbox conversation view.
 *
 * Responsibilities owned here:
 *   - fetch thread + messages, refresh on realtime events
 *   - composer + send, enforce 24h customer-service window in UI
 *   - per-message status ticks (sent/delivered/read/failed)
 *   - side-panel CTAs: Convert to Client, Book Appointment, Add Follow-up
 *
 * Parent decides which `threadId` to render. Modals are mounted here so
 * each chat carries its own modal state.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCheck,
  Clock4,
  Download,
  FileText,
  Mic,
  Phone,
  PhoneCall,
  Send,
  Sparkles,
  Square,
  UserCog,
  UserPlus,
  X,
} from 'lucide-react';
import {
  GhostButton,
  GlassCard,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  type BadgeTone,
} from '@/components/sales-v2/ui';
import { useWhatsAppSocket } from '@/lib/whatsapp-realtime';
import { getAccessToken } from '@/lib/auth-client';
import {
  getThread,
  listMessages,
  markThreadRead,
  sendMediaMessage,
  sendText,
  type ChatMessage,
  type ThreadDetail,
  type WhatsAppMessageStatus,
} from '@/lib/whatsapp';
import { ConvertToClientModal } from './ConvertToClientModal';
import { BookAppointmentModal } from './BookAppointmentModal';
import { AddFollowUpModal } from './AddFollowUpModal';
import { EditLeadModal } from './EditLeadModal';
import { TemplatePickerModal } from './TemplatePickerModal';

interface Props {
  threadId: string;
  /** Hide the right-hand profile + CTA panel when the tab variant already shows it. */
  hideSidePanel?: boolean;
  /** Called after a successful lead-to-client conversion. Parent typically routes to the client page. */
  onConverted?: (clientId: string) => void;
  /** Mobile: show a back arrow in the chat header to return to the conversation list. */
  onBack?: () => void;
}

export function WhatsAppChatPanel({ threadId, hideSidePanel, onConverted, onBack }: Props) {
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editLeadOpen, setEditLeadOpen] = useState(false);

  const { socket } = useWhatsAppSocket();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, m] = await Promise.all([getThread(threadId), listMessages(threadId)]);
      setThread(t);
      setMessages(m);
      markThreadRead(threadId).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Realtime: refresh on inbound, patch status in place.
  useEffect(() => {
    if (!socket) return;
    const onMessageNew = (evt: { threadId: string }) => {
      if (evt.threadId === threadId) void reload();
    };
    const onStatus = (evt: { threadId: string; messageId: string; status: WhatsAppMessageStatus }) => {
      if (evt.threadId !== threadId) return;
      setMessages((curr) =>
        curr.map((m) => (m.id === evt.messageId ? { ...m, status: evt.status } : m)),
      );
    };
    socket.on('whatsapp.message.new', onMessageNew);
    socket.on('whatsapp.message.status', onStatus);
    return () => {
      socket.off('whatsapp.message.new', onMessageNew);
      socket.off('whatsapp.message.status', onStatus);
    };
  }, [socket, threadId, reload]);

  // Auto-scroll to latest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const withinWindow = useMemo(() => {
    if (!thread?.windowExpiresAt) return false;
    return new Date(thread.windowExpiresAt).getTime() > Date.now();
  }, [thread?.windowExpiresAt]);

  const slaTone = useMemo<BadgeTone>(() => {
    if (!thread?.slaDeadlineAt) return 'neutral';
    if (thread.firstAgentReplyAt) return thread.slaBreached ? 'danger' : 'success';
    const remaining = new Date(thread.slaDeadlineAt).getTime() - Date.now();
    if (remaining < 0) return 'danger';
    if (remaining < 30_000) return 'warning';
    return 'info';
  }, [thread?.slaDeadlineAt, thread?.firstAgentReplyAt, thread?.slaBreached]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !thread) return;
    setSending(true);
    try {
      const msg = await sendText(thread.id, body);
      setMessages((curr) => [...curr, msg]);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleSendVoice = async (blob: Blob, mimeType: string) => {
    if (!thread) return;
    setSending(true);
    try {
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
      const msg = await sendMediaMessage(thread.id, blob, `voice-note.${ext}`);
      setMessages((curr) => [...curr, msg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send voice message');
    } finally {
      setSending(false);
    }
  };

  if (loading && !thread) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--wa-chat-bg)',
          color: 'var(--sos-text-muted)',
          fontSize: 14,
        }}
      >
        Loading conversation…
      </div>
    );
  }
  if (error && !thread) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--wa-chat-bg)',
          padding: 24,
        }}
      >
        <div
          style={{
            background: 'var(--sos-status-danger-soft)',
            color: 'var(--sos-status-danger)',
            borderRadius: 8,
            padding: '10px 16px',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertTriangle size={14} />
          {error}
        </div>
      </div>
    );
  }
  if (!thread) return null;

  const displayName =
    thread.client?.firstName || thread.client?.lastName
      ? `${thread.client.firstName} ${thread.client.lastName}`.trim()
      : thread.lead
        ? `${thread.lead.firstName} ${thread.lead.lastName}`.trim()
        : thread.waContactId;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: hideSidePanel ? '1fr' : 'minmax(0, 1fr) 300px',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* ── Chat window ── */}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <ChatHeader
          displayName={displayName}
          phone={thread.lead?.phone ?? thread.client?.phone ?? thread.waContactId}
          channelLabel={thread.channel.label}
          withinWindow={withinWindow}
          slaTone={slaTone}
          slaDeadlineAt={thread.slaDeadlineAt}
          firstAgentReplyAt={thread.firstAgentReplyAt}
          slaBreached={thread.slaBreached}
          assignedTo={thread.lead?.assignedEmployee ?? null}
          onBack={onBack}
        />
        {/* Quick actions strip — visible only when there's no right sidebar
            (i.e. on the inbox view). Lead-detail tab variant has its own
            sidebar with the same actions, so we skip the duplicate there. */}
        {hideSidePanel ? (
          <QuickActionsBar
            isLead={!thread.client && !!thread.lead}
            canConvertToLead={!thread.leadId && !thread.clientId}
            canEditLead={!!thread.lead && !thread.client}
            onConvertToLead={() => {
              // Prefill the Create Lead wizard with the contact's phone and
              // the source thread so the new Lead links back to this chat.
              const phone = thread.lead?.phone ?? thread.client?.phone ?? thread.waContactId;
              const qs = new URLSearchParams({
                phone,
                threadId: thread.id,
                source: 'WHATSAPP',
              }).toString();
              router.push(`/sales/create-lead?${qs}` as Route);
            }}
            onEditLead={() => setEditLeadOpen(true)}
            onBook={() => setBookOpen(true)}
            onFollowUp={() => setFollowUpOpen(true)}
          />
        ) : null}
        {/* Messages */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '12px 5%',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            background: 'var(--wa-chat-bg)',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.02'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        >
          {messages.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--sos-text-muted)',
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              No messages yet
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
        </div>
        {/* Inline error banner — shown whenever a send (text or voice)
            fails after the thread has already loaded. Without this
            banner, sendError silently fell into state and the user saw
            "nothing happened" when a voice note was rejected by Meta. */}
        {error && thread ? (
          <div
            role="alert"
            style={{
              padding: '8px 14px',
              background: 'var(--sos-status-danger-soft)',
              color: 'var(--sos-status-danger)',
              borderTop: '1px solid var(--sos-status-danger-border, rgba(229,62,62,0.35))',
              fontSize: 12.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss"
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: 2,
                color: 'inherit',
                opacity: 0.8,
              }}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
          onSendVoice={handleSendVoice}
          onOpenTemplate={() => setTemplateOpen(true)}
          disabled={!withinWindow}
          sending={sending}
        />
      </div>

      {/* ── Side panel (profile + CTAs) ── */}
      {!hideSidePanel && (
        <SidePanel
          thread={thread}
          onConvert={() => setConvertOpen(true)}
          onBook={() => setBookOpen(true)}
          onFollowUp={() => setFollowUpOpen(true)}
          onEditLead={() => setEditLeadOpen(true)}
        />
      )}

      <ConvertToClientModal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        lead={
          thread.lead && !thread.lead.convertedClientId
            ? {
                id: thread.lead.id,
                firstName: thread.lead.firstName,
                lastName: thread.lead.lastName,
                phone: thread.lead.phone,
                email: thread.lead.email,
                nationality: thread.lead.nationality,
              }
            : null
        }
        onConverted={(clientId) => {
          setConvertOpen(false);
          onConverted?.(clientId);
          void reload();
        }}
      />
      <BookAppointmentModal
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        leadId={thread.leadId ?? null}
        clientId={thread.clientId ?? null}
        defaultAssigneeId={thread.lead?.assignedEmployeeId ?? null}
        onBooked={() => {
          setBookOpen(false);
          void reload();
        }}
      />
      <AddFollowUpModal
        open={followUpOpen}
        onClose={() => setFollowUpOpen(false)}
        leadId={thread.leadId}
        defaultAssigneeId={thread.lead?.assignedEmployeeId ?? null}
        onCreated={() => {
          setFollowUpOpen(false);
          void reload();
        }}
      />
      <TemplatePickerModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        threadId={thread.id}
        channelId={thread.channelId}
        onSent={() => {
          setTemplateOpen(false);
          void reload();
        }}
      />
      <EditLeadModal
        open={editLeadOpen}
        onClose={() => setEditLeadOpen(false)}
        lead={
          thread.lead
            ? {
                id: thread.lead.id,
                firstName: thread.lead.firstName,
                lastName: thread.lead.lastName,
                phone: thread.lead.phone,
                email: thread.lead.email ?? undefined,
                targetCountry: thread.lead.targetCountry ?? undefined,
                // ThreadDetail.lead doesn't carry serviceInterest, so it
                // starts empty in the modal — the agent can still set
                // it from the chat for the first time if needed.
                service: undefined,
              }
            : null
        }
        onSaved={() => {
          setEditLeadOpen(false);
          void reload();
        }}
      />
    </div>
  );
}

// ---- Header -------------------------------------------------------------

const AVATAR_COLORS = ['var(--wa-accent)', '#0099cc', '#9c27b0', '#e91e63', '#ff5722', '#607d8b'];
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

function ChatHeader(props: {
  displayName: string;
  phone: string;
  channelLabel: string;
  withinWindow: boolean;
  slaTone: BadgeTone;
  slaDeadlineAt: string | null;
  firstAgentReplyAt: string | null;
  slaBreached: boolean;
  assignedTo: { firstName: string; lastName: string } | null;
  onBack?: () => void;
}) {
  return (
    <header
      style={{
        padding: '10px 16px',
        background: 'var(--wa-panel-header)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderBottom: '1px solid var(--sos-border-subtle)',
        flexShrink: 0,
      }}
    >
      {props.onBack ? (
        <button
          type="button"
          onClick={props.onBack}
          aria-label="Back to conversation list"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'transparent',
            color: 'var(--sos-text-secondary)',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          className="wa-back-btn"
        >
          <ArrowLeft size={18} />
        </button>
      ) : null}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: avatarColor(props.displayName),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 15,
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {initialsOf(props.displayName)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--sos-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {props.displayName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', marginTop: 1 }}>
          {props.phone}
          {props.assignedTo && (
            <span style={{ color: 'var(--wa-accent)', marginLeft: 8 }}>
              · {props.assignedTo.firstName}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {props.slaDeadlineAt && !props.firstAgentReplyAt && (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 10,
              fontWeight: 600,
              background: props.slaBreached ? 'var(--sos-status-danger-soft)' : props.slaTone === 'warning' ? 'var(--sos-status-warning-soft)' : 'var(--sos-status-success-soft)',
              color: props.slaBreached ? 'var(--sos-status-danger)' : props.slaTone === 'warning' ? 'var(--sos-status-warning)' : 'var(--sos-status-success)',
            }}
          >
            SLA {formatRelativeShort(props.slaDeadlineAt)}
          </span>
        )}
        {props.firstAgentReplyAt && (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 10,
              fontWeight: 600,
              background: props.slaBreached ? 'var(--sos-status-danger-soft)' : 'var(--sos-status-success-soft)',
              color: props.slaBreached ? 'var(--sos-status-danger)' : 'var(--sos-status-success)',
            }}
          >
            {props.slaBreached ? 'SLA breached' : 'SLA met'}
          </span>
        )}
        {!props.withinWindow && (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 10,
              fontWeight: 600,
              background: 'var(--sos-status-warning-soft)',
              color: 'var(--sos-status-warning)',
            }}
          >
            Template only
          </span>
        )}
      </div>
    </header>
  );
}

// ---- Quick actions strip ------------------------------------------------

/**
 * Compact horizontal CTA bar shown right under the chat header on the
 * inbox view (where the right-hand sidebar is hidden).
 *
 * Important domain rule (see memory/domain_entities.md):
 * A contact stays a Lead until Finance verifies payment and sends the case
 * to Processing — that's the only path that creates a Client. Sales agents
 * never "convert to client" manually from the chat. The quick actions a
 * sales agent needs in the conversation are:
 *   - Book appointment
 *   - Add follow-up
 *
 * Once a payment is recorded, the conversion happens automatically inside
 * ProcessingService.createFromHandover (already wired). After conversion
 * the contact shows on the chat as a Client; this bar still shows Book +
 * Add follow-up so the relationship stays productive.
 */
function QuickActionsBar({
  isLead,
  canConvertToLead,
  canEditLead,
  onConvertToLead,
  onEditLead,
  onBook,
  onFollowUp,
}: {
  isLead: boolean;
  canConvertToLead: boolean;
  canEditLead: boolean;
  onConvertToLead: () => void;
  onEditLead: () => void;
  onBook: () => void;
  onFollowUp: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '8px 16px',
        background: 'var(--wa-panel-header)',
        borderBottom: '1px solid var(--sos-border-subtle)',
        flexShrink: 0,
        overflowX: 'auto',
      }}
      className="sos-scroll"
    >
      {/* Convert-to-Lead is the primary action when this is a raw
          WhatsApp contact not yet in the pipeline. Once they're a Lead
          this button hides and Book/Follow-up become primary. */}
      {canConvertToLead ? (
        <button
          type="button"
          onClick={onConvertToLead}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 999,
            border: 'none',
            background: 'var(--sos-brand-gradient)',
            color: 'var(--sos-text-on-accent)',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            boxShadow: 'var(--sos-shadow-glow)',
          }}
        >
          <UserPlus size={13} />
          Convert to Lead
        </button>
      ) : null}
      <button
        type="button"
        onClick={onBook}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 14px',
          borderRadius: 999,
          border: canConvertToLead ? '1px solid var(--sos-border-strong)' : 'none',
          background: canConvertToLead ? 'var(--sos-surface-1)' : 'var(--sos-brand-gradient)',
          color: canConvertToLead ? 'var(--sos-text-primary)' : 'var(--sos-text-on-accent)',
          fontSize: 12.5,
          fontWeight: canConvertToLead ? 600 : 700,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: canConvertToLead ? 'none' : 'var(--sos-shadow-glow)',
        }}
      >
        <CalendarClock size={13} />
        Book appointment
      </button>
      {isLead ? (
        <button
          type="button"
          onClick={onFollowUp}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 999,
            border: '1px solid var(--sos-border-strong)',
            background: 'var(--sos-surface-1)',
            color: 'var(--sos-text-primary)',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <PhoneCall size={13} />
          Add follow-up
        </button>
      ) : null}
      {/* Edit lead — only shown once the contact is a tracked Lead.
          Opens the same EditLeadModal used on the lead profile page,
          prefilled with the lead's current details. Lets sales correct
          a misspelled name or swap a phone number without leaving the
          chat. Clients (post-conversion) are read-only here on purpose
          — finance/processing own the client record at that point. */}
      {canEditLead ? (
        <button
          type="button"
          onClick={onEditLead}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 999,
            border: '1px solid var(--sos-border-strong)',
            background: 'var(--sos-surface-1)',
            color: 'var(--sos-text-primary)',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <UserCog size={13} />
          Edit lead
        </button>
      ) : null}
    </div>
  );
}

// ---- Message bubble -----------------------------------------------------

/** Fetch media binary from the backend proxy and return a blob URL. */
function useMediaBlobUrl(threadId: string, messageId: string, enabled: boolean): {
  blobUrl: string | null;
  loading: boolean;
  error: boolean;
} {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    setError(false);
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const token = getAccessToken();
    fetch(`${apiBase}/whatsapp/threads/${threadId}/messages/${messageId}/media`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setBlobUrl(url);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));

    return () => {
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, messageId]);

  return { blobUrl, loading, error };
}

/** Renders image / audio / video / document media inside a message bubble. */
function MediaBubbleContent({ message }: { message: ChatMessage }) {
  type AnyPayload = Record<string, { id?: string; filename?: string }>;
  const p = message.payload as AnyPayload | null;
  const typeKey = message.type.toLowerCase() as 'image' | 'audio' | 'video' | 'document';
  // Inbound: media ID lives in payload.audio.id etc.
  // Outbound (voice notes we sent): media ID lives in mediaUrl as "meta:<id>", payload is null.
  const hasMedia = !!(p?.[typeKey]?.id) || !!(message.mediaUrl);

  const { blobUrl, loading, error } = useMediaBlobUrl(
    message.threadId,
    message.id,
    hasMedia,
  );

  const filename = p?.[typeKey]?.filename ?? `${typeKey}`;

  if (!hasMedia) {
    return (
      <span style={{ fontStyle: 'italic', color: 'var(--sos-text-faint)' }}>
        [{message.type.toLowerCase()}]
      </span>
    );
  }

  if (loading) {
    return (
      <span style={{ fontSize: 13, color: 'var(--sos-text-faint)', fontStyle: 'italic' }}>
        Loading {typeKey}…
      </span>
    );
  }

  if (error || !blobUrl) {
    return (
      <span style={{ fontSize: 13, color: 'var(--sos-status-danger)', fontStyle: 'italic' }}>
        Media unavailable
      </span>
    );
  }

  if (message.type === 'IMAGE') {
    return (
      <img
        src={blobUrl}
        alt="Image"
        style={{
          maxWidth: '100%',
          maxHeight: 280,
          borderRadius: 6,
          display: 'block',
          cursor: 'pointer',
        }}
        onClick={() => window.open(blobUrl, '_blank')}
      />
    );
  }

  if (message.type === 'AUDIO') {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <audio
        controls
        src={blobUrl}
        style={{ width: '100%', minWidth: 200, maxWidth: 320 }}
      />
    );
  }

  // VIDEO and DOCUMENT — download to device.
  return (
    <a
      href={blobUrl}
      download={filename}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 6,
        background: 'var(--wa-bubble-out)',
        color: 'var(--sos-text-primary)',
        textDecoration: 'none',
        fontSize: 13,
        fontWeight: 500,
        border: '1px solid var(--sos-border)',
      }}
    >
      <Download size={14} />
      {message.type === 'VIDEO' ? 'Download video' : filename}
    </a>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isOut = message.direction === 'OUTBOUND';
  const isMedia = ['IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT'].includes(message.type);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isOut ? 'flex-end' : 'flex-start',
        marginBottom: 2,
      }}
    >
      <div
        style={{
          maxWidth: '65%',
          minWidth: 80,
          padding: '6px 10px 4px',
          borderRadius: isOut ? '8px 0 8px 8px' : '0 8px 8px 8px',
          background: isOut ? 'var(--wa-bubble-out)' : 'var(--wa-bubble-in)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
          position: 'relative',
        }}
      >
        <div
          style={{
            fontSize: 14,
            color: 'var(--sos-text-primary)',
            lineHeight: '1.5',
            wordBreak: 'break-word',
            whiteSpace: isMedia ? 'normal' : 'pre-wrap',
          }}
        >
          {isMedia ? (
            <MediaBubbleContent message={message} />
          ) : (
            message.body ??
              (message.templateName
                ? `📋 Template: ${message.templateName}`
                : `[${message.type.toLowerCase()}]`)
          )}
          {/* Caption below media if present */}
          {isMedia && message.body && (
            <div style={{ marginTop: 4, fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {message.body}
            </div>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 3,
            marginTop: 3,
          }}
        >
          <time style={{ fontSize: 11, color: 'var(--sos-text-faint)', lineHeight: 1 }}>
            {formatTime(message.createdAt)}
          </time>
          {isOut && <StatusIcon status={message.status} errorTitle={message.errorTitle} />}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({
  status,
  errorTitle,
}: {
  status: WhatsAppMessageStatus;
  errorTitle: string | null;
}) {
  if (status === 'FAILED') {
    return (
      <span title={errorTitle ?? 'Failed'} style={{ color: 'var(--sos-status-danger)' }}>
        <X size={12} />
      </span>
    );
  }
  if (status === 'QUEUED' || status === 'SENDING') {
    return (
      <span title="Sending" style={{ color: 'var(--sos-text-faint)' }}>
        <Clock4 size={12} />
      </span>
    );
  }
  if (status === 'READ') {
    return (
      <span title="Read" style={{ color: 'var(--sos-brand-primary)' }}>
        <CheckCheck size={12} />
      </span>
    );
  }
  if (status === 'DELIVERED') {
    return (
      <span title="Delivered" style={{ color: 'var(--sos-text-muted)' }}>
        <CheckCheck size={12} />
      </span>
    );
  }
  return (
    <span title="Sent" style={{ color: 'var(--sos-text-muted)' }}>
      <Check size={12} />
    </span>
  );
}

// ---- Composer -----------------------------------------------------------

function ChatComposer(props: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
  onOpenTemplate: () => void;
  disabled: boolean;
  sending: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = async () => {
    if (props.disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Prefer ogg/opus for WhatsApp compatibility; fall back to webm
      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        props.onSendVoice(blob, mr.mimeType);
        setRecording(false);
        setRecordingSecs(0);
      };
      mr.start(250); // collect chunks every 250ms
      mediaRecorderRef.current = mr;
      setRecording(true);
      setRecordingSecs(0);
      timerRef.current = setInterval(() => setRecordingSecs((s) => s + 1), 1000);
    } catch {
      alert('Microphone access denied. Allow microphone in your browser settings.');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRecorderRef.current?.stop();
  };

  const cancelRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const mr = mediaRecorderRef.current;
    if (mr) {
      mr.onstop = null; // prevent send
      mr.stream?.getTracks().forEach((t) => t.stop());
      try { mr.stop(); } catch { /* ignore */ }
      mediaRecorderRef.current = null;
    }
    setRecording(false);
    setRecordingSecs(0);
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div
      style={{
        padding: '8px 12px',
        background: 'var(--wa-panel-header)',
        borderTop: '1px solid var(--sos-border-subtle)',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 8,
        flexShrink: 0,
      }}
    >
      {recording ? (
        /* ── Recording mode ── */
        <>
          {/* Cancel */}
          <button
            type="button"
            title="Cancel recording"
            onClick={cancelRecording}
            style={{
              all: 'unset', cursor: 'pointer', color: 'var(--sos-text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            }}
          >
            <X size={20} />
          </button>
          {/* Timer */}
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 10,
            color: 'var(--sos-text-primary)', fontSize: 14,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#e53e3e', flexShrink: 0,
              animation: 'pulse 1s ease-in-out infinite',
            }} />
            <span>{fmtTime(recordingSecs)}</span>
            <span style={{ color: 'var(--sos-text-muted)', fontSize: 12 }}>Recording…</span>
          </div>
          {/* Stop + send */}
          <button
            type="button"
            title="Stop and send"
            onClick={stopRecording}
            style={{
              all: 'unset', cursor: 'pointer',
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--wa-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Square size={16} color="#fff" fill="#fff" />
          </button>
        </>
      ) : (
        /* ── Normal compose mode ── */
        <>
          {/* Template button */}
          <button
            type="button"
            title="Send a template message"
            onClick={props.onOpenTemplate}
            style={{
              all: 'unset', cursor: 'pointer',
              color: props.disabled ? 'var(--wa-accent)' : 'var(--sos-text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <FileText size={20} />
          </button>

          {/* Text input */}
          <textarea
            disabled={props.disabled}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!props.sending && props.value.trim()) props.onSend();
              }
            }}
            placeholder={props.disabled ? 'Window closed — use template to reopen' : 'Type a message'}
            rows={1}
            style={{
              flex: 1,
              background: 'var(--wa-composer-input-bg)',
              color: 'var(--sos-text-primary)',
              border: 'none',
              borderRadius: 8,
              padding: '9px 12px',
              fontSize: 14,
              lineHeight: '1.5',
              resize: 'none',
              outline: 'none',
              maxHeight: 120,
              fontFamily: 'inherit',
              opacity: props.disabled ? 0.5 : 1,
            }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />

          {/* Send or Mic button */}
          {props.value.trim() ? (
            <button
              type="button"
              onClick={props.onSend}
              disabled={props.disabled || props.sending}
              title="Send"
              style={{
                all: 'unset',
                cursor: props.disabled || props.sending ? 'not-allowed' : 'pointer',
                width: 40, height: 40, borderRadius: '50%',
                background: props.disabled ? 'var(--sos-surface-3)' : 'var(--wa-accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'background 0.2s',
              }}
            >
              <Send size={18} color="#fff" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={props.disabled || props.sending}
              title="Record voice message"
              style={{
                all: 'unset',
                cursor: props.disabled || props.sending ? 'not-allowed' : 'pointer',
                width: 40, height: 40, borderRadius: '50%',
                background: props.disabled ? 'var(--sos-surface-3)' : 'var(--wa-accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'background 0.2s',
              }}
            >
              <Mic size={18} color="#fff" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---- Side panel (profile + CTAs) ----------------------------------------

function SidePanel({
  thread,
  onConvert,
  onBook,
  onFollowUp,
  onEditLead,
}: {
  thread: ThreadDetail;
  onConvert: () => void;
  onBook: () => void;
  onFollowUp: () => void;
  onEditLead: () => void;
}) {
  const isLead = !thread.client && !!thread.lead;
  const isClient = !!thread.client;
  const lead = thread.lead;
  const client = thread.client;

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <GlassCard variant="default" padded="md">
        <div className="sos-eyebrow">{isClient ? 'Client' : 'Lead'}</div>
        <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)', marginTop: 4 }}>
          {(client?.firstName ?? lead?.firstName ?? '')}{' '}
          {(client?.lastName ?? lead?.lastName ?? '')}
        </div>
        <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)', marginTop: 6 }}>
          {client?.phone ?? lead?.phone ?? thread.waContactId}
        </div>
        {(client?.email ?? lead?.email) && (
          <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)', marginTop: 2 }}>
            {client?.email ?? lead?.email}
          </div>
        )}
        {(client?.nationality ?? lead?.nationality) && (
          <div style={{ marginTop: 10 }}>
            <StatusBadge tone="info" size="sm">
              {client?.nationality ?? lead?.nationality}
            </StatusBadge>
          </div>
        )}
        {lead?.targetCountry && !isClient && (
          <div style={{ marginTop: 6 }}>
            <StatusBadge tone="cyan" size="sm">Target: {lead.targetCountry}</StatusBadge>
          </div>
        )}
      </GlassCard>

      <GlassCard variant="default" padded="md">
        <div className="sos-eyebrow">Quick actions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {isLead && (
            <PrimaryButton onClick={onConvert} iconLeft={<UserPlus size={14} />} fullWidth>
              Convert to client
            </PrimaryButton>
          )}
          <SecondaryButton onClick={onBook} iconLeft={<CalendarClock size={14} />} fullWidth>
            Book appointment
          </SecondaryButton>
          {isLead && lead && (
            <SecondaryButton onClick={onFollowUp} iconLeft={<Phone size={14} />} fullWidth>
              Add follow-up
            </SecondaryButton>
          )}
          {isLead && lead && (
            <SecondaryButton onClick={onEditLead} iconLeft={<UserCog size={14} />} fullWidth>
              Edit lead details
            </SecondaryButton>
          )}
        </div>
      </GlassCard>

      <GlassCard variant="soft" padded="md">
        <div className="sos-eyebrow">Routing</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {lead?.assignedEmployee ? (
            <div className="sos-text-secondary" style={{ fontSize: 'var(--sos-text-sm)' }}>
              Assigned: <strong>{lead.assignedEmployee.firstName} {lead.assignedEmployee.lastName}</strong>
            </div>
          ) : (
            <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>
              Awaiting assignment
            </div>
          )}
          {lead?.preferredEmployeeId && (
            <GhostButton size="sm" iconLeft={<Sparkles size={12} />}>
              Sticky to preferred agent
            </GhostButton>
          )}
        </div>
      </GlassCard>
    </aside>
  );
}

// ---- helpers ------------------------------------------------------------

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeShort(iso: string, now = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const sec = Math.round(abs / 1000);
  const past = diff < 0;
  if (sec < 60) return past ? `${sec}s ago` : `in ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return past ? `${min}m ago` : `in ${min}m`;
  const hr = Math.round(min / 60);
  return past ? `${hr}h ago` : `in ${hr}h`;
}
