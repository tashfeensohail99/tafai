import { Global, Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

/**
 * Global so any feature module (AI orchestrator, future Anthropic/Gemini
 * integrations) can inject {@link ApiKeysService} without re-importing.
 */
@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
