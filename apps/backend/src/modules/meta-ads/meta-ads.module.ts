import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { MetaAdsService } from './meta-ads.service';
import { MetaAdsSyncService } from './meta-ads-sync.service';
import { MetaHierarchyService } from './meta-hierarchy.service';
import { MetaHierarchySyncService } from './meta-hierarchy-sync.service';
import { MetaAdsController } from './meta-ads.controller';

/**
 * Meta Marketing API → ad-spend cache for the leads-dashboard ROI metrics.
 * Credentials come from the `meta_ads` API key (ApiKeysModule, @Global) or an
 * env override; FxService (@Global) converts spend to CAD; PrismaService
 * (@Global) persists AdSpendDaily. ApiKeysModule is imported explicitly so the
 * dependency is declared even though it is also global.
 */
@Module({
  imports: [ApiKeysModule],
  providers: [MetaAdsService, MetaAdsSyncService, MetaHierarchyService, MetaHierarchySyncService],
  controllers: [MetaAdsController],
  exports: [MetaAdsService, MetaHierarchyService],
})
export class MetaAdsModule {}
