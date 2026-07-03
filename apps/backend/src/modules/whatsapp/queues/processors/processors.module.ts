import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../../../activity-timeline/activity-timeline.module';
import { AuditLogModule } from '../../../audit-log/audit-log.module';
import { StorageModule } from '../../../storage/storage.module';
import { WebhookIngestProcessor } from './webhook-ingest.processor';
import { OutboundMessageProcessor } from './outbound-message.processor';
import { MediaDownloadProcessor } from './media-download.processor';
import { TemplateSyncProcessor } from './template-sync.processor';
import { AiReplyProcessor } from './ai-reply.processor';
import { CsvDripProcessor } from './csv-drip.processor';
import { CsvDripService } from '../../drip/csv-drip.service';
import { OutboundOrphanDrainerService } from './outbound-orphan-drainer.service';

// StorageModule is imported here so AiReplyProcessor can pull voice-note
// audio bytes from S3/Supabase before transcribing via Whisper. Without
// this import the container fails to resolve StorageService at boot —
// observed live in 7ed3017's crash loop.
@Module({
  imports: [ActivityTimelineModule, AuditLogModule, StorageModule],
  providers: [
    WebhookIngestProcessor,
    OutboundMessageProcessor,
    MediaDownloadProcessor,
    TemplateSyncProcessor,
    AiReplyProcessor,
    // CSV auto-drip: 2-touch template outreach for imported leads.
    CsvDripProcessor,
    CsvDripService,
    // Boot-time sweep that re-enqueues OUTBOUND messages stuck in QUEUED
    // status without a Redis job (typical when a maintenance script wrote
    // them from outside the VPC and couldn't reach internal Redis).
    OutboundOrphanDrainerService,
  ],
})
export class WhatsAppProcessorsModule {}
