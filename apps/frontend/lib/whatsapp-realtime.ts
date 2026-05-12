'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './auth-client';

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
