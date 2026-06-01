import { Module } from '@nestjs/common';
import { WhatsAppRealtimeModule } from '../realtime/realtime.module';
import { WhatsAppCallsService } from './calls.service';
import { WhatsAppCallsController } from './calls.controller';

// PrismaService, WhatsAppMetaClientFactory (meta module is @Global) and
// ConfigService are globally available; we import RealtimeModule for the
// publisher (CALL_ENDED fanout).
@Module({
  imports: [WhatsAppRealtimeModule],
  controllers: [WhatsAppCallsController],
  providers: [WhatsAppCallsService],
})
export class WhatsAppCallsModule {}
