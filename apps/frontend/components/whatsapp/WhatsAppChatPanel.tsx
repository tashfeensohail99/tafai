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
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  Clock4,
  Copy,
  Download,
  Info,
  Smile,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Mic,
  MapPin,
  Camera,
  Phone,
  PhoneOutgoing,
  Plus,
  Reply,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  User,
  UserCog,
  UserPlus,
  Video as VideoIcon,
  X,
  Zap,
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
  requestCallPermission,
  listMessages,
  markThreadRead,
  sendMediaMessage,
  sendText,
  type AdReferral,
  type ChatMessage,
  type ThreadDetail,
  type WhatsAppMessageStatus,
} from '@/lib/whatsapp';
import { ConvertToClientModal } from './ConvertToClientModal';
import { CsvLeadBadge } from '@/components/shared/CsvLeadBadge';
import { BookAppointmentModal, type AppointmentPrefill } from './BookAppointmentModal';
import { AddFollowUpModal } from './AddFollowUpModal';
import { EditLeadModal } from './EditLeadModal';
import { TemplatePickerModal } from './TemplatePickerModal';
import { QuickReplyPicker } from './QuickReplyPicker';
import { fillQuickReply } from '@/lib/quick-replies';
import { AiBotStrip } from './AiBotStrip';

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
  // Live mirror of `messages` so the realtime handler can read the latest
  // list (to compute the tail cursor) without re-subscribing on every change.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  // Pagination state for "Load older messages" — backend pages 50 at a time
  // (max 200) via the ?before=<oldest> cursor.
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  // When sales clicks "Book now" on a bot-captured AppointmentRequest banner,
  // we stash the request data here so the modal opens pre-filled (day, time,
  // modality + the customer's raw words in notes). null = manual open, no
  // bot context. Cleared on close.
  const [bookPrefill, setBookPrefill] = useState<AppointmentPrefill | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const [editLeadOpen, setEditLeadOpen] = useState(false);
  // Fullscreen image viewer ("lightbox"). Holds the blob URL of the image
  // the user just clicked; null = closed. Escape / click-backdrop closes.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Drag-drop: counter (not bool) so nested children's dragenter/leave pairs
  // don't make the overlay flicker — only hide when the counter returns to 0.
  const dragCounterRef = useRef(0);
  const [dragHover, setDragHover] = useState(false);
  // Media preview modal — picked from + menu or dropped on the chat. The user
  // can add a caption before the actual upload kicks off. Cleared to null on
  // send-or-cancel; the blob URL is revoked so the browser doesn't hold the
  // file in memory after the modal closes.
  const [pendingMedia, setPendingMedia] = useState<{
    file: File;
    previewUrl: string;
    kind: 'image' | 'video' | 'document';
  } | null>(null);
  // Reply-to: the message currently being quoted by the composer. Cleared
  // after a successful send or when the user clicks the X on the quote bar.
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  // Camera capture modal — opened from the + menu's Camera item. Closes
  // after the user picks a captured photo, which is then handed off to the
  // standard handlePickMedia → caption-modal → send flow.
  const [cameraOpen, setCameraOpen] = useState(false);

  const { socket } = useWhatsAppSocket();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Used by loadOlder() to skip the auto-scroll-to-bottom on prepend and
  // restore the visible scroll position after the older messages land.
  const prependingRef = useRef(false);
  const preservedScrollRef = useRef<{ height: number; top: number } | null>(null);
  const router = useRouter();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, m] = await Promise.all([getThread(threadId), listMessages(threadId)]);
      setThread(t);
      setMessages(m);
      // Backend page size is 50 — if we got a full page back, older ones may
      // exist; if we got fewer, we already have the whole thread.
      setHasMore(m.length >= 50);
      markThreadRead(threadId).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  // Fetch the next page of OLDER messages (uses the ?before=<oldest> cursor)
  // and prepend them. The auto-scroll effect detects the prependingRef flag
  // and preserves the visible position so the user stays where they were.
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      const before = new Date(oldest.createdAt);
      if (scrollRef.current) {
        preservedScrollRef.current = {
          height: scrollRef.current.scrollHeight,
          top: scrollRef.current.scrollTop,
        };
        prependingRef.current = true;
      }
      const older = await listMessages(threadId, { before });
      setMessages((curr) => [...older, ...curr]);
      if (older.length < 50) setHasMore(false);
    } catch {
      // Best-effort — leave the button visible so the user can retry.
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, hasMore, messages, threadId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Infinite scroll: when the user scrolls within ~80px of the top of the
  // message list, automatically fetch the next page of older messages.
  // Same feel as WhatsApp Web — no button to click.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop < 80 && hasMore && !loadingOlder) {
        void loadOlder();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore, loadingOlder, loadOlder]);

  // Realtime: APPEND just-arrived messages instead of refetching the whole
  // window — this is what makes an incoming message pop into the open chat
  // instantly, WhatsApp-style, rather than after a 1.5s full reload. The
  // message.new event is id-only, so we tail-fetch everything newer than our
  // latest REAL message (skipping optimistic temp- bubbles) and splice in
  // what's not already shown. A 300ms coalesce batches bursts; any error
  // falls back to a full reload. Status events still patch ticks in place.
  useEffect(() => {
    if (!socket) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const flushNew = async () => {
      pending = null;
      if (inFlight) return;
      inFlight = true;
      try {
        const curr = messagesRef.current;
        let cursor: Date | undefined;
        for (let i = curr.length - 1; i >= 0; i--) {
          const m = curr[i]!;
          if (!m.id.startsWith('temp-')) {
            cursor = new Date(m.createdAt);
            break;
          }
        }
        // Fetch new messages AND refresh the thread object in parallel.
        // The thread refresh is critical: the backend stamps a fresh
        // windowExpiresAt (+24h) on every inbound message, but if we only
        // append messages the stale thread.windowExpiresAt stays in state
        // and the composer stays locked even though the window is now open.
        const [fresh, updatedThread] = await Promise.all([
          listMessages(threadId, cursor ? { after: cursor } : {}),
          getThread(threadId),
        ]);
        if (fresh.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const add = fresh.filter((m) => !seen.has(m.id));
            return add.length ? [...prev, ...add] : prev;
          });
        }
        // Always update the thread so windowExpiresAt, unreadCount, and
        // other thread-level fields reflect the latest server state.
        setThread(updatedThread);
      } catch {
        void reload(); // fall back to a full refetch if the tail fetch fails
      } finally {
        inFlight = false;
      }
    };

    const onMessageNew = (evt: { threadId: string }) => {
      if (evt.threadId !== threadId) return;
      if (pending) return;
      pending = setTimeout(() => void flushNew(), 300);
    };
    const onStatus = (evt: { threadId: string; messageId: string; status: WhatsAppMessageStatus }) => {
      if (evt.threadId !== threadId) return;
      setMessages((curr) =>
        curr.map((m) => (m.id === evt.messageId ? { ...m, status: evt.status } : m)),
      );
    };
    // The customer answered our call-permission request — flip the chip live so
    // the rep sees "Calls allowed" the instant they tap Allow (no refresh).
    const onPermission = (evt: { threadId: string; status: string; expiresAt?: string | null }) => {
      if (evt.threadId !== threadId) return;
      setThread((prev) =>
        prev
          ? { ...prev, callPermissionStatus: evt.status, callPermissionExpiresAt: evt.expiresAt ?? null }
          : prev,
      );
    };
    socket.on('whatsapp.message.new', onMessageNew);
    socket.on('whatsapp.message.status', onStatus);
    socket.on('whatsapp.call.permission', onPermission);
    return () => {
      if (pending) clearTimeout(pending);
      socket.off('whatsapp.message.new', onMessageNew);
      socket.off('whatsapp.message.status', onStatus);
      socket.off('whatsapp.call.permission', onPermission);
    };
  }, [socket, threadId, reload]);

  // Auto-scroll: jump to the latest message when new bottom-side messages
  // arrive, but PRESERVE the visible position when older messages are
  // prepended via loadOlder (otherwise the chat would yank to the bottom and
  // the user would lose their reading place).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependingRef.current && preservedScrollRef.current) {
      el.scrollTop =
        el.scrollHeight - preservedScrollRef.current.height + preservedScrollRef.current.top;
      prependingRef.current = false;
      preservedScrollRef.current = null;
    } else {
      el.scrollTop = el.scrollHeight;
    }
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

  const handleSend = () => {
    const body = draft.trim();
    if (!body || !thread) return;

    // Optimistic UI: render the bubble immediately with a clock icon and clear
    // the composer before the backend round-trip finishes. The temp message
    // shares the same wire shape as a real ChatMessage so the bubble renderer
    // doesn't branch. When the POST resolves we swap the temp row for the
    // server's authoritative copy (matched by tempId). When the realtime SENT
    // event arrives, it patches the real row's status — no UI flicker because
    // the temp and real bubbles look identical at that moment.
    //
    // Same pattern WhatsApp/iMessage/Slack use. Customer-side behaviour is
    // unchanged — Meta only sees the message when the backend worker posts it,
    // exactly as before.
    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempId = `temp-${idempotencyKey}`;
    const nowIso = new Date().toISOString();
    // If the user is replying to a message, stamp that message's waMessageId
    // onto repliedToWaMessageId so the outgoing send shows up as a quote on
    // the recipient's WhatsApp (Meta context.message_id). The backend already
    // accepts contextWaMessageId and writes it to the same column.
    const contextWaMessageId = replyingTo?.waMessageId ?? undefined;
    const tempMessage: ChatMessage = {
      id: tempId,
      threadId: thread.id,
      leadId: thread.leadId ?? null,
      clientId: thread.clientId ?? null,
      direction: 'OUTBOUND',
      type: 'TEXT',
      status: 'QUEUED',
      body,
      payload: null,
      mediaUrl: null,
      mediaMimeType: null,
      templateName: null,
      templateLanguage: null,
      sentByEmployeeId: null,
      waMessageId: null,
      repliedToWaMessageId: contextWaMessageId ?? null,
      errorCode: null,
      errorTitle: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      createdAt: nowIso,
    };

    setMessages((curr) => [...curr, tempMessage]);
    setDraft('');
    // Clear the reply-target as soon as the send is fired — the bubble
    // already carries the quoted context, no need for the bar to linger.
    setReplyingTo(null);

    // Fire-and-forget — but track the result so we can swap or mark FAILED.
    void (async () => {
      try {
        const real = await sendText(thread.id, body, {
          idempotencyKey,
          ...(contextWaMessageId ? { contextWaMessageId } : {}),
        });
        setMessages((curr) => curr.map((m) => (m.id === tempId ? real : m)));
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Failed to send';
        setMessages((curr) =>
          curr.map((m) =>
            m.id === tempId
              ? { ...m, status: 'FAILED', errorTitle: reason, failedAt: new Date().toISOString() }
              : m,
          ),
        );
        setError(reason);
      }
    })();
  };

  /**
   * Triggered from the + attach menu and the drag-drop drop event. Opens the
   * preview modal so the user can confirm the file and optionally add a
   * caption before the upload kicks off. The actual send happens in
   * confirmSendMedia below.
   */
  const handlePickMedia = (file: File) => {
    if (!thread) return;
    const mime = (file.type || '').toLowerCase();
    const kind: 'image' | 'video' | 'document' = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : 'document';
    setPendingMedia({
      file,
      previewUrl: URL.createObjectURL(file),
      kind,
    });
  };

  /**
   * Actually send a previewed media file (optionally with a caption typed in
   * the preview modal).
   *
   * Optimistic UI mirrors the text path: insert a placeholder bubble the
   * moment the user hits Send (with a local blob-URL preview for images so
   * they SEE what they're about to send) and swap it for the server's
   * authoritative copy once the upload + Meta forwarding completes.
   */
  const confirmSendMedia = (file: File, caption: string | undefined) => {
    if (!thread) return;

    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempId = `temp-${idempotencyKey}`;
    const mime = (file.type || '').toLowerCase();
    const isImage = mime.startsWith('image/');
    const isVideo = mime.startsWith('video/');
    const tempType: 'IMAGE' | 'VIDEO' | 'DOCUMENT' = isImage
      ? 'IMAGE'
      : isVideo
        ? 'VIDEO'
        : 'DOCUMENT';
    const previewUrl = URL.createObjectURL(file);
    const trimmedCaption = caption?.trim() ? caption.trim() : undefined;
    // For image/video, captions show under the media as a separate line
    // (existing renderer reads message.body for the caption). For documents
    // the body slot is the filename, so we put the caption in payload
    // metadata instead — matches Meta's inbound shape.
    const tempBody = isImage || isVideo ? trimmedCaption ?? null : file.name;
    const tempMessage: ChatMessage = {
      id: tempId,
      threadId: thread.id,
      leadId: thread.leadId ?? null,
      clientId: thread.clientId ?? null,
      direction: 'OUTBOUND',
      type: tempType,
      status: 'QUEUED',
      body: tempBody,
      payload:
        tempType === 'DOCUMENT'
          ? ({ document: { filename: file.name } } as unknown)
          : null,
      mediaUrl: previewUrl,
      mediaMimeType: file.type || null,
      templateName: null,
      templateLanguage: null,
      sentByEmployeeId: null,
      waMessageId: null,
      repliedToWaMessageId: null,
      errorCode: null,
      errorTitle: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      createdAt: new Date().toISOString(),
    };

    setMessages((curr) => [...curr, tempMessage]);
    // Tear down the preview modal AFTER the optimistic bubble lands so the
    // transition feels like "image flies into the conversation" rather than
    // "modal closes, nothing happens for 1s".
    if (pendingMedia) URL.revokeObjectURL(pendingMedia.previewUrl);
    setPendingMedia(null);

    void (async () => {
      try {
        const real = await sendMediaMessage(
          thread.id,
          file,
          file.name,
          trimmedCaption,
          idempotencyKey,
        );
        setMessages((curr) => curr.map((m) => (m.id === tempId ? real : m)));
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Failed to send';
        setMessages((curr) =>
          curr.map((m) =>
            m.id === tempId
              ? { ...m, status: 'FAILED', errorTitle: reason, failedAt: new Date().toISOString() }
              : m,
          ),
        );
        setError(reason);
      }
    })();
  };

  const cancelPendingMedia = () => {
    if (pendingMedia) URL.revokeObjectURL(pendingMedia.previewUrl);
    setPendingMedia(null);
  };

  const handleSendVoice = (blob: Blob, mimeType: string) => {
    if (!thread) return;
    // Optimistic send — mirror the image/document path so the voice bubble
    // appears INSTANTLY (playable from a local blob URL) instead of blocking
    // the composer for ~7-8s on the upload + transcode + Meta-forwarding
    // round-trip. The heavy lifting happens in the background; we swap the
    // placeholder for the server's authoritative copy when it returns.
    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempId = `temp-${idempotencyKey}`;
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
    const previewUrl = URL.createObjectURL(blob);
    const tempMessage: ChatMessage = {
      id: tempId,
      threadId: thread.id,
      leadId: thread.leadId ?? null,
      clientId: thread.clientId ?? null,
      direction: 'OUTBOUND',
      type: 'AUDIO',
      status: 'QUEUED',
      body: null,
      payload: { isVoiceNote: true } as unknown as ChatMessage['payload'],
      mediaUrl: previewUrl,
      mediaMimeType: mimeType || null,
      templateName: null,
      templateLanguage: null,
      sentByEmployeeId: null,
      waMessageId: null,
      repliedToWaMessageId: null,
      errorCode: null,
      errorTitle: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      createdAt: new Date().toISOString(),
    };

    setMessages((curr) => [...curr, tempMessage]);

    void (async () => {
      try {
        const real = await sendMediaMessage(
          thread.id,
          blob,
          `voice-note.${ext}`,
          undefined,
          idempotencyKey,
        );
        setMessages((curr) => curr.map((m) => (m.id === tempId ? real : m)));
        URL.revokeObjectURL(previewUrl);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Failed to send voice message';
        setMessages((curr) =>
          curr.map((m) =>
            m.id === tempId
              ? { ...m, status: 'FAILED', errorTitle: reason, failedAt: new Date().toISOString() }
              : m,
          ),
        );
        setError(reason);
      }
    })();
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
          csvBatchName={thread.lead?.importRows?.[0]?.batch.name ?? null}
          onBack={onBack}
        />
        {/* AI bot strip — per-thread on/off toggle + any bot-captured
            appointment-request banners. Self-contained: fetches its own
            state from the API and silently renders nothing when both
            are absent (no toggle data + no pending requests). */}
        <AiBotStrip
          threadId={thread.id}
          onBookFromRequest={(req) => {
            // Pass the captured intent through to the modal so it opens
            // pre-filled (modality → type, day/time → date+time, notes →
            // "Bot captured: …"). The requestId travels with the create
            // call so the backend auto-marks the AppointmentRequest as
            // CONFIRMED and links it to the new appointment.
            setBookPrefill({
              appointmentRequestId: req.id,
              preferredDay: req.preferredDay,
              preferredTime: req.preferredTime,
              modality: req.modality,
              rawText: req.rawText,
            });
            setBookOpen(true);
          }}
        />
        {/* Quick actions strip — visible only when there's no right sidebar
            (i.e. on the inbox view). Lead-detail tab variant has its own
            sidebar with the same actions, so we skip the duplicate there. */}
        {hideSidePanel ? (
          <QuickActionsBar
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
            onCall={() =>
              window.dispatchEvent(
                new CustomEvent('wa:outbound-call', {
                  detail: {
                    threadId: thread.id,
                    name: displayName,
                    phone: thread.lead?.phone ?? thread.client?.phone ?? thread.waContactId,
                  },
                }),
              )
            }
            callPermission={callPermissionChip(
              thread.callPermissionStatus,
              thread.callPermissionExpiresAt,
            )}
            withinWindow={withinWindow}
            onRequestPermission={() => {
              void (async () => {
                try {
                  await requestCallPermission(thread.id);
                  setThread((p) =>
                    p
                      ? { ...p, callPermissionStatus: 'PENDING', callPermissionExpiresAt: null }
                      : p,
                  );
                  setError(null);
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : 'Could not send the call-permission request',
                  );
                }
              })();
            }}
          />
        ) : null}
        {/* Click-to-WhatsApp ad attribution banner — shows when the thread's
            latest inbound came in via a Facebook / Instagram ad click. Stays
            sticky just under the header so agents always see which campaign
            the customer engaged with, even after several follow-up messages. */}
        {thread.adReferral ? (
          <AdReferralBanner
            referral={thread.adReferral}
            at={thread.adReferralAt ?? null}
            onOpenImage={(url) => setLightboxUrl(url)}
          />
        ) : null}
        {/* Messages */}
        <div
          ref={scrollRef}
          onDragEnter={(e) => {
            if (!withinWindow) return;
            // Only react to file drags, not text-selection drags within the page.
            if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
            e.preventDefault();
            dragCounterRef.current += 1;
            setDragHover(true);
          }}
          onDragOver={(e) => {
            if (!withinWindow) return;
            if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
            // Must preventDefault to allow drop. Setting dropEffect='copy' makes
            // the OS cursor show the green "+" icon over the chat.
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={() => {
            dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
            if (dragCounterRef.current === 0) setDragHover(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragCounterRef.current = 0;
            setDragHover(false);
            if (!withinWindow) return;
            const file = e.dataTransfer.files?.[0];
            if (file) handlePickMedia(file);
          }}
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
            position: 'relative',
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
            <>
              {/* Infinite scroll — older messages load automatically as the user
                  scrolls up (see the scroll-listener effect). A thin loading
                  indicator at the top shows during the fetch; once we've
                  reached the start of the thread, both disappear. */}
              {loadingOlder ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0', fontSize: 12, color: 'var(--sos-text-muted)' }}>
                  Loading older messages…
                </div>
              ) : null}
              {messages.map((m, i) => {
                const prev = i > 0 ? messages[i - 1] : null;
                const showDay = !prev || chatDayKey(prev.createdAt) !== chatDayKey(m.createdAt);
                const bubble = (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onImageClick={(url) => setLightboxUrl(url)}
                    onReply={() => setReplyingTo(m)}
                    allMessages={messages}
                  />
                );
                if (!showDay) return bubble;
                return [
                  <DateSeparator key={`day-${m.id}`} label={formatDaySeparator(m.createdAt)} />,
                  bubble,
                ];
              })}
            </>
          )}

          {/* Drop-zone overlay — appears while the user is dragging a file
              over the chat. Positioned absolutely inside the scroll
              container so it covers messages without affecting layout. */}
          {dragHover ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0, 168, 132, 0.18)',
                border: '2px dashed var(--wa-accent)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--sos-text-primary)',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Plus size={32} />
                Drop to send
              </div>
            </div>
          ) : null}
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

        {/* Reply-target quote bar — shown above the composer while the user
            is composing a reply. Click X to cancel and send a normal
            (non-reply) message instead. The quoted content is rendered
            with the same QuotedMessagePreview component used inside
            bubbles so the affordance is visually consistent. */}
        {replyingTo ? (
          <div
            style={{
              padding: '8px 14px',
              background: 'var(--wa-panel-header)',
              borderTop: '1px solid var(--sos-border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
            }}
          >
            <Reply
              size={16}
              style={{ color: 'var(--wa-accent)', flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <QuotedMessagePreview quoted={replyingTo} />
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              aria-label="Cancel reply"
              title="Cancel reply"
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: 4,
                color: 'var(--sos-text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                flexShrink: 0,
              }}
            >
              <X size={16} />
            </button>
          </div>
        ) : null}

        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
          onSendVoice={handleSendVoice}
          onSendMedia={handlePickMedia}
          onOpenCamera={() => setCameraOpen(true)}
          onOpenTemplate={() => setTemplateOpen(true)}
          onOpenQuickReplies={() => setQuickRepliesOpen(true)}
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
        onClose={() => {
          setBookOpen(false);
          setBookPrefill(null);
        }}
        leadId={thread.leadId ?? null}
        clientId={thread.clientId ?? null}
        defaultAssigneeId={thread.lead?.assignedEmployeeId ?? null}
        prefill={bookPrefill}
        onBooked={() => {
          setBookOpen(false);
          setBookPrefill(null);
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
      <QuickReplyPicker
        open={quickRepliesOpen}
        onClose={() => setQuickRepliesOpen(false)}
        onInsert={(body) => {
          const filled = fillQuickReply(body, {
            name: thread.lead?.firstName || thread.client?.firstName || null,
          });
          setDraft((d) => (d.trim() ? `${d} ${filled}` : filled));
        }}
      />
      <TemplatePickerModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        threadId={thread.id}
        channelId={thread.channelId}
        contactName={thread.client?.firstName || thread.lead?.firstName || displayName || ''}
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

      {pendingMedia ? (
        <MediaPreviewModal
          file={pendingMedia.file}
          previewUrl={pendingMedia.previewUrl}
          kind={pendingMedia.kind}
          onCancel={cancelPendingMedia}
          onSend={(caption) => confirmSendMedia(pendingMedia.file, caption)}
        />
      ) : null}

      {cameraOpen ? (
        <CameraCaptureModal
          onCancel={() => setCameraOpen(false)}
          onCapture={(file) => {
            setCameraOpen(false);
            // Funnel the captured photo through the same preview/caption
            // flow as a normal pick — user can still cancel or add a caption.
            handlePickMedia(file);
          }}
        />
      ) : null}

      {lightboxUrl ? (
        <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      ) : null}
    </div>
  );
}

