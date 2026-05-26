import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../../../activity-timeline/activity-timeline.module';
import { StorageModule } from '../../../storage/storage.module';
import { WebhookIngestProcessor } from './webhook-ingest.processor';
import { OutboundMessageProcessor } from './outbound-message.processor';
import { MediaDownloadProcessor } from './media-download.processor';
import { TemplateSyncProcessor } from './template-sync.processor';
import { AiReplyProcessor } from './ai-reply.processor';

// StorageModule is imported here so AiReplyProcessor can pull voice-note
// audio bytes from S3/Supabase before transcribing via Whisper. Without
// this import the container fails to resolve StorageService at boot —
// observed live in 7ed3017's crash loop.
@Module({
  imports: [ActivityTimelineModule, StorageModule],
  providers: [
    WebhookIngestProcessor,
    OutboundMessageProcessor,
    MediaDownloadProcessor,
    TemplateSyncProcessor,
    AiReplyProcessor,
  ],
})
export class WhatsAppProcessorsModule {}
