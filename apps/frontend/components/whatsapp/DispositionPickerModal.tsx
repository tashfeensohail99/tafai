'use client';

/**
 * Standalone modal for setting a lead's sales disposition, extracted from
 * DispositionControl so it can be triggered from anywhere (inbox row menu,
 * lead card, elsewhere). DispositionControl now composes this modal with
 * its own trigger button. Behaviour + copy are identical to the previous
 * inline modal.
 */

import { useEffect, useState } from 'react';
import { Clock, X } from 'lucide-react';
import {
  DISPOSITION_LABEL,
  DISPOSITIONS_WITH_REMINDER,
  LEAD_DISPOSITIONS,
  getLeadDispositionHistory,
  setLeadDisposition,
  type DispositionHistoryItem,
  type LeadDisposition,
} from '@/lib/whatsapp';

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

function defaultReminderLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DispositionPickerModal({
  open,
  leadId,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  leadId: string;
  current: LeadDisposition | null;
  onClose: () => void;
  onSaved?: (d: LeadDisposition) => void;
}) {
  const [sel, setSel] = useState<LeadDisposition | null>(current);
  const [note, setNote] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<DispositionHistoryItem[] | null>(null);

  // Reset state + fetch history on each open.
  useEffect(() => {
    if (!open) return;
    setSel(current);
    setNote('');
    setReminderAt('');
    setErr(null);
    setHistory(null);
    getLeadDispositionHistory(leadId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [open, leadId, current]);

  if (!open) return null;

  const needsReminder = sel != null && DISPOSITIONS_WITH_REMINDER.includes(sel);

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
      onSaved?.(sel);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save disposition');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Set disposition"
      onClick={() => !busy && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="sos-glass sos-glass--strong"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 100%)', maxHeight: '86vh', overflowY: 'auto',
          borderRadius: 16, padding: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)' }}>Disposition</div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sos-text-muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {LEAD_DISPOSITIONS.map((d) => {
            const active = sel === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setSel(d);
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

        {needsReminder ? (
          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--sos-text-secondary)', marginBottom: 6 }}>
              <Clock size={14} /> Remind me on
            </label>
            <input
              type="datetime-local"
              value={reminderAt}
              onChange={(e) => setReminderAt(e.target.value)}
              style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--sos-border-subtle)', background: 'var(--wa-composer-input-bg)', color: 'var(--sos-text-primary)', fontSize: 13 }}
            />
            <div style={{ fontSize: 11.5, color: 'var(--sos-text-muted)', marginTop: 4 }}>
              You&rsquo;ll get a reminder notification at this time.
            </div>
          </div>
        ) : null}

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
            style={{ width: '100%', marginTop: 6, padding: '9px 10px', borderRadius: 8, border: '1px solid var(--sos-border-subtle)', background: 'var(--wa-composer-input-bg)', color: 'var(--sos-text-primary)', fontSize: 13, resize: 'vertical' }}
          />
        </div>

        {err ? (
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--sos-status-danger)' }}>{err}</div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            type="button"
            onClick={() => onClose()}
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
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap', ...toneColors(TONE[h.disposition], true) }}>
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
  );
}
