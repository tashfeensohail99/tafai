import { BadRequestException } from '@nestjs/common';

export type SocialField = 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube';

export interface NormalizedSocial {
  /** Canonical handle (instagram/tiktok). Undefined for URL-only platforms. */
  handle?: string;
  /** Canonical, openable profile URL. */
  url: string;
}

/**
 * Normalise a social profile accepting EITHER a bare handle OR a full URL, and
 * return the canonical handle (where the platform has one) + an openable URL.
 *
 * Empty input returns `null` (the field is simply unset). Malformed non-empty
 * input throws a BadRequest with a clear, per-platform message. We only
 * guarantee the link is WELL-FORMED and opens — not that the profile exists
 * (there is no free existence API for LinkedIn/FB/TikTok, and IG existence is
 * confirmed downstream by the comment-verification engine).
 */
export function normalizeSocial(field: SocialField, raw: string | null | undefined): NormalizedSocial | null {
  const input = (raw ?? '').trim();
  if (!input) return null;

  switch (field) {
    case 'instagram':
      return normalizeInstagram(input);
    case 'facebook':
      return normalizeFacebook(input);
    case 'linkedin':
      return normalizeLinkedin(input);
    case 'tiktok':
      return normalizeTiktok(input);
    case 'youtube':
      return normalizeYoutube(input);
  }
}

/** Pull the hostname + path segments from a URL-ish string, or null if not a URL. */
function asUrl(input: string): URL | null {
  let candidate = input;
  if (!/^https?:\/\//i.test(candidate)) {
    // Only treat it as a URL when it clearly looks like a domain path.
    if (!/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(candidate)) return null;
    candidate = `https://${candidate}`;
  }
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function firstSegment(u: URL): string {
  return u.pathname.split('/').filter(Boolean)[0] ?? '';
}

function normalizeInstagram(input: string): NormalizedSocial {
  let handle = input;
  const u = asUrl(input);
  if (u) {
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) {
      throw new BadRequestException('That doesn’t look like an Instagram link. Use your @username or instagram.com/username.');
    }
    handle = firstSegment(u);
  }
  handle = handle.replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
    throw new BadRequestException('Enter a valid Instagram username (letters, numbers, “.” and “_”).');
  }
  return { handle, url: `https://www.instagram.com/${handle}` };
}

function normalizeFacebook(input: string): NormalizedSocial {
  const u = asUrl(input);
  if (u) {
    if (!/(^|\.)(facebook\.com|fb\.com|fb\.me)$/i.test(u.hostname)) {
      throw new BadRequestException('That doesn’t look like a Facebook link.');
    }
    // Numeric profile links: facebook.com/profile.php?id=<digits>
    if (/\/profile\.php$/i.test(u.pathname)) {
      const id = u.searchParams.get('id');
      if (id && /^\d+$/.test(id)) return { url: `https://www.facebook.com/profile.php?id=${id}` };
      throw new BadRequestException('That Facebook profile link is missing its id.');
    }
    const seg = firstSegment(u);
    // Keep the "people/<name>/<id>" shape intact when present.
    if (seg.toLowerCase() === 'people') {
      const rest = u.pathname.split('/').filter(Boolean).slice(0, 3).join('/');
      return { url: `https://www.facebook.com/${rest}` };
    }
    if (!/^[a-zA-Z0-9.]{3,}$/.test(seg)) {
      throw new BadRequestException('Enter a valid Facebook profile link or username.');
    }
    return { url: `https://www.facebook.com/${seg}` };
  }
  const handle = input.replace(/^@+/, '');
  if (!/^[a-zA-Z0-9.]{3,}$/.test(handle)) {
    throw new BadRequestException('Enter your Facebook username or paste your profile link.');
  }
  return { url: `https://www.facebook.com/${handle}` };
}

function normalizeLinkedin(input: string): NormalizedSocial {
  const u = asUrl(input);
  if (u) {
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) {
      throw new BadRequestException('That doesn’t look like a LinkedIn link. Use linkedin.com/in/your-name.');
    }
    const parts = u.pathname.split('/').filter(Boolean);
    const kind = (parts[0] ?? '').toLowerCase();
    const slug = parts[1] ?? '';
    if ((kind === 'in' || kind === 'company' || kind === 'pub') && /^[a-zA-Z0-9\-_%]{2,}$/.test(slug)) {
      return { url: `https://www.linkedin.com/${kind}/${slug}` };
    }
    throw new BadRequestException('Paste your full LinkedIn profile URL (linkedin.com/in/your-name).');
  }
  const slug = input.replace(/^@+/, '');
  if (!/^[a-zA-Z0-9\-_]{3,}$/.test(slug)) {
    throw new BadRequestException('Paste your full LinkedIn profile URL (linkedin.com/in/your-name).');
  }
  return { url: `https://www.linkedin.com/in/${slug}` };
}

function normalizeTiktok(input: string): NormalizedSocial {
  let handle = input;
  const u = asUrl(input);
  if (u) {
    if (!/(^|\.)tiktok\.com$/i.test(u.hostname)) {
      throw new BadRequestException('That doesn’t look like a TikTok link. Use your @username.');
    }
    handle = firstSegment(u);
  }
  handle = handle.replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9._]{2,24}$/.test(handle)) {
    throw new BadRequestException('Enter a valid TikTok username (letters, numbers, “.” and “_”).');
  }
  return { handle, url: `https://www.tiktok.com/@${handle}` };
}

function normalizeYoutube(input: string): NormalizedSocial {
  const u = asUrl(input);
  if (u) {
    if (!/(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname)) {
      throw new BadRequestException('That doesn’t look like a YouTube link. Use youtube.com/@yourchannel.');
    }
    const parts = u.pathname.split('/').filter(Boolean);
    const first = parts[0] ?? '';
    // Handle form: /@name
    if (first.startsWith('@')) {
      const h = first.slice(1).toLowerCase();
      if (/^[a-z0-9._-]{3,30}$/.test(h)) return { url: `https://www.youtube.com/@${h}` };
    }
    // Canonical forms: /channel/UC..., /c/Name, /user/Name
    const kind = first.toLowerCase();
    const slug = parts[1] ?? '';
    if ((kind === 'channel' || kind === 'c' || kind === 'user') && /^[a-zA-Z0-9._-]{2,}$/.test(slug)) {
      return { url: `https://www.youtube.com/${kind}/${slug}` };
    }
    throw new BadRequestException('Paste your channel link (youtube.com/@you, /channel/… or /c/…).');
  }
  // Bare @handle or handle
  const h = input.replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(h)) {
    throw new BadRequestException('Enter your YouTube @handle or paste your channel link.');
  }
  return { url: `https://www.youtube.com/@${h}` };
}

/** Canonical openable URL for a stored value, or null. Used by read responses. */
export function instagramUrl(handle: string | null): string | null {
  return handle ? `https://www.instagram.com/${handle}` : null;
}
export function tiktokUrl(handle: string | null): string | null {
  return handle ? `https://www.tiktok.com/@${handle}` : null;
}
