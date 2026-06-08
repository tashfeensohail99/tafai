import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../activity-timeline/activity-timeline.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { WhatsAppNotificationsModule } from '../whatsapp/notifications/notifications.module';
import { AppointmentBookingModule } from './appointment-booking.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

// NOTE: the old in-memory AppointmentReminderService was replaced by the
// durable RemindersModule (reminder_jobs ledger), which reminds for both
// appointments and follow-ups and survives restarts.
@Module({
  imports: [
    AuditLogModule,
    ActivityTimelineModule,
    WhatsAppNotificationsModule,
    AppointmentBookingModule, // shared double-booking engine (also used by the bot)
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}