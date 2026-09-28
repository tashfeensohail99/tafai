/**
 * Identity keys for the upload queue (Databank Phase 1, PR-7). Pure.
 */
import type { DatabankBasePath, UploadTarget } from './transport.ts'; // type-only: erased at runtime

/** One transport per portal base + databank: Processing and JR are different
 *  API prefixes even for the same client. */
export function targetKey(base: DatabankBasePath, t: UploadTarget): string {
  return t.personal ? `${base}|me` : `${base}|c:${t.clientId}`;
}

/** Which databank a landed file belongs to — WITHOUT the portal: Processing and
 *  JR show the same client databank, so both explorers refresh. */
export function dataScopeOf(t: UploadTarget): string {
  return t.personal ? 'me' : `c:${t.clientId}`;
}

/** A dropped file's queue key: its destination + where it sat in the drop +
 *  size + lastModified. Re-dropping the same file into the same place gives
 *  the same key (so the engine resumes / re-asks the server); the same file
 *  dropped into a DIFFERENT folder is a different upload. NUL-separated so no
 *  field can impersonate another ("a|b" + "c" vs "a" + "b|c"). */
export function itemKey(folderId: string | null, relPathOrName: string, size: number, lastModified: number): string {
  return [folderId ?? '', relPathOrName, String(size), String(lastModified)].join('\u0000');
}

/** The signed-in user id (`sub`) from a JWT access token, without verifying it
 *  (the server does that) — only to notice that a DIFFERENT person signed in. */
export function jwtSub(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))); // UTF-8, not Latin-1
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}