// ---- Quoted-message preview (inline, inside a bubble) -------------------

function QuotedMessagePreview({ quoted }: { quoted: ChatMessage }) {
  // Outbound-from-us = our agent. Inbound = the customer. The label colour
  // mirrors WhatsApp: green-ish for our side, white for customer side.
  const isQuotedOut = quoted.direction === 'OUTBOUND';
  const author = isQuotedOut ? 'You' : 'Customer';
  const preview = (() => {
    if (quoted.type === 'TEXT') return quoted.body ?? '';
    if (quoted.type === 'IMAGE') return quoted.body ? `📷 ${quoted.body}` : '📷 Photo';
    if (quoted.type === 'VIDEO') return quoted.body ? `🎥 ${quoted.body}` : '🎥 Video';
    if (quoted.type === 'AUDIO') return '🎤 Voice message';
    if (quoted.type === 'DOCUMENT') return `📄 ${quoted.body ?? 'Document'}`;
    if (quoted.type === 'TEMPLATE') return `📋 ${quoted.templateName ?? 'Template'}`;
    return '';
  })();

  return (
    <div
      style={{
        borderLeft: `3px solid ${isQuotedOut ? 'var(--wa-accent)' : '#a0a0a0'}`,
        background: 'rgba(0,0,0,0.18)',
        borderRadius: 4,
        padding: '4px 8px',
        marginBottom: 4,
        fontSize: 12,
        lineHeight: 1.3,
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          color: isQuotedOut ? 'var(--wa-accent)' : '#e0e0e0',
          marginBottom: 2,
        }}
      >
        {author}
      </div>
      <div
        style={{
          color: 'var(--sos-text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {preview || <span style={{ fontStyle: 'italic' }}>(no preview)</span>}
      </div>
    </div>
  );
}

// ---- Media preview modal (caption-before-send) --------------------------

function MediaPreviewModal(props: {
  file: File;
  previewUrl: string;
  kind: 'image' | 'video' | 'document';
  onCancel: () => void;
  onSend: (caption: string | undefined) => void;
}) {
  const [caption, setCaption] = useState('');

  // Escape cancels, Enter (without shift) sends. Auto-focus the caption
  // input on open so the user can type immediately.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  const fmtBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={props.onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--sos-surface-1, #111b21)',
          borderRadius: 10,
          width: 'min(600px, 100%)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--sos-border-subtle, rgba(255,255,255,0.08))',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
            Send {props.kind}
          </div>
          <button
            type="button"
            onClick={props.onCancel}
            title="Cancel (Esc)"
            style={{
              all: 'unset', cursor: 'pointer', color: 'var(--sos-text-muted)',
              width: 28, height: 28, display: 'flex',
              alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Preview body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            background: 'var(--wa-chat-bg, #0b141a)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          {props.kind === 'image' ? (
            <img
              src={props.previewUrl}
              alt="Preview"
              style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 6 }}
            />
          ) : props.kind === 'video' ? (
            <video
              src={props.previewUrl}
              controls
              style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 6 }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '16px 20px',
                background: 'var(--wa-bubble-out, #005c4b)',
                borderRadius: 8,
                color: 'var(--sos-text-primary)',
                minWidth: 280,
              }}
            >
              <FileIcon size={32} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 360,
                  }}
                >
                  {props.file.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>
                  {fmtBytes(props.file.size)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Caption + send */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            padding: 12,
            borderTop: '1px solid var(--sos-border-subtle, rgba(255,255,255,0.08))',
            background: 'var(--wa-panel-header, #202c33)',
          }}
        >
          <textarea
            autoFocus
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                props.onSend(caption.trim() || undefined);
              }
            }}
            placeholder="Add a caption…"
            rows={1}
            style={{
              flex: 1,
              background: 'var(--wa-composer-input-bg, #2a3942)',
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
            }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
          <button
            type="button"
            onClick={() => props.onSend(caption.trim() || undefined)}
            title="Send (Enter)"
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--wa-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Send size={18} color="#fff" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Camera capture modal -----------------------------------------------

function CameraCaptureModal(props: {
  onCancel: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<{ blob: Blob; previewUrl: string } | null>(null);
  // facingMode preference — most mobile devices have both front + rear
  // cameras; default to environment (rear) since that's what a sales agent
  // usually wants when photographing a document. Desktop just uses whatever
  // single camera is available, this hint is ignored.
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Camera unavailable';
        setError(
          /permission|denied|notallowed/i.test(msg)
            ? 'Camera access was blocked. Allow camera in your browser settings.'
            : `Camera error: ${msg}`,
        );
      }
    };
    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  // Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (captured) URL.revokeObjectURL(captured.previewUrl);
        setCaptured({ blob, previewUrl: URL.createObjectURL(blob) });
      },
      'image/jpeg',
      0.92,
    );
  };

  const retake = () => {
    if (captured) URL.revokeObjectURL(captured.previewUrl);
    setCaptured(null);
  };

  const useCaptured = () => {
    if (!captured) return;
    const file = new File([captured.blob], `camera-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });
    // Cleanup local URL since the file is going to handlePickMedia which
    // will create its own preview.
    URL.revokeObjectURL(captured.previewUrl);
    props.onCapture(file);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={props.onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--sos-surface-1, #111b21)',
          borderRadius: 10,
          width: 'min(640px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--sos-border-subtle, rgba(255,255,255,0.08))',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
            Take a photo
          </div>
          <button
            type="button"
            onClick={props.onCancel}
            title="Cancel (Esc)"
            style={{
              all: 'unset', cursor: 'pointer', color: 'var(--sos-text-muted)',
              width: 28, height: 28, display: 'flex',
              alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Viewport */}
        <div
          style={{
            background: '#000',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 320,
            maxHeight: '60vh',
          }}
        >
          {error ? (
            <div
              style={{
                padding: 24,
                color: 'var(--sos-status-danger, #f87171)',
                textAlign: 'center',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : captured ? (
            <img
              src={captured.previewUrl}
              alt="Captured"
              style={{ maxWidth: '100%', maxHeight: '60vh', display: 'block' }}
            />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={videoRef}
              playsInline
              muted
              style={{
                maxWidth: '100%',
                maxHeight: '60vh',
                display: 'block',
                // Mirror the front camera since users expect their own
                // image to be mirrored, like a real mirror.
                transform: facing === 'user' ? 'scaleX(-1)' : 'none',
              }}
            />
          )}
        </div>

        {/* Controls */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 16,
            gap: 12,
            background: 'var(--wa-panel-header, #202c33)',
          }}
        >
          {/* Left: facing-mode switch (only useful while in live preview) */}
          {!captured && !error ? (
            <button
              type="button"
              onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
              title="Switch camera"
              style={{
                all: 'unset',
                cursor: 'pointer',
                color: 'var(--sos-text-muted)',
                padding: 8,
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <RotateCcw size={20} />
            </button>
          ) : (
            <span style={{ width: 36 }} />
          )}

          {/* Centre: capture / retake */}
          {captured ? (
            <button
              type="button"
              onClick={retake}
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: '10px 20px',
                borderRadius: 8,
                background: 'transparent',
                border: '1px solid var(--sos-border)',
                color: 'var(--sos-text-primary)',
                fontSize: 14,
              }}
            >
              Retake
            </button>
          ) : !error ? (
            <button
              type="button"
              onClick={capture}
              title="Capture"
              style={{
                all: 'unset',
                cursor: 'pointer',
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: '#fff',
                border: '4px solid var(--wa-accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            />
          ) : (
            <span />
          )}

          {/* Right: use captured photo (only enabled once captured) */}
          {captured ? (
            <button
              type="button"
              onClick={useCaptured}
              title="Use this photo"
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: '10px 16px',
                borderRadius: 8,
                background: 'var(--wa-accent)',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Check size={16} />
              Use photo
            </button>
          ) : (
            <span style={{ width: 36 }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Image lightbox -----------------------------------------------------

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  // Escape-to-close + lock body scroll while the lightbox is up so the
  // viewport doesn't scroll behind the dimmed overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        cursor: 'zoom-out',
      }}
    >
      {/* Close button — top right */}
      <button
        type="button"
        title="Close (Esc)"
        onClick={onClose}
        style={{
          all: 'unset',
          position: 'absolute',
          top: 16,
          right: 16,
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <X size={22} />
      </button>
      {/* Download button — bottom right. Uses an <a download> rather than a
          button + JS so the browser handles the save dialog natively. */}
      <a
        href={url}
        download
        onClick={(e) => e.stopPropagation()}
        title="Download"
        style={{
          position: 'absolute',
          bottom: 24,
          right: 24,
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textDecoration: 'none',
        }}
      >
        <Download size={20} />
      </a>
      {/* The image — stop click propagation so clicking the image itself
          doesn't dismiss; the user has to click the backdrop or Esc/X. */}
      <img
        src={url}
        alt="Preview"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          borderRadius: 4,
          cursor: 'default',
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
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
  csvBatchName: string | null;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 15, color: 'var(--sos-text-primary)', overflow: 'hidden' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {props.displayName}
          </span>
          {props.csvBatchName ? <CsvLeadBadge batchName={props.csvBatchName} /> : null}
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
/**
 * Map a thread's Meta call-permission state → a small status chip shown next to
 * the Call button, so the rep knows whether a business-initiated WhatsApp call
 * is currently allowed BEFORE clicking. Permission is what authorises an
 * outbound call (independent of the 24h messaging window). Returns null only if
 * we choose not to render a chip — here we always render one for clarity.
 */
function callPermissionChip(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
): { label: string; color: string; bg: string; title: string; action: 'request' | null; canCall?: boolean } {
  const exp = expiresAt ? new Date(expiresAt) : null;
  const expired = !!exp && exp.getTime() < Date.now();
  if (status === 'GRANTED' && !expired) {
    const until = exp ? ` · until ${exp.toLocaleDateString()}` : '';
    return {
      label: `Calls allowed${until}`,
      color: 'var(--sos-status-success)',
      bg: 'var(--sos-status-success-soft)',
      title: 'The customer has allowed WhatsApp calls — you can call them now.',
      action: null,
      canCall: true,
    };
  }
  if (status === 'GRANTED' && expired) {
    return {
      label: 'Call permission expired',
      color: 'var(--sos-status-warning)',
      bg: 'var(--sos-status-warning-soft)',
      title: 'Permission has expired — request it again before calling.',
      action: 'request',
    };
  }
  if (status === 'PENDING') {
    return {
      label: 'Permission requested',
      color: 'var(--sos-status-warning)',
      bg: 'var(--sos-status-warning-soft)',
      title: 'Waiting for the customer to tap “Allow” on the call-permission request.',
      action: null,
    };
  }
  if (status === 'REJECTED') {
    return {
      label: 'Calls declined',
      color: 'var(--sos-status-danger)',
      bg: 'var(--sos-status-danger-soft)',
      title: 'The customer declined call permission. You can ask again.',
      action: 'request',
    };
  }
  return {
    label: 'Permission needed',
    color: 'var(--sos-text-secondary)',
    bg: 'var(--sos-surface-2)',
    title:
      'Meta requires the customer to allow WhatsApp calls first. Tap “Request call permission” to send them the opt-in.',
    action: 'request',
  };
}

function QuickActionsBar({
  canConvertToLead,
  canEditLead,
  onConvertToLead,
  onEditLead,
  onBook,
  onCall,
  callPermission,
  withinWindow,
  onRequestPermission,
}: {
  canConvertToLead: boolean;
  canEditLead: boolean;
  onConvertToLead: () => void;
  onEditLead: () => void;
  onBook: () => void;
  onCall: () => void;
  callPermission: { label: string; color: string; bg: string; title: string; action: 'request' | null; canCall?: boolean };
  withinWindow: boolean;
  onRequestPermission: () => void;
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
      {/* Single context-aware call control. While the customer hasn't granted
          WhatsApp-call permission, this is a "Request call permission" button
          (sends the opt-in). Once they tap Allow it becomes the real Call
          button — permanently, until permission lapses. PENDING / out-of-window
          show an informational chip. Replaces the old always-on Call button +
          separate permission chip. */}
      {callPermission.canCall ? (
        <button
          type="button"
          onClick={onCall}
          title="The customer has allowed WhatsApp calls — call them now."
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 999,
            border: '1px solid var(--sos-status-success)',
            background: 'var(--sos-status-success-soft)',
            color: 'var(--sos-status-success)',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Phone size={13} />
          Call
        </button>
      ) : callPermission.action === 'request' ? (
        withinWindow ? (
          <button
            type="button"
            onClick={onRequestPermission}
            title="Send the customer a WhatsApp call-permission request. Once they tap “Allow”, this turns into the Call button."
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
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <PhoneOutgoing size={13} />
            Request call permission
          </button>
        ) : (
          <span
            title="Send the customer a message first — the call-permission request can only go out inside the 24-hour window."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '5px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: callPermission.bg,
              color: callPermission.color,
              whiteSpace: 'nowrap',
            }}
          >
            {callPermission.label}
          </span>
        )
      ) : (
        <span
          title={callPermission.title}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '5px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            background: callPermission.bg,
            color: callPermission.color,
            whiteSpace: 'nowrap',
          }}
        >
          {callPermission.label}
        </span>
      )}
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

// ---- Click-to-WhatsApp ad referral cards -------------------------------

/**
 * Sticky banner under the chat header. Shows when the thread's MOST RECENT
 * inbound came in via a click on a Facebook / Instagram WhatsApp ad. Stays
 * visible across the whole chat session even after several follow-up
 * messages, so agents always know "this contact replied through <ad>"
 * while reading older history.
 *
 * Click the image / video thumbnail to open the lightbox (same one the
 * media bubbles use). The "View ad" link opens Meta's source_url in a
 * new tab if available.
 */
function AdReferralBanner({
  referral,
  at,
  onOpenImage,
}: {
  referral: AdReferral;
  at: string | null;
  onOpenImage?: (url: string) => void;
}) {
  const thumb =
    referral.thumbnail_url ||
    referral.image_url ||
    (referral.media_type === 'video' ? referral.video_url : undefined);
  const headline = referral.headline?.trim() || 'WhatsApp ad';
  const subtitle = referral.body?.trim() || referral.source_type || 'Click-to-WhatsApp ad';
  const when = at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return (
    <div
      style={{
        margin: '0 0',
        padding: '10px 14px',
        background:
          'linear-gradient(90deg, rgba(24,119,242,0.20) 0%, rgba(24,119,242,0.06) 100%)',
        borderBottom: '1px solid rgba(24,119,242,0.35)',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      {thumb ? (
        <div
          style={{
            width: 56,
            height: 56,
            flexShrink: 0,
            borderRadius: 6,
            overflow: 'hidden',
            position: 'relative',
            background: '#000',
            cursor: onOpenImage ? 'zoom-in' : 'default',
          }}
          onClick={() => onOpenImage?.(thumb)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            alt="Ad thumbnail"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {referral.media_type === 'video' ? (
            <span
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%,-50%)',
                color: '#fff',
                background: 'rgba(0,0,0,0.55)',
                width: 24,
                height: 24,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
              }}
              aria-hidden
            >
              ▶
            </span>
          ) : null}
        </div>
      ) : (
        <div
          style={{
            width: 56,
            height: 56,
            flexShrink: 0,
            borderRadius: 6,
            background: 'rgba(24,119,242,0.25)',
            color: '#90caf9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 11,
          }}
        >
          AD
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: '#5b9dff',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 2,
          }}
        >
          Replied from {referral.media_type === 'video' ? 'video ad' : referral.media_type === 'image' ? 'image ad' : 'ad'}
        </div>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--sos-text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {headline}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--sos-text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginTop: 1,
          }}
        >
          {subtitle}
          {when ? ` · ${when}` : ''}
        </div>
      </div>
      {referral.source_url ? (
        <a
          href={referral.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="sos-btn sos-btn--ghost sos-btn--sm"
          style={{ flexShrink: 0, fontSize: 12 }}
        >
          View ad
        </a>
      ) : null}
    </div>
  );
}

/**
 * Compact per-message ad card — sits directly above a specific incoming
 * message bubble when that message's payload included a `referral`. Used
 * to mark exactly WHICH reply was triggered by the ad click, useful when
 * the customer has been chatting for a while and a single thread now
 * carries multiple referrals from different campaigns.
 */
function InlineAdReferralCard({
  referral,
  isOut,
}: {
  referral: AdReferral;
  isOut: boolean;
}) {
  const thumb =
    referral.thumbnail_url ||
    referral.image_url ||
    (referral.media_type === 'video' ? referral.video_url : undefined);
  const headline = referral.headline?.trim() || 'WhatsApp ad';
  const mediaLabel = referral.media_type === 'video' ? 'Video ad' : referral.media_type === 'image' ? 'Image ad' : 'Ad';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: '65%',
        padding: '6px 10px',
        marginBottom: 4,
        borderRadius: 8,
        background: 'rgba(24,119,242,0.12)',
        border: '1px solid rgba(24,119,242,0.30)',
        // Same side as the bubble so the card hangs over the message
        // it belongs to, not the opposite side.
        alignSelf: isOut ? 'flex-end' : 'flex-start',
      }}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          style={{
            width: 32,
            height: 32,
            borderRadius: 4,
            objectFit: 'cover',
            flexShrink: 0,
          }}
        />
      ) : (
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 4,
            background: 'rgba(24,119,242,0.30)',
            color: '#90caf9',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          AD
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#5b9dff',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          From {mediaLabel.toLowerCase()}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--sos-text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 280,
          }}
        >
          {headline}
        </div>
      </div>
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

/**
 * Shown when the media bytes can't be loaded. Lets the operator re-trigger
 * the media-download worker — useful when the original download failed for
 * a transient reason (Meta timeout, backend restart, etc.) and the bytes
 * are still fetchable. Bytes that Meta no longer holds (>30 days, or wrong
 * WABA token) won't recover; that surfaces as a second "Media unavailable".
 */
function MediaUnavailableWithRetry({
  threadId,
  messageId,
}: {
  threadId: string;
  messageId: string;
}) {
  const [state, setState] = useState<'idle' | 'retrying' | 'queued' | 'failed'>('idle');

  async function handleRetry() {
    setState('retrying');
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const token = getAccessToken();
      const res = await fetch(
        `${apiBase}/whatsapp/threads/${threadId}/messages/${messageId}/refetch-media`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState('queued');
      // Worker typically completes inside a couple seconds. Reload the
      // chat after a short delay so the freshly-cached bytes render.
      setTimeout(() => window.location.reload(), 4000);
    } catch {
      setState('failed');
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontStyle: 'italic', color: 'var(--sos-status-danger)' }}>
      Media unavailable
      {state === 'idle' ? (
        <button
          type="button"
          onClick={() => void handleRetry()}
          style={{
            background: 'none',
            border: '1px solid var(--sos-border)',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
            color: 'var(--sos-text-secondary)',
            fontStyle: 'normal',
          }}
        >
          Retry
        </button>
      ) : null}
      {state === 'retrying' ? <span style={{ fontSize: 11, fontStyle: 'normal' }}>retrying…</span> : null}
      {state === 'queued' ? <span style={{ fontSize: 11, fontStyle: 'normal', color: 'var(--sos-status-success)' }}>queued — reloading…</span> : null}
      {state === 'failed' ? <span style={{ fontSize: 11, fontStyle: 'normal' }}>retry failed</span> : null}
    </span>
  );
}

/** Structured, non-media message types the backend already ingests but that used
 *  to render as a raw "[location]" / "[contacts]" placeholder. */
const SPECIAL_MESSAGE_TYPES = new Set(['LOCATION', 'CONTACTS', 'REACTION', 'INTERACTIVE']);
function isSpecialType(type: string): boolean {
  return SPECIAL_MESSAGE_TYPES.has(type);
}

/** Renders the structured non-media types as WhatsApp-style cards instead of a
 *  "[type]" placeholder: location → a map-link card, contacts → a vCard card,
 *  reaction → emoji + label, interactive → the tapped button/list title. Reads
 *  the payload shapes decodeIncoming() stores in the webhook ingest processor. */
function SpecialMessageContent({ message }: { message: ChatMessage }) {
  // Payloads are Meta's raw JSON objects; type loosely and read defensively.
  const p = (message.payload ?? {}) as Record<string, any>;

  const card: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 8,
    background: 'var(--wa-composer-input-bg)',
    color: 'var(--sos-text-primary)',
    textDecoration: 'none',
    maxWidth: 260,
  };

  if (message.type === 'LOCATION') {
    const loc = p.location ?? {};
    const lat = loc.latitude;
    const lng = loc.longitude;
    const label = loc.name || loc.address || 'Shared location';
    const href =
      lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : undefined;
    return (
      <a href={href} target="_blank" rel="noreferrer" style={card}>
        <MapPin size={18} style={{ flexShrink: 0, color: 'var(--wa-accent)' }} />
        <span style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </div>
          {loc.address && loc.name ? (
            <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {loc.address}
            </div>
          ) : null}
          {href ? <div style={{ fontSize: 11, color: 'var(--sos-text-faint)' }}>Open in Maps</div> : null}
        </span>
      </a>
    );
  }

  if (message.type === 'CONTACTS') {
    const contacts: any[] = Array.isArray(p.contacts) ? p.contacts : [];
    const c = contacts[0] ?? {};
    const name = c?.name?.formatted_name || 'Contact';
    const phone = c?.phones?.[0]?.phone || '';
    const extra = contacts.length > 1 ? ` +${contacts.length - 1} more` : '';
    return (
      <div style={card}>
        <User size={18} style={{ flexShrink: 0, color: 'var(--wa-accent)' }} />
        <span style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}{extra}
          </div>
          {phone ? <div style={{ fontSize: 12, color: 'var(--sos-text-muted)' }}>{phone}</div> : null}
        </span>
      </div>
    );
  }

  if (message.type === 'REACTION') {
    const emoji = p.reaction?.emoji || message.body || '';
    return (
      <span style={{ fontSize: 13, color: 'var(--sos-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 18 }}>{emoji}</span>
        Reacted to a message
      </span>
    );
  }

  // INTERACTIVE — the customer tapped a quick-reply button or picked a list row.
  const it = p.interactive ?? {};
  const title =
    it.button_reply?.title ?? it.list_reply?.title ?? it.nfm_reply?.name ?? 'Interactive reply';
  return (
    <span style={{ fontSize: 14, color: 'var(--sos-text-primary)' }}>
      <span style={{ opacity: 0.6, marginRight: 4 }}>↳</span>
      {title}
    </span>
  );
}

// ── WhatsApp text formatting (*bold* _italic_ ~strike~ ```mono```) ──────────
// Conservative, XSS-safe (renders React nodes, never HTML). Markers only format
// when they hug non-space content AND sit at a boundary, so normal text like
// "2*3", "snake_case", "a_b_c", "file_name.txt", emails and globs are NEVER
// mangled. Verified against a 22-case table (false negatives are acceptable;
// mangling real messages is not).
type FmtNode = string | { t: 'b' | 'i' | 's' | 'mono'; c: FmtNode[] };
const FMT_MARKERS: Array<{ ch: string; t: 'b' | 'i' | 's' }> = [
  { ch: '*', t: 'b' },
  { ch: '_', t: 'i' },
  { ch: '~', t: 's' },
];
function fmtBoundaryBefore(prev: string | undefined): boolean {
  return prev === undefined || /\s/.test(prev) || '([{<"\'`'.includes(prev);
}
function fmtBoundaryAfter(next: string | undefined): boolean {
  return next === undefined || /\s/.test(next) || ')]}>"\'`.,!?;:'.includes(next);
}
function parseWhatsAppText(text: string): FmtNode[] {
  const out: FmtNode[] = [];
  let i = 0;
  let buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  while (i < text.length) {
    if (text.startsWith('```', i)) {
      const end = text.indexOf('```', i + 3);
      if (end !== -1 && end > i + 3) {
        flush();
        out.push({ t: 'mono', c: [text.slice(i + 3, end)] });
        i = end + 3;
        continue;
      }
    }
    const ch = text.charAt(i);
    const marker = FMT_MARKERS.find((m) => m.ch === ch);
    if (marker) {
      const prev = i > 0 ? text[i - 1] : undefined;
      const next = text[i + 1];
      if (next !== undefined && !/\s/.test(next) && fmtBoundaryBefore(prev)) {
        let j = i + 1;
        let closeIdx = -1;
        while (j < text.length) {
          if (text[j] === '\n') break; // inline styles don't cross lines
          if (text[j] === ch) {
            const before = text[j - 1];
            const after = text[j + 1];
            if (before !== undefined && !/\s/.test(before) && fmtBoundaryAfter(after)) {
              closeIdx = j;
              break;
            }
          }
          j++;
        }
        if (closeIdx > i + 1) {
          flush();
          out.push({ t: marker.t, c: parseWhatsAppText(text.slice(i + 1, closeIdx)) });
          i = closeIdx + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}
function renderFmtNodes(nodes: FmtNode[], keyBase: string): ReactNode[] {
  return nodes.map((n, idx) => {
    const key = `${keyBase}.${idx}`;
    // Key every node (strings via a no-DOM Fragment) so the array is uniformly
    // keyed — silences any React strict-mode warning with no markup change.
    if (typeof n === 'string') return <Fragment key={key}>{n}</Fragment>;
    if (n.t === 'mono') {
      const raw = n.c.map((x) => (typeof x === 'string' ? x : '')).join('');
      return (
        <code key={key} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.9em' }}>
          {raw}
        </code>
      );
    }
    const inner = renderFmtNodes(n.c, key);
    if (n.t === 'b') return <strong key={key}>{inner}</strong>;
    if (n.t === 'i') return <em key={key}>{inner}</em>;
    return <s key={key}>{inner}</s>;
  });
}
/** Render a message body with WhatsApp markup applied. Whitespace/newlines are
 *  preserved by the parent's `white-space: pre-wrap`. */
function FormattedText({ text }: { text: string }) {
  return <>{renderFmtNodes(parseWhatsAppText(text), 'f')}</>;
}

/** Renders image / audio / video / document / sticker media inside a message bubble. */
function MediaBubbleContent({
  message,
  onImageClick,
}: {
  message: ChatMessage;
  onImageClick?: (blobUrl: string) => void;
}) {
  type AnyPayload = Record<string, { id?: string; filename?: string }>;
  const p = message.payload as AnyPayload | null;
  const typeKey = message.type.toLowerCase() as 'image' | 'audio' | 'video' | 'document' | 'sticker';
  // Inbound: media ID lives in payload.audio.id etc.
  // Outbound (voice notes we sent): media ID lives in mediaUrl as "meta:<id>", payload is null.
  // Optimistic placeholder (just-picked + attach): mediaUrl is a "blob:" URL
  // pointing at the local File, so we can preview without a backend round-trip.
  const isOptimistic =
    message.id.startsWith('temp-') && (message.mediaUrl?.startsWith('blob:') ?? false);
  const hasMedia = !!(p?.[typeKey]?.id) || !!(message.mediaUrl);

  // Only fetch from the backend for already-persisted media — skip for temp
  // bubbles since the blob URL is already in hand.
  const { blobUrl: fetchedBlobUrl, loading, error } = useMediaBlobUrl(
    message.threadId,
    message.id,
    hasMedia && !isOptimistic,
  );
  const blobUrl = isOptimistic ? message.mediaUrl : fetchedBlobUrl;

  const filename = p?.[typeKey]?.filename ?? `${typeKey}`;

  if (!hasMedia) {
    return (
      <span style={{ fontStyle: 'italic', color: 'var(--sos-text-faint)' }}>
        [{message.type.toLowerCase()}]
      </span>
    );
  }

  if (loading && !isOptimistic) {
    return (
      <span style={{ fontSize: 13, color: 'var(--sos-text-faint)', fontStyle: 'italic' }}>
        Loading {typeKey}…
      </span>
    );
  }

  if (!isOptimistic && (error || !blobUrl)) {
    return <MediaUnavailableWithRetry threadId={message.threadId} messageId={message.id} />;
  }

  // From here on: blobUrl is non-null (either from the backend fetch or the
  // optimistic blob: URL stamped on the temp message).
  if (!blobUrl) return null;

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
        onClick={() => {
          // Open the in-app lightbox if available, else fall back to a new tab
          // (preserves behaviour for any embed that doesn't pass the callback).
          if (onImageClick) onImageClick(blobUrl);
          else window.open(blobUrl, '_blank');
        }}
      />
    );
  }

  if (message.type === 'STICKER') {
    // Stickers are .webp images — render inline like a small image (no lightbox).
    return (
      <img
        src={blobUrl}
        alt="Sticker"
        style={{ width: 120, height: 120, objectFit: 'contain', display: 'block' }}
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

  if (message.type === 'VIDEO') {
    // Inline player instead of the old "Download video" link — the single most
    // jarring "this isn't WhatsApp" gap. The download fallback still applies if
    // the browser can't play the codec (native <video> shows its own message).
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        controls
        preload="metadata"
        src={blobUrl}
        style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 6, display: 'block' }}
      />
    );
  }

  // DOCUMENT — a proper file card (icon + filename), tap to download.
  return (
    <a
      href={blobUrl}
      download={filename}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 8,
        background: 'var(--wa-bubble-out)',
        color: 'var(--sos-text-primary)',
        textDecoration: 'none',
        fontSize: 13,
        fontWeight: 500,
        border: '1px solid var(--sos-border)',
        maxWidth: 260,
      }}
    >
      <FileText size={20} style={{ flexShrink: 0, opacity: 0.85 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {filename}
      </span>
      <Download size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
    </a>
  );
}

/** Full date+time for the per-message "Message info" panel. */
function fmtInfoTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** A single row inside the per-message hover menu (Copy / Message info). */
function BubbleMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '7px 10px',
        borderRadius: 6,
        fontSize: 13,
        color: 'var(--sos-text-primary)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--wa-composer-input-bg)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {icon}
      {label}
    </button>
  );
}

