'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './auth-client';
import { getThreadListItem, type ThreadListItem } from './whatsapp';

/**
 * Realtime hook for the WhatsApp inbox. Connects once per browser tab, holds
 * the singleton socket in a module-scoped variable, and exposes
 * subscribe/unsubscribe helpers for components.
 *
 * Events emitted by the backend:
 *   whatsapp.message.new        { threadId, leadId, clientId, messageId, direction }
 *   whatsapp.message.status     { threadId, messageId, status }
 *   whatsapp.thread.updated     { threadId }
 *   whatsapp.thread.assigned    { threadId, assignedEmployeeId }
 *   whatsapp.presence.changed   { employeeId, status }
 */

const WS_PATH = '/whatsapp/realtime';

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

let singleton: Socket | null = null;
const refCount = { value: 0 };

function ensureSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (singleton && singleton.connected) return singleton;
  const token = getAccessToken();
  if (!token) return null;
  if (singleton) return singleton;

  singleton = io(apiBase(), {
    path: WS_PATH,
    transports: ['websocket'],
    auth: { token },
  });
  return singleton;
}

function release(): void {
  refCount.value = Math.max(0, refCount.value - 1);
  if (refCount.value === 0 && singleton) {
    singleton.disconnect();
    singleton = null;
  }
}

/**
 * Maintain a socket connection for the lifetime of the calling component.
 * Returns the live socket (null while connecting / unauthenticated) plus
 * a `connected` flag for UI indicators.
 */
export function useWhatsAppSocket(): { socket: Socket | null; connected: boolean } {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const heldRef = useRef(false);

  useEffect(() => {
    const s = ensureSocket();
    if (!s) {
      setSocket(null);
      setConnected(false);
      return;
    }
    if (!heldRef.current) {
      refCount.value += 1;
      heldRef.current = true;
    }
    setSocket(s);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    if (s.connected) setConnected(true);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      if (heldRef.current) {
        heldRef.current = false;
        release();
      }
    };
  }, []);

  return { socket, connected };
}

// Sort threads the same way the backend list does: lastMessageAt DESC, nulls
// last (treated as epoch 0 so they sink to the bottom).
function byLastMessageDesc(a: ThreadListItem, b: ThreadListItem): number {
  const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
  const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
  return bt - at;
}

const LIVE_PATCH_BURST_MS = 500;
const LIVE_PATCH_MAX = 8;
const LIVE_RECONCILE_MS = 30_000;

/**
 * WhatsApp-grade realtime for a thread LIST. Instead of refetching the whole
 * list on every socket event, this refreshes only the affected thread(s):
 *
 *   - Socket events (message.new / message.status / thread.assigned) carry
 *     only a threadId. We coalesce a short burst, then fetch JUST those rows
 *     (one cheap indexed lookup each) and splice them in, re-sorted by
 *     lastMessageAt — so the touched chat jumps to the top like WhatsApp.
 *   - `matches(row)` decides whether the freshly-fetched row still belongs in
 *     the CURRENT view (active tab / search / assignment filter). If it no
 *     longer matches — or the fetch reports the row gone / not visible — we
 *     drop it. This is what keeps filter transitions correct (e.g. a thread
 *     that just got assigned leaves the "Unassigned" tab; a resolved thread
 *     leaves "Open").
 *   - A slow full `reconcile()` (every 30s) + a `reconcileOnFocus()` when the
 *     tab regains focus are the safety net: even if a patch is ever wrong the
 *     list self-heals, and it can never end up worse than a plain refetch.
 *
 * If one burst touches more than LIVE_PATCH_MAX distinct threads, we skip the
 * per-row fetches and just reconcile — a single full refetch is cheaper than
 * many singles. Transient fetch errors leave the existing row untouched.
 *
 * matches/reconcile are read through refs so a filter/search change doesn't
 * tear down and re-create the socket subscription — only a socket swap does.
 */
export function useThreadListLivePatch(params: {
  socket: Socket | null;
  setItems: Dispatch<SetStateAction<ThreadListItem[]>>;
  matches: (row: ThreadListItem) => boolean;
  reconcile: () => void;
  reconcileOnFocus?: () => void;
  /**
   * Fired once per flushed burst of activity (debounced by LIVE_PATCH_BURST_MS).
   * The per-row patch above keeps the LIST correct; this lets the caller also
   * refresh lightweight derived state — chiefly the tab-count badges — so e.g.
   * "Pending N" drops the moment an agent's reply clears a thread, instead of
   * waiting for the 30s reconcile. Cheap + throttled; skipped on the >MAX
   * branch (which already does a full reconcile that refreshes counts).
   */
  onActivity?: () => void;
}): void {
  const { socket, setItems } = params;
  const matchesRef = useRef(params.matches);
  const reconcileRef = useRef(params.reconcile);
  const reconcileFocusRef = useRef(params.reconcileOnFocus ?? params.reconcile);
  const onActivityRef = useRef(params.onActivity);
  matchesRef.current = params.matches;
  reconcileRef.current = params.reconcile;
  reconcileFocusRef.current = params.reconcileOnFocus ?? params.reconcile;
  onActivityRef.current = params.onActivity;

  useEffect(() => {
    if (!socket) return;
    const dirty = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const flush = async () => {
      timer = null;
      const ids = [...dirty];
      dirty.clear();
      if (ids.length === 0) return;
      if (ids.length > LIVE_PATCH_MAX) {
        reconcileRef.current();
        return;
      }
      const results = await Promise.all(
        ids.map((id) =>
          getThreadListItem(id)
            .then((row) => ({ id, row, ok: true }))
            .catch(() => ({ id, row: null as ThreadListItem | null, ok: false })),
        ),
      );
      if (cancelled) return; // unmounted / socket swapped mid-fetch
      setItems((curr) => {
        const next = curr.slice();
        for (const { id, row, ok } of results) {
          if (!ok) continue; // transient error — leave the row as-is
          const idx = next.findIndex((t) => t.id === id);
          if (!row || !matchesRef.current(row)) {
            if (idx >= 0) next.splice(idx, 1); // gone / no longer in this view
            continue;
          }
          if (idx >= 0) next[idx] = row;
          else next.push(row);
        }
        next.sort(byLastMessageDesc);
        return next;
      });
      // Counts move with activity, not on a 30s timer: refresh the tab badges
      // now that a burst has been applied. The replied/resolved chat already
      // left the LIST above; this makes its number drop in the same beat.
      onActivityRef.current?.();
    };

    const onEvent = (payload: { threadId?: string } | undefined) => {
      const id = payload?.threadId;
      if (!id) return;
      dirty.add(id);
      if (!timer) timer = setTimeout(() => void flush(), LIVE_PATCH_BURST_MS);
    };

    socket.on('whatsapp.message.new', onEvent);
    socket.on('whatsapp.message.status', onEvent);
    socket.on('whatsapp.thread.assigned', onEvent);

    const interval = setInterval(() => reconcileRef.current(), LIVE_RECONCILE_MS);
    const onFocus = () => reconcileFocusRef.current();
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
      socket.off('whatsapp.message.new', onEvent);
      socket.off('whatsapp.message.status', onEvent);
      socket.off('whatsapp.thread.assigned', onEvent);
    };
  }, [socket, setItems]);
}

/**
 * Convenience helper: subscribe to a single event for the component's
 * lifetime. Auto-unsubscribes on unmount.
 */
export function useWhatsAppEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
): void {
  const { socket } = useWhatsAppSocket();
  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler as (data: unknown) => void);
    return () => {
      socket.off(event, handler as (data: unknown) => void);
    };
  }, [socket, event, handler]);
}
