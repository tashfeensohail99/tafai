import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { LeadsModule } from '../leads/leads.module';
import { JudicialReviewService } from './judicial-review.service';
import { JudicialReviewController } from './judicial-review.controller';
import { JrArtifactsService } from './jr-artifacts.service';
import { JrArtifactsController } from './jr-artifacts.controller';
import { JrNotesService } from './jr-notes.service';
import { JrNotesController } from './jr-notes.controller';
import { JrDeadlinesService } from './jr-deadlines.service';
import { JrDeadlinesController } from './jr-deadlines.controller';
import { JrIntakeService } from './jr-intake.service';
import { JrIntakeController } from './jr-intake.controller';
import { JrSettlementService } from './jr-settlement.service';
import { JrSettlementController } from './jr-settlement.controller';
import { JrDeadlineSweeperService } from './jr-deadline-sweeper.service';
import { JrNotificationsService } from './jr-notifications.service';
import { JrWorkReportCompileService } from './jr-work-report-compile.service';
import { JrWorkReportService } from './jr-work-report.service';
import { JrWorkReportController } from './jr-work-report.controller';
import { JrCounselService } from './jr-counsel.service';
import { JrCounselController } from './jr-counsel.controller';

/**
 * Judicial Review (Federal Court JR) module — PR 1 foundation. Owns the `legal`
 * schema domain: matters, artifacts + versions, counsel, deadlines. Exposes a
 * read/store surface only for now; the stage machine, route tree and deadline
 * engine ship in later PRs.
 *
 * StorageModule backs the artifact store (files under jr/matters/${matterId},
 * never the shared client databank). PrismaModule and NumberingModule are
 * @Global — no explicit import needed.
 */
@Module({
  imports: [StorageModule, LeadsModule],
  providers: [
    JrDeadlinesService,
    JudicialReviewService,
    JrArtifactsService,
    JrNotesService,
    JrIntakeService,
    JrSettlementService,
    JrDeadlineSweeperService,
    JrNotificationsService,
    JrWorkReportCompileService,
    JrWorkReportService,
    JrCounselService,
  ],
  controllers: [
    JudicialReviewController,
    JrArtifactsController,
    JrNotesController,
    JrDeadlinesController,
    JrIntakeController,
    JrSettlementController,
    JrWorkReportController,
    JrCounselController,
  ],
  exports: [
    JudicialReviewService,
    JrArtifactsService,
    JrNotesService,
    JrDeadlinesService,
    JrIntakeService,
    JrSettlementService,
    JrWorkReportCompileService,
    JrWorkReportService,
  ],
})
export class JudicialReviewModule {}
