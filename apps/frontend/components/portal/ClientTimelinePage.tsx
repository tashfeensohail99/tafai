'use client';
// Client Portal — Timeline page — Phase 1C.
// Filtered view — no internal notes, no STRATEGY or MANAGER_ONLY events.
// Client sees only events relevant to their case progress.

import {
  CheckCircle2,
  AlertTriangle,
  MessageSquare,
  LayoutDashboard,
  Bell,
  GitCommitHorizontal,
} from 'lucide-react';
import { GlassCard } from '@/components/sales-v2/ui';
import {
  MOCK_CLIENT_TIMELINE,
  type ClientTimelineItem,
  fmtDate,
} from '@/components/portal/clientMockData';

// ---------- Icon map -------------------------------------------------------

function TimelineIcon({ icon }: { icon: ClientTimelineItem['icon'] }) {
  const iconStyle = { flexShrink: 0 };
  if (icon === 'case') return <LayoutDashboard size={15} style={iconStyle} />;
  if (icon === 'stage') return <GitCommitHorizontal size={15} style={iconStyle} />;
  if (icon === 'document_ok') return <CheckCircle2 size={15} style={iconStyle} />;
  if (icon === 'document_warn') return <AlertTriangle size={15} style={iconStyle} />;
  if (icon === 'message') return <MessageSquare size={15} style={iconStyle} />;
  return <Bell size={15} style={iconStyle} />;
}

function iconColor(icon: ClientTimelineItem['icon']): string {
  if (icon === 'document_ok') return 'var(--sos-status-success)';
  if (icon === 'document_warn') return 'var(--sos-status-warning)';
  if (icon === 'stage') return 'var(--sos-brand-primary-strong)';
  if (icon === 'message') return 'var(--sos-status-info)';
  if (icon === 'case') return 'var(--sos-text-muted)';
  return 'var(--sos-text-muted)';
}

function iconBg(icon: ClientTimelineItem['icon']): string {
  if (icon === 'document_ok') return 'var(--sos-status-success-soft)';
  if (icon === 'document_warn') return 'var(--sos-status-warning-soft)';
  if (icon === 'stage') return 'var(--sos-brand-primary-soft)';
  if (icon === 'message') return 'var(--sos-status-info-soft)';
  return 'var(--sos-surface-hover)';
}

// ---------- Timeline event -------------------------------------------------

function TimelineEvent({ item, isLast }: { item: ClientTimelineItem; isLast: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '14px', position: 'relative' }}>
      {/* Connector line + dot */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{
          width: '34px', height: '34px', borderRadius: '50%',
          background: iconBg(item.icon),
          border: `1.5px solid ${iconColor(item.icon)}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: iconColor(item.icon),
          zIndex: 1,
        }}>
          <TimelineIcon icon={item.icon} />
        </div>
        {!isLast ? (
          <div style={{ width: '2px', flex: 1, minHeight: '20px', background: 'var(--sos-border-subtle)', margin: '4px 0' }} />
        ) : null}
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingTop: '6px', paddingBottom: isLast ? 0 : '16px' }}>
        <div style={{ fontSize: '13.5px', color: 'var(--sos-text-primary)', lineHeight: 1.55, marginBottom: '5px' }}>
          {item.description}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>{item.actorLabel}</span>
          <span style={{ fontSize: '11px', color: 'var(--sos-border-subtle)' }}>·</span>
          <span style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>{fmtDate(item.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Client Timeline page ------------------------------------------

export function ClientTimelinePage() {
  // Timeline is shown newest-first for the client
  const events = [...MOCK_CLIENT_TIMELINE].reverse();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--sos-text-primary)', margin: 0, marginBottom: '4px' }}>
          Case Timeline
        </h1>
        <div style={{ fontSize: '13.5px', color: 'var(--sos-text-muted)' }}>
          History of your application — most recent first
        </div>
      </div>

      <GlassCard variant="panel" padded="md">
        {events.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--sos-text-muted)' }}>
            No timeline events yet
          </div>
        ) : (
          <div>
            {events.map((item, i) => (
              <TimelineEvent key={item.id} item={item} isLast={i === events.length - 1} />
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
