import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { ActivityTimelineModule } from '../activity-timeline/activity-timeline.module';
import { LeadsModule } from '../leads/leads.module';
import { FinanceModule } from '../finance/finance.module';
import { JudicialReviewModule } from '../judicial-review/judicial-review.module';
import { ProcessingController } from './processing.controller';
import { ProcessingService } from './processing.service';
import { DatabankController } from './databank/databank.controller';
import { JrDatabankController } from './databank/jr-databank.controller';
import { DatabankService } from './databank/databank.service';
import { DOC_AI_QUEUE } from './document-ai/document-ai.contracts';
import { DocumentParserClient } from './document-ai/document-parser.client';
import { DocumentAiService } from './document-ai/document-ai.service';
import { DocAiProcessor } from './document-ai/document-ai.processor';
import { DocumentIntakeService } from './document-ai/document-intake.service';
import { DocIntakeProcessor } from './document-ai/doc-intake.processor';
import { DocumentExpirySweeperService } from './document-expiry-sweeper.service';
import { SubmissionPackageService } from './submission-package.service';
import { ClientNudgeService } from './client-nudge.service';

@Module({
  imports: [
    AuditLogModule,
    StorageModule,
    ActivityTimelineModule,
    LeadsModule,
    // Manual-client creation records an authentic CAD invoice (+ verified
    // payment + receipt) via the Finance engine. FinanceModule exports
    // FinanceService; no cycle (Finance imports Cases/Leads, not Processing).
    FinanceModule,
    // A paid JR_RESUBMISSION agreement is routed to a JrMatter (JR Head's queue)
    // instead of a ProcessingCase. JudicialReviewModule exports JrIntakeService;
    // no cycle — the JR module imports StorageModule + LeadsModule only, never
    // ProcessingModule.
    JudicialReviewModule,
    ConfigModule,
    // Phase D2 — document-AI assessment queue (Redis root is the @Global
    // WhatsAppQueuesModule; we just register our own queue name here). The
    // DOC_INTAKE_QUEUE (Phase E) is registered globally in WhatsAppQueuesModule;
    // DocIntakeProcessor below consumes it.
    BullModule.registerQueue({ name: DOC_AI_QUEUE }),
  ],
  controllers: [ProcessingController, DatabankController, JrDatabankController],
  providers: [
    ProcessingService,
    DatabankService,
    DocumentParserClient,
    DocumentAiService,
    DocAiProcessor,
    DocumentIntakeService,
    DocIntakeProcessor,
    DocumentExpirySweeperService,
    SubmissionPackageService,
    ClientNudgeService,
  ],
  // DocumentAiService is exported so the client portal (PortalModule) can run
  // the same AI assessment on client-uploaded documents. DocumentIntakeService
  // is exported so portal/officer uploads can run the bundle-split safety net.
  exports: [ProcessingService, DocumentAiService, DocumentIntakeService],
})
export class ProcessingModule {}
