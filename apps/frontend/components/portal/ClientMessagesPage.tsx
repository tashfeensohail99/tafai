'use client';
// Client Portal — Messages page — Phase 1C.
// Client sees filtered communication thread (OFFICER_TO_CLIENT, CLIENT_TO_OFFICER, SYSTEM_TO_CLIENT).
// Client can compose a reply. Internal messages are NEVER shown.

import { useState } from 'react';
import { MessageSquare, Send, User, Info } from 'lucide-react';
import { GlassCard } from '@/components/sales-v2/ui';
import {
  MOCK_CLIENT_MESSAGES,
  MOCK_CLIENT,
  MOCK_CLIENT_CASE,
  type ClientMessage,
  fmtDate,
} from '@/components/portal/clientMockData';

// ---------- Message bubble ------------------------------------------------

function MessageBubble({ msg }: { msg: ClientMessage }) {
  const isClient = msg.direction === 'FROM_CLIENT';
  const isSystem = msg.direction === 'FROM_SYSTEM';

  if (isSystem) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
        <div style={{ maxWidth: '480px', padding: '10px 16px', borderRadius: 'var(--sos-radius-lg)', background: 'var(--sos-surface-2)', border: '1px solid var(--sos-border-subtle)', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', marginBottom: '4px' }}>
            <Info size={13} style={{ color: 'var(--sos-text-muted)' }} />
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              System notification
            </span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--sos-text-secondary)', lineHeight: 1.55 }}>{msg.content}</div>
          <div style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginTop: '6px' }}>
            {fmtDate(msg.createdAt)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: isClient ? 'row-reverse' : 'row', gap: '10px', alignItems: 'flex-end', margin: '4px 0' }}>
      {/* Avatar */}
      <div style={{ flexShrink: 0, width: '32px', height: '32px', borderRadius: '50%', background: isClient ? 'var(--sos-brand-primary-soft)' : 'var(--sos-status-success-soft)', border: `1px solid ${isClient ? 'var(--sos-brand-primary-border)' : 'var(--sos-status-success-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: isClient ? 'var(--sos-brand-primary-strong)' : 'var(--sos-status-success)' }}>
        {isClient ? MOCK_CLIENT.initials : MOCK_CLIENT_CASE.assignedOfficerInitials}
      </div>

      {/* Bubble */}
      <div style={{ maxWidth: '72%', minWidth: '0' }}>
        <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexDirection: isClient ? 'row-reverse' : 'row' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
            {isClient ? 'You' : msg.senderName}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--sos-text-muted)' }}>
            {fmtDate(msg.createdAt)}
          </span>
        </div>
        {msg.subject ? (
          <div style={{
            fontSize: '11.5px', fontWeight: 600, color: 'var(--sos-text-muted)',
            marginBottom: '4px',
            textAlign: isClient ? 'right' : 'left',
          }}>
            {msg.subject}
          </div>
        ) : null}
        <div style={{
          padding: '12px 15px',
          borderRadius: isClient ? 'var(--sos-radius-lg) var(--sos-radius-sm) var(--sos-radius-lg) var(--sos-radius-lg)' : 'var(--sos-radius-sm) var(--sos-radius-lg) var(--sos-radius-lg) var(--sos-radius-lg)',
          background: isClient ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-2)',
          border: `1px solid ${isClient ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
          fontSize: '13.5px',
          color: 'var(--sos-text-primary)',
          lineHeight: 1.6,
        }}>
          {msg.content}
        </div>
        {msg.channel !== 'Portal' ? (
          <div style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginTop: '4px', textAlign: isClient ? 'right' : 'left' }}>
            via {msg.channel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Reply composer -------------------------------------------------

function ReplyComposer() {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  function handleSend() {
    if (!text.trim()) return;
    setSending(true);
    // NOTE: In production, call POST /cases/:id/communications with direction=CLIENT_TO_OFFICER
    setTimeout(() => {
      setSending(false);
      setSent(true);
      setText('');
      setTimeout(() => setSent(false), 3000);
    }, 900);
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
          transition: 'border-color 150ms',
        }}
        onFocus={(e) => { e.target.style.borderColor = 'var(--sos-brand-primary-strong)'; }}
        onBlur={(e) => { e.target.style.borderColor = 'var(--sos-border-subtle)'; }}
      />
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
          {sent ? 'Sent!' : sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </GlassCard>
  );
}

// ---------- Client Messages page ------------------------------------------

export function ClientMessagesPage() {
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
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--sos-status-success-soft)', border: '1px solid var(--sos-status-success-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: 'var(--sos-status-success)' }}>
            {MOCK_CLIENT_CASE.assignedOfficerInitials}
          </div>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>
              {MOCK_CLIENT_CASE.assignedOfficerName}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>Your processing officer</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {MOCK_CLIENT_MESSAGES.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--sos-text-muted)' }}>
              <MessageSquare size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
              <div>No messages yet</div>
            </div>
          ) : (
            MOCK_CLIENT_MESSAGES.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))
          )}
        </div>
      </GlassCard>

      <ReplyComposer />
    </div>
  );
}
