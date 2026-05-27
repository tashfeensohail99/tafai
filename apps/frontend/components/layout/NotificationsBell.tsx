'use client';

import { Bell, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from '@/lib/notifications';

const POLL_MS = 15 * 1000;
const ICON_SIZE_DEFAULT = 15;

/**
 * Topbar bell with unread badge + dropdown + audio alert.
 *
 * - Polls /notifications/unread-count every 15s.
 * - When the count *increases* between polls, plays a Web Audio ding so
 *   the agent hears new notifications even when the tab is in the
 *   background.
 * - Updates `document.title` to "(N) <original>" so background tabs show
 *   the unread count.
 * - Pulses the bell icon while there are unread items.
 *
 * Audio note: browsers require a user gesture before audio can play. The
 * agent has already logged in (a click) by the time this mounts, so the
 * first ding works in Chrome/Edge/Safari/Firefox. If the gesture is too
 * old in some browsers, we silently swallow the rejected play() promise
 * and the badge + tab title still convey the alert.
 */
export function NotificationsBell({ iconSize = ICON_SIZE_DEFAULT }: { iconSize?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastUnreadRef = useRef<number>(0);
  const titleBaseRef = useRef<string>('');
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Capture the original document.title on first mount so we can restore /
  // prefix it as the unread count changes.
  useEffect(() => {
    if (!titleBaseRef.current) {
      titleBaseRef.current = document.title.replace(/^\(\d+\)\s*/, '');
    }
  }, []);

  // Update tab title whenever the unread count changes.
  useEffect(() => {
    const base = titleBaseRef.current || document.title;
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
  }, [unread]);

  // Play a short two-tone chime via Web Audio. No external asset needed.
  // Frequencies tuned for a clean "ding" that cuts through a noisy office
  // without being annoying. Wrapped in try/catch because audio can fail
  // for a dozen reasons (autoplay policy, suspended context, etc.) and we
  // never want it to break the bell.
  const playDing = useCallback(() => {
    try {
      if (typeof window === 'undefined') return;
      let ctx = audioCtxRef.current;
      if (!ctx) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        audioCtxRef.current = ctx;
      }
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
      const now = ctx.currentTime;
      // First tone: C6 (1046Hz), second tone: E6 (1318Hz). Sounds like an
      // iOS notification. Each tone ~140ms, total under 300ms.
      const playTone = (freq: number, start: number, dur: number, gain: number) => {
        const osc = ctx!.createOscillator();
        const g = ctx!.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(gain, start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(g).connect(ctx!.destination);
        osc.start(start);
        osc.stop(start + dur + 0.02);
      };
      playTone(1046.5, now, 0.14, 0.35);
      playTone(1318.5, now + 0.13, 0.18, 0.35);
    } catch {
      /* audio is best-effort */
    }
  }, []);

  // Poll unread count every 15s. Play a ding when the count *increases*
  // (so a freshly-arrived notification triggers the alert, but mark-read
  // dropping the count back to zero doesn't).
  //
  // First-load suppression: lastUnreadRef starts at 0, but a freshly mounted
  // shell with N existing unread items would trip "0 → N" on the very first
  // poll and ding on every page navigation. We seed the ref from the first
  // response without playing, so the ding fires only when something genuinely
  // new arrives during this session.
  useEffect(() => {
    let cancelled = false;
    let seeded = false;
    const fetchCount = () => {
      getUnreadNotificationCount()
        .then((r) => {
          if (cancelled) return;
          if (seeded && r.count > lastUnreadRef.current) {
            playDing();
          }
          lastUnreadRef.current = r.count;
          setUnread(r.count);
          seeded = true;
        })
        .catch(() => {
          /* best-effort */
        });
    };
    fetchCount();
    const id = setInterval(fetchCount, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [playDing]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const refreshList = useCallback(() => {
    setLoading(true);
    listNotifications(20)
      .then((list) => {
        setRows(list);
        const u = list.filter((r) => !r.read).length;
        lastUnreadRef.current = u; // keep ref in sync — avoid false-positive ding
        setUnread(u);
      })
      .catch(() => {
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    refreshList();
  }

  async function onItemClick(row: NotificationRow) {
    if (!row.read) {
      // optimistic
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, read: true } : r)));
      const next = Math.max(0, unread - 1);
      lastUnreadRef.current = next;
      setUnread(next);
      markNotificationRead(row.id).catch(() => {
        /* keep optimistic state — next poll will reconcile */
      });
    }
    setOpen(false);
    if (row.link) router.push(row.link);
  }

  async function onMarkAll() {
    setRows((prev) => prev.map((r) => ({ ...r, read: true })));
    lastUnreadRef.current = 0;
    setUnread(0);
    try {
      await markAllNotificationsRead();
    } catch {
      /* best-effort */
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`sos-topbar__icon-btn ${unread > 0 ? 'tash-bell-pulse' : ''}`}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        style={{ position: 'relative' }}
      >
        <Bell size={iconSize} />
        {unread > 0 && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 999,
              background: '#ef4444',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              boxShadow: '0 0 0 2px var(--sos-surface-1, #fff)',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="sos-glass sos-glass--strong"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: 360,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 480,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 'var(--sos-radius-card, 12px)',
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--sos-border)',
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
              Notifications
            </div>
            {rows.some((r) => !r.read) && (
              <button
                type="button"
                onClick={onMarkAll}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--sos-brand-accent, #7c3aed)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>

          {/* Body */}
          <div className="sos-scroll" style={{ overflowY: 'auto', flex: 1 }}>
            {loading && rows.length === 0 ? (
              <div
                style={{
                  padding: '24px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--sos-text-muted)',
                  fontSize: 12.5,
                }}
              >
                <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />
                Loading…
              </div>
            ) : rows.length === 0 ? (
              <div
                style={{
                  padding: '32px 16px',
                  textAlign: 'center',
                  color: 'var(--sos-text-muted)',
                  fontSize: 13,
                }}
              >
                You're all caught up
                <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--sos-text-faint)' }}>
                  We'll show new appointments and updates here.
                </div>
              </div>
            ) : (
              rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onItemClick(row)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 14px',
                    border: 'none',
                    borderBottom: '1px solid var(--sos-border)',
                    background: row.read ? 'transparent' : 'var(--sos-surface-2, rgba(124,58,237,0.06))',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flex: '0 0 8px',
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      marginTop: 6,
                      background: row.read ? 'transparent' : 'var(--sos-brand-accent, #7c3aed)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: row.read ? 500 : 700,
                        color: 'var(--sos-text-primary)',
                        marginBottom: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {row.title}
                    </div>
                    {row.body && (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--sos-text-muted)',
                          lineHeight: 1.45,
                          marginBottom: 4,
                        }}
                      >
                        {row.body}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--sos-text-faint)' }}>
                      {relativeTime(row.createdAt)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Pulse keyframes — kept colocated so the bell ships as one unit. */}
      <style>{`
        @keyframes tashBellPulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.12); }
        }
        .tash-bell-pulse {
          animation: tashBellPulse 1.6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h ago`;
  if (diff < 7 * 24 * 60 * 60_000) return `${Math.floor(diff / (24 * 60 * 60_000))}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}
