import { Global, Module } from '@nestjs/common';
import { OpenAiService } from './openai.service';
import { KnowledgeService } from './knowledge.service';
import { OrchestratorService } from './orchestrator.service';
import { AiAdminController } from './ai-admin.controller';
import { AiBacklogSweeperService } from './ai-backlog-sweeper.service';
import { WhatsAppWindowKeeperService } from './window-keeper.service';
import { WhatsAppNotificationsModule } from '../whatsapp/notifications/notifications.module';
import { AppointmentBookingModule } from '../appointments/appointment-booking.module';

/**
 * Global so the WhatsApp inbound processor can inject {@link OrchestratorService}
 * without an explicit module import.
 *
 * Imports WhatsAppNotificationsModule so the orchestrator can send the formal
 * appointment-confirmation WhatsApp after an auto-book (the same block sales
 * agents send when they finalize an appointment manually).
 *
 * Imports AppointmentBookingModule so the bot books through the SAME
 * double-booking engine the web/app uses (one conflict authority platform-wide).
 */
@Global()
@Module({
  imports: [WhatsAppNotificationsModule, AppointmentBookingModule],
  controllers: [AiAdminController],
  providers: [
    OpenAiService,
    KnowledgeService,
    OrchestratorService,
    AiBacklogSweeperService,
    WhatsAppWindowKeeperService,
  ],
  exports: [OpenAiService, KnowledgeService, OrchestratorService],
})
export class AiModule {}
