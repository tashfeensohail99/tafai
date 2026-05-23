import { Global, Module } from '@nestjs/common';
import { PdfController } from './pdf.controller';
import { PdfRenderService } from './pdf.service';

/**
 * Global so any feature module (agreements, receipts, …) can inject
 * PdfRenderService without re-importing. Exposes GET /pdf/health for
 * deploy verification of the headless-Chrome engine.
 */
@Global()
@Module({
  controllers: [PdfController],
  providers: [PdfRenderService],
  exports: [PdfRenderService],
})
export class PdfModule {}
