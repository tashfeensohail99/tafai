import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { ActivityTimelineModule } from '../activity-timeline/activity-timeline.module';
import { LeadsModule } from '../leads/leads.module';
import { ProcessingController } from './processing.controller';
import { ProcessingService } from './processing.service';

@Module({
  imports: [AuditLogModule, StorageModule, ActivityTimelineModule, LeadsModule],
  controllers: [ProcessingController],
  providers: [ProcessingService],
  exports: [ProcessingService],
})
export class ProcessingModule {}
