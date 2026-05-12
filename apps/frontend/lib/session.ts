'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api-client';
import { clearAccessToken, getAccessToken, setAccessToken } from './auth-client';

export interface SessionUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
}

/**
 * Single source of truth for "who is logged in." Used by every shell
 * (AdminShell, ClientPortalShell, and future Employee/Finance/Processing
 * shells once they migrate off mocks).
 *
 * Reads JWT from sessionStorage and calls `/auth/me`. Returns:
 *   - { status: 'loading' } while resolving
 *   - { status: 'authed', user } when authenticated
 *   - { status: 'unauthed' } when no token or token invalid
 */
export function useSession() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'authed'; user: SessionUser }
    | { status: 'unauthed' }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const token = getAccessToken();
    if (!token) {
      setState({ status: 'unauthed' });
      return;
    }
    apiFetch<SessionUser>('/auth/me')
      .then((user) => {
        if (!cancelled) setState({ status: 'authed', user });
      })
      .catch(() => {
        clearAccessToken();
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
  // Pull the canonical user from /auth/me — it carries the roles + permissions.
  return apiFetch<SessionUser>('/auth/me');
}

export function logout() {
  clearAccessToken();
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
