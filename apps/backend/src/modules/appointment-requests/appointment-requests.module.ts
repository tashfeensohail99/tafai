import { Module } from '@nestjs/common';
import { AppointmentRequestsController } from './appointment-requests.controller';

@Module({
  controllers: [AppointmentRequestsController],
})
export class AppointmentRequestsModule {}
