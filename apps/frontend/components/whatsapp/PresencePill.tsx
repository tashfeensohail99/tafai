'use client';

import { useEffect, useRef, useState } from 'react';
import { Circle } from 'lucide-react';
import { StatusBadge, type BadgeTone } from '@/components/sales-v2/ui';
import {
  getMyPresence,
  heartbeat,
  setMyPresence,
  type MyPresence,
  type PresenceStatus,
} from '@/lib/whatsapp';

const HEARTBEAT_MS = 60 * 1000;

const TONES: Record<PresenceStatus, BadgeTone> = {
  ONLINE: 'success',
  AWAY: 'warning',
  OFFLINE: 'neutral',
};

const LABELS: Record<PresenceStatus, string> = {
  ONLINE: 'Online',
  AWAY: 'Away',
  OFFLINE: 'Offline',
};

/**
 * Topbar presence pill. Lets an agent flip online/away/offline. Also pings
 * the heartbeat endpoint every 60s while mounted so the routing engine
 * keeps treating them as live.
 */
export function PresencePill() {
  const [presence, setPresence] = useState<MyPresence | null>(null);
  const [open, setOpen] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getMyPresence()
      .then(setPresence)
      .catch(() => setPresence(null));
  }, []);

  useEffect(() => {
    if (!presence || presence.explicit === 'OFFLINE') return;
    heartbeatRef.current = setInterval(() => {
      heartbeat().catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [presence?.explicit]);

  if (!presence) return null;

  const tone = TONES[presence.effective];
  const label = LABELS[presence.effective];

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      >
        <StatusBadge tone={tone} dot size="sm">{label}</StatusBadge>
      </button>
      {open && (
        <div
          role="menu"
          onMouseLeave={() => setOpen(false)}
          className="sos-glass sos-glass--strong"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            minWidth: 180,
            padding: 6,
            borderRadius: 'var(--sos-radius-button)',
            zIndex: 30,
          }}
        >
          {(['ONLINE', 'AWAY', 'OFFLINE'] as PresenceStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                try {
                  const updated = await setMyPresence(s);
                  setPresence(updated);
                } catch {
                  // best-effort
                }
              }}
              style={{
                all: 'unset',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 'var(--sos-text-sm)',
                color: 'var(--sos-text-primary)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sos-surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Circle
                size={10}
                style={{
                  color: `var(--sos-status-${TONES[s]})`,
                  fill: `var(--sos-status-${TONES[s]})`,
                }}
              />
              <span>{LABELS[s]}</span>
              {presence.explicit === s && (
                <span className="sos-text-faint" style={{ marginLeft: 'auto', fontSize: 11 }}>
                  current
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
