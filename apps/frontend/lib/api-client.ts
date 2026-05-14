'use client';

import { clearAllTokens, getAccessToken, getRefreshToken } from './auth-client';

export class ApiClientError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Endpoints that must NEVER be retried after a 401-refresh cycle. Refresh
 * itself is the obvious one (infinite loop), login and logout shouldn't
 * be re-attempted with a fresh token either.
 */
const NO_REFRESH_PATHS = new Set(['/auth/refresh', '/auth/login', '/auth/logout']);

/**
 * Single-flight refresh coordinator. If 4 parallel requests all hit 401
 * at once (typical on a page mount that fans out to /leads, /follow-ups,
 * /appointments, /me), only one refresh call goes out and the other
 * three wait on the same promise. Avoids 4 racing refresh attempts where
 * 3 of them invalidate the fourth's just-rotated refresh token.
 */
let refreshPromise: Promise<string | null> | null = null;

async function attemptRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const tokens = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      // Write directly via the auth-client setters to avoid a circular
      // import with session.ts (which itself imports from this file).
      window.sessionStorage.setItem('tafsheen-access-token', tokens.accessToken);
      window.localStorage.setItem('tafsheen-refresh-token', tokens.refreshToken);
      return tokens.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

export function buildQuery(params: Record<string, unknown>): string {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });

  const serialised = query.toString();
  return serialised ? `?${serialised}` : '';
}

// ─── Tiny in-memory cache for safe GET responses ─────────────────────────────
// Killed two pain points seen in production:
//  1. Quick back/forward navigation between /sales/decisions ↔ /sales/leads
//     refetches the same /leads payload — now served from cache for 10s.
//  2. Multiple components on the same page each call apiFetch independently
//     (e.g. SalesDecisionsPage + AdminShell both reading /auth/me). The
//     coalesce map below dedupes in-flight requests so only one network
//     call goes out at a time.
//
// Mutation requests (POST/PATCH/DELETE/PUT) wipe the cache to avoid stale
// reads after a write. Callers can opt out by setting init?.cache='no-store'.
const CACHE_TTL_MS = 10_000;
const cacheStore = new Map<string, { value: unknown; cachedAt: number }>();
const inflightStore = new Map<string, Promise<unknown>>();

/** Manually invalidate every cached GET. Useful after wholesale mutations. */
export function invalidateApiCache(): void {
  cacheStore.clear();
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const method = (init?.method ?? 'GET').toUpperCase();
  const isGet = method === 'GET';
  const cacheKey = `${token ? 'u' : 'a'}|${path}`;

  // Cache hit — return without going to the network.
  if (isGet && init?.cache !== 'no-store') {
    const cached = cacheStore.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.value as T;
    }
    // Coalesce duplicate in-flight requests for the same path.
    const existing = inflightStore.get(cacheKey);
    if (existing) return existing as Promise<T>;
  }

  function buildHeaders(currentToken: string | null): Headers {
    const h = new Headers(init?.headers ?? {});
    if (!h.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
      h.set('Content-Type', 'application/json');
    }
    if (currentToken) h.set('Authorization', `Bearer ${currentToken}`);
    return h;
  }

  async function doFetch(currentToken: string | null): Promise<Response> {
    return fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: buildHeaders(currentToken),
    });
  }

  const promise = (async (): Promise<T> => {
    let response = await doFetch(token);

    // Token-expiry recovery: if the request came back 401 AND the user
    // had an access token (i.e. it wasn't an anonymous call), try to
    // refresh once. If refresh succeeds we replay the original request
    // with the new bearer. If refresh fails we clear state so the next
    // navigation lands on /login instead of looping. Endpoints in
    // NO_REFRESH_PATHS are deliberately excluded to avoid infinite loops.
    if (response.status === 401 && token && !NO_REFRESH_PATHS.has(path)) {
      const newToken = await attemptRefresh();
      if (newToken) {
        response = await doFetch(newToken);
      } else {
        // Refresh path is dead — wipe local state so the next mount of
        // useSession() sees "unauthed" and the shell redirects to login.
        clearAllTokens();
      }
    }

    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');

    if (!response.ok) {
      const message =
        typeof body === 'object' && body && 'message' in body
          ? String((body as { message?: unknown }).message)
          : `Request failed with status ${response.status}`;
      throw new ApiClientError(message, response.status, body);
    }

    return body as T;
  })();

  if (isGet) {
    inflightStore.set(cacheKey, promise);
    promise
      .then((value) => {
        cacheStore.set(cacheKey, { value, cachedAt: Date.now() });
      })
      .catch(() => {
        // Don't cache failed requests — let the next call retry.
      })
      .finally(() => {
        inflightStore.delete(cacheKey);
      });
  } else {
    // Any write invalidates the read cache. Slightly aggressive but
    // dramatically simpler than tracking dependencies; the 10s TTL means
    // the next read pays at most one extra round-trip.
    promise.then(() => invalidateApiCache()).catch(() => undefined);
  }

  return promise;
}

/**
 * Wake the backend up if it's been idle. Railway free-tier services nap
 * after inactivity and cold-start the next request. Call this early in the
 * page lifecycle so user-driven requests don't pay for the wake-up.
 *
 * It hits /health which is deliberately /v1-less and doesn't need auth.
 * Fire-and-forget — failures are ignored.
 */
export function pingBackend(): void {
  try {
    fetch(`${getApiBaseUrl()}/health`, { method: 'GET', cache: 'no-store' }).catch(
      () => undefined,
    );
  } catch {
    // Ignore — this is a best-effort warmup.
  }
}