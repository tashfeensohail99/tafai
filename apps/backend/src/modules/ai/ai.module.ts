import { Global, Module } from '@nestjs/common';
import { OpenAiService } from './openai.service';
import { KnowledgeService } from './knowledge.service';
import { OrchestratorService } from './orchestrator.service';
import { AiAdminController } from './ai-admin.controller';
import { AiBacklogSweeperService } from './ai-backlog-sweeper.service';

/**
 * Global so the WhatsApp inbound processor can inject {@link OrchestratorService}
 * without an explicit module import.
 */
@Global()
@Module({
  controllers: [AiAdminController],
  providers: [OpenAiService, KnowledgeService, OrchestratorService, AiBacklogSweeperService],
  exports: [OpenAiService, KnowledgeService, OrchestratorService],
})
export class AiModule {}
