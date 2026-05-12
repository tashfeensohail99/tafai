import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../activity-timeline/activity-timeline.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { WhatsAppNotificationsModule } from '../whatsapp/notifications/notifications.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [AuditLogModule, ActivityTimelineModule, WhatsAppNotificationsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}