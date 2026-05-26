import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../../../activity-timeline/activity-timeline.module';
import { WebhookIngestProcessor } from './webhook-ingest.processor';
import { OutboundMessageProcessor } from './outbound-message.processor';
import { MediaDownloadProcessor } from './media-download.processor';
import { TemplateSyncProcessor } from './template-sync.processor';
import { AiReplyProcessor } from './ai-reply.processor';

@Module({
  imports: [ActivityTimelineModule],
  providers: [
    WebhookIngestProcessor,
    OutboundMessageProcessor,
    MediaDownloadProcessor,
    TemplateSyncProcessor,
    AiReplyProcessor,
  ],
})
export class WhatsAppProcessorsModule {}
