import { Global, Module } from '@nestjs/common';
import { MetaAdsModule } from '../meta-ads/meta-ads.module';
import { MarketingService } from './marketing.service';
import { MarketingController } from './marketing.controller';
import { AdRoutingRulesService } from './routing.service';
import { MarketingRoutingController } from './routing.controller';
import { MarketingAlertsService } from './alerts.service';
import { MarketingHealthService } from './health.service';

/**
 * Marketing portal — dashboard aggregations (1D), editable ad-routing rules
 * (1E), alerts + integration health (1F). Global so the WhatsApp assignment
 * loop can inject AdRoutingRulesService without a circular module import
 * (assignment sits deep inside the whatsapp module tree).
 *
 * Imports MetaAdsModule for MetaAdsService (used by the Health service to
 * report ad-credential + account status). PrismaService is @Global — no
 * explicit import needed.
 */
@Global()
@Module({
  imports: [MetaAdsModule],
  providers: [MarketingService, AdRoutingRulesService, MarketingAlertsService, MarketingHealthService],
  controllers: [MarketingController, MarketingRoutingController],
  exports: [MarketingService, AdRoutingRulesService],
})
export class MarketingModule {}
