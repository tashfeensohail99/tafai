import { Module } from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { MarketingController } from './marketing.controller';

/**
 * Read-only dashboard aggregations for the Marketing portal (Phase 1D).
 * PrismaService is @Global — no explicit import needed.
 */
@Module({
  providers: [MarketingService],
  controllers: [MarketingController],
  exports: [MarketingService],
})
export class MarketingModule {}
