'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, CalendarClock, HandMetal, Power, Sparkles, X } from 'lucide-react';
import {
  getThread,
  getThreadAppointmentRequests,
  takeOverThread,
  toggleThreadAi,
  type PendingAppointmentRequest,
} from '@/lib/whatsapp';

/**
 * Compact strip rendered above the chat composer that shows the AI bot's
 * per-thread status and any pending bot-captured appointment requests.
 *
 * Two responsibilities:
 *   1. Quick AI on/off toggle — clicking flips `WhatsAppThread.aiEnabled`.
 *      When OFF, the orchestrator skips this thread regardless of global
 *      bot config. Stays gone forever until someone flips it back.
 *   2. Pending appointment-request banner — when the bot has captured a
 *      day/time/modality intent from the customer (state HANDED_OFF), we
 *      surface it here so sales sees "Client wants Monday morning, video
 *      call" and one tap opens the Book Appointment modal pre-filled.
 *
 * Self-contained: fetches its own state from the API; only takes threadId.
 */
export function AiBotStrip({
  threadId,
  onBookFromRequest,
}: {
  threadId: string;
  onBookFromRequest?: (req: PendingAppointmentRequest) => void;
}) {
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [requests, setRequests] = useState<PendingAppointmentRequest[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [thread, reqs] = await Promise.all([
        // getThread already pulls aiEnabled (added it to the thread select on
        // the backend so we don't need a new endpoint just for this).
        getThread(threadId).catch(() => null),
        getThreadAppointmentRequests(threadId).catch(() => []),
      ]);
      // Backend returns the full thread; we only need the aiEnabled flag.
      const t = thread as unknown as { aiEnabled?: boolean } | null;
      setAiEnabled(t?.aiEnabled ?? true);
      setRequests(reqs);
    } catch {
      // Non-fatal — the strip just doesn't render.
    }
  }, [threadId]);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async () => {
    if (aiEnabled === null) return;
    setBusy(true);
    try {
      const next = !aiEnabled;
      await toggleThreadAi(threadId, next);
      setAiEnabled(next);
    } catch {
      // Swallow — UI just doesn't flip.
    } finally {
      setBusy(false);
    }
  };

  const handleTakeOver = async () => {
    if (!confirm('Take over this conversation? AI will be disabled here and the lead will be assigned to you.')) return;
    setBusy(true);
    try {
      await takeOverThread(threadId);
      setAiEnabled(false);
    } catch {
      // Swallow — UI just doesn't flip.
    } finally {
      setBusy(false);
    }
  };

  // Always render the AI toggle. The appointment-request row only renders
  // when there's a PENDING request. If both are absent we render nothing.
  if (aiEnabled === null && requests.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '6px 16px 0 16px',
        background: 'var(--wa-panel-header)',
      }}
    >
      {/* AI on/off pill + Take-over button */}
      {aiEnabled !== null ? (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11.5,
              fontWeight: 600,
              background: aiEnabled ? 'var(--sos-status-success-soft)' : 'var(--sos-surface-1)',
              color: aiEnabled ? 'var(--sos-status-success)' : 'var(--sos-text-secondary)',
              border: '1px solid var(--sos-border-subtle)',
            }}
          >
            <Bot size={12} />
            <span>AI assist {aiEnabled ? 'ON' : 'OFF'}</span>
            <button
              type="button"
              onClick={() => void handleToggle()}
              disabled={busy}
              title={aiEnabled ? 'Turn off AI for this thread' : 'Turn on AI for this thread'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 8px',
                borderRadius: 8,
                border: '1px solid var(--sos-border-strong)',
                background: 'var(--sos-surface-0)',
                color: 'var(--sos-text-primary)',
                fontSize: 11,
                fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              <Power size={10} />
              {busy ? '…' : aiEnabled ? 'Turn off' : 'Turn on'}
            </button>
          </div>
          {/* "Take over" — one click: disables AI, parks state, reassigns
              the lead to me. Only shows when AI is still ON; once off,
              the take-over has effectively happened already. */}
          {aiEnabled ? (
            <button
              type="button"
              onClick={() => void handleTakeOver()}
              disabled={busy}
              title="Disable AI here + assign this lead to me"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid var(--sos-brand-primary-border)',
                background: 'var(--sos-brand-primary-soft)',
                color: 'var(--sos-brand-primary)',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              <HandMetal size={11} />
              Take over
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Pending appointment-request banner(s) */}
      {requests.map((req) => (
        <div
          key={req.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderRadius: 'var(--sos-radius-sm)',
            background: 'var(--sos-brand-primary-soft)',
            color: 'var(--sos-brand-primary)',
            border: '1px solid var(--sos-brand-primary-border)',
            fontSize: 12.5,
            flexWrap: 'wrap',
          }}
        >
          <Sparkles size={13} />
          <strong>Bot captured an appointment intent:</strong>
          <span style={{ color: 'var(--sos-text-primary)' }}>
            {[req.preferredDay, req.preferredTime, modalityLabel(req.modality)]
              .filter(Boolean)
              .join(' · ') || '(no details parsed)'}
          </span>
          {onBookFromRequest ? (
            <button
              type="button"
              onClick={() => onBookFromRequest(req)}
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--sos-brand-gradient)',
                color: 'var(--sos-text-on-accent)',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: 'var(--sos-shadow-glow)',
              }}
            >
              <CalendarClock size={11} /> Book now
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function modalityLabel(modality: string | null): string {
  switch (modality) {
    case 'CALL':      return 'Phone call';
    case 'VIDEO':     return 'Google Meet';
    case 'IN_PERSON': return 'Office visit';
    default:          return '';
  }
}
