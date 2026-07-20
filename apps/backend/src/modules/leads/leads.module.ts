import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../activity-timeline/activity-timeline.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { LeadAssignmentModule } from '../lead-assignment/lead-assignment.module';
import { LeadsController, LeadVerificationController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  // LeadAssignmentModule: round-robins public website enquiries to a sales
  // agent. Depends only on Prisma, so importing it here adds no coupling.
  imports: [AuditLogModule, ActivityTimelineModule, StorageModule, LeadAssignmentModule],
  controllers: [LeadsController, LeadVerificationController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}