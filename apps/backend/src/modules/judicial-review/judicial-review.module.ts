import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { LeadsModule } from '../leads/leads.module';
import { JudicialReviewService } from './judicial-review.service';
import { JudicialReviewController } from './judicial-review.controller';
import { JrArtifactsService } from './jr-artifacts.service';
import { JrArtifactsController } from './jr-artifacts.controller';
import { JrDeadlinesService } from './jr-deadlines.service';
import { JrDeadlinesController } from './jr-deadlines.controller';
import { JrIntakeService } from './jr-intake.service';
import { JrIntakeController } from './jr-intake.controller';

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
  providers: [JrDeadlinesService, JudicialReviewService, JrArtifactsService, JrIntakeService],
  controllers: [
    JudicialReviewController,
    JrArtifactsController,
    JrDeadlinesController,
    JrIntakeController,
  ],
  exports: [JudicialReviewService, JrArtifactsService, JrDeadlinesService, JrIntakeService],
})
export class JudicialReviewModule {}
