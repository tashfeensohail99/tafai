'use client';

/**
 * Token storage for the web client.
 *
 * Access tokens live in sessionStorage and are short-lived (15 min by
 * default). They die when the tab closes — keeping them out of long-lived
 * storage limits the blast radius if an XSS bug ever lets a page read the
 * Storage API.
 *
 * Refresh tokens live in localStorage so a returning user with an
 * unexpired refresh window (default 7 days) can silently bootstrap a
 * fresh access token without re-entering credentials. The refresh
 * endpoint rotates the refresh token on every call, so a stolen refresh
 * token reveals itself the next time the legitimate browser refreshes
 * (the rotated value won't be in their store).
 */

const ACCESS_TOKEN_KEY = 'tafsheen-access-token';
const REFRESH_TOKEN_KEY = 'tafsheen-refresh-token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function clearRefreshToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/** Convenience: nuke both tokens. Called on logout and on irrecoverable 401s. */
export function clearAllTokens(): void {
  clearAccessToken();
  clearRefreshToken();
}