function MessageBubble({
  message,
  onImageClick,
  onReply,
  allMessages,
}: {
  message: ChatMessage;
  onImageClick?: (blobUrl: string) => void;
  onReply?: () => void;
  /** Used to resolve the quoted message preview when this bubble is a reply. */
  allMessages?: ChatMessage[];
}) {
  const isOut = message.direction === 'OUTBOUND';
  const isMedia = ['IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'STICKER'].includes(message.type);
  const isSpecial = isSpecialType(message.type);
  const [hovered, setHovered] = useState(false);
  // Per-message hover menu (Copy / Message info) + the expandable info panel.
  const [menuOpen, setMenuOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);
  const copyText = message.body ?? '';
  // Resolve the message this bubble is replying to, if any. Match by
  // waMessageId since that's what Meta uses for cross-message references.
  // Falls through to undefined if the original isn't in the loaded window.
  const quoted = message.repliedToWaMessageId && allMessages
    ? allMessages.find((m) => m.waMessageId === message.repliedToWaMessageId)
    : undefined;
  // FAILED-state messages can't be replied to (they don't have a waMessageId
  // on Meta's side yet). Same for our own optimistic temp bubbles.
  const canReply =
    Boolean(onReply) &&
    Boolean(message.waMessageId) &&
    message.status !== 'FAILED' &&
    !message.id.startsWith('temp-');
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isOut ? 'flex-end' : 'flex-start',
        marginBottom: 2,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Inline ad-context card — sits on the same side as the bubble and
          identifies which click-to-WhatsApp ad triggered this specific
          reply. Renders only on the exact message that carried the
          referral; subsequent unattributed replies fall back to the
          thread-level AdReferralBanner shown above the messages list. */}
      {message.adReferral ? (
        <InlineAdReferralCard referral={message.adReferral} isOut={isOut} />
      ) : null}
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
        {/* Hover Reply button — appears on the opposite side of the bubble
            (outbound bubble = button on left, inbound bubble = button on
            right). Hidden for FAILED / optimistic messages since they have
            no waMessageId yet. */}
        {hovered && canReply ? (
          <button
            type="button"
            onClick={onReply}
            title="Reply"
            style={{
              all: 'unset',
              cursor: 'pointer',
              position: 'absolute',
              top: '50%',
              transform: 'translateY(-50%)',
              [isOut ? 'right' : 'left']: 'calc(100% + 6px)',
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--sos-surface-2, #1f2c33)',
              color: 'var(--sos-text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }}
          >
            <Reply size={14} />
          </button>
        ) : null}
        {/* If this message is a reply, render the quoted message above
            the body. Click jumps to the original (browser native anchor
            scroll-into-view via id). */}
        {/* Hover chevron → per-message menu (Copy / Message info). */}
        <div ref={menuRef} style={{ position: 'absolute', top: 2, right: 3, zIndex: 6 }}>
          {hovered || menuOpen ? (
            <button
              type="button"
              aria-label="Message menu"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              style={{
                all: 'unset', cursor: 'pointer',
                width: 22, height: 18, borderRadius: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isOut ? 'var(--wa-bubble-out)' : 'var(--wa-bubble-in)',
                color: 'var(--sos-text-muted)',
              }}
            >
              <ChevronDown size={15} />
            </button>
          ) : null}
          {menuOpen ? (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', top: 'calc(100% + 2px)', right: 0,
                minWidth: 158, background: 'var(--sos-surface-2)',
                border: '1px solid var(--sos-border-subtle)', borderRadius: 8,
                boxShadow: '0 6px 20px rgba(0,0,0,0.3)', padding: 4, zIndex: 30,
              }}
            >
              {copyText ? (
                <BubbleMenuItem
                  icon={<Copy size={15} />}
                  label="Copy"
                  onClick={() => { void navigator.clipboard?.writeText(copyText).catch(() => {}); setMenuOpen(false); }}
                />
              ) : null}
              <BubbleMenuItem
                icon={<Info size={15} />}
                label={showInfo ? 'Hide info' : 'Message info'}
                onClick={() => { setShowInfo((s) => !s); setMenuOpen(false); }}
              />
            </div>
          ) : null}
        </div>
        {quoted ? <QuotedMessagePreview quoted={quoted} /> : null}
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
            <MediaBubbleContent message={message} onImageClick={onImageClick} />
          ) : isSpecial ? (
            <SpecialMessageContent message={message} />
          ) : message.body != null ? (
            <FormattedText text={message.body} />
          ) : message.templateName ? (
            `📋 Template: ${message.templateName}`
          ) : (
            `[${message.type.toLowerCase()}]`
          )}
          {/* Caption below media if present */}
          {isMedia && message.body && (
            <div style={{ marginTop: 4, fontSize: 13, whiteSpace: 'pre-wrap' }}>
              <FormattedText text={message.body} />
            </div>
          )}
        </div>
        {/* Message info panel — delivery milestones from the stored timestamps. */}
        {showInfo ? (
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid var(--sos-border-subtle)',
              fontSize: 11,
              color: 'var(--sos-text-muted)',
              lineHeight: 1.6,
            }}
          >
            {isOut ? (
              <>
                {message.sentAt ? <div>Sent · {fmtInfoTime(message.sentAt)}</div> : null}
                {message.deliveredAt ? <div>Delivered · {fmtInfoTime(message.deliveredAt)}</div> : null}
                {message.readAt ? <div>Read · {fmtInfoTime(message.readAt)}</div> : null}
                {!message.sentAt && !message.deliveredAt && !message.readAt ? (
                  <div>Not sent yet</div>
                ) : null}
              </>
            ) : (
              <div>Received · {fmtInfoTime(message.createdAt)}</div>
            )}
          </div>
        ) : null}
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
        {/* Visible failure reason — so a failed send shows WHY (e.g. a Meta
            billing block) instead of only a red ✗ the rep has to hover. */}
        {isOut && message.status === 'FAILED' ? (
          <div
            title={`${message.errorTitle ?? 'Failed'}${message.errorCode ? ` (Meta code ${message.errorCode})` : ''}`}
            style={{
              marginTop: 5,
              paddingTop: 4,
              borderTop: '1px solid var(--sos-border-subtle)',
              fontSize: 11.5,
              lineHeight: 1.35,
              fontWeight: 600,
              color: 'var(--sos-status-danger)',
            }}
          >
            ⚠ {failureReason(message.errorCode, message.errorTitle)}
          </div>
        ) : null}
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

