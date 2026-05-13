'use client';

import { useEffect, useState } from 'react';
import { apiFetch, invalidateApiCache } from './api-client';
import { clearAccessToken, getAccessToken, setAccessToken } from './auth-client';

export interface SessionUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
}

// Module-level cache. Before this every shell re-fetched /auth/me on mount,
// so navigating /admin → /admin/users → /admin/sales fired 3 separate auth
// probes. Now the first call seeds this cache and the rest of the app reads
// it instantly. TTL is short enough that role/permission changes still
// propagate within ~half a minute.
const SESSION_TTL_MS = 30_000;
let cachedUser: SessionUser | null = null;
let cachedAt = 0;
let inflight: Promise<SessionUser> | null = null;

function fetchMe(): Promise<SessionUser> {
  // Coalesce parallel requests — if two shells mount at the same moment,
  // only one network call goes out.
  if (inflight) return inflight;
  inflight = apiFetch<SessionUser>('/auth/me')
    .then((user) => {
      cachedUser = user;
      cachedAt = Date.now();
      return user;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Clear the session cache. Call after login / logout. */
export function invalidateSessionCache(): void {
  cachedUser = null;
  cachedAt = 0;
  inflight = null;
}

/**
 * Single source of truth for "who is logged in." Used by every shell.
 * Reads JWT from sessionStorage and calls `/auth/me` (cached for 30s).
 * Returns: { status: 'loading' | 'authed' | 'unauthed' }
 */
export function useSession() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'authed'; user: SessionUser }
    | { status: 'unauthed' }
  >(() => {
    // Synchronous warm-start: if the cache is fresh we can render with the
    // user immediately — no spinner flash on route changes.
    if (cachedUser && Date.now() - cachedAt < SESSION_TTL_MS) {
      return { status: 'authed', user: cachedUser };
    }
    return { status: 'loading' };
  });

  useEffect(() => {
    let cancelled = false;
    const token = getAccessToken();
    if (!token) {
      setState({ status: 'unauthed' });
      return;
    }
    // Cache hit — already rendered, nothing to do.
    if (cachedUser && Date.now() - cachedAt < SESSION_TTL_MS) {
      setState({ status: 'authed', user: cachedUser });
      return;
    }
    fetchMe()
      .then((user) => {
        if (!cancelled) setState({ status: 'authed', user });
      })
      .catch(() => {
        clearAccessToken();
        invalidateSessionCache();
        if (!cancelled) setState({ status: 'unauthed' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const tokens = await apiFetch<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(tokens.accessToken);
  invalidateSessionCache();
  invalidateApiCache();
  // Pull the canonical user from /auth/me — it carries the roles + permissions.
  return fetchMe();
}

export function logout() {
  clearAccessToken();
  invalidateSessionCache();
  invalidateApiCache();
}

/**
 * Decide where to send a user after login based on their roles. Priority:
 *   1. super_admin / admin → /admin
 *   2. client → /portal
 *   3. sales → /sales
 *   4. finance → /finance
 *   5. processing / documentation → /processing
 *   6. fallback → /sales (matches existing mock behaviour)
 */
export function destinationForUser(user: SessionUser): string {
  const roles = new Set(user.roles);
  if (roles.has('super_admin') || roles.has('admin')) return '/admin';
  if (roles.has('client')) return '/portal/case';
  if (roles.has('sales')) return '/sales';
  if (roles.has('finance')) return '/finance';
  if (roles.has('processing') || roles.has('documentation')) return '/processing';
  return '/sales';
}
