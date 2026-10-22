import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

/** A multer-style uploaded file (the shape both upload controllers hand us). */
export interface UploadedFileLike {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/** Types we can MERGE into a single PDF (pdf-lib embeds JPEG/PNG + copies PDF pages). */
export const MERGEABLE_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

/** Types accepted for a SINGLE-file upload (stored as-is, no merge needed). */
export const SIGNED_UPLOAD_ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

/** Merging loads every file into memory at once, so cap the combined size. */
const MAX_TOTAL_BYTES = 60 * 1024 * 1024; // 60 MB

/**
 * Merge an ordered list of PDFs and/or images (JPEG/PNG) into ONE PDF, in the
 * given order. PDF pages are copied verbatim; each image is placed one-per-page
 * on A4, scaled to fit with a small margin. Mirrors the proven logic in
 * submission-package.service.ts. Returns the merged PDF bytes.
 */
export async function mergeFilesToPdf(files: UploadedFileLike[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const f of files) {
    if (f.mimetype === 'application/pdf') {
      const src = await PDFDocument.load(f.buffer, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const p of pages) merged.addPage(p);
    } else if (f.mimetype === 'image/jpeg' || f.mimetype === 'image/jpg') {
      addImagePage(merged, await merged.embedJpg(f.buffer));
    } else if (f.mimetype === 'image/png') {
      addImagePage(merged, await merged.embedPng(f.buffer));
    } else {
      throw new BadRequestException(`Cannot merge unsupported file type: ${f.mimetype}`);
    }
  }
  const bytes = await merged.save();
  return Buffer.from(bytes);
}

/** Lay an embedded image centred on its own A4 page, scaled to fit the margins. */
function addImagePage(doc: PDFDocument, image: Awaited<ReturnType<PDFDocument['embedJpg']>>): void {
  const page = doc.addPage([595, 842]); // A4 portrait (pt)
  const { width, height } = page.getSize();
  const margin = 24;
  const usableW = width - margin * 2;
  const usableH = height - margin * 2;
  const dims = image.scaleToFit(usableW, usableH);
  page.drawImage(image, {
    x: margin + (usableW - dims.width) / 2,
    y: margin + (usableH - dims.height) / 2,
    width: dims.width,
    height: dims.height,
  });
}

/**
 * Resolve an upload (one or many files) to the SINGLE file we store on the
 * contract's `agreementKey`:
 *  - exactly one file  → stored as-is (any allowed type, incl. WebP/a ready PDF).
 *  - multiple files    → merged into one PDF (page order = array order).
 * Throws BadRequestException on an empty, oversized, or unmergeable upload.
 */
export async function resolveSignedUpload(
  files: UploadedFileLike[] | undefined,
): Promise<UploadedFileLike> {
  if (!files || files.length === 0) {
    throw new BadRequestException('At least one file is required');
  }
  const total = files.reduce((n, f) => n + (f.size ?? f.buffer.length), 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new BadRequestException('Total upload is too large (max 60 MB) — send fewer or smaller pages.');
  }
  for (const f of files) {
    if (!f.buffer || f.buffer.length === 0) {
      throw new BadRequestException('One of the files is empty.');
    }
  }

  if (files.length === 1) {
    const f = files[0];
    if (!SIGNED_UPLOAD_ALLOWED_MIME_TYPES.has(f.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${f.mimetype}. Use PDF or image (PNG/JPEG/WebP).`,
      );
    }
    return f;
  }

  // Multiple → merge. Only PDF/JPEG/PNG can be merged (WebP is not embeddable).
  for (const f of files) {
    if (!MERGEABLE_MIME_TYPES.has(f.mimetype)) {
      throw new BadRequestException(
        `Can't merge "${f.originalname}" (${f.mimetype}). For multiple pages use PDF, JPEG or PNG.`,
      );
    }
  }
  const merged = await mergeFilesToPdf(files);
  return {
    buffer: merged,
    mimetype: 'application/pdf',
    originalname: 'signed-agreement.pdf',
    size: merged.length,
  };
}
