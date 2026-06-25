import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { WhatsAppMessagesController } from './messages.controller';
import { WhatsAppReengageController } from './reengage.controller';
import { WhatsAppMessagesService } from './messages.service';

@Module({
  imports: [StorageModule],
  controllers: [WhatsAppMessagesController, WhatsAppReengageController],
  providers: [WhatsAppMessagesService],
  exports: [WhatsAppMessagesService],
})
export class WhatsAppMessagesModule {}