/**
 * Friendly, actionable reason for a failed outbound message, mapped from Meta's
 * error code (stored on the message). Rendered as a visible red line under the
 * bubble so reps see WHY a send failed instead of just a red ✗.
 */
function failureReason(code: string | null, title: string | null): string {
  switch (code) {
    case '131042':
      return 'WhatsApp Business payment issue — check the payment method / billing in Meta Business Manager.';
    case '131047':
      return 'The 24-hour reply window is closed — use an approved template to reopen.';
    case '131048':
      return 'Meta rate limit reached for this number — try again shortly.';
    case '131049':
    case '130472':
      return 'Meta limited this marketing message to the recipient — use a utility template or space sends out.';
    case '131026':
      return "This number can't receive WhatsApp messages.";
    case '132000':
    case '132001':
    case '132005':
    case '132007':
    case '132012':
    case '132015':
    case '132016':
      return `Template problem${title ? ` — ${title}` : ''}. Check the template's status / parameters in WhatsApp Manager.`;
    case '190':
      return 'WhatsApp connection expired — re-save the access token in Admin → Settings.';
    case 'internal':
      return title ?? 'Internal error while sending.';
    default:
      return title ? `Not delivered — ${title}` : 'Not delivered.';
  }
}

// ---- Attach-menu item ---------------------------------------------------

