import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { WhatsAppRealtimeModule } from '../realtime/realtime.module';
import { WhatsAppCallsService } from './calls.service';
import { WhatsAppCallsController } from './calls.controller';

// PrismaService, WhatsAppMetaClientFactory (meta module is @Global) and
// ConfigService are globally available; we import RealtimeModule for the
// publisher (CALL_ENDED fanout).
@Module({
  imports: [WhatsAppRealtimeModule, StorageModule],
  controllers: [WhatsAppCallsController],
  providers: [WhatsAppCallsService],
  // Exported so the AI orchestrator can send the bot's post-booking
  // call-permission request via requestCallPermission().
  exports: [WhatsAppCallsService],
})
export class WhatsAppCallsModule {}
