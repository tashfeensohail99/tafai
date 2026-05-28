'use client';

import { useEffect, useState } from 'react';
import { apiFetch, invalidateApiCache } from './api-client';
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

    const bootstrap = async (): Promise<void> => {
      let token = getAccessToken();
      // Cold start: no access token in this tab's sessionStorage but a
      // refresh token is sitting in localStorage from a previous tab.
      // Try once to mint a fresh access token before declaring the user
      // unauthed — otherwise closing the tab and reopening it always
      // forces a re-login even though the 7-day refresh window is open.
      if (!token && getRefreshToken()) {
        token = await refreshTokens();
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
      } catch {
        clearAllTokens();
        invalidateSessionCache();
        if (!cancelled) setState({ status: 'unauthed' });
      }
    };

    void bootstrap();
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
 * Exchange a refresh token for a fresh access token. Called by api-client
 * when a request comes back 401, before retrying the original request.
 * Returns the new access token, or null if the refresh failed (refresh
 * token expired, revoked, or never existed). On failure the caller is
 * responsible for clearing tokens + bouncing to /login.
 *
 * Coalesces concurrent refresh attempts so a page-load that fires 5
 * parallel API calls (all hitting 401 simultaneously) only spends one
 * refresh round-trip instead of racing 5 of them.
 */
let refreshInflight: Promise<string | null> | null = null;
export function refreshTokens(): Promise<string | null> {
  if (refreshInflight) return refreshInflight;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return Promise.resolve(null);

  refreshInflight = apiFetch<LoginResult>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  })
    .then((tokens) => {
      setAccessToken(tokens.accessToken);
      setRefreshToken(tokens.refreshToken);
      return tokens.accessToken;
    })
    .catch(() => {
      // Refresh failed — token is gone for good, surface that to the
      // caller. They'll clear state and redirect.
      return null;
    })
    .finally(() => {
      refreshInflight = null;
    });
  return refreshInflight;
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
 *   6. fallback → /sales (matches existing mock behaviour)
 */
export function destinationForUser(user: SessionUser): string {
  const roles = new Set(user.roles);
  if (roles.has('super_admin') || roles.has('admin')) return '/admin';
  if (roles.has('client')) return '/portal/case';
  if (roles.has('sales')) return '/sales';
  if (roles.has('finance')) return '/finance';
  if (roles.has('processing') || roles.has('processing_manager') || roles.has('documentation')) return '/processing';
  return '/sales';
}
