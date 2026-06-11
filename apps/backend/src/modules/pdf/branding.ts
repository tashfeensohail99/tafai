import type { PDFOptions } from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shared Tashfeen Immigration Solutions print branding — the logo banner
 * header + contact/address footer used on every generated PDF (agreements,
 * receipts, …). Kept in one place so the letterhead and the registered office
 * address are updated once and apply everywhere.
 *
 * The logo is the real brand PNG (tashfeen-logo.png) shipped alongside this
 * module — nest-cli.json's `assets` config copies it to dist. We read it at
 * module load and embed it as a base64 data URI so puppeteer can render it
 * without needing filesystem access at PDF-render time.
 */
let logoDataUri = '';
try {
  const buf = readFileSync(join(__dirname, 'tashfeen-logo.png'));
  logoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
} catch {
  // Asset missing in this build environment — the header still renders
  // (with no logo image) rather than crashing PDF generation.
}
export const LOGO_DATA_URI = logoDataUri;

/** Registered office + contact line — single source of truth for the footer. */
export const FIRM_PHONE = '+92 335 000 1111';
export const FIRM_EMAIL = 'info@tashfeenimmigrationsolutions.com';
export const FIRM_ADDRESS =
  'Office no. 3029A, 3029B, 3031, 3032, 3rd Floor, World Trade Center, Giga Mall DHA-2 Islamabad';

/**
 * Branded running header (logo banner) repeated on every PDF page.
 *
 * Chromium lays the header/footer templates out at 72dpi (1px ≈ 1pt), so px
 * here occupy ~33% more paper than the same px in the page body. The old
 * 82px banner therefore rendered ~30mm tall — past the 24mm top margin — and
 * swallowed the first lines of every page after the first. Sizes below are
 * the pt-equivalents of the original design (82px CSS ≈ 62pt), and the page
 * margins in brandedPdfOptions() clear them with room to spare.
 */
export const HEADER_TEMPLATE = `<div style="width:100%;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="background:#0b1f3a;height:62px;box-sizing:border-box;display:flex;align-items:center;padding:0 32px;"><img src="${LOGO_DATA_URI}" style="height:48px;display:block;"/></div>
  <div style="height:2px;background:#d6a84f;"></div>
</div>`;

/** Branded running footer (contact + address + page numbers) on every page. */
export const FOOTER_TEMPLATE = `<div style="width:100%;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="height:3px;background:#d6a84f;"></div>
  <div style="background:#0b1f3a;color:#e2e8f0;padding:6px 30px 7px;font-size:8px;text-align:center;line-height:1.5;">
    ${FIRM_PHONE} &nbsp;&middot;&nbsp; ${FIRM_EMAIL} &nbsp;&middot;&nbsp; ${FIRM_ADDRESS}
    <div style="font-size:7px;color:#94a3b8;margin-top:2px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
  </div>
</div>`;

/**
 * PDF options for branded documents: the logo header + contact/address footer
 * repeat on every page (displayHeaderFooter), with top/bottom margins sized to
 * fit them and full-bleed sides so the banners reach the page edges. The body
 * supplies its own horizontal padding.
 */
export function brandedPdfOptions(): PDFOptions {
  return {
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: HEADER_TEMPLATE,
    footerTemplate: FOOTER_TEMPLATE,
    // Top must exceed the banner's RENDERED height (64px-as-pt ≈ 22.6mm) or
    // the header overlaps body text on pages 2+. 28mm leaves ~5mm of air.
    margin: { top: '28mm', right: '0', bottom: '20mm', left: '0' },
  };
}
