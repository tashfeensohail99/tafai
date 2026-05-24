import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '../storage/storage.module';
import { LeadAssignmentModule } from '../lead-assignment/lead-assignment.module';
import { LeadImportsController } from './lead-imports.controller';
import { LeadImportsService } from './lead-imports.service';
import { LeadImportProcessor } from './processors/lead-import.processor';
import { LEAD_IMPORT_QUEUE } from './queue-contracts';

@Module({
  imports: [
    StorageModule,
    LeadAssignmentModule,
    BullModule.registerQueue({ name: LEAD_IMPORT_QUEUE }),
  ],
  controllers: [LeadImportsController],
  providers: [LeadImportsService, LeadImportProcessor],
  exports: [LeadImportsService],
})
export class LeadImportsModule {}
