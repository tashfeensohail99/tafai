'use client';

import { apiFetch } from './api-client';

/**
 * In-app notification rows that drive the bell badge in the topbar.
 * Currently only fired by the WhatsApp AI orchestrator when it auto-books
 * an appointment for a sales agent — but the model is generic so future
 * events (lead reassigned, follow-up overdue, etc.) can plug in.
 */
export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export function listNotifications(limit = 20): Promise<NotificationRow[]> {
  return apiFetch<NotificationRow[]>(`/notifications?limit=${limit}`, { cache: 'no-store' });
}

export function getUnreadNotificationCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>(`/notifications/unread-count`, { cache: 'no-store' });
}

export function markNotificationRead(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/notifications/${id}/read`, {
    method: 'PATCH',
    cache: 'no-store',
  });
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>(`/notifications/read-all`, {
    method: 'POST',
    cache: 'no-store',
  });
}
