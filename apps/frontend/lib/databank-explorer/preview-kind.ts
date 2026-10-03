/**
 * How a file should be previewed inline, from its MIME type. Drives the
 * explorer's live preview (image/pdf/video/audio/text render in-app; anything
 * else falls back to a Download prompt). Kept pure so it can be unit-tested and
 * reused by any portal.
 */
export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'docx' | 'xlsx' | 'none';

export function previewKind(mime: string | null | undefined): PreviewKind {
  if (!mime) return 'none';
  if (/^image\//i.test(mime)) return 'image';
  if (/pdf/i.test(mime)) return 'pdf';
  if (/^video\//i.test(mime)) return 'video';
  if (/^audio\//i.test(mime)) return 'audio';
  // Modern Office formats render in-browser via a lazy-loaded library (docx →
  // docx-preview, xlsx → SheetJS), with bytes never leaving the browser. Only
  // the OOXML formats (.docx/.xlsx) — the legacy binary .doc/.xls have no
  // reliable browser renderer and fall through to Download.
  if (/wordprocessingml\.document/i.test(mime)) return 'docx';
  if (/spreadsheetml\.sheet/i.test(mime)) return 'xlsx';
  // Plain text and JSON render fine in an <iframe>; other application/* types
  // (PowerPoint, zip, legacy Office, …) have no reliable in-browser viewer → Download.
  if (/^text\//i.test(mime) || /^application\/json\b/i.test(mime)) return 'text';
  return 'none';
}
