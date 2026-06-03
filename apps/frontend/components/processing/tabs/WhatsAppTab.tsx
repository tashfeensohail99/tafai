'use client';
// WhatsApp Tab — the live two-way thread for this case's client, wired to
// /processing/cases/:id/whatsapp (read, paginated) + POST (send). Scoped by
// case access on the backend, so processing officers don't need WhatsApp-inbox
// perms. Renders the COMPLETE history (load older), inline media (photos / voice
// / documents), delivery/read ticks, and clock-time stamps. Send respects the
// 24h customer-service window (enforced server-side too).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  Download,
  FileText,
  Film,
  Loader2,
  MessageCircle,
  Send,
} from 'lucide-react';
import { GlassCard, EmptyState, PrimaryButton, SecondaryButton } from '@/components/sales-v2/ui';
import { type MockProcessingCase } from '@/components/processing/mockData';
import {
  fetchCaseWhatsApp,
  sendCaseWhatsApp,
  type ApiCaseWhatsAppMessage,
} from '@/lib/processing';

function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function StatusTicks({ status }: { status: string }) {
  const s = (status || '').toUpperCase();
  if (s === 'READ') return <CheckCheck size={13} style={{ color: '#34b7f1' }} />;
  if (s === 'DELIVERED') return <CheckCheck size={13} style={{ color: 'var(--sos-text-muted)' }} />;
  if (s === 'SENT') return <Check size={13} style={{ color: 'var(--sos-text-muted)' }} />;
  if (s === 'FAILED') return <span style={{ color: 'var(--sos-status-danger)', fontSize: 10 }}>failed</span>;
  return <Clock size={11} style={{ color: 'var(--sos-text-muted)' }} />; // QUEUED / PENDING
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--sos-text-muted)', fontStyle: 'italic', fontSize: 12.5 }}>
      <AlertTriangle size={12} /> {label} · unavailable
    </span>
  );
}

function MessageBody({ m }: { m: ApiCaseWhatsAppMessage }) {
  const t = (m.type || 'TEXT').toUpperCase();
  const url = m.mediaSignedUrl;

  if (t === 'IMAGE' || t === 'STICKER') {
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt="photo" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, display: 'block' }} />
      </a>
    ) : <MediaUnavailable label="Photo" />;
  }
  if (t === 'AUDIO' || t === 'VOICE') {
    return url ? (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <audio controls src={url} style={{ width: 220, maxWidth: '100%' }} />
    ) : <MediaUnavailable label="Voice note" />;
  }
  if (t === 'VIDEO') {
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--sos-brand-primary-strong)', fontSize: 13 }}>
        <Film size={14} /> {m.mediaFilename || 'Video'} <Download size={12} />
      </a>
    ) : <MediaUnavailable label="Video" />;
  }
  if (t === 'DOCUMENT') {
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--sos-brand-primary-strong)', fontSize: 13 }}>
        <FileText size={14} /> {m.mediaFilename || 'Document'} <Download size={12} />
      </a>
    ) : <MediaUnavailable label={m.mediaFilename || 'Document'} />;
  }
  // TEXT and everything else
  return <span style={{ whiteSpace: 'pre-wrap' }}>{m.body ?? ''}</span>;
}

