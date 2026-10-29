import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { MetaCredentialsService } from '../meta-leads/meta-credentials.service';
import { SocialGraphService } from './social-graph.service';
import { SocialEngagementService } from './social-engagement.service';
import { SocialSweepService } from './social-sweep.service';
import { SocialEngagementController } from './social-engagement.controller';
import { PublicSocialHandlesController } from './public-social-handles.controller';

/**
 * Team social-engagement verification — confirms via the Graph API that reps
 * actually commented on the company's FB/IG posts, replacing the WhatsApp-group
 * screenshot ritual with a tracked KPI. See
 * docs/social-engagement-verification.md.
 *
 * Provides its own MetaCredentialsService (depends only on the @Global
 * PrismaService + ConfigService) so it reuses the stored system-user token
 * without importing the lead-ads module. PrismaService is @Global; StorageModule
 * is imported for the Facebook-claim screenshot upload.
 */
@Module({
  imports: [StorageModule],
  providers: [MetaCredentialsService, SocialGraphService, SocialEngagementService, SocialSweepService],
  controllers: [SocialEngagementController, PublicSocialHandlesController],
  exports: [SocialEngagementService],
})
export class SocialEngagementModule {}
