import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../activity-timeline/activity-timeline.module';
import { LeadAssignmentModule } from '../lead-assignment/lead-assignment.module';
import { MetaCredentialsService } from './meta-credentials.service';
import { MetaGraphService } from './meta-graph.service';
import { MetaLeadsService } from './meta-leads.service';
import { MetaLeadgenProcessor } from './meta-leadgen.processor';

/**
 * Meta Lead Ads → CRM. The public webhook is shared with WhatsApp (one Meta
 * callback URL per app); the WhatsApp ingest worker forks `page`/`leadgen`
 * events onto the META_LEADGEN queue, consumed here. The META_LEADGEN queue is
 * registered in the @Global WhatsAppQueuesModule so both the producer (fork)
 * and this consumer share it.
 */
@Module({
  imports: [ActivityTimelineModule, LeadAssignmentModule],
  providers: [MetaCredentialsService, MetaGraphService, MetaLeadsService, MetaLeadgenProcessor],
  exports: [MetaGraphService, MetaLeadsService],
})
export class MetaLeadsModule {}
