import type { PDFOptions } from 'puppeteer-core';

/**
 * Shared Tashfeen Immigration Solutions print branding — the logo banner
 * header + contact/address footer used on every generated PDF (agreements,
 * receipts, …). Kept in one place so the letterhead and the registered office
 * address are updated once and apply everywhere.
 */

// Navy-locked Tashfeen logo. Colours are hard-coded to the dark/navy brand so
// headless Chrome's prefers-color-scheme:light doesn't flip them.
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420">
<style>.bg{fill:#0b1f3a}.mm{fill:#f8fafc}.ms{fill:#cbd5e1}.ac{fill:#d6a84f}.word{fill:#f8fafc;font-family:Montserrat,Arial,Helvetica,sans-serif;font-weight:800;letter-spacing:3px}.tag{fill:#cbd5e1;font-family:Montserrat,Arial,Helvetica,sans-serif;font-weight:600;letter-spacing:4px}</style>
<rect class="bg" x="0" y="0" width="1200" height="420" rx="34"/>
<g transform="translate(72 74)"><path class="ms" d="M0 0h342c-9 29-28 48-59 57H200v247h-48V57H24C13 44 5 25 0 0Z"/><path class="mm" d="M126 57h74l-37 247h-37V57Z"/><path class="ac" d="M154 304h46l-58 42 12-42Z"/></g>
<g transform="translate(440 138)"><text class="word" x="0" y="62" font-size="64">TASHFEEN</text><rect class="ac" x="2" y="92" width="426" height="6" rx="3"/><text class="tag" x="2" y="136" font-size="24">IMMIGRATION SOLUTIONS</text></g>
</svg>`;

export const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

/** Registered office + contact line — single source of truth for the footer. */
export const FIRM_PHONE = '+92 335 000 1111';
export const FIRM_EMAIL = 'info@tashfeenimmigrationsolutions.com';
export const FIRM_ADDRESS =
  'Office no. 3029A, 3029B, 3031, 3032, 3rd Floor, World Trade Center, Giga Mall DHA-2 Islamabad';

/** Branded running header (logo banner) repeated on every PDF page. */
export const HEADER_TEMPLATE = `<div style="width:100%;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="background:#0b1f3a;height:82px;box-sizing:border-box;display:flex;align-items:center;padding:0 42px;"><img src="${LOGO_DATA_URI}" style="height:64px;display:block;"/></div>
  <div style="height:3px;background:#d6a84f;"></div>
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
    margin: { top: '24mm', right: '0', bottom: '20mm', left: '0' },
  };
}