function AttachMenuItem(props: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={props.onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        borderRadius: 6,
        color: 'var(--sos-text-primary)',
        fontSize: 13,
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <span style={{ color: 'var(--wa-accent)' }}>{props.icon}</span>
      {props.label}
    </button>
  );
}

// ---- Composer -----------------------------------------------------------

// A curated set of common emojis for the composer picker — client-only, no
// library. Inserted at the caret as plain unicode (renders on the customer side
// like any other text). Kept small on purpose (fast, no scroll fatigue).
const COMPOSER_EMOJIS = [
  '😀','😃','😄','😁','😅','😂','🙂','😊','😉','😍','😘','😎','🤔','😐','🙄','😴',
  '😢','😭','😤','😠','👍','👎','👏','🙏','💪','🙌','👌','✌️','🤝','👋','❤️','🧡',
  '💛','💚','💙','💜','🔥','✨','🎉','✅','❌','⚠️','📌','📞','📅','⏰','💯','🚀',
];

function ChatComposer(props: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
  onSendMedia: (file: File) => void;
  onOpenCamera: () => void;
  onOpenTemplate: () => void;
  onOpenQuickReplies: () => void;
  disabled: boolean;
  sending: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // + attach menu state
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const attachRootRef = useRef<HTMLDivElement | null>(null);
  // Emoji picker state — textarea ref lets us insert at the caret, not just append.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiRootRef = useRef<HTMLDivElement | null>(null);
  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) { props.onChange(props.value + emoji); return; }
    const start = el.selectionStart ?? props.value.length;
    const end = el.selectionEnd ?? props.value.length;
    props.onChange(props.value.slice(0, start) + emoji + props.value.slice(end));
    // Restore focus + caret just after the inserted emoji (post-render).
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      try { el.setSelectionRange(pos, pos); } catch { /* selection may be unavailable */ }
    });
  };

  // Close attach menu on outside-click / Escape so it behaves like a
  // proper dropdown rather than a stuck overlay.
  useEffect(() => {
    if (!attachMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!attachRootRef.current) return;
      if (!attachRootRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAttachMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [attachMenuOpen]);

  // Same outside-click / Escape close for the emoji picker.
  useEffect(() => {
    if (!emojiOpen) return;
    const onDown = (e: MouseEvent) => {
      if (emojiRootRef.current && !emojiRootRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [emojiOpen]);

  const pickFile = (kind: 'image' | 'video' | 'document') => {
    setAttachMenuOpen(false);
    const ref =
      kind === 'image' ? imageInputRef : kind === 'video' ? videoInputRef : docInputRef;
    // Reset so picking the SAME file twice in a row still fires onChange.
    if (ref.current) {
      ref.current.value = '';
      ref.current.click();
    }
  };

  const onFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) props.onSendMedia(file);
    // Allow re-selecting the same file later.
    e.target.value = '';
  };

  const startRecording = async () => {
    if (props.disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,   // mono — Meta OGG voice notes are mono-only
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      // The server re-encodes every voice note to Ogg/Opus with ffmpeg
      // before handing it to Meta, so we just need ANY format the browser
      // can actually produce — the backend normalises it. (Raw
      // MediaRecorder output — WebM, MP4, even Chrome's mislabeled "ogg" —
      // sniffs as video/* on Meta's side and fails delivery with 131053,
      // which is exactly why the transcode exists.) Order by fidelity:
      const candidates = [
        'audio/webm;codecs=opus', // Chrome / Edge / Firefox (Opus, best quality)
        'audio/ogg;codecs=opus',  // Firefox native Ogg/Opus
        'audio/mp4',              // Safari / iOS (AAC)
        'audio/webm',
        'audio/aac',
        'audio/mpeg',
      ];
      const mimeType = candidates.find((c) => MediaRecorder.isTypeSupported(c));
      if (!mimeType) {
        stream.getTracks().forEach((t) => t.stop());
        alert(
          'Your browser cannot record in a WhatsApp-compatible audio format. ' +
            'Try Chrome, Firefox, or Safari on a current OS.',
        );
        return;
      }
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
      timerRef.current = setInterval(() => {
        setRecordingSecs((s) => {
          const next = s + 1;
          // Auto-stop at 120 s — files larger than ~512 KB show a download
          // icon instead of inline play on the recipient's WhatsApp.
          if (next >= 120) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
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
          {/* + attach menu — image / video / document */}
          <div
            ref={attachRootRef}
            style={{ position: 'relative', flexShrink: 0 }}
          >
            <button
              type="button"
              title="Attach image, video, or document"
              onClick={() => setAttachMenuOpen((o) => !o)}
              disabled={props.disabled}
              style={{
                all: 'unset',
                cursor: props.disabled ? 'not-allowed' : 'pointer',
                color: attachMenuOpen ? 'var(--wa-accent)' : 'var(--sos-text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: '50%',
                transition: 'background 0.15s, transform 0.15s',
                transform: attachMenuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                opacity: props.disabled ? 0.4 : 1,
              }}
              onMouseEnter={(e) => {
                if (!props.disabled)
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              <Plus size={22} />
            </button>

            {attachMenuOpen ? (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: 0,
                  minWidth: 180,
                  background: 'var(--sos-surface-2, #1f2c33)',
                  border: '1px solid var(--sos-border-subtle, rgba(255,255,255,0.08))',
                  borderRadius: 10,
                  padding: 6,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  zIndex: 50,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <AttachMenuItem
                  icon={<Camera size={18} />}
                  label="Camera"
                  onClick={() => {
                    setAttachMenuOpen(false);
                    props.onOpenCamera();
                  }}
                />
                <AttachMenuItem
                  icon={<ImageIcon size={18} />}
                  label="Photo"
                  onClick={() => pickFile('image')}
                />
                <AttachMenuItem
                  icon={<VideoIcon size={18} />}
                  label="Video"
                  onClick={() => pickFile('video')}
                />
                <AttachMenuItem
                  icon={<FileIcon size={18} />}
                  label="Document"
                  onClick={() => pickFile('document')}
                />
              </div>
            ) : null}

            {/* Hidden file inputs. Three of them so the OS file-picker
                pre-filters to the correct media type — better UX than one
                generic input that shows every file on the user's disk. */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={onFileChosen}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/3gpp"
              style={{ display: 'none' }}
              onChange={onFileChosen}
            />
            <input
              ref={docInputRef}
              type="file"
              accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
              style={{ display: 'none' }}
              onChange={onFileChosen}
            />
          </div>

          {/* Rounded input pill — WhatsApp-style. The textarea grows, with the
              quick-reply (⚡) and template (📄) actions tucked inside the pill
              on the right so they don't eat a separate column of space. */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'flex-end',
              gap: 2,
              background: 'var(--wa-composer-input-bg)',
              borderRadius: 22,
              padding: '0 4px 0 6px',
              opacity: props.disabled ? 0.6 : 1,
            }}
          >
            <textarea
              ref={textareaRef}
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
                minWidth: 0,
                background: 'transparent',
                color: 'var(--sos-text-primary)',
                border: 'none',
                padding: '10px 6px',
                fontSize: 14,
                lineHeight: '1.4',
                resize: 'none',
                outline: 'none',
                maxHeight: 120,
                fontFamily: 'inherit',
              }}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
            />
            {/* Emoji picker — client-only unicode insert at the caret. */}
            <div ref={emojiRootRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                title="Emoji"
                onClick={() => setEmojiOpen((o) => !o)}
                disabled={props.disabled}
                style={{
                  all: 'unset', cursor: props.disabled ? 'not-allowed' : 'pointer',
                  color: emojiOpen ? 'var(--wa-accent)' : 'var(--sos-text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 36, borderRadius: '50%',
                  opacity: props.disabled ? 0.4 : 1,
                }}
              >
                <Smile size={19} />
              </button>
              {emojiOpen ? (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 8px)',
                    right: 0,
                    width: 272,
                    maxHeight: 220,
                    overflowY: 'auto',
                    background: 'var(--sos-surface-2)',
                    border: '1px solid var(--sos-border-subtle)',
                    borderRadius: 12,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
                    padding: 8,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(8, 1fr)',
                    gap: 2,
                    zIndex: 40,
                  }}
                >
                  {COMPOSER_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => insertEmoji(em)}
                      style={{
                        all: 'unset', cursor: 'pointer', fontSize: 20,
                        textAlign: 'center', borderRadius: 6, height: 30, lineHeight: '30px',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--wa-composer-input-bg)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {/* Quick replies — saved snippets inserted into the box. */}
            <button
              type="button"
              title="Insert a quick reply"
              onClick={props.onOpenQuickReplies}
              disabled={props.disabled}
              style={{
                all: 'unset', cursor: props.disabled ? 'not-allowed' : 'pointer',
                color: 'var(--sos-text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 36, borderRadius: '50%', flexShrink: 0,
                transition: 'color 0.15s',
                opacity: props.disabled ? 0.4 : 1,
              }}
              onMouseEnter={(e) => {
                if (!props.disabled)
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--wa-accent)';
              }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--sos-text-muted)'; }}
            >
              <Zap size={19} />
            </button>
            {/* Template message */}
            <button
              type="button"
              title="Send a template message"
              onClick={props.onOpenTemplate}
              style={{
                all: 'unset', cursor: 'pointer',
                color: props.disabled ? 'var(--wa-accent)' : 'var(--sos-text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 36, borderRadius: '50%', flexShrink: 0,
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wa-accent)'; }}
              onMouseLeave={(e) => { if (!props.disabled) (e.currentTarget as HTMLButtonElement).style.color = 'var(--sos-text-muted)'; }}
            >
              <FileText size={19} />
            </button>
          </div>

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

/** Local-day key (viewer's timezone) for grouping messages by calendar day —
 *  same timezone formatTime() displays in, so separators line up with bubbles. */
function chatDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** WhatsApp-style day label: Today / Yesterday / weekday (last 7 days) / date. */
function formatDaySeparator(iso: string): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Centered date chip shown between message groups, like WhatsApp. */
function DateSeparator({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 8px' }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--sos-text-muted)',
          background: 'var(--sos-surface-2)',
          border: '1px solid var(--sos-border-subtle)',
          borderRadius: 999,
          padding: '3px 12px',
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </span>
    </div>
  );
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
