import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../activity-timeline/activity-timeline.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { LeadsController, LeadVerificationController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [AuditLogModule, ActivityTimelineModule, StorageModule],
  controllers: [LeadsController, LeadVerificationController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}