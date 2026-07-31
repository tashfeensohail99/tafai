import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SlowQuerySamplerService } from './slow-query-sampler.service';

@Module({
  controllers: [HealthController],
  providers: [SlowQuerySamplerService],
})
export class HealthModule {}
