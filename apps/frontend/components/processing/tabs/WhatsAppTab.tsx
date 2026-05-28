'use client';
// WhatsApp Tab — the live two-way thread for this case's client, wired to
// /processing/cases/:id/whatsapp (read) + POST (send). Scoped by case access
// on the backend, so processing officers don't need WhatsApp-inbox perms.
// Send respects the 24h customer-service window (enforced server-side too).

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, Image as ImageIcon, Loader2, MessageCircle, Send } from 'lucide-react';
import { GlassCard, EmptyState, PrimaryButton } from '@/components/sales-v2/ui';
import { type MockProcessingCase, fmtRelative } from '@/components/processing/mockData';
import {
  fetchCaseWhatsApp,
  sendCaseWhatsApp,
  type ApiCaseWhatsApp,
  type ApiCaseWhatsAppMessage,
} from '@/lib/processing';

function MessageBubble({ m }: { m: ApiCaseWhatsAppMessage }) {
  const outbound = m.direction === 'OUTBOUND';
  const isMedia = ['IMAGE', 'DOCUMENT', 'VIDEO', 'AUDIO'].includes(m.type);
  const mediaLabel =
    m.type === 'IMAGE' ? 'Photo' : m.type === 'DOCUMENT' ? 'Document' : m.type === 'VIDEO' ? 'Video' : 'Voice note';
  return (
    <div style={{ display: 'flex', justifyContent: outbound ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '75%',
          padding: '8px 12px',
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.5,
          background: outbound ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-hover)',
          border: `1px solid ${outbound ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
          color: 'var(--sos-text-primary)',
        }}
      >
        {isMedia ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--sos-text-secondary)' }}>
            {m.type === 'IMAGE' ? <ImageIcon size={13} /> : <FileText size={13} />}
            {mediaLabel}
            {m.body ? ` · ${m.body}` : ''}
          </span>
        ) : (
          <span style={{ whiteSpace: 'pre-wrap' }}>{m.body ?? ''}</span>
        )}
        <div style={{ fontSize: 10, color: 'var(--sos-text-muted)', marginTop: 4, textAlign: outbound ? 'right' : 'left' }}>
          {fmtRelative(m.createdAt)}
          {outbound ? ` · ${m.status.toLowerCase()}` : ''}
        </div>
      </div>
    </div>
  );
}

export function WhatsAppTab({ c }: { c: MockProcessingCase }) {
  const [data, setData] = useState<ApiCaseWhatsApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendWarn, setSendWarn] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const d = await fetchCaseWhatsApp(c.id);
      setData(d);
      setErr(null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load WhatsApp');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000); // light poll for new inbound
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [data?.messages.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setSendWarn(null);
    try {
      const res = await sendCaseWhatsApp(c.id, body);
      if (res.success) {
        setDraft('');
        await load();
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

  const windowOpen = data?.windowOpen ?? false;

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
        ref={scrollRef}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 440, overflowY: 'auto', padding: '4px 2px', marginBottom: 10 }}
      >
        {!data?.threadId ? (
          <EmptyState
            Icon={MessageCircle}
            title="No WhatsApp conversation yet"
            description="When this client messages your business number on WhatsApp, the conversation appears here."
          />
        ) : data.messages.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--sos-text-muted)', textAlign: 'center', padding: 16 }}>No messages yet.</div>
        ) : (
          data.messages.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
      </div>

      {data?.threadId && !windowOpen ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)', border: '1px solid var(--sos-border-subtle)' }}>
          <AlertTriangle size={14} style={{ color: 'var(--sos-status-warning)', marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: 'var(--sos-text-secondary)' }}>
            The 24-hour reply window is closed — WhatsApp only allows free-text replies within 24h of the client&apos;s last message. They need to message first, or send an approved template from the WhatsApp inbox.
          </div>
        </div>
      ) : data?.threadId ? (
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
