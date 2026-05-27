'use client';
// Communications Tab — wired to /processing/cases/:id/communications.
// Lists messages sent on this case + a small form to send a new one.
// Channels: PORTAL / WHATSAPP / EMAIL (writes a CaseCommunication row;
// outbound WhatsApp + email transports themselves are wired separately).

import { useEffect, useState } from 'react';
import { Loader2, Mail, MessageSquare, PlusCircle, Send } from 'lucide-react';
import {
  GlassCard,
  EmptyState,
  PrimaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  fmtRelative,
} from '@/components/processing/mockData';
import {
  fetchCaseCommunications,
  sendCaseCommunication,
  type ApiCaseCommunication,
} from '@/lib/processing';

const CHANNEL_OPTIONS = [
  { value: 'PORTAL', label: 'Portal note' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'Email' },
];

function ChannelChip({ channel }: { channel: string }) {
  const c = channel.toUpperCase();
  if (c === 'WHATSAPP') return <StatusBadge tone="success" size="sm">WhatsApp</StatusBadge>;
  if (c === 'EMAIL') return <StatusBadge tone="info" size="sm">Email</StatusBadge>;
  return <StatusBadge tone="neutral" size="sm">{c}</StatusBadge>;
}

function CommunicationCard({ m }: { m: ApiCaseCommunication }) {
  const author = m.sentBy?.email.split('@')[0] ?? (m.direction === 'INBOUND' ? 'Client' : 'Officer');
  const isInbound = m.direction === 'INBOUND';

  return (
    <GlassCard variant="default" padded="md">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ marginTop: 2, color: isInbound ? 'var(--sos-status-success)' : 'var(--sos-brand-primary-strong)' }}>
          {isInbound ? <MessageSquare size={14} /> : <Send size={14} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
            {m.subject ? (
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                {m.subject}
              </span>
            ) : null}
            {m.channelsSent.map((ch) => <ChannelChip key={ch} channel={ch} />)}
            <span style={{ fontSize: 11, color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>
              {author} · {fmtRelative(m.createdAt)}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--sos-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
            {m.content}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function SendForm({ caseId, onSent }: { caseId: string; onSent: (m: ApiCaseCommunication) => void }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [channels, setChannels] = useState<string[]>(['PORTAL']);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleChannel(c: string) {
    setChannels((curr) => curr.includes(c) ? curr.filter((x) => x !== c) : [...curr, c]);
  }

  async function handleSend() {
    if (!subject.trim() || !content.trim() || channels.length === 0) return;
    setSending(true);
    setErr(null);
    try {
      const saved = await sendCaseCommunication(caseId, {
        subject: subject.trim(),
        content: content.trim(),
        channelsSent: channels,
      });
      onSent(saved);
      setSubject('');
      setContent('');
      setChannels(['PORTAL']);
      setOpen(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <PrimaryButton iconLeft={<PlusCircle size={14} />} onClick={() => setOpen(true)}>
        New message
      </PrimaryButton>
    );
  }

  return (
    <GlassCard variant="strong" padded="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          className="sos-input"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <textarea
          rows={5}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Message to the client…"
          style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-primary)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Send via</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CHANNEL_OPTIONS.map((opt) => {
              const active = channels.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleChannel(opt.value)}
                  style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, border: `1px solid ${active ? 'var(--sos-border-accent)' : 'var(--sos-border)'}`, background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)', color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)', cursor: 'pointer' }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        {err ? (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--sos-status-danger-soft)', border: '1px solid var(--sos-status-danger-border)', color: 'var(--sos-status-danger)', fontSize: 12.5 }}>{err}</div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setOpen(false)} style={{ padding: '8px 16px', borderRadius: 'var(--sos-radius-md)', border: '1px solid var(--sos-border-subtle)', background: 'transparent', color: 'var(--sos-text-muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <PrimaryButton onClick={handleSend} disabled={sending || !subject.trim() || !content.trim() || channels.length === 0}>
            {sending ? 'Sending…' : 'Send'}
          </PrimaryButton>
        </div>
      </div>
    </GlassCard>
  );
}

export function CommunicationsTab({ c }: { c: MockProcessingCase }) {
  const [items, setItems] = useState<ApiCaseCommunication[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCaseCommunications(c.id)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load communications'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [c.id]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SendForm caseId={c.id} onSent={(m) => setItems((p) => [m, ...p])} />
      </div>

      {loading ? (
        <GlassCard variant="panel" padded="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
            <Loader2 size={16} className="sos-spin" />
            <span>Loading communications…</span>
          </div>
        </GlassCard>
      ) : err ? (
        <GlassCard variant="panel" padded="md">
          <div style={{ color: 'var(--sos-status-danger)', fontSize: 13 }}>{err}</div>
        </GlassCard>
      ) : items.length === 0 ? (
        <GlassCard variant="panel" padded="lg">
          <EmptyState
            Icon={Mail}
            title="No communications yet"
            description="Send a portal note, WhatsApp message, or email to the client and it'll log here for the whole team to see."
          />
        </GlassCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((m) => <CommunicationCard key={m.id} m={m} />)}
        </div>
      )}
    </div>
  );
}
