import { Module } from '@nestjs/common';
import { SocialEngagementModule } from '../social-engagement/social-engagement.module';
import { SocialAlertConfigService } from './social-alert-config.service';
import { SocialAlertService } from './social-alert.service';
import { SocialAlertPollerService } from './social-alert-poller.service';
import { SocialAlertsController } from './social-alerts.controller';

/**
 * New-post → staff engagement alert. Detects new FB/IG posts and nudges staff
 * (email + in-CRM bell + mobile push + a cross-shell banner) to go like &
 * comment — driving the engagement the verification engine then confirms.
 * See docs/social-post-alerts.md.
 *
 * Imports SocialEngagementModule for SocialGraphService (page-token resolution
 * + post/media listing). NotificationsService + EmailService are @Global.
 */
@Module({
  imports: [SocialEngagementModule],
  providers: [SocialAlertConfigService, SocialAlertService, SocialAlertPollerService],
  controllers: [SocialAlertsController],
  exports: [SocialAlertService],
})
export class SocialAlertsModule {}
