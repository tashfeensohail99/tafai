/**
 * How a file should be previewed inline, from its MIME type. Drives the
 * explorer's live preview (image/pdf/video/audio/text render in-app; anything
 * else falls back to a Download prompt). Kept pure so it can be unit-tested and
 * reused by any portal.
 */
export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'none';

export function previewKind(mime: string | null | undefined): PreviewKind {
  if (!mime) return 'none';
  if (/^image\//i.test(mime)) return 'image';
  if (/pdf/i.test(mime)) return 'pdf';
  if (/^video\//i.test(mime)) return 'video';
  if (/^audio\//i.test(mime)) return 'audio';
  // Plain text and JSON render fine in an <iframe>; other application/* types
  // (Word, Excel, zip, …) have no reliable in-browser viewer → Download.
  if (/^text\//i.test(mime) || /^application\/json\b/i.test(mime)) return 'text';
  return 'none';
}
