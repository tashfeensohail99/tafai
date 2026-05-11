'use client';
// Case Timeline Tab — Phase 1B.
// Read-only audit trail of all events on this case.

import { History } from 'lucide-react';
import { GlassCard, EmptyState } from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  fmtDate,
  fmtRelative,
} from '@/components/processing/mockData';

const EVENT_STYLE: Record<string, { color: string; label: string }> = {
  PROCESSING_CASE_CREATED: { color: 'var(--sos-status-info)', label: 'Case opened' },
  PROCESSING_STAGE_CHANGED: { color: 'var(--sos-brand-primary-strong)', label: 'Stage changed' },
  PROCESSING_DOCUMENT_ACCEPTED: { color: 'var(--sos-status-success)', label: 'Document accepted' },
  PROCESSING_DOCUMENT_REJECTED: { color: 'var(--sos-status-danger)', label: 'Document rejected' },
  PROCESSING_DOCUMENT_WAIVED: { color: 'var(--sos-text-muted)', label: 'Document waived' },
  PROCESSING_NOTE_CREATED: { color: 'var(--sos-status-info)', label: 'Note added' },
  PROCESSING_TASK_CREATED: { color: 'var(--sos-text-muted)', label: 'Task created' },
  PROCESSING_TASK_COMPLETED: { color: 'var(--sos-status-success)', label: 'Task completed' },
  PROCESSING_CASE_ASSIGNED: { color: 'var(--sos-brand-accent)', label: 'Case assigned' },
};

export function CaseTimelineTab({ c }: { c: MockProcessingCase }) {
  if (c.timeline.length === 0) {
    return (
      <GlassCard variant="panel" padded="lg">
        <EmptyState
          Icon={History}
          title="No activity yet"
          description="Events will appear here as the case progresses."
        />
      </GlassCard>
    );
  }

  const events = [...c.timeline].reverse();

  return (
    <GlassCard variant="panel" padded={false}>
      <div style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-primary)', borderBottom: '1px solid var(--sos-border-subtle)' }}>
        Activity timeline ({c.timeline.length} events)
      </div>
      <div style={{ padding: '8px 0' }}>
        {events.map((event, idx) => {
          const style = EVENT_STYLE[event.eventType] ?? { color: 'var(--sos-text-muted)', label: event.eventType };
          const isLast = idx === events.length - 1;
          return (
            <div
              key={event.id}
              style={{ display: 'flex', gap: '14px', padding: '10px 16px', position: 'relative' }}
            >
              {/* Connector line */}
              {!isLast ? (
                <div style={{ position: 'absolute', left: '23px', top: '28px', bottom: '0', width: '2px', background: 'var(--sos-border-subtle)' }} />
              ) : null}

              {/* Dot */}
              <div style={{ flexShrink: 0, width: '16px', height: '16px', borderRadius: '50%', background: style.color, border: '2px solid var(--sos-surface-1, var(--sos-surface-2))', marginTop: '2px', boxShadow: `0 0 0 3px var(--sos-surface-2)`, zIndex: 1 }} />

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '2px' }}>
                  {event.description}
                </div>
                <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: 'var(--sos-text-muted)', flexWrap: 'wrap' }}>
                  <span>by {event.actorName}</span>
                  <span>·</span>
                  <span>{fmtRelative(event.createdAt)}</span>
                </div>
                {event.metadata ? (
                  <div style={{ marginTop: '4px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {Object.entries(event.metadata).map(([k, v]) => (
                      <span key={k} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--sos-radius-sm)', background: 'var(--sos-surface-hover)', color: 'var(--sos-text-muted)' }}>
                        {k}: {v}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
