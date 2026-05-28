import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { StorageModule } from '../storage/storage.module';
import { ProcessingModule } from '../processing/processing.module';

@Module({
  // ProcessingModule exports DocumentAiService — client uploads run the same
  // AI assessment pipeline as officer/WhatsApp uploads.
  imports: [StorageModule, ProcessingModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
