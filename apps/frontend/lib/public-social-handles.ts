/**
 * Public (unauthenticated) API for the ONE shared employee social-handle
 * self-submit page. Employees identify themselves by work email. Talks straight
 * to the token-free /public/social-handles endpoints — NO auth is sent. Kept
 * separate from the authed api-client so the public page never pulls in
 * session/refresh logic.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface LookupResult {
  found: boolean;
  name?: string;
  instagram?: string | null;
  facebookUrl?: string | null;
  linkedinUrl?: string | null;
  tiktok?: string | null;
  youtube?: string | null;
  submittedAt?: string | null;
}

export interface IntakeSubmitResult {
  ok: boolean;
  name: string;
  normalized: {
    instagramUrl: string;
    facebookUrl: string | null;
    linkedinUrl: string | null;
    tiktokUrl: string | null;
    youtubeUrl: string | null;
  };
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    const m = body?.message;
    return Array.isArray(m) ? m.join(', ') : m || fallback;
  } catch {
    return fallback;
  }
}

/** Step 1: confirm the email maps to a team member + prefill their handles. */
export async function lookupByEmail(email: string): Promise<LookupResult> {
  const res = await fetch(`${API_BASE}/public/social-handles/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await readError(res, 'Could not look up that email. Please try again.'));
  return res.json() as Promise<LookupResult>;
}

/** Step 2: submit/resubmit handles for the employee behind the email. */
export async function submitByEmail(body: {
  email: string;
  instagram: string;
  facebookUrl?: string;
  linkedinUrl?: string;
  tiktok?: string;
  youtube?: string;
}): Promise<IntakeSubmitResult> {
  const res = await fetch(`${API_BASE}/public/social-handles/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res, 'Could not save. Please check your entries and try again.'));
  return res.json() as Promise<IntakeSubmitResult>;
}

export type SocialField = 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube';

/**
 * Best-effort client-side preview URL for the live "Open profile ↗" link.
 * Mirrors the server normalization loosely — the backend is authoritative and
 * returns a clear error on submit if the input is actually malformed. Returns
 * null when it can't form a plausible URL yet (so no link is shown).
 */
export function previewUrl(field: SocialField, raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  const hasUrl = /^https?:\/\//i.test(input) || /^[\w.-]+\.[a-z]{2,}\//i.test(input);

  const seg = (): string => {
    if (!hasUrl) return input.replace(/^@+/, '');
    try {
      const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
      return u.pathname.split('/').filter(Boolean)[0]?.replace(/^@+/, '') ?? '';
    } catch {
      return '';
    }
  };

  switch (field) {
    case 'instagram': {
      const h = seg().toLowerCase();
      return /^[a-z0-9._]{1,30}$/.test(h) ? `https://www.instagram.com/${h}` : null;
    }
    case 'tiktok': {
      const h = seg().toLowerCase();
      return /^[a-z0-9._]{2,24}$/.test(h) ? `https://www.tiktok.com/@${h}` : null;
    }
    case 'facebook': {
      if (hasUrl && /facebook\.com|fb\.com|fb\.me/i.test(input)) {
        return /^https?:\/\//i.test(input) ? input : `https://${input}`;
      }
      const h = seg();
      return /^[a-zA-Z0-9.]{3,}$/.test(h) ? `https://www.facebook.com/${h}` : null;
    }
    case 'linkedin': {
      if (hasUrl && /linkedin\.com/i.test(input)) {
        return /^https?:\/\//i.test(input) ? input : `https://${input}`;
      }
      const h = seg();
      return /^[a-zA-Z0-9\-_]{3,}$/.test(h) ? `https://www.linkedin.com/in/${h}` : null;
    }
    case 'youtube': {
      if (hasUrl && /youtube\.com|youtu\.be/i.test(input)) {
        return /^https?:\/\//i.test(input) ? input : `https://${input}`;
      }
      const h = seg().toLowerCase();
      return /^[a-z0-9._-]{3,30}$/.test(h) ? `https://www.youtube.com/@${h}` : null;
    }
  }
}
