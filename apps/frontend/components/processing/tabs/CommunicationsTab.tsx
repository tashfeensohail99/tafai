'use client';
// Communications Tab — Phase 1B.
// Read thread of portal + WhatsApp messages. Compose button placeholder.

import { MessageSquare, Send, User } from 'lucide-react';
import { GlassCard, EmptyState, PrimaryButton, StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  type MockCommunication,
  fmtRelative,
} from '@/components/processing/mockData';

function directionTone(direction: MockCommunication['direction']): BadgeTone {
  if (direction === 'CLIENT_TO_OFFICER') return 'accent';
  if (direction === 'SYSTEM_TO_CLIENT') return 'neutral';
  return 'info';
}

function directionLabel(direction: MockCommunication['direction']): string {
  if (direction === 'CLIENT_TO_OFFICER') return 'Client → Us';
  if (direction === 'SYSTEM_TO_CLIENT') return 'System';
  return 'Us → Client';
}

export function CommunicationsTab({ c }: { c: MockProcessingCase }) {
  if (c.communications.length === 0) {
    return (
      <GlassCard variant="panel" padded="lg">
        <EmptyState
          Icon={MessageSquare}
          title="No messages yet"
          description="Send the welcome message or request documents using the compose button."
        />
      </GlassCard>
    );
  }

  const msgs = [...c.communications].reverse();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <PrimaryButton iconLeft={<Send size={14} />} onClick={() => {}}>
          Send message
        </PrimaryButton>
      </div>

      {msgs.map((msg) => {
        const isFromClient = msg.direction === 'CLIENT_TO_OFFICER';
        return (
          <GlassCard key={msg.id} variant="default" padded="md">
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: isFromClient ? 'var(--sos-status-info-soft)' : 'var(--sos-brand-primary-soft)', border: `1px solid ${isFromClient ? 'var(--sos-status-info-border)' : 'var(--sos-brand-primary-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <User size={14} style={{ color: isFromClient ? 'var(--sos-status-info)' : 'var(--sos-brand-primary-strong)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-primary)' }}>{msg.sentByName}</span>
                  <StatusBadge tone={directionTone(msg.direction)} size="sm" dot={false}>{directionLabel(msg.direction)}</StatusBadge>
                  <span style={{ fontSize: '11px', color: 'var(--sos-text-muted)', marginLeft: 'auto' }}>{fmtRelative(msg.createdAt)}</span>
                </div>
                <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--sos-text-primary)', marginTop: '2px' }}>{msg.subject}</div>
              </div>
            </div>

            {/* Message body */}
            <div style={{ fontSize: '13.5px', color: 'var(--sos-text-primary)', lineHeight: 1.6, padding: '12px 14px', borderRadius: 'var(--sos-radius-md)', background: 'var(--sos-surface-hover)' }}>
              {msg.content}
            </div>

            {/* Footer */}
            <div style={{ marginTop: '8px', display: 'flex', gap: '10px', alignItems: 'center', fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>
              Sent via: {msg.channelsSent.join(', ')}
              {msg.readByClientAt ? (
                <span style={{ color: 'var(--sos-status-success)' }}>· Read {fmtRelative(msg.readByClientAt)}</span>
              ) : (
                <span>· Not yet read</span>
              )}
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}
