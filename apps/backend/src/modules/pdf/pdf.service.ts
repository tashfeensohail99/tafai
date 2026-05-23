import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { existsSync } from 'node:fs';
import puppeteer, { type Browser, type PDFOptions } from 'puppeteer-core';

/**
 * Headless-Chrome HTML→PDF engine.
 *
 * Drives the system Chromium shipped in the Docker image (Alpine `chromium`
 * package) via puppeteer-core. We deliberately avoid full `puppeteer`, which
 * would download its own browser at npm-install time and bloat the image.
 *
 * A single Browser instance is launched lazily and reused across renders;
 * each render gets a short-lived page. This bounds memory and keeps the
 * cold-start launch cost off the request path after the first render.
 */
@Injectable()
export class PdfRenderService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRenderService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  /** Candidate Chromium binary locations, in priority order. */
  private static readonly CANDIDATES: string[] = [
    process.env.CHROMIUM_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/lib/chromium/chrome',
  ].filter((p): p is string => Boolean(p));

  private resolveExecutablePath(): string {
    for (const candidate of PdfRenderService.CANDIDATES) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(
      `No Chromium binary found. Looked in: ${PdfRenderService.CANDIDATES.join(', ')}. ` +
        'Install the `chromium` package in the runtime image or set CHROMIUM_PATH.',
    );
  }

  /** Lazily launch (or relaunch after a crash) the shared browser. */
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launching) return this.launching;

    const executablePath = this.resolveExecutablePath();
    this.logger.log(`Launching headless Chromium: ${executablePath}`);

    this.launching = puppeteer
      .launch({
        executablePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
        ],
      })
      .then((browser) => {
        this.browser = browser;
        // If Chrome dies, drop the ref so the next render relaunches cleanly.
        browser.on('disconnected', () => {
          this.logger.warn(
            'Headless Chromium disconnected — will relaunch on next render',
          );
          this.browser = null;
        });
        return browser;
      })
      .finally(() => {
        this.launching = null;
      });

    return this.launching;
  }

  /**
   * Render a complete HTML document to a PDF buffer.
   * @param html Full HTML string (should embed its own <style>/fonts).
   * @param options puppeteer PDF options; merged over A4 defaults.
   */
  async renderHtml(html: string, options: PDFOptions = {}): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '16mm', bottom: '20mm', left: '16mm' },
        ...options,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /**
   * Self-test for GET /pdf/health — renders a fixed tiny document and reports
   * the byte size, confirming Chromium is wired correctly in the deployed
   * image without exposing anything sensitive.
   */
  async selfTest(): Promise<{ ok: true; bytes: number; executablePath: string }> {
    const executablePath = this.resolveExecutablePath();
    const buf = await this.renderHtml(
      '<!doctype html><html><body style="font-family:sans-serif">' +
        '<h1>PDF engine OK</h1><p>Rendered at ' +
        new Date().toISOString() +
        '</p></body></html>',
    );
    return { ok: true, bytes: buf.length, executablePath };
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
