import { Module } from '@nestjs/common';
import { WhatsAppAppointmentNotifierService } from './appointment-notifier.service';

/**
 * Outbound notification helpers that other modules (appointments,
 * follow-ups, etc.) call into. Kept small + dependency-free so importing
 * it never drags the rest of the WhatsApp module along.
 *
 * Relies on the @Global() WhatsAppQueuesModule for the outbound queue
 * registration.
 */
@Module({
  providers: [WhatsAppAppointmentNotifierService],
  exports: [WhatsAppAppointmentNotifierService],
})
export class WhatsAppNotificationsModule {}
