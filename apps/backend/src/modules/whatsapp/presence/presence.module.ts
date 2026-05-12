import { Module } from '@nestjs/common';
import { WhatsAppPresenceController } from './presence.controller';
import { WhatsAppPresenceService } from './presence.service';

@Module({
  controllers: [WhatsAppPresenceController],
  providers: [WhatsAppPresenceService],
  exports: [WhatsAppPresenceService],
})
export class WhatsAppPresenceModule {}
