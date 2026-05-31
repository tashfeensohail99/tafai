import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { ActivityTimelineModule } from '../activity-timeline/activity-timeline.module';
import { LeadsModule } from '../leads/leads.module';
import { ProcessingController } from './processing.controller';
import { ProcessingService } from './processing.service';
import { DOC_AI_QUEUE } from './document-ai/document-ai.contracts';
import { DocumentParserClient } from './document-ai/document-parser.client';
import { DocumentAiService } from './document-ai/document-ai.service';
import { DocAiProcessor } from './document-ai/document-ai.processor';
import { DocumentIntakeService } from './document-ai/document-intake.service';
import { DocIntakeProcessor } from './document-ai/doc-intake.processor';

@Module({
  imports: [
    AuditLogModule,
    StorageModule,
    ActivityTimelineModule,
    LeadsModule,
    ConfigModule,
    // Phase D2 — document-AI assessment queue (Redis root is the @Global
    // WhatsAppQueuesModule; we just register our own queue name here). The
    // DOC_INTAKE_QUEUE (Phase E) is registered globally in WhatsAppQueuesModule;
    // DocIntakeProcessor below consumes it.
    BullModule.registerQueue({ name: DOC_AI_QUEUE }),
  ],
  controllers: [ProcessingController],
  providers: [
    ProcessingService,
    DocumentParserClient,
    DocumentAiService,
    DocAiProcessor,
    DocumentIntakeService,
    DocIntakeProcessor,
  ],
  // DocumentAiService is exported so the client portal (PortalModule) can run
  // the same AI assessment on client-uploaded documents. DocumentIntakeService
  // is exported so portal/officer uploads can run the bundle-split safety net.
  exports: [ProcessingService, DocumentAiService, DocumentIntakeService],
})
export class ProcessingModule {}
