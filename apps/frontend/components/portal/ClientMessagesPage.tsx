'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Send, Info } from 'lucide-react';
import { GlassCard } from '@/components/sales-v2/ui';
import {
  fmtDate,
  getCommunications,
  sendMessage,
  type PortalMessage,
} from '@/lib/portal';
import { useClientSession } from '@/components/layout/ClientPortalShell';

function initialsFor(name: string | null, fallback: string): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function MessageBubble({
  msg,
  clientInitials,
  officerInitials,
}: {
  msg: PortalMessage;
  clientInitials: string;
  officerInitials: string;
}) {
  const isClient = msg.direction === 'CLIENT_TO_OFFICER';
  const isSystem = msg.direction === 'SYSTEM_TO_CLIENT';

  if (isSystem) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
        <div
          style={{
            maxWidth: '480px',
            padding: '10px 16px',
            borderRadius: 'var(--sos-radius-lg)',
            background: 'var(--sos-surface-2)',
            border: '1px solid var(--sos-border-subtle)',
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', marginBottom: '4px' }}>
            <Info size={13} style={{ color: 'var(--sos-text-muted)' }} />
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              System notification
            </span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-secondary)', lineHeight: 1.55 }}>{msg.content}</div>
          <div style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginTop: '6px' }}>{fmtDate(msg.createdAt)}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: isClient ? 'row-reverse' : 'row', gap: '10px', alignItems: 'flex-end', margin: '4px 0' }}>
      <div
        style={{
          flexShrink: 0,
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          background: isClient ? 'var(--sos-brand-primary-soft)' : 'var(--sos-status-success-soft)',
          border: `1px solid ${isClient ? 'var(--sos-brand-primary-border)' : 'var(--sos-status-success-border)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          fontWeight: 700,
          color: isClient ? 'var(--sos-brand-primary-strong)' : 'var(--sos-status-success)',
        }}
      >
        {isClient ? clientInitials : officerInitials}
      </div>

      <div style={{ maxWidth: '72%', minWidth: '0' }}>
        <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexDirection: isClient ? 'row-reverse' : 'row' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
            {isClient ? 'You' : msg.senderName ?? 'Your officer'}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--sos-text-muted)' }}>{fmtDate(msg.createdAt)}</span>
        </div>
        {msg.subject ? (
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)', marginBottom: '4px', textAlign: isClient ? 'right' : 'left' }}>
            {msg.subject}
          </div>
        ) : null}
        <div
          style={{
            padding: '12px 15px',
            borderRadius: isClient
              ? 'var(--sos-radius-lg) var(--sos-radius-sm) var(--sos-radius-lg) var(--sos-radius-lg)'
              : 'var(--sos-radius-sm) var(--sos-radius-lg) var(--sos-radius-lg) var(--sos-radius-lg)',
            background: isClient ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-2)',
            border: `1px solid ${isClient ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
            fontSize: '13.5px',
            color: 'var(--sos-text-primary)',
            lineHeight: 1.6,
          }}
        >
          {msg.content}
        </div>
      </div>
    </div>
  );
}

function ReplyComposer({ caseId, onSent }: { caseId: string; onSent: () => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendMessage(caseId, { content: text.trim() });
      setText('');
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <GlassCard variant="panel" padded="md">
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-muted)', marginBottom: '10px' }}>
        Reply to your officer
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your message here…"
        rows={4}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '12px 14px',
          borderRadius: 'var(--sos-radius-md)',
          border: '1px solid var(--sos-border-subtle)',
          background: 'var(--sos-surface-2)',
          color: 'var(--sos-text-primary)',
          fontSize: '13.5px',
          lineHeight: 1.6,
          resize: 'vertical',
          outline: 'none',
          fontFamily: 'inherit',
          marginBottom: '10px',
        }}
      />
      {error ? (
        <div className="sos-banner sos-banner--danger" style={{ marginBottom: 10 }}>{error}</div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '12px', color: 'var(--sos-text-muted)' }}>
          Your officer typically responds within 1–2 business days
        </div>
        <button
          type="button"
          className="sos-btn sos-btn--primary"
          onClick={handleSend}
          disabled={!text.trim() || sending}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Send size={14} />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </GlassCard>
  );
}

export function ClientMessagesPage() {
  const { user, activeCase, refreshCases } = useClientSession();
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCase) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await getCommunications(activeCase.id);
      setMessages(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [activeCase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!activeCase) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div className="sos-text-muted" style={{ textAlign: 'center', padding: 24 }}>
          No active case yet. Once your case is assigned you can message your officer here.
        </div>
      </GlassCard>
    );
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--sos-text-muted)' }}>Loading messages…</div>;
  }
  if (error) {
    return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error}</div>;
  }

  const clientInitials = initialsFor(user.email, 'C');
  const officerInitials = initialsFor(activeCase.assignedOfficerName, 'O');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--sos-text-primary)', margin: 0, marginBottom: '4px' }}>
          Messages
        </h1>
        <div style={{ fontSize: '13.5px', color: 'var(--sos-text-muted)' }}>
          Communication between you and your assigned officer
        </div>
      </div>

      <GlassCard variant="panel" padded="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0', borderBottom: '1px solid var(--sos-border-subtle)', marginBottom: '12px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'var(--sos-status-success-soft)',
              border: '1px solid var(--sos-status-success-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--sos-status-success)',
            }}
          >
            {officerInitials}
          </div>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {activeCase.assignedOfficerName ?? 'Officer not yet assigned'}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>Your processing officer</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--sos-text-muted)' }}>
              <MessageSquare size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
              <div>No messages yet</div>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} clientInitials={clientInitials} officerInitials={officerInitials} />
            ))
          )}
        </div>
      </GlassCard>

      <ReplyComposer
        caseId={activeCase.id}
        onSent={() => {
          void load();
          void refreshCases();
        }}
      />
    </div>
  );
}
