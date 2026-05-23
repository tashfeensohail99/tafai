import { Module } from '@nestjs/common';
import { AgreementsController } from './agreements.controller';
import { AgreementTemplatesService } from './agreement-templates.service';
import { AgreementRenderService } from './agreement-render.service';

/**
 * Sales → Finance → Client agreement authoring. Slice 1 ships template
 * management + the render engine (PDF via the global PdfModule). Sales
 * authoring and Finance review land in later slices.
 *
 * No imports needed: PrismaModule and PdfModule are both @Global.
 */
@Module({
  controllers: [AgreementsController],
  providers: [AgreementTemplatesService, AgreementRenderService],
  exports: [AgreementTemplatesService, AgreementRenderService],
})
export class AgreementsModule {}
