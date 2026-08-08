import { Global, Module } from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { MarketingController } from './marketing.controller';
import { AdRoutingRulesService } from './routing.service';
import { MarketingRoutingController } from './routing.controller';
import { MarketingAiInsightsService } from './ai-insights.service';

/**
 * Marketing portal — dashboard aggregations (1D), editable ad-routing rules
 * (1E), and advisory AI insights (1G). Global so the WhatsApp assignment
 * loop can inject AdRoutingRulesService without a circular module import
 * (assignment sits deep inside the whatsapp module tree). PrismaService and
 * OpenAiService (via AiModule) are @Global — no explicit imports needed.
 */
@Global()
@Module({
  providers: [MarketingService, AdRoutingRulesService, MarketingAiInsightsService],
  controllers: [MarketingController, MarketingRoutingController],
  exports: [MarketingService, AdRoutingRulesService],
})
export class MarketingModule {}
