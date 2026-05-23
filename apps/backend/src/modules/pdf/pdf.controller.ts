import { Controller, Get } from '@nestjs/common';
import { PdfRenderService } from './pdf.service';

@Controller('pdf')
export class PdfController {
  constructor(private readonly pdf: PdfRenderService) {}

  /**
   * Unauthenticated self-test (mirrors GET /health). Renders a fixed tiny
   * document so we can curl-verify the Chromium engine on a fresh deploy.
   * Returns the byte size on success, or the error message on failure.
   */
  @Get('health')
  async health() {
    try {
      const result = await this.pdf.selfTest();
      return { status: 'ok', ...result };
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
