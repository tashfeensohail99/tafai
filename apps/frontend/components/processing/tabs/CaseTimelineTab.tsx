'use client';
// Case Timeline Tab — read-only audit trail powered by /processing/cases/:id/audit.

import { History, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GlassCard, EmptyState } from '@/components/sales-v2/ui';
import {
  type MockProcessingCase,
  fmtRelative,
} from '@/components/processing/mockData';
import {
  fetchCaseAudit,
  type ApiProcessingAuditLog,
} from '@/lib/processing';

// Map of audit-log `action` codes (whatever the backend logs) to a coloured
// dot + human label. Unknown actions still render with a neutral dot + the
// raw action string.
const EVENT_STYLE: Record<string, { color: string; label: string }> = {
  CASE_CREATED:           { color: 'var(--sos-status-info)',          label: 'Case opened' },
  INTAKE_ACKNOWLEDGED:    { color: 'var(--sos-brand-accent)',         label: 'Intake acknowledged' },
  STAGE_CHANGED:          { color: 'var(--sos-brand-primary-strong)', label: 'Stage changed' },
  CASE_ASSIGNED:          { color: 'var(--sos-brand-accent)',         label: 'Case assigned' },
  CASE_PRIORITY_CHANGED:  { color: 'var(--sos-status-warning)',       label: 'Priority changed' },
  DOCUMENT_ITEM_ADDED:    { color: 'var(--sos-status-info)',          label: 'Document added' },
  DOCUMENT_ACCEPTED:      { color: 'var(--sos-status-success)',       label: 'Document accepted' },
  DOCUMENT_REJECTED:      { color: 'var(--sos-status-danger)',        label: 'Document rejected' },
  DOCUMENT_WAIVED:        { color: 'var(--sos-text-muted)',           label: 'Document waived' },
  DOCUMENT_REQUESTED:     { color: 'var(--sos-status-info)',          label: 'Document requested' },
  DOCUMENT_UPLOADED:      { color: 'var(--sos-status-info)',          label: 'Document uploaded' },
  NOTE_CREATED:           { color: 'var(--sos-status-info)',          label: 'Note added' },
  TASK_CREATED:           { color: 'var(--sos-text-muted)',           label: 'Task created' },
  TASK_UPDATED:           { color: 'var(--sos-text-muted)',           label: 'Task updated' },
  SUBMISSION_CREATED:     { color: 'var(--sos-brand-primary-strong)', label: 'Submitted to authority' },
  SUBMISSION_UPDATED:     { color: 'var(--sos-brand-primary-strong)', label: 'Submission updated' },
  CORRECTION_REQUESTED:   { color: 'var(--sos-status-warning)',       label: 'Correction requested' },
  CORRECTION_RESOLVED:    { color: 'var(--sos-status-success)',       label: 'Correction resolved' },
  CORRECTION_ESCALATED:   { color: 'var(--sos-status-danger)',        label: 'Correction escalated' },
  COMMUNICATION_SENT:     { color: 'var(--sos-status-info)',          label: 'Message sent' },
  CASE_CANCELLED:         { color: 'var(--sos-status-danger)',        label: 'Case cancelled' },
};

function describe(entry: ApiProcessingAuditLog): string {
  const friendly = EVENT_STYLE[entry.action]?.label ?? entry.action;
  if (entry.fromValue && entry.toValue) return `${friendly}: ${entry.fromValue} → ${entry.toValue}`;
  if (entry.toValue) return `${friendly}: ${entry.toValue}`;
  return friendly;
}

export function CaseTimelineTab({ c }: { c: MockProcessingCase }) {
  const [events, setEvents] = useState<ApiProcessingAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCaseAudit(c.id)
      .then((rows) => { if (!cancelled) setEvents(rows); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load activity'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [c.id]);

  if (loading) {
    return (
      <GlassCard variant="panel" padded="lg">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--sos-text-muted)', padding: 24 }}>
          <Loader2 size={16} className="sos-spin" />
          <span>Loading activity…</span>
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
  if (events.length === 0) {
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

  return (
    <GlassCard variant="panel" padded={false}>
      <div style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 600, color: 'var(--sos-text-primary)', borderBottom: '1px solid var(--sos-border-subtle)' }}>
        Activity timeline ({events.length} events)
      </div>
      <div style={{ padding: '8px 0' }}>
        {events.map((event, idx) => {
          const style = EVENT_STYLE[event.action] ?? { color: 'var(--sos-text-muted)', label: event.action };
          const isLast = idx === events.length - 1;
          const actor = event.performedBy?.email.split('@')[0] ?? 'System';
          return (
            <div
              key={event.id}
              style={{ display: 'flex', gap: '14px', padding: '10px 16px', position: 'relative' }}
            >
              {!isLast ? (
                <div style={{ position: 'absolute', left: '23px', top: '28px', bottom: '0', width: '2px', background: 'var(--sos-border-subtle)' }} />
              ) : null}

              <div style={{ flexShrink: 0, width: '16px', height: '16px', borderRadius: '50%', background: style.color, border: '2px solid var(--sos-surface-1, var(--sos-surface-2))', marginTop: '2px', boxShadow: `0 0 0 3px var(--sos-surface-2)`, zIndex: 1 }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: '2px' }}>
                  {describe(event)}
                </div>
                <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: 'var(--sos-text-muted)', flexWrap: 'wrap' }}>
                  <span>by {actor}</span>
                  <span>·</span>
                  <span>{fmtRelative(event.createdAt)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
