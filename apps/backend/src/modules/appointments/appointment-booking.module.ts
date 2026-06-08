import { Module } from '@nestjs/common';
import { AppointmentBookingService } from './appointment-booking.service';

/**
 * The shared double-booking engine, isolated in its own module so both the web
 * (AppointmentsModule) and the bot (AiModule) can import it without a circular
 * dependency. Depends on PrismaService only (PrismaModule is @Global).
 */
@Module({
  providers: [AppointmentBookingService],
  exports: [AppointmentBookingService],
})
export class AppointmentBookingModule {}
