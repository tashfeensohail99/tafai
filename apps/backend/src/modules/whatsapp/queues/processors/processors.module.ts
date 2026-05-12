import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../../../activity-timeline/activity-timeline.module';
import { WebhookIngestProcessor } from './webhook-ingest.processor';
import { OutboundMessageProcessor } from './outbound-message.processor';
import { MediaDownloadProcessor } from './media-download.processor';
import { TemplateSyncProcessor } from './template-sync.processor';

@Module({
  imports: [ActivityTimelineModule],
  providers: [
    WebhookIngestProcessor,
    OutboundMessageProcessor,
    MediaDownloadProcessor,
    TemplateSyncProcessor,
  ],
})
export class WhatsAppProcessorsModule {}
