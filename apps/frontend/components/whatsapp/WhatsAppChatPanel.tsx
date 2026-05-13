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
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCheck,
  Clock4,
  FileText,
  Phone,
  Send,
  Sparkles,
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
import {
  getThread,
  listMessages,
  markThreadRead,
  sendText,
  type ChatMessage,
  type ThreadDetail,
  type WhatsAppMessageStatus,
} from '@/lib/whatsapp';
import { ConvertToClientModal } from './ConvertToClientModal';
import { BookAppointmentModal } from './BookAppointmentModal';
import { AddFollowUpModal } from './AddFollowUpModal';
import { TemplatePickerModal } from './TemplatePickerModal';

interface Props {
  threadId: string;
  /** Hide the right-hand profile + CTA panel when the tab variant already shows it. */
  hideSidePanel?: boolean;
  /** Called after a successful lead-to-client conversion. Parent typically routes to the client page. */
  onConverted?: (clientId: string) => void;
}

export function WhatsAppChatPanel({ threadId, hideSidePanel, onConverted }: Props) {
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

  const { socket } = useWhatsAppSocket();
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  if (loading && !thread) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--wa-chat-bg, #0b141a)',
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
          background: 'var(--wa-chat-bg, #0b141a)',
          padding: 24,
        }}
      >
        <div
          style={{
            background: '#7f1d1d',
            color: '#fca5a5',
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
        />
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
            background: 'var(--wa-chat-bg, #0b141a)',
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
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
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
    </div>
  );
}

// ---- Header -------------------------------------------------------------

const AVATAR_COLORS = ['#00a884', '#0099cc', '#9c27b0', '#e91e63', '#ff5722', '#607d8b'];
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
}) {
  return (
    <header
      style={{
        padding: '10px 16px',
        background: 'var(--wa-panel-header, #202c33)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderBottom: '1px solid var(--sos-border-subtle)',
        flexShrink: 0,
      }}
    >
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
            <span style={{ color: '#00a884', marginLeft: 8 }}>
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
              background: props.slaBreached ? '#7f1d1d' : props.slaTone === 'warning' ? '#78350f' : '#064e3b',
              color: props.slaBreached ? '#fca5a5' : props.slaTone === 'warning' ? '#fde68a' : '#6ee7b7',
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
              background: props.slaBreached ? '#7f1d1d' : '#064e3b',
              color: props.slaBreached ? '#fca5a5' : '#6ee7b7',
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
              background: '#78350f',
              color: '#fde68a',
            }}
          >
            Template only
          </span>
        )}
      </div>
    </header>
  );
}

// ---- Message bubble -----------------------------------------------------

function MessageBubble({ message }: { message: ChatMessage }) {
  const isOut = message.direction === 'OUTBOUND';
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
          background: isOut ? 'var(--wa-bubble-out, #005c4b)' : 'var(--wa-bubble-in, #202c33)',
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
            whiteSpace: 'pre-wrap',
          }}
        >
          {message.body ??
            (message.templateName
              ? `📋 Template: ${message.templateName}`
              : `[${message.type.toLowerCase()}]`)}
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
  onOpenTemplate: () => void;
  disabled: boolean;
  sending: boolean;
}) {
  return (
    <div
      style={{
        padding: '8px 12px',
        background: 'var(--wa-panel-header, #202c33)',
        borderTop: '1px solid var(--sos-border-subtle)',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 8,
        flexShrink: 0,
      }}
    >
      {/* Template button */}
      <button
        type="button"
        title="Send a template message"
        onClick={props.onOpenTemplate}
        style={{
          all: 'unset',
          cursor: 'pointer',
          color: props.disabled ? '#00a884' : 'var(--sos-text-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '50%',
          flexShrink: 0,
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
          background: 'var(--sos-surface-3, #2a3942)',
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

      {/* Send button */}
      <button
        type="button"
        onClick={props.onSend}
        disabled={props.disabled || props.sending || !props.value.trim()}
        title="Send"
        style={{
          all: 'unset',
          cursor: props.disabled || props.sending || !props.value.trim() ? 'not-allowed' : 'pointer',
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: props.disabled || !props.value.trim() ? '#374151' : '#00a884',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 0.2s',
        }}
      >
        <Send size={18} color="#fff" />
      </button>
    </div>
  );
}

// ---- Side panel (profile + CTAs) ----------------------------------------

function SidePanel({
  thread,
  onConvert,
  onBook,
  onFollowUp,
}: {
  thread: ThreadDetail;
  onConvert: () => void;
  onBook: () => void;
  onFollowUp: () => void;
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
