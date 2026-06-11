import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { WhatsAppMessagesController } from './messages.controller';
import { WhatsAppMessagesService } from './messages.service';

@Module({
  imports: [StorageModule],
  controllers: [WhatsAppMessagesController],
  providers: [WhatsAppMessagesService],
  exports: [WhatsAppMessagesService],
})
export class WhatsAppMessagesModule {}
