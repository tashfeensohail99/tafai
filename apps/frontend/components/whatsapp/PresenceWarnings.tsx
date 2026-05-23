'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useWhatsAppSocket } from '@/lib/whatsapp-realtime';
import { getMyPresence } from '@/lib/whatsapp';

/**
 * Agent-facing availability warnings. Listens on the realtime socket for the
 * presence-accountability events the SLA sweeper emits and shows a popup ONLY
 * when the event targets the logged-in agent (matched by employeeId):
 *   - Away > 10 min  → nudge ("you're not getting leads + losing SLA points")
 *   - Offline > 2h    → penalty notice (−SLA points)
 * Mounted once in the sales shell so it works on any page.
 */
export function PresenceWarnings() {
  const { socket } = useWhatsAppSocket();
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getMyPresence()
      .then((p) => setMyEmployeeId(p.employeeId))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!socket || !myEmployeeId) return;
    const onAway = (d: { employeeId?: string; minutes?: number }) => {
      if (d?.employeeId !== myEmployeeId) return;
      setMessage(
        `You've been Away for about ${d.minutes ?? 10} minutes. While you're Away you don't receive new WhatsApp leads, and staying unavailable costs SLA points. Set yourself back to Online when you're at your desk.`,
      );
    };
    const onPenalty = (d: { employeeId?: string; offlineMinutes?: number; penalty?: number }) => {
      if (d?.employeeId !== myEmployeeId) return;
      setMessage(
        `You've been Offline for about ${d.offlineMinutes ?? 120} minutes during working hours today. Your SLA score has been reduced by ${d.penalty ?? 2} points (it recovers as you stay available). Please switch to Online to receive and answer client chats.`,
      );
    };
    socket.on('whatsapp.presence.away_warning', onAway);
    socket.on('whatsapp.presence.offline_penalty', onPenalty);
    return () => {
      socket.off('whatsapp.presence.away_warning', onAway);
      socket.off('whatsapp.presence.offline_penalty', onPenalty);
    };
  }, [socket, myEmployeeId]);

  if (!message) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        padding: 16,
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: '100%',
          background: 'var(--sos-surface-1)',
          borderRadius: 14,
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          border: '1px solid var(--sos-status-warning-border, rgba(245,158,11,0.45))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <AlertTriangle size={22} style={{ color: 'var(--sos-status-warning)', flexShrink: 0 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
            Availability warning
          </div>
        </div>
        <p style={{ fontSize: 14, color: 'var(--sos-text-secondary)', lineHeight: 1.55, margin: 0 }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" onClick={() => setMessage(null)} className="sos-btn sos-btn--primary">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
