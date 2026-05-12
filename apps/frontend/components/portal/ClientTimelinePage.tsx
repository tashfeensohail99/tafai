'use client';

import { useCallback, useEffect, useState } from 'react';
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
  fmtDate,
  getTimeline,
  type PortalTimelineEvent,
} from '@/lib/portal';
import { useClientSession } from '@/components/layout/ClientPortalShell';

type IconKey = 'case' | 'stage' | 'document_ok' | 'document_warn' | 'message' | 'system';

function iconKeyFor(evt: PortalTimelineEvent): IconKey {
  if (evt.type === 'STAGE_CHANGE') return 'stage';
  if (evt.type === 'COMMUNICATION') return 'message';
  if (evt.type === 'DOCUMENT_REVIEW') {
    return evt.decision === 'ACCEPTED' ? 'document_ok' : 'document_warn';
  }
  return 'system';
}

function TimelineIcon({ icon }: { icon: IconKey }) {
  const iconStyle = { flexShrink: 0 };
  if (icon === 'case') return <LayoutDashboard size={15} style={iconStyle} />;
  if (icon === 'stage') return <GitCommitHorizontal size={15} style={iconStyle} />;
  if (icon === 'document_ok') return <CheckCircle2 size={15} style={iconStyle} />;
  if (icon === 'document_warn') return <AlertTriangle size={15} style={iconStyle} />;
  if (icon === 'message') return <MessageSquare size={15} style={iconStyle} />;
  return <Bell size={15} style={iconStyle} />;
}

function iconColor(icon: IconKey): string {
  if (icon === 'document_ok') return 'var(--sos-status-success)';
  if (icon === 'document_warn') return 'var(--sos-status-warning)';
  if (icon === 'stage') return 'var(--sos-brand-primary-strong)';
  if (icon === 'message') return 'var(--sos-status-info)';
  return 'var(--sos-text-muted)';
}

function iconBg(icon: IconKey): string {
  if (icon === 'document_ok') return 'var(--sos-status-success-soft)';
  if (icon === 'document_warn') return 'var(--sos-status-warning-soft)';
  if (icon === 'stage') return 'var(--sos-brand-primary-soft)';
  if (icon === 'message') return 'var(--sos-status-info-soft)';
  return 'var(--sos-surface-hover)';
}

function TimelineEventRow({ evt, isLast }: { evt: PortalTimelineEvent; isLast: boolean }) {
  const icon = iconKeyFor(evt);
  return (
    <div style={{ display: 'flex', gap: '14px', position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '50%',
            background: iconBg(icon),
            border: `1.5px solid ${iconColor(icon)}33`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: iconColor(icon),
            zIndex: 1,
          }}
        >
          <TimelineIcon icon={icon} />
        </div>
        {!isLast ? (
          <div style={{ width: '2px', flex: 1, minHeight: '20px', background: 'var(--sos-border-subtle)', margin: '4px 0' }} />
        ) : null}
      </div>

      <div style={{ flex: 1, paddingTop: '6px', paddingBottom: isLast ? 0 : '16px' }}>
        <div style={{ fontSize: '13.5px', color: 'var(--sos-text-primary)', lineHeight: 1.55, marginBottom: '5px' }}>
          {evt.description}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>{evt.actor ?? 'Tafsheen Immigration'}</span>
          <span style={{ fontSize: '11px', color: 'var(--sos-border-subtle)' }}>·</span>
          <span style={{ fontSize: '11.5px', color: 'var(--sos-text-muted)' }}>{fmtDate(evt.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

export function ClientTimelinePage() {
  const { activeCase } = useClientSession();
  const [events, setEvents] = useState<PortalTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCase) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await getTimeline(activeCase.id);
      setEvents(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timeline');
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
          No active case yet — no events to show.
        </div>
      </GlassCard>
    );
  }
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--sos-text-muted)' }}>Loading timeline…</div>;
  }
  if (error) {
    return <div className="sos-banner sos-banner--danger" style={{ margin: 16 }}>{error}</div>;
  }

  // Newest first.
  const sorted = [...events].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

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
        {sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--sos-text-muted)' }}>
            No timeline events yet
          </div>
        ) : (
          <div>
            {sorted.map((evt, i) => (
              <TimelineEventRow key={evt.id} evt={evt} isLast={i === sorted.length - 1} />
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
