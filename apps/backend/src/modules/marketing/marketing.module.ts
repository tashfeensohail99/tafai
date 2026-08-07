import { Global, Module } from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { MarketingController } from './marketing.controller';
import { AdRoutingRulesService } from './routing.service';
import { MarketingRoutingController } from './routing.controller';

/**
 * Marketing portal — dashboard aggregations (1D) + editable ad-routing rules
 * (1E). Global so the WhatsApp assignment loop can inject
 * AdRoutingRulesService without a circular module import (assignment sits
 * deep inside the whatsapp module tree). PrismaService is @Global — no
 * explicit import needed.
 */
@Global()
@Module({
  providers: [MarketingService, AdRoutingRulesService],
  controllers: [MarketingController, MarketingRoutingController],
  exports: [MarketingService, AdRoutingRulesService],
})
export class MarketingModule {}
