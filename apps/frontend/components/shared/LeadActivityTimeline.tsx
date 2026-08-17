'use client';

// Shared lead activity timeline — the full "every touch on this lead" feed.
// Lifted out of SalesLeadProfilePage so the admin reassign context panel can
// reuse the exact same renderer. Fetches GET /activity-timeline?leadId= via
// fetchLeadActivityTimeline; the endpoint enforces access server-side.

import { useEffect, useState } from 'react';
import {
  Activity,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  ClipboardList,
  Mail,
  MessageSquare,
  Paperclip,
  Phone,
  PhoneOff,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { GlassCard } from '@/components/sales-v2/ui';
import { Timeline, TimelineStep } from '@/components/sales-v2/ui/TimelineStep';
import { fmtRelativeToNow } from '@/components/sales-v2/mockData';
import { fetchLeadActivityTimeline, type ActivityTimelineEntry } from '@/lib/sales-api';

const TIMELINE_EVENT_META: Record<
  string,
  { Icon: typeof Activity; title: string; tone?: 'success' | 'danger' | 'info' | 'warning' }
> = {
  LEAD_CREATED:          { Icon: Sparkles,     title: 'Lead created' },
  LEAD_CONTACTED:        { Icon: Phone,        title: 'Lead contacted',  tone: 'info' },
  LEAD_QUALIFIED:        { Icon: ShieldCheck,  title: 'Lead qualified',  tone: 'success' },
  LEAD_ASSIGNED:         { Icon: Shield,       title: 'Lead assigned',   tone: 'info' },
  LEAD_CONVERTED:        { Icon: CheckCircle2, title: 'Lead converted',  tone: 'success' },
  LEAD_STATUS_CHANGED:   { Icon: Activity,     title: 'Status changed' },
  LEAD_UPDATED:          { Icon: ClipboardList,title: 'Lead updated' },
  LEAD_DELETED:          { Icon: X,            title: 'Lead deleted',    tone: 'danger' },
  LEAD_FILE_UPLOADED:    { Icon: Paperclip,    title: 'File uploaded' },
  LEAD_FILE_DELETED:     { Icon: X,            title: 'File deleted',    tone: 'danger' },
  FOLLOW_UP_CREATED:     { Icon: CalendarPlus, title: 'Follow-up created' },
  FOLLOW_UP_COMPLETED:   { Icon: Check,        title: 'Follow-up done',  tone: 'success' },
  FOLLOW_UP_RESCHEDULED: { Icon: CalendarClock,title: 'Follow-up rescheduled', tone: 'warning' },
  APPOINTMENT_SCHEDULED: { Icon: CalendarPlus, title: 'Appointment booked' },
  APPOINTMENT_COMPLETED: { Icon: CheckCircle2, title: 'Appointment completed', tone: 'success' },
  APPOINTMENT_CANCELLED: { Icon: X,            title: 'Appointment cancelled', tone: 'danger' },
  APPOINTMENT_RESCHEDULED:{Icon: CalendarClock,title: 'Appointment rescheduled', tone: 'warning' },
  APPOINTMENT_NO_SHOW:   { Icon: PhoneOff,     title: 'No-show',         tone: 'danger' },
  WHATSAPP_LEAD_CREATED: { Icon: MessageSquare,title: 'WhatsApp lead created', tone: 'info' },
  WHATSAPP_MESSAGE_RECEIVED: { Icon: MessageSquare, title: 'WhatsApp received', tone: 'info' },
  WHATSAPP_MESSAGE_SENT: { Icon: MessageSquare,title: 'WhatsApp sent',   tone: 'info' },
  WHATSAPP_ASSIGNED:     { Icon: Shield,       title: 'WhatsApp routed', tone: 'info' },
  WHATSAPP_CONVERSATION_RESOLVED: { Icon: Check, title: 'WhatsApp resolved', tone: 'success' },
  WHATSAPP_OPTED_OUT:    { Icon: PhoneOff,     title: 'Customer opted out', tone: 'danger' },
  EMAIL_RECEIVED:        { Icon: Mail,         title: 'Email received',  tone: 'info' },
  EMAIL_VERIFICATION_SENT: { Icon: Mail,       title: 'Verification email sent' },
  EMAIL_VERIFIED:        { Icon: ShieldCheck,  title: 'Email verified',  tone: 'success' },
  PAYMENT_RECEIVED:      { Icon: Wallet,       title: 'Payment received', tone: 'success' },
  FINANCE_HANDOVER_SUBMITTED: { Icon: Send,    title: 'Finance handover sent' },
  FINANCE_HANDOVER_REVIEWED:  { Icon: CheckCircle2, title: 'Finance reviewed', tone: 'success' },
  DOCUMENT_UPLOADED:     { Icon: Upload,       title: 'Document uploaded' },
  DOCUMENT_VERIFIED:     { Icon: CheckCircle2, title: 'Document verified', tone: 'success' },
  DOCUMENT_REJECTED:     { Icon: X,            title: 'Document rejected', tone: 'danger' },
  NOTE_ADDED:            { Icon: StickyNote,   title: 'Note added' },
};

/** Turn LEAD_STATUS_CHANGED into "Lead status changed" for unknown events. */
function prettifyEventType(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(' ');
}

/** Just the timeline list (no card/header) — used inside another panel. */
export function LeadActivityTimelineList({
  entries,
}: {
  entries: ActivityTimelineEntry[];
}) {
  return (
    <Timeline>
      {entries.map((entry) => {
        const meta = TIMELINE_EVENT_META[entry.eventType] ?? {
          Icon: Activity,
          title: prettifyEventType(entry.eventType),
        };
        return (
          <TimelineStep
            key={entry.id}
            Icon={meta.Icon}
            title={meta.title}
            meta={fmtRelativeToNow(entry.createdAt)}
            description={entry.description}
            done={true}
          />
        );
      })}
    </Timeline>
  );
}

/**
 * Full activity timeline for a lead. `compact` drops the big card header (for
 * embedding inside another panel such as the reassign context tabs).
 */
export function LeadActivityTimeline({
  leadId,
  compact = false,
}: {
  leadId: string;
  compact?: boolean;
}) {
  const [entries, setEntries] = useState<ActivityTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchLeadActivityTimeline(leadId);
        if (!cancelled) setEntries(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load timeline');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    // Refresh on focus keeps the feed current while the user acts elsewhere.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [leadId]);

  const body = (
    <>
      {error ? (
        <div
          style={{
            marginTop: compact ? 0 : 16,
            padding: '10px 14px',
            background: 'var(--sos-status-danger-soft)',
            color: 'var(--sos-status-danger)',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}
      <div style={{ marginTop: compact ? 4 : 20 }}>
        {loading && entries.length === 0 ? (
          <div className="sos-text-muted" style={{ fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
            Loading timeline…
          </div>
        ) : entries.length === 0 ? (
          <div className="sos-text-muted" style={{ fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
            No activity yet. Touches on this lead will appear here.
          </div>
        ) : (
          <LeadActivityTimelineList entries={entries} />
        )}
      </div>
    </>
  );

  if (compact) return body;

  return (
    <GlassCard variant="strong" padded="lg">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="sos-eyebrow">Activity timeline</div>
          <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
            Every touch on this lead, newest first
          </h2>
          <p className="sos-text-muted" style={{ marginTop: '4px', fontSize: '13px' }}>
            Calls, WhatsApp, emails, status changes, files, payments — all in one place.
          </p>
        </div>
        <span className="sos-text-muted" style={{ fontSize: '12px' }}>
          {loading ? 'Loading…' : `${entries.length} event${entries.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {body}
    </GlassCard>
  );
}
