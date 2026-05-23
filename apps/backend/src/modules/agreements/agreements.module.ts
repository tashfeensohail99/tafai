import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AgreementsController } from './agreements.controller';
import { AgreementTemplatesService } from './agreement-templates.service';
import { AgreementsService } from './agreements.service';
import { AgreementRenderService } from './agreement-render.service';

/**
 * Sales → Finance → Client agreement authoring. Template management + the
 * render engine + Sales drafting with structured payment plans + the Finance
 * review/approve workflow (approval materialises a ServiceContract + ledger
 * and stores the final PDF).
 *
 * StorageModule for the final-PDF upload; PrismaModule and PdfModule are
 * both @Global.
 */
@Module({
  imports: [StorageModule],
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
