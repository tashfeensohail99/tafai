'use client';

import { useEffect } from 'react';
import { pingBackend } from '@/lib/api-client';

/**
 * Fires a no-op GET /health when the app boots so Railway's free-tier
 * backend wakes up before the user's first real request lands. Saves
 * 5-10s on the first page load when the backend has been idle.
 *
 * Mounted from the root layout — runs exactly once per page load
 * regardless of route.
 */
export function BackendWarmup() {
  useEffect(() => {
    pingBackend();
  }, []);
  return null;
}
