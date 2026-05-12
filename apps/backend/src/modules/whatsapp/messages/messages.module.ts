import { Module } from '@nestjs/common';
import { WhatsAppMessagesController } from './messages.controller';
import { WhatsAppMessagesService } from './messages.service';

@Module({
  controllers: [WhatsAppMessagesController],
  providers: [WhatsAppMessagesService],
  exports: [WhatsAppMessagesService],
})
export class WhatsAppMessagesModule {}
