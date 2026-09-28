'use client';

import { useEffect, useState } from 'react';
import { apiFetch, attemptRefresh, invalidateApiCache, isSessionRejected } from './api-client';
import {
  clearAllTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './auth-client';

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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;

    // The server couldn't be reached (offline, timeout, 5xx while Railway
    // redeploys) — keep the tokens and stay on the loader, retrying after
    // 2s, 4s, 8s, 16s, then every 30s, instead of logging the user out.
    const retryLater = (): void => {
      if (cancelled) return;
      const delay = Math.min(30_000, 2_000 * 2 ** retries++);
      retryTimer = setTimeout(() => void bootstrap(), delay);
    };

    const bootstrap = async (): Promise<void> => {
      let token = getAccessToken();
      // Cold start: no access token in this tab's sessionStorage but a
      // refresh token is sitting in localStorage from a previous tab.
      // Try once to mint a fresh access token before declaring the user
      // unauthed — otherwise closing the tab and reopening it always
      // forces a re-login even though the 7-day refresh window is open.
      if (!token && getRefreshToken()) {
        const refresh = await attemptRefresh();
        if (refresh.kind === 'unavailable') {
          retryLater();
          return;
        }
        if (refresh.kind === 'rejected') clearAllTokens();
        else token = refresh.accessToken;
      }
      if (!token) {
        if (!cancelled) setState({ status: 'unauthed' });
        return;
      }
      // Cache hit — already rendered, nothing to do.
      if (cachedUser && Date.now() - cachedAt < SESSION_TTL_MS) {
        if (!cancelled) setState({ status: 'authed', user: cachedUser });
        return;
      }
      try {
        const user = await fetchMe();
        if (!cancelled) setState({ status: 'authed', user });
      } catch (err) {
        if (isSessionRejected(err)) {
          clearAllTokens();
          invalidateSessionCache();
          if (!cancelled) setState({ status: 'unauthed' });
        } else if (cachedUser) {
          // Transient failure, but this tab already verified the user — keep
          // them signed in on the (slightly stale) copy.
          if (!cancelled) setState({ status: 'authed', user: cachedUser });
        } else {
          retryLater();
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
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
  // Persist refresh token in localStorage so apiFetch can silently rotate
  // the access token when it expires (15 min default). Without this the
  // user's session dies mid-form and they have to log in again.
  setRefreshToken(tokens.refreshToken);
  invalidateSessionCache();
  invalidateApiCache();
  // Pull the canonical user from /auth/me — it carries the roles + permissions.
  return fetchMe();
}

/**
 * Exchange the stored refresh token for a fresh access token. Returns the
 * new access token, or null if the refresh was rejected or couldn't reach
 * the server. Shares api-client's single-flight refresh (and its timeout),
 * so it never races the automatic refresh apiFetch does on a 401.
 */
export async function refreshTokens(): Promise<string | null> {
  const refresh = await attemptRefresh();
  return refresh.kind === 'refreshed' ? refresh.accessToken : null;
}

export function logout() {
  // Fire-and-forget revocation. The backend invalidates the refresh
  // token server-side so even if it lingers in some other tab it can't
  // be used. We don't await — logout is a UX action, not a transaction.
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    apiFetch('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => undefined);
  }
  clearAllTokens();
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
 *   6. reception → /reception
 *   7. fallback → /sales (matches existing mock behaviour)
 */
export function destinationForUser(user: SessionUser): string {
  const roles = new Set(user.roles);
  if (roles.has('super_admin') || roles.has('admin')) return '/admin';
  if (roles.has('hr')) return '/hr';
  if (roles.has('client')) return '/portal/case';
  if (roles.has('sales')) return '/sales';
  if (roles.has('finance')) return '/finance';
  if (roles.has('processing') || roles.has('processing_manager') || roles.has('documentation')) return '/processing';
  if (roles.has('reception')) return '/reception';
  if (roles.has('marketing')) return '/marketing';
  if (roles.has('jr_head') || roles.has('jr_associate') || roles.has('jr')) return '/jr';
  return '/sales';
}
