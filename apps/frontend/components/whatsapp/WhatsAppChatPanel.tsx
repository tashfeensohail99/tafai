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
      <div style={{ padding: 40, color: 'var(--sos-text-muted)', textAlign: 'center' }}>
        Loading conversation…
      </div>
    );
  }
  if (error && !thread) {
    return (
      <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>
        <AlertTriangle size={14} />
        <span>{error}</span>
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
        gridTemplateColumns: hideSidePanel ? '1fr' : 'minmax(0, 1fr) minmax(280px, 320px)',
        gap: 16,
        minHeight: 480,
      }}
    >
      <GlassCard
        variant="strong"
        padded={false}
        style={{ display: 'flex', flexDirection: 'column', minHeight: 480 }}
      >
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
        <div
          ref={scrollRef}
          className="sos-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '18px 18px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {messages.length === 0 ? (
            <div
              className="sos-text-muted"
              style={{ textAlign: 'center', padding: 32, fontSize: 'var(--sos-text-sm)' }}
            >
              No messages yet. The first message will appear here.
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
      </GlassCard>

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
        padding: '14px 18px',
        borderBottom: '1px solid var(--sos-border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div className="sos-avatar sos-avatar--lg">{initialsOf(props.displayName)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)' }}>
            {props.displayName}
          </div>
          <div className="sos-text-muted" style={{ fontSize: 'var(--sos-text-sm)' }}>
            {props.phone} · via {props.channelLabel}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <StatusBadge tone={props.withinWindow ? 'success' : 'warning'} size="sm" dot>
          {props.withinWindow ? '24h window open' : 'Template only'}
        </StatusBadge>
        {props.firstAgentReplyAt ? (
          <StatusBadge tone={props.slaBreached ? 'danger' : 'success'} size="sm">
            {props.slaBreached ? 'SLA breached' : 'SLA met'}
          </StatusBadge>
        ) : props.slaDeadlineAt ? (
          <StatusBadge tone={props.slaTone} size="sm">
            SLA {formatRelativeShort(props.slaDeadlineAt)}
          </StatusBadge>
        ) : null}
        {props.assignedTo && (
          <StatusBadge tone="violet" size="sm">
            {props.assignedTo.firstName} {props.assignedTo.lastName}
          </StatusBadge>
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
      }}
    >
      <div className={`sos-bubble ${isOut ? 'sos-bubble--out' : 'sos-bubble--in'}`}>
        {message.body ??
          (message.templateName
            ? `Template: ${message.templateName}`
            : `[${message.type.toLowerCase()}]`)}
      </div>
      <div
        className="sos-text-faint"
        style={{
          fontSize: 'var(--sos-text-xs)',
          marginTop: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <time>{formatTime(message.createdAt)}</time>
        {isOut && <StatusIcon status={message.status} errorTitle={message.errorTitle} />}
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
    <footer style={{ padding: 16, borderTop: '1px solid var(--sos-border-subtle)' }}>
      {props.disabled && (
        <div className="sos-banner sos-banner--warning" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} />
          <span>
            <strong>24-hour window expired.</strong>&nbsp; Free-form replies are blocked. Use an
            approved template message instead.
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <textarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.disabled ? 'Send a template message…' : 'Type a reply…'}
          disabled={props.disabled || props.sending}
          className="sos-textarea"
          style={{ flex: 1, minHeight: 60, resize: 'vertical' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !props.disabled && !props.sending) {
              e.preventDefault();
              props.onSend();
            }
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {props.disabled ? (
            <PrimaryButton
              type="button"
              onClick={props.onOpenTemplate}
              iconLeft={<FileText size={14} />}
            >
              Send template
            </PrimaryButton>
          ) : (
            <>
              <PrimaryButton
                type="button"
                onClick={props.onSend}
                disabled={!props.value.trim() || props.sending}
                iconRight={<Send size={14} />}
              >
                {props.sending ? 'Sending…' : 'Send'}
              </PrimaryButton>
              <GhostButton
                type="button"
                onClick={props.onOpenTemplate}
                size="sm"
                iconLeft={<FileText size={12} />}
              >
                Template
              </GhostButton>
            </>
          )}
        </div>
      </div>
    </footer>
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
