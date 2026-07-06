'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, X } from 'lucide-react';
import { GhostButton, PrimaryButton } from '@/components/sales-v2/ui';
import {
  getConsultAvailability,
  rescheduleConsult,
  type Availability,
  type AvailabilitySlot,
  type VisitRow,
} from '@/lib/reception-api';
import { fmtTime, todayPkt } from './shared';

/** PKT (YYYY-MM-DD) day for an ISO instant — same +5h offset as todayPkt(). */
function pktDateOf(iso: string): string {
  const p = new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000);
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}-${String(p.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Move a booked paid consult to a new date/time on the principal's calendar.
 * Date/time only — reuses the same availability slot picker as the collect flow.
 */
export function RescheduleConsultModal({
  open,
  visit,
  onClose,
  onDone,
}: {
  open: boolean;
  visit: VisitRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = todayPkt();
  const [date, setDate] = useState<string>(today);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the date from the current appointment (or today) each time we open —
  // but never earlier than today, since the date input floors at today.
  useEffect(() => {
    if (!open) return;
    const seed = visit?.appointmentAt ? pktDateOf(visit.appointmentAt) : today;
    setDate(seed >= today ? seed : today);
    setSlot(null);
    setError(null);
  }, [open, visit, today]);

  // Load available slots for the chosen date.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingSlots(true);
    setSlot(null);
    getConsultAvailability(date)
      .then((a) => {
        if (!cancelled) setAvail(a);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load available times');
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, date]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  if (!open || !visit) return null;

  const isToday = date === today;
  const slots = (avail?.freeSlots ?? []).filter(
    (sl) => !isToday || new Date(sl.start).getTime() >= Date.now(),
  );

  async function submit() {
    if (!slot || !visit) return;
    setSubmitting(true);
    setError(null);
    try {
      await rescheduleConsult(visit.id, { scheduledAt: slot.start });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reschedule the consultation.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reschedule consultation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--sos-bg-overlay)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 16px',
        zIndex: 1000,
        overflowY: 'auto',
      }}
    >
      <div className="sos-glass sos-glass--strong" style={{ width: '100%', maxWidth: 540, borderRadius: 'var(--sos-radius-panel, 20px)', padding: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px', borderBottom: '1px solid var(--sos-border-subtle)' }}>
          <div>
            <div className="sos-title" style={{ fontSize: 'var(--sos-text-md)' }}>Reschedule consultation</div>
            <div className="sos-text-faint" style={{ fontSize: 12 }}>
              {visit.name}
              {visit.appointmentAt ? ` · currently ${fmtTime(visit.appointmentAt)} PKT` : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="sos-btn sos-btn--ghost sos-btn--sm">
            <X size={16} />
          </button>
        </header>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Time */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <CalendarClock size={14} style={{ color: 'var(--sos-brand-accent)' }} />
              <label className="sos-text-faint" style={{ fontSize: 12, fontWeight: 600 }}>Pick a new time</label>
              <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="sos-input" style={{ marginLeft: 'auto', width: 'auto' }} />
            </div>
            {loadingSlots ? (
              <div className="sos-text-faint" style={{ fontSize: 12 }}>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading times…
              </div>
            ) : slots.length === 0 ? (
              <div className="sos-text-faint" style={{ fontSize: 12.5 }}>No free slots on this day — try another date.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 132, overflowY: 'auto' }}>
                {slots.map((sl) => {
                  const active = slot?.start === sl.start;
                  return (
                    <button
                      key={sl.start}
                      type="button"
                      onClick={() => setSlot(sl)}
                      style={{
                        padding: '6px 12px',
                        fontSize: 12.5,
                        fontWeight: 600,
                        borderRadius: 8,
                        cursor: 'pointer',
                        border: `1px solid ${active ? 'var(--sos-brand-primary-border)' : 'var(--sos-border-subtle)'}`,
                        background: active ? 'var(--sos-brand-primary-soft)' : 'var(--sos-surface-1)',
                        color: active ? 'var(--sos-brand-primary-strong)' : 'var(--sos-text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtTime(sl.start)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error ? <div className="sos-banner sos-banner--danger" style={{ fontSize: 12.5 }}>{error}</div> : null}
        </div>

        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 18px', borderTop: '1px solid var(--sos-border-subtle)' }}>
          <GhostButton type="button" onClick={onClose} disabled={submitting}>Cancel</GhostButton>
          <PrimaryButton
            type="button"
            onClick={() => void submit()}
            disabled={!slot || submitting}
            iconLeft={submitting ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <CalendarClock size={15} />}
          >
            {submitting ? 'Rescheduling…' : 'Reschedule'}
          </PrimaryButton>
        </footer>
      </div>
    </div>
  );
}
