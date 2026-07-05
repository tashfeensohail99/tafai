'use client';

import { useEffect, useState } from 'react';
import { Clock, Tag, X } from 'lucide-react';
import {
  DISPOSITION_LABEL,
  DISPOSITIONS_WITH_REMINDER,
  LEAD_DISPOSITIONS,
  getLeadDispositionHistory,
  setLeadDisposition,
  type DispositionHistoryItem,
  type LeadDisposition,
} from '@/lib/whatsapp';

// Visual tone per disposition so the chip/option reads at a glance:
// good = a positive/won outcome, warn = needs follow-up, bad = dead-ends.
const TONE: Record<LeadDisposition, 'good' | 'warn' | 'bad' | 'neutral'> = {
  CONVERTED_TO_DEAL: 'good',
  QUALIFIED: 'good',
  FOLLOW_UP: 'warn',
  CONTACT_LATER: 'warn',
  REQUESTED_DISCOUNT: 'neutral',
  PRICE_CONCERN: 'neutral',
  NO_RESPONSE: 'neutral',
  NOT_ELIGIBLE: 'bad',
  JUNK: 'bad',
  DEAD: 'bad',
};

function toneColors(tone: 'good' | 'warn' | 'bad' | 'neutral', active: boolean) {
  const map = {
    good: 'var(--sos-status-success)',
    warn: 'var(--sos-status-warning-strong, #b7791f)',
    bad: 'var(--sos-status-danger-strong)',
    neutral: 'var(--sos-text-secondary)',
  } as const;
  const c = map[tone];
  return active
    ? { background: c, color: '#fff', border: `1px solid ${c}` }
    : { background: 'transparent', color: c, border: '1px solid var(--sos-border-subtle)' };
}

/** datetime-local value for tomorrow 10:00 (agent-local) — a sensible reminder default. */
function defaultReminderLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Sales-disposition control for the WhatsApp chat screen: a compact chip showing
 * the current disposition; tapping opens a sheet to pick a new one, add a note,
 * (for Follow Up / Contact Later) schedule a reminder, and review the full
 * who/when history. Separate from the pipeline status — this only sets the
 * call-outcome tag.
 */
export function DispositionControl({
  leadId,
  current,
  onChanged,
}: {
  leadId: string;
  current: LeadDisposition | null;
  onChanged?: (d: LeadDisposition) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<LeadDisposition | null>(current);
  const [note, setNote] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<DispositionHistoryItem[] | null>(null);

  useEffect(() => setSel(current), [current]);

  const needsReminder = sel != null && DISPOSITIONS_WITH_REMINDER.includes(sel);
  // A default reminder time is seeded when the rep PICKS a reminder-type
  // disposition (see the option onClick), NOT via an effect on `reminderAt` —
  // otherwise clearing the field would instantly re-seed it and the rep could
  // never choose Follow Up / Contact Later WITHOUT a reminder (the backend
  // treats reminderAt as optional).

  const openSheet = () => {
    setSel(current);
    setNote('');
    setReminderAt('');
    setErr(null);
    setOpen(true);
    setHistory(null);
    getLeadDispositionHistory(leadId)
      .then(setHistory)
      .catch(() => setHistory([]));
  };

  const save = async () => {
    if (!sel) return;
    setBusy(true);
    setErr(null);
    try {
      await setLeadDisposition(leadId, {
        disposition: sel,
        note: note.trim() || undefined,
        reminderAt: needsReminder && reminderAt ? new Date(reminderAt).toISOString() : undefined,
      });
      onChanged?.(sel);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save disposition');
    } finally {
      setBusy(false);
    }
  };

  const chipTone = current ? TONE[current] : 'neutral';
  const chipStyle = toneColors(chipTone, !!current);

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        title="Set the sales disposition for this lead"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          ...chipStyle,
        }}
      >
        <Tag size={13} />
        {current ? DISPOSITION_LABEL[current] : 'Set disposition'}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Set disposition"
          onClick={() => !busy && setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            className="sos-glass sos-glass--strong"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(460px, 100%)',
              maxHeight: '86vh',
              overflowY: 'auto',
              borderRadius: 16,
              padding: 18,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Disposition</div>
              <button
                type="button"
                onClick={() => !busy && setOpen(false)}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sos-text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Options grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {LEAD_DISPOSITIONS.map((d) => {
                const active = sel === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setSel(d);
                      // Seed a convenient default only on first pick of a
                      // reminder-type disposition; leave a cleared field cleared.
                      if (DISPOSITIONS_WITH_REMINDER.includes(d) && !reminderAt) {
                        setReminderAt(defaultReminderLocal());
                      }
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '9px 12px',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      ...toneColors(TONE[d], active),
                    }}
                  >
                    {DISPOSITION_LABEL[d]}
                  </button>
                );
              })}
            </div>

            {/* Reminder (only for Follow Up / Contact Later) */}
            {needsReminder ? (
              <div style={{ marginTop: 14 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: 'var(--sos-text-secondary)',
                    marginBottom: 6,
                  }}
                >
                  <Clock size={14} /> Remind me on
                </label>
                <input
                  type="datetime-local"
                  value={reminderAt}
                  onChange={(e) => setReminderAt(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--sos-border-subtle)',
                    background: 'var(--wa-composer-input-bg)',
                    color: 'var(--sos-text-primary)',
                    fontSize: 13,
                  }}
                />
                <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', marginTop: 4 }}>
                  You&rsquo;ll get a reminder notification at this time.
                </div>
              </div>
            ) : null}

            {/* Note */}
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sos-text-secondary)' }}>
                Note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Why this outcome? (optional)"
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: '9px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--sos-border-subtle)',
                  background: 'var(--wa-composer-input-bg)',
                  color: 'var(--sos-text-primary)',
                  fontSize: 13,
                  resize: 'vertical',
                }}
              />
            </div>

            {err ? (
              <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--sos-status-danger)' }}>{err}</div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="sos-btn sos-btn--ghost"
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || !sel}
                className="sos-btn sos-btn--primary"
                style={{ flex: 1 }}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* History */}
            <div style={{ marginTop: 18, borderTop: '1px solid var(--sos-border-subtle)', paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                History
              </div>
              {history == null ? (
                <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>Loading…</div>
              ) : history.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--sos-text-muted)' }}>No disposition set yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {history.map((h) => (
                    <div key={h.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 6,
                          whiteSpace: 'nowrap',
                          ...toneColors(TONE[h.disposition], true),
                        }}
                      >
                        {DISPOSITION_LABEL[h.disposition]}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, color: 'var(--sos-text-secondary)' }}>
                          {h.byName ?? 'Someone'} · {new Date(h.at).toLocaleString()}
                        </div>
                        {h.note ? (
                          <div style={{ fontSize: 12.5, color: 'var(--sos-text-primary)', marginTop: 2 }}>{h.note}</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
