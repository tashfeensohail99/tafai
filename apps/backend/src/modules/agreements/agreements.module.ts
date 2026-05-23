import { Module } from '@nestjs/common';
import { AgreementsController } from './agreements.controller';
import { AgreementTemplatesService } from './agreement-templates.service';
import { AgreementsService } from './agreements.service';
import { AgreementRenderService } from './agreement-render.service';

/**
 * Sales → Finance → Client agreement authoring. Template management + the
 * render engine + Sales-side drafting with structured payment plans. The
 * Finance review/approve workflow lands in the next slice.
 *
 * No imports needed: PrismaModule and PdfModule are both @Global.
 */
@Module({
  controllers: [AgreementsController],
  providers: [
    AgreementTemplatesService,
    AgreementsService,
    AgreementRenderService,
  ],
  exports: [
    AgreementTemplatesService,
    AgreementsService,
    AgreementRenderService,
  ],
})
export class AgreementsModule {}
