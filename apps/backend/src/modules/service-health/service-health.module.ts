import { Module } from '@nestjs/common';
import { ServiceHealthSentinelService } from './service-health.service';
import { ServiceHealthController } from './service-health.controller';

// EmailModule + NotificationsModule are @Global, so EmailService and
// NotificationsService inject without importing them here.
@Module({
  controllers: [ServiceHealthController],
  providers: [ServiceHealthSentinelService],
})
export class ServiceHealthModule {}