function MessageBubble({ m }: { m: ApiCaseWhatsAppMessage }) {
  const outbound = m.direction === 'OUTBOUND';
  const isMedia = ['IMAGE', 'STICKER', 'AUDIO', 'VOICE', 'VIDEO', 'DOCUMENT'].includes((m.type || '').toUpperCase());
  const hasCaption = isMedia && !!m.body && !['VIDEO', 'DOCUMENT'].includes((m.type || '').toUpperCase());
  return (
    <div style={{ display: 'flex', justifyContent: outbound ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '78%',
          padding: '8px 12px',
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.5,
          background: outbound ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-hover)',
          border: `1px solid ${outbound ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
          color: 'var(--sos-text-primary)',
        }}
      >
        <MessageBody m={m} />
        {hasCaption ? <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{m.body}</div> : null}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: outbound ? 'flex-end' : 'flex-start', gap: 4, fontSize: 10, color: 'var(--sos-text-muted)', marginTop: 4 }}>
          <span>{fmtClock(m.createdAt)}</span>
          {outbound ? <StatusTicks status={m.status} /> : null}
        </div>
      </div>
    </div>
  );
}

export function WhatsAppTab({ c }: { c: MockProcessingCase }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const [messages, setMessages] = useState<ApiCaseWhatsAppMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendWarn, setSendWarn] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const restoreHeightRef = useRef<number | null>(null);
  const initialisedRef = useRef(false);

  const merge = useCallback((incoming: ApiCaseWhatsAppMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m); // incoming wins → status updates apply
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const loadLatest = useCallback(async () => {
    try {
      const d = await fetchCaseWhatsApp(c.id);
      setThreadId(d.threadId);
      setWindowOpen(d.windowOpen);
      merge(d.messages);
      if (!initialisedRef.current) { setHasMore(!!d.hasMore); initialisedRef.current = true; }
      setErr(null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load WhatsApp');
    } finally {
      setLoading(false);
    }
  }, [c.id, merge]);

  useEffect(() => {
    void loadLatest();
    const t = setInterval(() => void loadLatest(), 15000); // light poll for new inbound + status
    return () => clearInterval(t);
  }, [loadLatest]);

  async function loadOlder() {
    if (!messages.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const d = await fetchCaseWhatsApp(c.id, messages[0].createdAt);
      const fresh = d.messages.filter((m) => !messages.some((x) => x.id === m.id));
      if (fresh.length) {
        restoreHeightRef.current = scrollerRef.current?.scrollHeight ?? 0; // preserve view on prepend
        merge(d.messages);
      }
      setHasMore(!!d.hasMore);
    } catch {
      /* non-fatal */
    } finally {
      setLoadingOlder(false);
    }
  }

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (restoreHeightRef.current != null) {
      el.scrollTop = el.scrollHeight - restoreHeightRef.current; // keep position after loading older
      restoreHeightRef.current = null;
    } else {
      el.scrollTop = el.scrollHeight; // stick to bottom on new / initial
    }
  }, [messages]);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setSendWarn(null);
    try {
      const res = await sendCaseWhatsApp(c.id, body);
      if (res.success) {
        setDraft('');
        await loadLatest();
      } else {
        setSendWarn(res.reason ?? 'Message could not be sent');
      }
    } catch (e: unknown) {
      setSendWarn(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
          <Loader2 size={16} className="sos-spin" />
          <span>Loading WhatsApp…</span>
        </div>
      </GlassCard>
    );
  }
  if (err) {
    return (
      <GlassCard variant="panel" padded="md">
        <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>
      </GlassCard>
    );
  }

  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <MessageCircle size={15} style={{ color: 'var(--sos-status-success)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sos-text-primary)' }}>WhatsApp · {c.clientName}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: windowOpen ? 'var(--sos-status-success)' : 'var(--sos-text-muted)' }}>
          {windowOpen ? '24h reply window open' : 'reply window closed'}
        </span>
      </div>

      <div
        ref={scrollerRef}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 460, overflowY: 'auto', padding: '4px 2px', marginBottom: 10 }}
      >
        {!threadId ? (
          <EmptyState
            Icon={MessageCircle}
            title="No WhatsApp conversation yet"
            description="When this client messages your business number on WhatsApp, the full conversation appears here."
          />
        ) : messages.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', textAlign: 'center', padding: 16 }}>No messages yet.</div>
        ) : (
          <>
            {hasMore ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 6px' }}>
                <SecondaryButton onClick={loadOlder} disabled={loadingOlder} iconLeft={loadingOlder ? <Loader2 size={13} className="sos-spin" /> : undefined}>
                  {loadingOlder ? 'Loading…' : 'Load older messages'}
                </SecondaryButton>
              </div>
            ) : null}
            {messages.map((m) => <MessageBubble key={m.id} m={m} />)}
          </>
        )}
      </div>

      {threadId && !windowOpen ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', border: '1px solid var(--sos-border-subtle)' }}>
          <AlertTriangle size={14} style={{ color: 'var(--sos-status-warning)', marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary)' }}>
            The 24-hour reply window is closed — WhatsApp only allows free-text replies within 24h of the client&apos;s last message. They need to message first, or send an approved template from the WhatsApp inbox.
          </div>
        </div>
      ) : threadId ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sendWarn ? <div style={{ fontSize: 12, color: 'var(--sos-status-danger)' }}>{sendWarn}</div> : null}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Message the client on WhatsApp…"
              style={{ flex: 1, resize: 'vertical', padding: '9px 11px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13, fontFamily: 'inherit' }}
            />
            <PrimaryButton iconLeft={<Send size={14} />} onClick={handleSend} disabled={sending || !draft.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </PrimaryButton>
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}
