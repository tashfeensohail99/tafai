/**
 * The visual "kind" of a databank file, used to pick a distinct per-type icon
 * and a short Type-column label in the explorer (so a PDF looks like a PDF, a
 * Word doc like a document, an image like an image, and so on — rather than
 * every file sharing one generic glyph).
 *
 * Derived from BOTH the filename extension and the MIME type, extension first:
 * uploads routinely arrive with a useless `application/octet-stream` MIME, but
 * the name almost always carries a real extension. Kept pure so it can be
 * unit-tested and reused by any portal.
 */
export type FileKind =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'text'
  | 'file';

/** Extension → kind. The most common office/media/code extensions we expect. */
const BY_EXT: Record<string, FileKind> = {
  pdf: 'pdf',
  // Word processing
  doc: 'word', docx: 'word', odt: 'word', rtf: 'word', pages: 'word',
  // Spreadsheets
  xls: 'excel', xlsx: 'excel', xlsm: 'excel', xlsb: 'excel', csv: 'excel', tsv: 'excel', ods: 'excel', numbers: 'excel',
  // Presentations
  ppt: 'powerpoint', pptx: 'powerpoint', odp: 'powerpoint', key: 'powerpoint',
  // Images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  bmp: 'image', ico: 'image', heic: 'image', heif: 'image', tif: 'image', tiff: 'image', avif: 'image',
  // Video
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video', m4v: 'video', wmv: 'video', flv: 'video',
  // Audio
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio', weba: 'audio',
  // Archives
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', xz: 'archive',
  // Code / markup
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code', json: 'code', html: 'code', htm: 'code', css: 'code', scss: 'code',
  xml: 'code', yml: 'code', yaml: 'code', py: 'code', java: 'code', c: 'code', h: 'code', cpp: 'code', cs: 'code',
  go: 'code', rb: 'code', php: 'code', sh: 'code', sql: 'code',
  // Plain text
  txt: 'text', md: 'text', markdown: 'text', log: 'text',
};

/** Lower-cased final extension of a filename, or null. */
function extOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /\.([a-z0-9]+)\s*$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : null;
}

export function fileKind(mime: string | null | undefined, name?: string | null): FileKind {
  const ext = extOf(name);
  if (ext && BY_EXT[ext]) return BY_EXT[ext];

  const m = (mime ?? '').toLowerCase();
  if (!m) return 'file';
  if (m.includes('pdf')) return 'pdf';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (/wordprocessingml|msword|opendocument\.text|rtf/.test(m)) return 'word';
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet|\bcsv\b/.test(m)) return 'excel';
  if (/presentationml|ms-powerpoint|opendocument\.presentation/.test(m)) return 'powerpoint';
  if (/zip|rar|7z|tar|gzip|compressed/.test(m)) return 'archive';
  if (/json|javascript|typescript|html|xml|css/.test(m)) return 'code';
  if (m.startsWith('text/')) return 'text';
  return 'file';
}

const KIND_LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  word: 'Word',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  archive: 'Archive',
  code: 'Code',
  text: 'Text',
  file: 'File',
};

/** Short, human label for the Type column. */
export function fileTypeLabel(mime: string | null | undefined, name?: string | null): string {
  return KIND_LABEL[fileKind(mime, name)];
}
